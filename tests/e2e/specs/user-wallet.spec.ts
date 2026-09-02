import { test, expect } from "@playwright/test";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/**
 * ユーザー向けウォレット (`apps/user-wallet`) のゴールデンパス。
 * これまで手動のPlaywright確認でしか検証していなかった経路をコード化したもの。
 */
test.describe("user-wallet: LINEモックログイン→ウォレット表示→取引履歴", () => {
  test("logs in, sees the wallet home, and navigates to transaction history", async ({ page }) => {
    await page.goto(`${APP_URL}/login`);

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "LINEでログイン" }).click();

    await page.waitForURL(/\/wallet$/, { timeout: NAV_TIMEOUT });
    // 保存値は OVE-WLT-... のままだが、画面には ORI- で出す
    // (packages/shared-ui/src/business-code.ts)。
    await expect(page.getByText(/ORI-WLT-/)).toBeVisible();

    await page.getByRole("link", { name: "履歴", exact: true }).click();
    await page.waitForURL(/\/wallet\/transactions$/, { timeout: NAV_TIMEOUT_SHORT });
    // 新規アカウントのため取引はまだ無く、空状態のメッセージが表示される
    await expect(page.getByText("該当する取引はありません")).toBeVisible();
  });
});
