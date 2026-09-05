import { test, expect, type Page } from "@playwright/test";

/**
 * Notification flow: a user registers first (delivery fans out at send time),
 * then the admin composes and sends an announcement, and the user sees the
 * bell badge, reads the message and clears the badge.
 */
const USER_PASSWORD = "e2e-password-123";

async function registerUser(page: Page, suffix: string) {
  await page.goto("/register");
  await page.getByPlaceholder("Tên hiển thị").fill(`E2E Thông báo ${suffix}`);
  await page.getByPlaceholder("Username").fill(`e2e_notif_${suffix}`);
  await page.getByPlaceholder("Mật khẩu (ít nhất 10 ký tự)").fill(USER_PASSWORD);
  await page.getByPlaceholder("Nhập lại mật khẩu").fill(USER_PASSWORD);
  await page.getByRole("button", { name: "Đăng ký & vào học" }).click();
  await expect(page.getByRole("heading", { name: /Kho đề/ })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await page.waitForURL("**/login**");
}

test("admin sends notification; user sees badge, reads it, badge clears", async ({ page }) => {
  const marker = `E2E thông báo ${Date.now()}`;
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  // 1. Register the recipient up front so they are an active user at send time.
  await registerUser(page, suffix);
  await logout(page);

  // 2. Admin composes and sends.
  await page.getByPlaceholder("Username").fill("admin");
  await page.getByPlaceholder("Mật khẩu").fill("e2e-admin-password-123");
  await page.getByRole("button", { name: /Đăng nhập/ }).click();
  await page.waitForURL("**/library");
  await page.goto("/admin/notifications");
  await expect(page.getByRole("heading", { name: "Quản lý thông báo" })).toBeVisible();

  await page.getByPlaceholder("VD: Bảo trì hệ thống tối nay").fill(marker);
  await page.locator(".rich-editor").first().fill(`Nội dung rich text ${marker}`);
  await page.getByRole("button", { name: "Gửi ngay" }).click();
  await expect(page.getByRole("cell", { name: marker, exact: false })).toBeVisible();

  // 3. Recipient logs back in and sees the bell badge.
  await logout(page);
  await page.getByPlaceholder("Username").fill(`e2e_notif_${suffix}`);
  await page.getByPlaceholder("Mật khẩu").fill(USER_PASSWORD);
  await page.getByRole("button", { name: /Đăng nhập/ }).click();
  await page.waitForURL("**/library");
  const bell = page.getByRole("button", { name: /^Thông báo/ });
  await expect(bell).toBeVisible();
  await expect(bell.locator(".notification-badge")).toBeVisible();

  // 4. Open panel: message listed, body rendered as text (HTML sanitized away).
  await bell.click();
  await expect(page.locator(".notification-panel")).toBeVisible();
  await expect(page.locator(".notification-item", { hasText: marker })).toBeVisible();

  // 5. Mark all read → badge clears.
  await page.getByRole("button", { name: "Đánh dấu tất cả đã đọc" }).click();
  await expect(bell.locator(".notification-badge")).toHaveCount(0);
});
