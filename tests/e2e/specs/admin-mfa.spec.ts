import { test, expect } from "@playwright/test";
import { computeTotpCode } from "@ove/auth";
import { createTestAdmin, disconnect } from "../support/seed";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

/**
 * 管理画面MFA (RFC 6238 TOTP、指示書13章)。セットアップ→有効化→ログアウト→
 * 次回ログインでのコード要求、までを実ブラウザで自動化する
 * (docs/test-plan.md「今後の拡張候補」参照)。
 */
test.describe("admin-wallet: 管理者MFAのセットアップ→ログイン", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("sets up TOTP MFA and requires a code on the next login", async ({ page }) => {
    const { email, password } = await createTestAdmin("E2E MFA Admin (Playwright)");

    await page.goto(`${ADMIN_URL}/login`);
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill(password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });

    await page.goto(`${ADMIN_URL}/security`);
    await expect(page.getByText("無効")).toBeVisible();
    await page.getByRole("button", { name: "MFAを設定する" }).click();

    const secret = await page.locator("p.font-bold.font-mono").textContent();
    expect(secret).toBeTruthy();

    await page.getByLabel("認証アプリに表示された6桁のコード").fill(computeTotpCode(secret!.trim()));
    await page.getByRole("button", { name: "確認して有効化" }).click();
    await expect(page.getByText("二要素認証を有効化しました")).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
    await expect(page.getByText("有効", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "ログアウト" }).click();
    await page.waitForURL(/\/login$/, { timeout: NAV_TIMEOUT_SHORT });

    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill(password);
    await page.getByRole("button", { name: "ログイン" }).click();

    await expect(page.getByRole("heading", { name: "二要素認証" })).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
    await page.getByLabel("認証コード").fill(computeTotpCode(secret!.trim()));
    await page.getByRole("button", { name: "確認してログイン" }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });
  });
});
