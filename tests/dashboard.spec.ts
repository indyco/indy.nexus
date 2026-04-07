import { test, expect } from "@playwright/test";

test.describe("Dashboard access", () => {
  test("redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/dashboard.html");
    await expect(page).toHaveURL(/login\.html/, { timeout: 5000 });
  });

  test("API rejects unauthenticated service requests", async ({ request }) => {
    const res = await request.get("/api/services");
    expect(res.status()).toBe(401);
  });

  test("API rejects unauthenticated admin requests", async ({ request }) => {
    const res = await request.get("/api/admin/users");
    expect(res.status()).toBe(401);
  });
});
