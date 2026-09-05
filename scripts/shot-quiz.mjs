import { chromium } from "@playwright/test";

const shots = process.env.SHOT_DIR || ".shots";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
async function registerUser(pg) {
  const suf = `${Date.now()}${Math.floor(Math.random() * 1000)}-${labelOf(pg)}`;
  await pg.goto("http://127.0.0.1:4173/register");
  await pg.getByPlaceholder("Tên hiển thị").fill(`Shot ${suf}`);
  await pg.getByPlaceholder("Username").fill(`shot_${suf}`);
  await pg.getByPlaceholder("Mật khẩu (ít nhất 10 ký tự)").fill("shot-password-123");
  await pg.getByPlaceholder("Nhập lại mật khẩu").fill("shot-password-123");
  await pg.getByRole("button", { name: "Đăng ký & vào học" }).click();
  await pg.getByRole("heading", { name: /Kho đề/ }).waitFor();
}
function labelOf() { return Math.floor(Math.random() * 1e6).toString(); }
async function createExam(pg) {
  await pg.getByRole("link", { name: /Tạo đề mới/ }).click();
  const advanced = pg.locator("details").filter({ hasText: "Nhập JSON nâng cao" });
  await advanced.locator("summary").click();
  await advanced.getByRole("button", { name: "Xem mẫu" }).click();
  await advanced.getByRole("button", { name: "Kiểm tra" }).click();
  await advanced.getByRole("button", { name: "Lưu đề" }).click();
  await pg.waitForURL(/library\/.+\/edit/);
  const m = pg.url().match(/library\/([^/]+)\/edit/);
  if (!m) throw new Error("no exam id in " + pg.url());
  return m[1];
}
async function quizShot(pg, id, path) {
  await pg.goto(`http://127.0.0.1:4173/practice/${id}`);
  await pg.locator('.quiz-page, .card').first().waitFor();
  const resume = pg.getByRole('button', { name: 'Tiếp tục' });
  if (await resume.count()) await pg.getByRole('button', { name: 'Làm bài mới' }).click();
  await pg.locator('input[type="radio"]').first().waitFor({ state: 'visible' });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path });
}
await registerUser(page);
const examId = await createExam(page);
await quizShot(page, examId, shots + "/quiz-desktop-light.png");
await page.evaluate(() => { localStorage.setItem("thi-thu:dark", "1"); document.documentElement.dataset.mode = "dark"; });
await quizShot(page, examId, shots + "/quiz-desktop-dark.png");
const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const mp = await mob.newPage();
await mp.addInitScript(() => localStorage.setItem("thi-thu:dark", "1"));
await registerUser(mp);
const mobExam = await createExam(mp);
await quizShot(mp, mobExam, shots + "/quiz-mobile.png");
await mp.locator(".quiz-mobilebar-center").click();
await mp.waitForTimeout(300);
await mp.screenshot({ path: shots + "/quiz-mobile-drawer.png" });
await browser.close();
console.log("shots done");
