import { chromium } from "@playwright/test";
const base = "http://127.0.0.1:4173";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const suf = Date.now();
await page.goto(base + "/register");
await page.getByPlaceholder("Tên hiển thị").fill("Vocab Shot " + suf);
await page.getByPlaceholder("Username").fill("vshot_" + suf);
await page.getByPlaceholder("Mật khẩu (ít nhất 10 ký tự)").fill("shot-password-123");
await page.getByPlaceholder("Nhập lại mật khẩu").fill("shot-password-123");
await page.getByRole("button", { name: "Đăng ký & vào học" }).click();
await page.getByRole("heading", { name: /Kho đề/ }).waitFor();

await page.goto(base + "/library");
await page.getByRole("button", { name: "Import .exam" }).click();
await page.locator(".dialog-overlay").waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: ".shots/import-dialog-light.png" });
await page.locator(".dialog-close").click();

await page.goto(base + "/vocabulary/sets/new");
await page.getByLabel("Tên", { exact: true }).fill("Từ vựng TOEIC " + suf);
await page.getByRole("button", { name: "Lưu bộ từ" }).click();
await page.waitForURL(/vocabulary\/sets\/[^/]+$/);
const setId = page.url().split("/").pop();
await page.goto(base + "/vocabulary/sets/" + setId + "/edit");
await page.locator("textarea.input.min-h-28").fill("happy:hạnh phúc\napple:quả táo\nhello:xin chào\nbook:quyển sách\nwater:nước");
await page.getByRole("button", { name: "Thêm nhanh" }).click();
await page.waitForFunction(() => {
  const rows = document.querySelectorAll(".vocab-edit-row");
  return rows.length >= 5 && [...rows].some(r => r.textContent.includes("quyển sách"));
});

await page.goto(base + "/vocabulary/sets/" + setId);
await page.locator(".vocab-mode-grid").waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: ".shots/vocab-detail-light.png", fullPage: true });
await page.evaluate(() => { localStorage.setItem("thi-thu:dark", "1"); document.documentElement.dataset.mode = "dark"; });
await page.waitForTimeout(300);
await page.screenshot({ path: ".shots/vocab-detail-dark.png", fullPage: true });
await browser.close();
console.log("vocab shots done");
