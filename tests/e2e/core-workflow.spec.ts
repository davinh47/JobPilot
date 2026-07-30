import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jobpilot:interface-tour:v2", "complete"));
});

test("activation dashboard exposes the focused first-run workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/真实求职闭环|real job-search loop/i);
  await expect(page.getByRole("link", { name: /建立事实简历|factual resume/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /设置一个明确目标|clear target/i })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
});

test("core navigation remains keyboard-addressable", async ({ page }) => {
  await page.goto("/");
  const discovery = page.getByRole("link", { name: /岗位发现|job discovery/i });
  await discovery.focus();
  await expect(discovery).toBeFocused();
  await discovery.press("Enter");
  await expect(page).toHaveURL(/\/matches/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/岗位发现|job discovery/i);
});

test("core pages do not create horizontal viewport overflow", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("mobile navigation exposes account and settings routes", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Mobile navigation is only rendered at the compact breakpoint.");
  await page.goto("/");
  await page.getByRole("button", { name: /更多导航|more navigation/i }).click();
  const menu = page.getByRole("region", { name: /更多导航|more navigation/i });
  await expect(menu.getByRole("link", { name: /^(个人档案|profile)$/i })).toBeVisible();
  await expect(menu.getByRole("link", { name: /^(设置|settings)$/i })).toBeVisible();
  await expect(menu.getByRole("link", { name: /^(通知|notifications)$/i })).toBeVisible();
});

test("resume language choices are equal-width without an empty control area", async ({ page }) => {
  await page.goto("/resumes/import?language=zh");
  const languageControl = page.getByLabel(/简历语言|resume language/i);
  const chinese = languageControl.getByRole("link", { name: "中文" });
  const english = languageControl.getByRole("link", { name: "English" });
  const [controlBox, chineseBox, englishBox] = await Promise.all([
    languageControl.boundingBox(),
    chinese.boundingBox(),
    english.boundingBox(),
  ]);
  expect(chineseBox?.width).toBeCloseTo(englishBox?.width ?? 0, 0);
  expect(controlBox?.width ?? 0).toBeLessThan((chineseBox?.width ?? 0) + (englishBox?.width ?? 0) + 12);
});

test("page descriptions use the same available width as their section panel", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Desktop width verifies the page-header content constraint.");
  await page.goto("/profile");
  const [descriptionBox, panelBox] = await Promise.all([
    page.locator(".page-description").boundingBox(),
    page.locator(".profile-analysis-section").boundingBox(),
  ]);
  expect(descriptionBox?.width).toBeCloseTo(panelBox?.width ?? 0, 0);
});
