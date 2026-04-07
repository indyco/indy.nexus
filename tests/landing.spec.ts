import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders title bar and branding", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/indy\.nexus/);
    await expect(page.locator(".titlebar__logo")).toContainText("indy.nexus");
  });

  test("shows login and register actions", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#btn-login")).toBeVisible();
    await expect(page.locator("#btn-register")).toBeVisible();
  });

  test("shows feature cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".feature-card")).toHaveCount(2);
  });

  test("login button opens inline login form", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#inline-login");
    await expect(panel).not.toHaveClass(/open/);
    await page.click("#btn-login");
    await expect(panel).toHaveClass(/open/);
    await expect(page.locator("#inline-login-form")).toBeVisible();
  });

  test("L key opens inline login form", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#inline-login");
    await expect(panel).not.toHaveClass(/open/);
    await page.keyboard.press("l");
    await expect(panel).toHaveClass(/open/);
  });

  test("register button navigates to /register.html", async ({ page }) => {
    await page.goto("/");
    await page.click("#btn-register");
    await expect(page).toHaveURL(/register\.html/);
  });

  test("status bar shows online", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".statusbar .tag.green")).toContainText("Online");
  });
});
