import { test, expect } from "@playwright/test";
import { createTestAdmin, createTestWallet, disconnect } from "../support/seed";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

test.describe("admin-wallet: ログイン→個別付与→残高反映", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("logs in and grants OVE to a wallet, reflecting the new balance", async ({ page }) => {
    const { email, password } = await createTestAdmin();
    const { walletId, walletCode } = await createTestWallet(0);

    await page.goto(`${ADMIN_URL}/login`);
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill(password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });

    await page.goto(`${ADMIN_URL}/wallets/${walletId}`);
    await expect(page.getByText(walletCode)).toBeVisible();

    await page.getByLabel("金額 (OVE)").fill("1500");
    await page.getByLabel("理由").fill("Playwright E2E自動テスト");
    await page.getByRole("button", { name: "付与", exact: true }).click();

    // 「利用可能残高」「累計獲得」の2箇所と取引一覧の行、いずれにも1,500が表示されるため
    // 取引一覧の行 (増加方向の金額セル) で一意に確認する
    await expect(page.getByRole("cell", { name: "+1,500" })).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
  });
});
