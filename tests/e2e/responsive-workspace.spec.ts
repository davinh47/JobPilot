import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("jobpilot:interface-tour:v3", "complete"));
});

test("compact navigation restores keyboard focus after Escape", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Compact navigation is only available on phones.");
  await page.goto("/settings");
  const trigger = page.getByRole("button", { name: /更多导航|more navigation/i });
  await trigger.click();
  const menu = page.getByRole("region", { name: /更多导航|more navigation/i });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("settings actions retain readable width on compact screens", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Verifies the compact grid placement.");
  await page.goto("/settings");
  const actions = page.locator(".settings-list section > .button");
  await expect(actions.first()).toBeVisible();
  expect(await actions.count()).toBeGreaterThan(0);
  for (const action of await actions.all()) {
    await expect(action).toBeVisible();
    const box = await action.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeLessThan(75);
  }
});

test("status dialog traps focus and returns it on cancel", async ({ page }) => {
  await page.goto("/pipeline");
  const trigger = page.getByRole("button", { name: /管理状态|Manage statuses/i });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /管理申请状态|Manage application statuses/i });
  await expect(dialog).toBeVisible();
  const first = dialog.getByRole("button", { name: /^(关闭|Close)$/i });
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: /^(完成|Done)$/i })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("forms fit narrow phone and tablet widths", async ({ page, isMobile }) => {
  test.skip(isMobile, "Runs explicit viewport widths once.");
  for (const width of [320, 820, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/matches", "/pipeline", "/settings", "/preferences", "/resumes/new", "/resumes/import"]) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      if (width === 820) await expect(page.getByRole("button", { name: /切换到英文|Switch to Chinese/i })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${route} at ${width}px`).toBeLessThanOrEqual(1);
    }
  }
});
