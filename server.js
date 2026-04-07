/**
 * indy.nexus — TUI-styled game server hosting portal
 * Express server with session-based authentication and admin approval flow.
 */

"use strict";

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const compression = require("compression");
const FileStore = require("session-file-store")(session);

const proxmox = require("./proxmox");

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const IS_TEST_MODE = process.argv.includes("--test");
const SESSION_SECRET_FROM_ENV = process.env.SESSION_SECRET;

// Proxmox connection (required in live mode, ignored in --test mode)
const PROXMOX_HOST = process.env.PROXMOX_HOST || "";
const PROXMOX_NODE = process.env.PROXMOX_NODE || "";
const PROXMOX_TOKEN_ID = process.env.PROXMOX_TOKEN_ID || "";
const PROXMOX_TOKEN_SECRET = process.env.PROXMOX_TOKEN_SECRET || "";
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
let SESSION_SECRET = SESSION_SECRET_FROM_ENV;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  if (IS_TEST_MODE) {
    SESSION_SECRET = crypto.randomBytes(32).toString("hex");
    console.warn("[config] SESSION_SECRET is missing/short; generated an ephemeral secret for --test mode.");
  } else {
    throw new Error("[config] SESSION_SECRET must be set and at least 32 characters long.");
  }
}

// ---------------------------------------------------------------------------
// Data persistence helpers (JSON file store — simple, no DB required)
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, IS_TEST_MODE ? "data-test" : "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SERVICES_FILE = path.join(DATA_DIR, "services.json");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function ensureSessionDir() {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findUser(predicate) {
  return loadUsers().find(predicate);
}

/**
 * Load the service→VMID mapping from data/services.json.
 * Returns an empty array if the file does not exist (live mode will have
 * nothing to manage until the admin populates it).
 */
function loadServiceConfig() {
  if (!fs.existsSync(SERVICES_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(SERVICES_FILE, "utf8"));
  } catch {
    console.error("[config] Failed to parse data/services.json");
    return [];
  }
}

function generateTemporaryPassword(length = 8) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    const idx = crypto.randomInt(0, charset.length);
    result += charset[idx];
  }
  return result;
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asTrimmedString(value) {
  return asString(value).trim();
}


function isValidUserId(value) {
  return UUID_PATTERN.test(value);
}

function isValidServiceId(value) {
  return SERVICE_ID_PATTERN.test(value);
}

function requireValidUserIdParam(req, res, next) {
  if (!isValidUserId(asTrimmedString(req.params.id))) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  next();
}

function requireValidServiceIdParam(req, res, next) {
  if (!isValidServiceId(asTrimmedString(req.params.id))) {
    return res.status(400).json({ error: "Invalid service id" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Bootstrap admin account (username: admin, password: admin — change on first run)
// ---------------------------------------------------------------------------

async function bootstrapAdmin() {
  const users = loadUsers();
  if (!users.find((u) => u.role === "admin")) {
const hash = await bcrypt.hash("admin", 10);
    users.push({
      id: uuidv4(),
      username: "admin",
      passwordHash: hash,
      role: "admin",
      status: "approved",
      createdAt: new Date().toISOString(),
    });
    saveUsers(users);
    console.log(
      "[bootstrap] Admin account created — username: admin  password: admin"
    );
    console.log("[bootstrap] Change the admin password after first login!");
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
ensureSessionDir();

app.disable("x-powered-by");
app.use(compression());
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: IS_PRODUCTION ? undefined : false,
    referrerPolicy: { policy: "no-referrer" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: "same-origin" },
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "indy.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
      path: SESSIONS_DIR,
      ttl: 24 * 60 * 60,
      retries: 0,
      reapInterval: 60 * 60,
      logFn: () => {},
    }),
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      // Enable secure flag in production (HTTPS). For local dev over HTTP, keep false.
      secure: IS_PRODUCTION,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------

// Strict rate limit for auth endpoints (login / register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in 15 minutes." },
});

// Moderate rate limit for admin write actions
const adminWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// ---------------------------------------------------------------------------
// Auth middleware helpers
// ---------------------------------------------------------------------------

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const user = findUser((u) => u.id === req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Session is no longer valid" });
  }
  if (user.status !== "approved") {
    req.session.destroy(() => {});
    return res.status(403).json({ error: "Account is not approved" });
  }
  req.session.role = user.role;
  req.session.mustChangePassword = !!user.mustChangePassword;
  req.currentUser = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const user = findUser((u) => u.id === req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Session is no longer valid" });
  }
  if (user.status !== "approved") {
    req.session.destroy(() => {});
    return res.status(403).json({ error: "Account is not approved" });
  }
  if (user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (user.mustChangePassword) {
    return res.status(403).json({ error: "Password reset required before continuing" });
  }
  req.session.role = user.role;
  req.session.mustChangePassword = !!user.mustChangePassword;
  req.currentUser = user;
  next();
}

function requirePasswordResetComplete(req, res, next) {
  if (req.currentUser?.mustChangePassword) {
    return res.status(403).json({ error: "Password reset required before continuing" });
  }
  next();
}

// ---------------------------------------------------------------------------
// CSRF protection helper
// All state-changing API requests from the browser must include the
// X-Requested-With header, which browsers cannot set cross-origin without
// a CORS preflight (which this server does not allow). Combined with
// sameSite:strict on the session cookie this prevents CSRF attacks.
// ---------------------------------------------------------------------------

function requireCsrfHeader(req, res, next) {
  if (req.headers["x-requested-with"] !== "XMLHttpRequest") {
    return res.status(403).json({ error: "CSRF check failed" });
  }
  next();
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// GET /api/health — public health check (no auth required)
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    mode: IS_TEST_MODE ? "test" : "live",
  });
});

// GET /api/me — current session info
app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.json({ authenticated: false });
  }
  const user = findUser((u) => u.id === req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    username: user.username,
    role: user.role,
    status: user.status,
    mustChangePassword: !!user.mustChangePassword,
  });
});

// POST /api/register
app.post("/api/register", authLimiter, requireCsrfHeader, async (req, res) => {
  const username = asTrimmedString(req.body?.username);
  const password = asString(req.body?.password);

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: "Username must be 3–32 characters" });
  }
  if (!USERNAME_PATTERN.test(username)) {
    return res
      .status(400)
      .json({ error: "Username may only contain letters, numbers, _ and -" });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ error: "Password must be 128 characters or fewer" });
  }

  const users = loadUsers();
  if (users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
    // Intentionally return the same response as a normal registration to
    // prevent non-admin username enumeration.
    return res.status(201).json({
      message: "Registration successful. Your account is awaiting admin approval.",
    });
  }

  const hash = await bcrypt.hash(password, 10);
  users.push({
    id: uuidv4(),
    username,
    passwordHash: hash,
    role: "user",
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);

  console.log(`[audit] User registered: "${username}"`);
  res.status(201).json({
    message: "Registration successful. Your account is awaiting admin approval.",
  });
});

// POST /api/login
app.post("/api/login", authLimiter, requireCsrfHeader, async (req, res) => {
  const username = asTrimmedString(req.body?.username);
  const password = asString(req.body?.password);

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = findUser(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  if (user.status === "pending") {
    return res
      .status(403)
      .json({ error: "Account pending admin approval. Please check back later." });
  }
  if (user.status === "denied") {
    return res
      .status(403)
      .json({ error: "Account access has been denied. Contact an admin." });
  }

  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).json({ error: "Failed to establish session" });
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.mustChangePassword = !!user.mustChangePassword;

    res.json({
      message: user.mustChangePassword
        ? "Login successful. You must reset your password before continuing."
        : "Login successful",
      username: user.username,
      role: user.role,
      mustChangePassword: !!user.mustChangePassword,
    });
  });
});

// POST /api/logout
app.post("/api/logout", requireCsrfHeader, (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out" });
  });
});

// GET /api/admin/users — list all users (admin only)
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = loadUsers()
    .map(({ id, username, role, status, createdAt, mustChangePassword }) => ({
      id,
      username,
      role,
      status,
      createdAt,
      mustChangePassword: !!mustChangePassword,
    }));
  res.json(users);
});


// POST /api/admin/users/:id/approve
app.post("/api/admin/users/:id/approve", adminWriteLimiter, requireAdmin, requireValidUserIdParam, requireCsrfHeader, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.status = "approved";
  saveUsers(users);
  console.log(`[audit] Admin "${req.currentUser.username}" approved user "${user.username}"`);
  res.json({ message: `User "${user.username}" approved` });
});

// POST /api/admin/users/:id/deny
app.post("/api/admin/users/:id/deny", adminWriteLimiter, requireAdmin, requireValidUserIdParam, requireCsrfHeader, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.status = "denied";
  saveUsers(users);
  console.log(`[audit] Admin "${req.currentUser.username}" denied user "${user.username}"`);
  res.json({ message: `User "${user.username}" denied` });
});

// POST /api/admin/users/:id/revoke — revert back to pending
app.post("/api/admin/users/:id/revoke", adminWriteLimiter, requireAdmin, requireValidUserIdParam, requireCsrfHeader, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.status = "pending";
  saveUsers(users);
  console.log(`[audit] Admin "${req.currentUser.username}" revoked user "${user.username}"`);
  res.json({ message: `User "${user.username}" reverted to pending` });
});

// POST /api/admin/users/:id/reset-password — generate temporary password and force reset on next login
app.post("/api/admin/users/:id/reset-password", adminWriteLimiter, requireAdmin, requireValidUserIdParam, requireCsrfHeader, async (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  if (user.role === "admin") {
    return res.status(400).json({ error: "Admin passwords cannot be reset from this action" });
  }
  if (user.status !== "approved") {
    return res.status(400).json({ error: "Only approved users can have their password reset" });
  }

  const temporaryPassword = generateTemporaryPassword(8);
  user.passwordHash = await bcrypt.hash(temporaryPassword, 10);
  user.mustChangePassword = true;
  user.passwordResetIssuedAt = new Date().toISOString();
  saveUsers(users);

  console.log(`[audit] Admin "${req.currentUser.username}" reset password for user "${user.username}"`);
  res.json({
    message: `Password reset for "${user.username}"`,
    temporaryPassword,
  });
});

// POST /api/account/reset-password — complete forced password reset using temporary password session
app.post("/api/account/reset-password", authLimiter, requireAuth, requireCsrfHeader, async (req, res) => {
  const newPassword = asString(req.body?.newPassword);
  const confirmPassword = asString(req.body?.confirmPassword);
  if (!newPassword || !confirmPassword) {
    return res.status(400).json({ error: "Both password fields are required" });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "Passwords do not match" });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password must be 128 characters or fewer" });
  }

  const users = loadUsers();
  const user = users.find((u) => u.id === req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Session is no longer valid" });
  }
  if (!user.mustChangePassword) {
    return res.status(400).json({ error: "Password reset is not required for this account" });
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    return res.status(400).json({ error: "New password must be different from the temporary password" });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  delete user.temporaryPassword;
  delete user.temporaryPasswordCreatedAt;
  delete user.passwordResetIssuedAt;
  saveUsers(users);

  req.session.mustChangePassword = false;
  res.json({ message: "Password updated successfully" });
});

// POST /api/account/change-password — self-service password change for approved users
app.post("/api/account/change-password", authLimiter, requireAuth, requirePasswordResetComplete, requireCsrfHeader, async (req, res) => {
  const currentPassword = asString(req.body?.currentPassword);
  const newPassword = asString(req.body?.newPassword);
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Both fields are required" });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "New password must be 128 characters or fewer" });
  }
  const users = loadUsers();
  const user = users.find((u) => u.id === req.session.userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsers(users);
  console.log(`[audit] User "${user.username}" changed their password`);
  res.json({ message: "Password changed successfully" });
});

// ---------------------------------------------------------------------------
// System monitoring helpers
// ---------------------------------------------------------------------------

// --- Test-mode local monitoring (used when --test is active) ---------------

let prevCpuInfo = null;

function getLocalCpuPercent() {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  cpus.forEach((cpu) => {
    for (const type in cpu.times) total += cpu.times[type];
    idle += cpu.times.idle;
  });
  if (!prevCpuInfo) {
    prevCpuInfo = { idle, total };
    return 0;
  }
  const idleDiff = idle - prevCpuInfo.idle;
  const totalDiff = total - prevCpuInfo.total;
  prevCpuInfo = { idle, total };
  return totalDiff === 0 ? 0 : Math.round((1 - idleDiff / totalDiff) * 100);
}

function getLocalRamInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    total,
    used,
    free,
    percent: Math.round((used / total) * 100),
  };
}

// Simulated GPU utilisation (test mode only)
let gpuBase = 15;
function getTestGpuPercent() {
  gpuBase += (Math.random() - 0.5) * 6;
  gpuBase = Math.max(0, Math.min(100, gpuBase));
  return Math.round(gpuBase);
}

/**
 * Build a system resource snapshot.
 * Test mode: uses local os metrics + simulated GPU.
 * Live mode: queries the Proxmox host node for real metrics.
 */
async function getSystemSnapshot() {
  if (IS_TEST_MODE) {
    const ram = getLocalRamInfo();
    return {
      cpu: { percent: getLocalCpuPercent(), cores: os.cpus().length },
      ram: {
        percent: ram.percent,
        usedMb: Math.round(ram.used / 1048576),
        totalMb: Math.round(ram.total / 1048576),
      },
      gpu: {
        percent: getTestGpuPercent(),
        name: "NVIDIA GeForce RTX 3070",
      },
      uptime: os.uptime(),
    };
  }

  // Live mode — Proxmox node status
  const node = await proxmox.getNodeStatus();
  const cpuPercent = Math.round((node.cpu || 0) * 100);
  const totalMb = Math.round((node.memory?.total || 0) / 1048576);
  const usedMb = Math.round((node.memory?.used || 0) / 1048576);
  const ramPercent = totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0;

  return {
    cpu: { percent: cpuPercent, cores: node.cpuinfo?.cpus || 0 },
    ram: { percent: ramPercent, usedMb, totalMb },
    gpu: { percent: 0, name: "GPU monitoring not available" },
    uptime: node.uptime || 0,
  };
}

// ---------------------------------------------------------------------------
// Game-server service management
// ---------------------------------------------------------------------------

// --- Test-mode in-memory services -----------------------------------------

const TEST_SERVICES = [
  { id: "mc-1",  name: "minecraft-survival", game: "Minecraft", port: 25565, status: "running",  pid: 2041, uptimeSec: 86400 * 3 + 7200,  cpuPercent: 12, ramMb: 2048, players: 8,  maxPlayers: 20 },
  { id: "val-1", name: "valheim-dedicated",   game: "Valheim",   port: 2456,  status: "running",  pid: 2187, uptimeSec: 86400 + 3600,       cpuPercent: 8,  ramMb: 1536, players: 3,  maxPlayers: 10 },
  { id: "cs-1",  name: "cs2-competitive",     game: "CS2",       port: 27015, status: "stopped",  pid: null, uptimeSec: 0,                  cpuPercent: 0,  ramMb: 0,    players: 0,  maxPlayers: 10 },
  { id: "mc-2",  name: "minecraft-creative",  game: "Minecraft", port: 25566, status: "stopped",  pid: null, uptimeSec: 0,                  cpuPercent: 0,  ramMb: 0,    players: 0,  maxPlayers: 16 },
  { id: "ark-1", name: "ark-survival",        game: "ARK",       port: 7777,  status: "starting", pid: 3012, uptimeSec: 45,                 cpuPercent: 34, ramMb: 3072, players: 0,  maxPlayers: 32 },
];

function testListServices() {
  return TEST_SERVICES.map((s) => ({
    ...s,
    cpuPercent: s.status === "running"
      ? Math.min(100, Math.max(0, s.cpuPercent + Math.round((Math.random() - 0.5) * 4)))
      : s.cpuPercent,
    players: s.status === "running"
      ? Math.min(s.maxPlayers, Math.max(0, s.players + Math.round((Math.random() - 0.5) * 2)))
      : 0,
  }));
}

function testFindService(id) {
  return TEST_SERVICES.find((s) => s.id === id);
}

function testStartService(svc) {
  svc.status = "running";
  svc.pid = 3000 + Math.floor(Math.random() * 1000);
  svc.uptimeSec = 0;
  svc.cpuPercent = Math.round(Math.random() * 15) + 5;
  svc.ramMb = Math.round(Math.random() * 1024) + 512;
}

function testStopService(svc) {
  svc.status = "stopped";
  svc.pid = null;
  svc.uptimeSec = 0;
  svc.cpuPercent = 0;
  svc.ramMb = 0;
  svc.players = 0;
}

function testRestartService(svc) {
  svc.status = "running";
  svc.pid = 3000 + Math.floor(Math.random() * 1000);
  svc.uptimeSec = 0;
  svc.cpuPercent = Math.round(Math.random() * 15) + 5;
  svc.ramMb = Math.round(Math.random() * 1024) + 512;
}

// --- Live-mode Proxmox-backed services ------------------------------------

/**
 * Map a Proxmox container status response + our config entry into the shape
 * the frontend expects.
 */
function mapContainerToService(cfg, ct) {
  const status = ct.status || "unknown";    // "running" | "stopped" | …
  const isRunning = status === "running";
  return {
    id: cfg.id,
    name: cfg.name,
    game: cfg.game,
    port: cfg.port,
    maxPlayers: cfg.maxPlayers,
    status,
    pid: ct.pid || null,
    uptimeSec: ct.uptime || 0,
    cpuPercent: isRunning ? Math.round((ct.cpu || 0) * 100) : 0,
    ramMb: isRunning ? Math.round((ct.mem || 0) / 1048576) : 0,
    players: 0, // player count requires game-specific integration (future)
  };
}

/**
 * List all configured services with live status from Proxmox.
 */
async function listLiveServices() {
  if (IS_TEST_MODE) return testListServices();

  const configs = loadServiceConfig();
  const results = await Promise.allSettled(
    configs.map(async (cfg) => {
      const ct = await proxmox.getContainerStatus(cfg.vmid);
      return mapContainerToService(cfg, ct);
    })
  );
  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Find a single service by its config id and fetch its live status.
 * Returns { cfg, status } or null.
 */
async function findServiceLive(id) {
  if (IS_TEST_MODE) {
    const svc = testFindService(id);
    return svc ? { cfg: svc, status: svc } : null;
  }
  const cfg = loadServiceConfig().find((s) => s.id === id);
  if (!cfg) return null;
  const ct = await proxmox.getContainerStatus(cfg.vmid);
  return { cfg, status: mapContainerToService(cfg, ct) };
}

// GET /api/admin/system — live system resource snapshot
app.get("/api/admin/system", requireAdmin, async (req, res) => {
  try {
    const snapshot = await getSystemSnapshot();
    res.json(snapshot);
  } catch (err) {
    console.error("[api] /api/admin/system error:", err.message);
    res.status(502).json({ error: "Failed to fetch system metrics" });
  }
});

// GET /api/services — running game-server processes (authenticated users)
app.get("/api/services", requireAuth, requirePasswordResetComplete, async (req, res) => {
  try {
    res.json(await listLiveServices());
  } catch (err) {
    console.error("[api] /api/services error:", err.message);
    res.status(502).json({ error: "Failed to fetch services" });
  }
});

// GET /api/admin/services — running game-server processes
app.get("/api/admin/services", requireAdmin, async (req, res) => {
  try {
    res.json(await listLiveServices());
  } catch (err) {
    console.error("[api] /api/admin/services error:", err.message);
    res.status(502).json({ error: "Failed to fetch services" });
  }
});

// --- Service action helper (DRY for start/stop/restart) -------------------

async function handleServiceAction(req, res, action) {
  const id = req.params.id;
  try {
    const result = await findServiceLive(id);
    if (!result) return res.status(404).json({ error: "Service not found" });

    const { cfg, status: svc } = result;

    if (IS_TEST_MODE) {
      // Test mode: mutate in-memory array
      const testSvc = testFindService(id);
      if (!testSvc) return res.status(404).json({ error: "Service not found" });
      if (action === "start") {
        if (testSvc.status === "running") return res.status(400).json({ error: "Service is already running" });
        testStartService(testSvc);
      } else if (action === "stop") {
        if (testSvc.status === "stopped") return res.status(400).json({ error: "Service is already stopped" });
        testStopService(testSvc);
      } else {
        testRestartService(testSvc);
      }
      return res.json({ message: `Service "${testSvc.name}" ${action === "restart" ? "restarted" : action + "ed"}` });
    }

    // Live mode: call Proxmox API
    if (action === "start") {
      if (svc.status === "running") return res.status(400).json({ error: "Service is already running" });
      await proxmox.startContainer(cfg.vmid);
    } else if (action === "stop") {
      if (svc.status === "stopped") return res.status(400).json({ error: "Service is already stopped" });
      await proxmox.stopContainer(cfg.vmid);
    } else {
      await proxmox.rebootContainer(cfg.vmid);
    }
    res.json({ message: `Service "${cfg.name}" ${action === "restart" ? "restarted" : action + "ed"}` });
  } catch (err) {
    console.error(`[api] service ${action} error:`, err.message);
    res.status(502).json({ error: `Failed to ${action} service` });
  }
}

// POST /api/services/:id/start|stop|restart (authenticated users)
app.post("/api/services/:id/start", adminWriteLimiter, requireAuth, requirePasswordResetComplete, requireValidServiceIdParam, requireCsrfHeader, (req, res) => handleServiceAction(req, res, "start"));
app.post("/api/services/:id/stop", adminWriteLimiter, requireAuth, requirePasswordResetComplete, requireValidServiceIdParam, requireCsrfHeader, (req, res) => handleServiceAction(req, res, "stop"));
app.post("/api/services/:id/restart", adminWriteLimiter, requireAuth, requirePasswordResetComplete, requireValidServiceIdParam, requireCsrfHeader, (req, res) => handleServiceAction(req, res, "restart"));

// POST /api/admin/services/:id/start|stop|restart (admin only)
app.post("/api/admin/services/:id/start", adminWriteLimiter, requireAdmin, requireValidServiceIdParam, requireCsrfHeader, (req, res) => handleServiceAction(req, res, "start"));
app.post("/api/admin/services/:id/stop", adminWriteLimiter, requireAdmin, requireValidServiceIdParam, requireCsrfHeader, (req, res) => handleServiceAction(req, res, "stop"));
app.post("/api/admin/services/:id/restart", adminWriteLimiter, requireAdmin, requireValidServiceIdParam, requireCsrfHeader, (req, res) => handleServiceAction(req, res, "restart"));

// POST /api/admin/change-password
app.post("/api/admin/change-password", adminWriteLimiter, requireAdmin, requireCsrfHeader, async (req, res) => {
  const currentPassword = asString(req.body?.currentPassword);
  const newPassword = asString(req.body?.newPassword);
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Both fields are required" });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "New password must be 128 characters or fewer" });
  }
  const users = loadUsers();
  const admin = users.find((u) => u.id === req.session.userId);
  if (!admin || !(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  admin.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsers(users);
  console.log(`[audit] Admin "${admin.username}" changed their password`);
  res.json({ message: "Password changed successfully" });
});

// POST /api/admin/rename-user
app.post("/api/admin/rename-user", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const userId = asTrimmedString(req.body?.userId);
  const newUsername = asTrimmedString(req.body?.newUsername);
  
  if (!userId || !newUsername) {
    return res.status(400).json({ error: "User ID and new username are required" });
  }
  if (!isValidUserId(userId)) {
    return res.status(400).json({ error: "Invalid user id" });
  }
  
  // Validate username format
  if (newUsername.length < 3 || newUsername.length > 32) {
    return res.status(400).json({ error: "Username must be 3–32 characters" });
  }
  if (!USERNAME_PATTERN.test(newUsername)) {
    return res.status(400).json({ error: "Username may only contain letters, numbers, _ and -" });
  }
  
  const users = loadUsers();
  
  // Check if new username is already taken (case-insensitive)
  const existingUser = users.find((u) => u.username.toLowerCase() === newUsername.toLowerCase() && u.id !== userId);
  if (existingUser) {
    return res.status(409).json({ error: "Username already taken" });
  }
  
  // Find the user to rename
  const userToRename = users.find((u) => u.id === userId);
  if (!userToRename) {
    return res.status(404).json({ error: "User not found" });
  }
  
  const oldUsername = userToRename.username;
  userToRename.username = newUsername;
  saveUsers(users);
  console.log(`[audit] Admin "${req.currentUser.username}" renamed user "${oldUsername}" to "${newUsername}"`);
  
  // Update session if admin renamed themselves
  if (userId === req.session.userId) {
    res.json({ message: `Username changed from "${oldUsername}" to "${newUsername}"`, selfRenamed: true });
  } else {
    res.json({ message: `User "${oldUsername}" renamed to "${newUsername}"` });
  }
});

// JSON 404 fallback for unknown API routes (all HTTP methods)
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// ---------------------------------------------------------------------------
// Fallback: serve index.html for any unknown route (SPA-style navigation)
// ---------------------------------------------------------------------------

const staticLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

app.get("*", staticLimiter, (req, res) => {
  // Only serve index.html for non-API, non-static requests
  if (!req.path.startsWith("/api/")) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Validate Proxmox config in live mode and initialise the API client.
if (!IS_TEST_MODE) {
  const missing = [];
  if (!PROXMOX_HOST) missing.push("PROXMOX_HOST");
  if (!PROXMOX_NODE) missing.push("PROXMOX_NODE");
  if (!PROXMOX_TOKEN_ID) missing.push("PROXMOX_TOKEN_ID");
  if (!PROXMOX_TOKEN_SECRET) missing.push("PROXMOX_TOKEN_SECRET");
  if (missing.length) {
    throw new Error(
      `[config] Missing required Proxmox environment variables: ${missing.join(", ")}. ` +
        "Set them or start with --test for dummy data."
    );
  }
  proxmox.configure({
    host: PROXMOX_HOST,
    node: PROXMOX_NODE,
    tokenId: PROXMOX_TOKEN_ID,
    tokenSecret: PROXMOX_TOKEN_SECRET,
  });
  console.log(`[config] Proxmox API configured (host: ${PROXMOX_HOST}, node: ${PROXMOX_NODE})`);
}

bootstrapAdmin().then(() => {
  const server = app.listen(PORT, () => {
    if (IS_TEST_MODE) {
      console.log("[mode] Test mode enabled (dummy service data active)");
    } else {
      const serviceCount = loadServiceConfig().length;
      console.log(`[mode] Live mode — Proxmox integration active (${serviceCount} service(s) configured)`);
    }
    console.log(`[server] indy.nexus running on http://localhost:${PORT}`);
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  function shutdown(signal) {
    console.log(`\n[server] Received ${signal}, shutting down gracefully…`);
    server.close(() => {
      console.log("[server] HTTP server closed.");
      process.exit(0);
    });
    // Force exit after 10 seconds if connections won't close
    setTimeout(() => {
      console.error("[server] Forcing exit after timeout.");
      process.exit(1);
    }, 10000).unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
});
