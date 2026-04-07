import { test, expect } from "@playwright/test";

test.describe("Health endpoint", () => {
  test("GET /api/health returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.mode).toBe("test");
    expect(body.uptime).toBeGreaterThan(0);
  });
});
