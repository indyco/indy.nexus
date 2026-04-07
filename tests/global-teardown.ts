/**
 * Playwright global teardown — removes the data-playwright directory
 * created by global-setup so no test artifacts linger.
 */
import fs from "fs";
import { PLAYWRIGHT_DATA_DIR } from "./global-setup";

export default async function globalTeardown() {
  fs.rmSync(PLAYWRIGHT_DATA_DIR, { recursive: true, force: true });
}
