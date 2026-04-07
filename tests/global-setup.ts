/**
 * Playwright global setup — seeds a clean data-test directory with a
 * known admin/admin account so tests have deterministic credentials.
 */
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

export default async function globalSetup() {
  const dataDir = path.join(__dirname, "..", "data-test");

  // Safety: never operate on the real data directory
  if (!path.basename(dataDir).includes("test")) {
    throw new Error(`Global setup refusing to touch non-test directory: ${dataDir}`);
  }

  // Ensure the directory exists
  fs.mkdirSync(dataDir, { recursive: true });

  // Seed admin user with a fresh bcrypt hash
  const adminHash = await bcrypt.hash("admin", 10);

  const users = [
    {
      id: "00000000-0000-4000-8000-000000000000",
      username: "admin",
      passwordHash: adminHash,
      role: "admin",
      status: "approved",
      createdAt: new Date().toISOString(),
    },
  ];
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify(users, null, 2));

  // Clear stale sessions
  const sessionsDir = path.join(dataDir, "sessions");
  if (fs.existsSync(sessionsDir)) {
    for (const file of fs.readdirSync(sessionsDir)) {
      fs.unlinkSync(path.join(sessionsDir, file));
    }
  }
}
