import { test, expect, type Page } from "@playwright/test";

/**
 * The app requires an account (ProfileGate redirects logged-out users to
 * /login), so every smoke test starts by registering a fresh user. Username
 * is randomized so parallel runs never collide, and register rate limits
 * (5/min/IP) are never hit with this volume.
 */
async function register(page: Page) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await page.goto("/register");
  await page.getByPlaceholder("Tên hiển thị").fill(`E2E ${suffix}`);
  await page.getByPlaceholder("Username").fill(`e2e_${suffix}`);
  await page.getByPlaceholder("Mật khẩu (ít nhất 10 ký tự)").fill("e2e-password-123");
  await page.getByPlaceholder("Nhập lại mật khẩu").fill("e2e-password-123");
  await page.getByRole("button", { name: "Đăng ký & vào học" }).click();
  await expect(page.getByRole("heading", { name: /Kho đề/ })).toBeVisible();
}

/** Create the one-question sample exam via the advanced JSON import. */
async function createSampleExam(page: Page) {
  await page.getByRole("link", { name: /Tạo đề mới/ }).click();
  await expect(page.getByRole("heading", { name: /Tạo đề mới/ })).toBeVisible();
  // The creator is tab-based; the JSON import lives in its own tab.
  await page.getByRole("tab", { name: /JSON nâng cao/ }).click();
  await page.getByRole("button", { name: "Xem mẫu" }).click();
  await page.getByRole("button", { name: "Kiểm tra" }).click();
  // The template covers every question type; the preview lists each one.
  await expect(page.getByText("Câu 1 · ABCD")).toBeVisible();
  await expect(page.getByText("Câu 2 · TRUE_FALSE")).toBeVisible();
  await expect(page.getByText("Câu 3 · TRUE_FALSE")).toBeVisible();
  await expect(page.getByText("Câu 4 · SHORT_ANSWER")).toBeVisible();
  await page.getByRole("button", { name: "Lưu đề" }).click();
  await expect(page.getByRole("textbox").first()).toHaveValue("Đề mẫu — Đủ các dạng câu hỏi");
  await expect(page.getByText("Đã lưu trên thiết bị")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("session and profile survive reload; offline navigation reaches the app shell", async ({ page, context }) => {
  await register(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Kho đề/ })).toBeVisible();
  // Wait for the service worker to control the page before cutting the
  // network — see the 404 test for why this wait exists.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100));
    if (!navigator.serviceWorker.controller) throw new Error("service worker never controlled the page");
  });
  // Auth identity is cached locally, so the shell keeps working offline.
  await context.setOffline(true);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: /Kho đề/ })).toBeVisible();
});

test("creates an exam from the advanced JSON template and persists it after reload", async ({ page }) => {
  await register(page);
  await createSampleExam(page);
  await page.goto("/library");
  await page.reload();
  await expect(page.getByText(/Đề mẫu — Đủ các dạng câu hỏi/).first()).toBeVisible();
});

test("creates a blank exam manually and adds a question in the editor", async ({ page }) => {
  await register(page);
  await page.getByRole("link", { name: /Tạo đề mới/ }).click();
  await page.getByPlaceholder("Tên đề (bắt buộc)").fill("Đề thủ công E2E");
  await page.getByPlaceholder("Môn (bắt buộc)").fill("Toán");
  await page.getByRole("button", { name: /Tạo đề và soạn câu hỏi/ }).click();
  await expect(page.getByRole("textbox").first()).toHaveValue("Đề thủ công E2E");
  await page.getByRole("button", { name: "+ Thêm câu" }).click();
  await expect(page.getByText("Câu hỏi mới").first()).toBeVisible();
  await page.goto("/library");
  await expect(page.getByText("Đề thủ công E2E").first()).toBeVisible();
});

test("practice: answer with keyboard-visible option, submit, reach result", async ({ page }) => {
  await register(page);
  await createSampleExam(page);
  const examId = page.url().match(/library\/([^/]+)\/edit/)![1];
  await page.goto(`/practice/${examId}`);
  // Four questions from the template; the first is an ABCD fraction question.
  await expect(page.getByText(/Rút gọn biểu thức/)).toBeVisible();
  await page.locator('input[type="radio"]').first().check();
  // Submit lives on the last question: jump to Q4 (short answer), fill it,
  // then "Nộp bài →" opens the confirm dialog.
  await page.getByRole("button", { name: "Câu 4", exact: true }).click();
  await page.getByRole("textbox", { name: "Nhập đáp án" }).fill("3/4");
  await page.getByRole("button", { name: /Nộp bài/ }).first().click();
  const dialog = page.locator(".fixed.inset-0");
  await dialog.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page).toHaveURL(/\/practice\/.+\/result/);
});

test("unknown route renders the 404 page and the home button works offline", async ({ page, context }) => {
  await register(page);
  // Wait until the service worker actually controls the page — registration
  // is async, and going offline before it activates makes the navigation hit
  // the network (ERR_INTERNET_DISCONNECTED) instead of the precache.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise(r => setTimeout(r, 100));
    if (!navigator.serviceWorker.controller) throw new Error("service worker never controlled the page");
  });
  // Offline: the 404 page is part of the app-shell bundle, so the service
  // worker serves it without any network access.
  await context.setOffline(true);
  await page.goto("/trang-khong-ton-tai");
  await expect(page.getByRole("heading", { name: "Không tìm thấy trang" })).toBeVisible();
  await page.getByRole("link", { name: "Về trang chủ" }).click();
  // Home is the dashboard greeting; still fully offline.
  await expect(page.getByRole("heading", { name: /học tiếp nào/ })).toBeVisible();
});
