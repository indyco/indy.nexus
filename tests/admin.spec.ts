import { test, expect, type Page } from "@playwright/test";

/** Login as admin and return the page already on /admin.html */
async function loginAsAdmin(page: Page) {
  await page.goto("/login.html");
  await page.fill("#username", "admin");
  await page.fill("#password", "admin");
  await page.click("#submit-btn");
  await expect(page).toHaveURL(/admin\.html/, { timeout: 5000 });
}

test.describe("Admin panel", () => {
  test("shows sidebar with all sections", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.locator("[data-tab='services']")).toBeVisible();
    await expect(page.locator("[data-tab='resources']")).toBeVisible();
    await expect(page.locator("[data-tab='pending']")).toBeVisible();
    await expect(page.locator("[data-tab='all-users']")).toBeVisible();
    await expect(page.locator("[data-tab='settings']")).toBeVisible();
  });

  test("services tab loads game servers", async ({ page }) => {
    await loginAsAdmin(page);
    await page.click("[data-tab='services']");
    // Wait for services to load (test mode has 5 dummy services)
    await expect(page.locator("#services-tbody tr")).toHaveCount(5, { timeout: 10000 });
  });

  test("resources tab shows CPU, RAM, GPU cards", async ({ page }) => {
    await loginAsAdmin(page);
    await page.click("[data-tab='resources']");
    await expect(page.locator("#res-cpu-pct")).toBeVisible();
    await expect(page.locator("#res-ram-pct")).toBeVisible();
    await expect(page.locator("#res-gpu-pct")).toBeVisible();
  });

  test("settings tab shows change password form", async ({ page }) => {
    await loginAsAdmin(page);
    await page.click("[data-tab='settings']");
    await page.click("#toggle-change-password-panel");
    await expect(page.locator("#change-password-form")).toBeVisible();
  });

  test("keyboard shortcut ? opens help dialog", async ({ page }) => {
    await loginAsAdmin(page);
    await page.keyboard.press("?");
    await expect(page.locator("#help-dialog")).not.toHaveClass(/hidden/);
  });
});
