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
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "indy-nexus-dev-secret-change-in-prod";

// ---------------------------------------------------------------------------
// Data persistence helpers (JSON file store — simple, no DB required)
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

// ---------------------------------------------------------------------------
// Bootstrap admin account (username: admin, password: admin — change on first run)
// ---------------------------------------------------------------------------

function bootstrapAdmin() {
  const users = loadUsers();
  if (!users.find((u) => u.role === "admin")) {
    const hash = bcrypt.hashSync("admin", 10);
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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      // Enable secure flag in production (HTTPS). For local dev over HTTP, keep false.
      secure: process.env.NODE_ENV === "production",
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
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
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
  });
});

// POST /api/register
app.post("/api/register", authLimiter, requireCsrfHeader, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: "Username must be 3–32 characters" });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return res
      .status(400)
      .json({ error: "Username may only contain letters, numbers, _ and -" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }

  const users = loadUsers();
  if (users.find((u) => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const hash = bcrypt.hashSync(password, 10);
  users.push({
    id: uuidv4(),
    username,
    passwordHash: hash,
    role: "user",
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  saveUsers(users);

  res.status(201).json({
    message: "Registration successful. Your account is awaiting admin approval.",
  });
});

// POST /api/login
app.post("/api/login", authLimiter, requireCsrfHeader, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = findUser(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
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

  req.session.userId = user.id;
  req.session.role = user.role;

  res.json({
    message: "Login successful",
    username: user.username,
    role: user.role,
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
    .map(({ id, username, role, status, createdAt }) => ({
      id,
      username,
      role,
      status,
      createdAt,
    }));
  res.json(users);
});

// GET /api/admin/all-users — list ALL users including admins (admin only, for rename feature)
app.get("/api/admin/all-users", requireAdmin, (req, res) => {
  const users = loadUsers()
    .map(({ id, username, role, status, createdAt }) => ({
      id,
      username,
      role,
      status,
      createdAt,
    }));
  res.json(users);
});

// POST /api/admin/users/:id/approve
app.post("/api/admin/users/:id/approve", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.status = "approved";
  saveUsers(users);
  res.json({ message: `User "${user.username}" approved` });
});

// POST /api/admin/users/:id/deny
app.post("/api/admin/users/:id/deny", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.status = "denied";
  saveUsers(users);
  res.json({ message: `User "${user.username}" denied` });
});

// POST /api/admin/users/:id/revoke — revert back to pending
app.post("/api/admin/users/:id/revoke", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  user.status = "pending";
  saveUsers(users);
  res.json({ message: `User "${user.username}" reverted to pending` });
});

// ---------------------------------------------------------------------------
// System monitoring helpers
// ---------------------------------------------------------------------------

let prevCpuInfo = null;

function getCpuPercent() {
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

function getRamInfo() {
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

// Simulated GPU utilisation (varies realistically over time)
let gpuBase = 15;
function getGpuPercent() {
  gpuBase += (Math.random() - 0.5) * 6;
  gpuBase = Math.max(0, Math.min(100, gpuBase));
  return Math.round(gpuBase);
}

// Simulated game-server service list
const SERVICES = [
  { id: "mc-1",  name: "minecraft-survival", game: "Minecraft", port: 25565, status: "running",  pid: 2041, uptimeSec: 86400 * 3 + 7200,  cpuPercent: 12, ramMb: 2048, players: 8,  maxPlayers: 20 },
  { id: "val-1", name: "valheim-dedicated",   game: "Valheim",   port: 2456,  status: "running",  pid: 2187, uptimeSec: 86400 + 3600,       cpuPercent: 8,  ramMb: 1536, players: 3,  maxPlayers: 10 },
  { id: "cs-1",  name: "cs2-competitive",     game: "CS2",       port: 27015, status: "stopped",  pid: null, uptimeSec: 0,                  cpuPercent: 0,  ramMb: 0,    players: 0,  maxPlayers: 10 },
  { id: "mc-2",  name: "minecraft-creative",  game: "Minecraft", port: 25566, status: "stopped",  pid: null, uptimeSec: 0,                  cpuPercent: 0,  ramMb: 0,    players: 0,  maxPlayers: 16 },
  { id: "ark-1", name: "ark-survival",        game: "ARK",       port: 7777,  status: "starting", pid: 3012, uptimeSec: 45,                 cpuPercent: 34, ramMb: 3072, players: 0,  maxPlayers: 32 },
];

// GET /api/admin/system — live system resource snapshot
app.get("/api/admin/system", requireAdmin, (req, res) => {
  const ram = getRamInfo();
  res.json({
    cpu: { percent: getCpuPercent(), cores: os.cpus().length },
    ram: {
      percent: ram.percent,
      usedMb: Math.round(ram.used / 1048576),
      totalMb: Math.round(ram.total / 1048576),
    },
    gpu: { percent: getGpuPercent(), name: "NVIDIA GeForce RTX 3070" },
    uptime: os.uptime(),
  });
});

// GET /api/admin/services — running game-server processes
app.get("/api/admin/services", requireAdmin, (req, res) => {
  // Add small random jitter to make CPU numbers feel live
  const live = SERVICES.map((s) => ({
    ...s,
    cpuPercent: s.status === "running"
      ? Math.min(100, Math.max(0, s.cpuPercent + Math.round((Math.random() - 0.5) * 4)))
      : s.cpuPercent,
    players: s.status === "running"
      ? Math.min(s.maxPlayers, Math.max(0, s.players + Math.round((Math.random() - 0.5) * 2)))
      : 0,
  }));
  res.json(live);
});

// POST /api/admin/services/:id/start
app.post("/api/admin/services/:id/start", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const svc = SERVICES.find((s) => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: "Service not found" });
  if (svc.status === "running") return res.status(400).json({ error: "Service is already running" });
  svc.status = "running";
  svc.pid = 3000 + Math.floor(Math.random() * 1000);
  svc.uptimeSec = 0;
  svc.cpuPercent = Math.round(Math.random() * 15) + 5;
  svc.ramMb = Math.round(Math.random() * 1024) + 512;
  res.json({ message: `Service "${svc.name}" started` });
});

// POST /api/admin/services/:id/stop
app.post("/api/admin/services/:id/stop", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const svc = SERVICES.find((s) => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: "Service not found" });
  if (svc.status === "stopped") return res.status(400).json({ error: "Service is already stopped" });
  svc.status = "stopped";
  svc.pid = null;
  svc.uptimeSec = 0;
  svc.cpuPercent = 0;
  svc.ramMb = 0;
  svc.players = 0;
  res.json({ message: `Service "${svc.name}" stopped` });
});

// POST /api/admin/services/:id/restart
app.post("/api/admin/services/:id/restart", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const svc = SERVICES.find((s) => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: "Service not found" });
  svc.status = "running";
  svc.pid = 3000 + Math.floor(Math.random() * 1000);
  svc.uptimeSec = 0;
  svc.cpuPercent = Math.round(Math.random() * 15) + 5;
  svc.ramMb = Math.round(Math.random() * 1024) + 512;
  res.json({ message: `Service "${svc.name}" restarted` });
});

// POST /api/admin/change-password
app.post("/api/admin/change-password", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Both fields are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  const users = loadUsers();
  const admin = users.find((u) => u.id === req.session.userId);
  if (!admin || !bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveUsers(users);
  res.json({ message: "Password changed successfully" });
});

// POST /api/admin/rename-user
app.post("/api/admin/rename-user", adminWriteLimiter, requireAdmin, requireCsrfHeader, (req, res) => {
  const { userId, newUsername } = req.body;
  
  if (!userId || !newUsername) {
    return res.status(400).json({ error: "User ID and new username are required" });
  }
  
  // Validate username format
  if (newUsername.length < 3 || newUsername.length > 32) {
    return res.status(400).json({ error: "Username must be 3–32 characters" });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
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
  
  // Update session if admin renamed themselves
  if (userId === req.session.userId) {
    res.json({ message: `Username changed from "${oldUsername}" to "${newUsername}"`, selfRenamed: true });
  } else {
    res.json({ message: `User "${oldUsername}" renamed to "${newUsername}"` });
  }
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

bootstrapAdmin();
app.listen(PORT, () => {
  console.log(`[server] indy.nexus running on http://localhost:${PORT}`);
});
