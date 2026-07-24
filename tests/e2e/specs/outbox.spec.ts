import { test, expect } from "@playwright/test";
import { prisma } from "@ove/database";
import { createTestAdmin, disconnect } from "../support/seed";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

/**
 * 外部連携キュー (Transactional Outbox、開発ガイドライン10章)。代理店紹介の登録
 * (実装指示書v1.0 Phase1) で作られるイベントを題材に、一覧・絞り込みを自動化する。
 * 手動処理 (`processPendingEvents`) 自体はapps/api側のjest e2e (`outbox.test.ts`)
 * で既に検証済みのため、ここでは管理画面での表示・絞り込みに絞る (テストDBは他の
 * テスト実行分のイベントも積み上がっており、1回の「まとめて処理」でこの行まで必ず
 * 到達するとは限らないため、処理結果自体の検証は行わない)。
 */
test.describe("admin-wallet: 外部連携キュー (Outbox)", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("lists a queued referral-sync event and can filter by destination service", async ({ browser }) => {
    const referralToken = `pw-e2e-outbox-referral-${Date.now()}`;
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

    const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });

    const admin = await createTestAdmin("E2E Outbox Admin (Playwright)");
    const adminPage = await (await browser.newContext()).newPage();
    await adminPage.goto(`${ADMIN_URL}/login`);
    await adminPage.getByLabel("メールアドレス").fill(admin.email);
    await adminPage.getByLabel("パスワード").fill(admin.password);
    await adminPage.getByRole("button", { name: "ログイン" }).click();
    await adminPage.waitForURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });

    await adminPage.goto(`${ADMIN_URL}/outbox`);
    const row = adminPage.locator("tr", { hasText: `wallet_referral:${referral.id}` });
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
    await expect(row).toContainText("再送待ち");
    await expect(row.locator("td").nth(5)).toHaveText("0"); // 試行回数

    // 絞り込み欄 (画面内のUI操作、URLクエリパラメータではない) に存在しない連携先を
    // 入力すると行が消え、絞り込みが実際にAPIへ渡っていることを確認する。
    await adminPage.locator("#destinationFilter").fill("NONEXISTENT_SERVICE");
    await expect(row).not.toBeVisible({ timeout: NAV_TIMEOUT_SHORT });

    await adminPage.locator("#destinationFilter").fill("AGENCY_SYSTEM");
    await expect(row).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
  });
});
