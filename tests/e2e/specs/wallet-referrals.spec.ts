import { test, expect } from "@playwright/test";
import { prisma } from "@ove/database";
import { createTestAdmin, disconnect } from "../support/seed";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

/**
 * 代理店紹介トークン受け入れ (実装指示書v1.0 Phase1、docs/agency-referral.md参照)。
 * /invite/{token} → LINE新規登録での紐付け → 管理画面での確認までを自動化する。
 * `ENABLE_WALLET_REFERRAL_TOKEN` は `playwright.config.ts` のwebServer設定で、
 * このテストが使うAPIプロセスにだけ有効化してある (`.env.test` 本体は変更しない)。
 */
test.describe("代理店紹介トークン受け入れ: /invite/{token} → LINE登録 → 管理画面確認", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("captures a referral, links it at LINE registration, and shows it in the admin screen", async ({
    browser,
  }) => {
    const referralToken = `pw-e2e-referral-${Date.now()}`;
    const referredCtx = await browser.newContext();
    const referredPage = await referredCtx.newPage();

    await referredPage.goto(`${APP_URL}/invite/${referralToken}`);
    await referredPage.waitForURL(`${APP_URL}/login`, { timeout: NAV_TIMEOUT_SHORT });

    const loginResponsePromise = referredPage.waitForResponse(
      (res) => res.url().includes("/api/v1/auth/line/login") && res.request().method() === "POST",
    );
    await referredPage.getByRole("checkbox").check();
    await referredPage.getByRole("button", { name: "LINEでログイン" }).click();
    const loginResponse = await loginResponsePromise;
    const { ove_account_id: oveAccountId } = (await loginResponse.json()) as { ove_account_id: string };
    await referredPage.waitForURL(/\/wallet$/, { timeout: NAV_TIMEOUT });

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referral.status).toBe("PENDING");

    const admin = await createTestAdmin("E2E Wallet Referrals Admin (Playwright)");
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`${ADMIN_URL}/login`);
    await adminPage.getByLabel("メールアドレス").fill(admin.email);
    await adminPage.getByLabel("パスワード").fill(admin.password);
    await adminPage.getByRole("button", { name: "ログイン" }).click();
    await adminPage.waitForURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });

    await adminPage.goto(`${ADMIN_URL}/wallet-referrals`);
    const row = adminPage.locator("tr", { hasText: account.accountCode });
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
    await expect(row).toContainText("登録済み・確認待ち");
    await expect(row).toContainText("3,000 ORI (PENDING)");
  });
});
