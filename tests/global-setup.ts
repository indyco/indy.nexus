/**
 * Playwright global setup — seeds a dedicated data-playwright directory
 * with known admin/admin credentials so tests are deterministic without
 * touching the real data/ or data-test/ directories.
 */
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

export const PLAYWRIGHT_DATA_DIR = path.join(__dirname, "..", "data-playwright");

export default async function globalSetup() {
  // Wipe and recreate so every run starts clean
  fs.rmSync(PLAYWRIGHT_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(PLAYWRIGHT_DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(PLAYWRIGHT_DATA_DIR, "sessions"), { recursive: true });

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
  fs.writeFileSync(path.join(PLAYWRIGHT_DATA_DIR, "users.json"), JSON.stringify(users, null, 2));
}
