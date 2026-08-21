import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("profile survives reload and offline navigation reaches the app shell", async ({ page, context }) => {
  await page.goto("/");
  await page.getByPlaceholder(/Tên của bạn/).fill("Phase 9");
  await page.getByRole("button", { name: "Tạo hồ sơ" }).click();
  await expect(page.getByRole("heading", { name: /Kho đề/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Kho đề/ })).toBeVisible();
  await context.setOffline(true);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: /Kho đề/ })).toBeVisible();
});

test("creates an exam and persists it after reload", async ({ page }) => {
  await page.getByPlaceholder(/Tên của bạn/).fill("Exam Tester");
  await page.getByRole("button", { name: "Tạo hồ sơ" }).click();
  await page.getByRole("link", { name: /Tạo đề/ }).click();
  await page.getByPlaceholder("Tên đề").fill("Phase 9 Exam");
  await page.getByPlaceholder("Môn").fill("English");
  await page.getByRole("button", { name: "Tạo đề" }).click();
  await expect(page.getByText("Phase 9 Exam")).toBeVisible();
  await page.goto("/library");
  await page.reload();
  await expect(page.getByText("Phase 9 Exam")).toBeVisible();
});
