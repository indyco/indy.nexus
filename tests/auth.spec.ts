import { test, expect } from "@playwright/test";

test.describe("Login", () => {
  test("shows login form", async ({ page }) => {
    await page.goto("/login.html");
    await expect(page).toHaveTitle(/Login/);
    await expect(page.locator("#login-form")).toBeVisible();
    await expect(page.locator("#username")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
  });

  test("rejects empty submission", async ({ page }) => {
    await page.goto("/login.html");
    await page.click("#submit-btn");
    await expect(page.locator("#alert-area .alert--error")).toBeVisible();
  });

  test("rejects wrong credentials", async ({ page }) => {
    await page.goto("/login.html");
    await page.fill("#username", "admin");
    await page.fill("#password", "wrongpassword");
    await page.click("#submit-btn");
    await expect(page.locator("#alert-area .alert--error")).toBeVisible();
  });

  test("admin login redirects to admin panel", async ({ page }) => {
    await page.goto("/login.html");
    await page.fill("#username", "admin");
    await page.fill("#password", "admin");

    // Capture the login API response
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/login")),
      page.click("#submit-btn"),
    ]);
    const body = await response.json();
    expect(response.status()).toBe(200);
    expect(body.role).toBe("admin");

    await expect(page).toHaveURL(/admin\.html/, { timeout: 5000 });
  });

  test("admin can logout", async ({ page }) => {
    // Login first
    await page.goto("/login.html");
    await page.fill("#username", "admin");
    await page.fill("#password", "admin");
    await page.click("#submit-btn");
    await expect(page).toHaveURL(/admin\.html/, { timeout: 5000 });

    // Logout
    await page.click("#logout-btn");
    await expect(page).toHaveURL("/", { timeout: 5000 });
  });
});

test.describe("Register", () => {
  test("shows registration form", async ({ page }) => {
    await page.goto("/register.html");
    await expect(page).toHaveTitle(/Register/);
    await expect(page.locator("#register-form")).toBeVisible();
  });

  test("shows admin approval notice", async ({ page }) => {
    await page.goto("/register.html");
    await expect(page.locator(".alert--info")).toContainText("admin approval");
  });

  test("rejects mismatched passwords", async ({ page }) => {
    await page.goto("/register.html");
    await page.fill("#username", "testuser");
    await page.fill("#password", "password123");
    await page.fill("#password2", "different456");
    await page.click("#submit-btn");
    await expect(page.locator("#alert-area .alert--error")).toContainText("do not match");
  });

  test("rejects short password", async ({ page }) => {
    await page.goto("/register.html");
    await page.fill("#username", "testuser");
    await page.fill("#password", "short");
    await page.fill("#password2", "short");
    await page.click("#submit-btn");
    await expect(page.locator("#alert-area .alert--error")).toContainText("at least 8");
  });
});
