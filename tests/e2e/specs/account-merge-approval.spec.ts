import { test, expect } from "@playwright/test";
import { createTestAdmin, createTestWallet, disconnect } from "../support/seed";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });
}

/**
 * アカウント統合の二段階承認 (指示書6章・13章)。これまで手動確認のみだった
 * 「申請者本人以外の管理者が承認するまで実行されない」フローを実ブラウザで自動化する
 * (docs/project-status.md 6章「アカウント統合の二段階承認...はまだ手動実行での確認のみ」)。
 */
test.describe("admin-wallet: アカウント統合の二段階承認 (申請者・承認者を分離)", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("rejects self-approval and only merges after a different admin approves", async ({ browser }) => {
    const requester = await createTestAdmin("E2E Merge Requester (Playwright)");
    const approver = await createTestAdmin("E2E Merge Approver (Playwright)");
    const source = await createTestWallet(2000);
    const target = await createTestWallet(500);

    const requesterCtx = await browser.newContext();
    const requesterPage = await requesterCtx.newPage();
    await login(requesterPage, requester.email, requester.password);

    await requesterPage.goto(`${ADMIN_URL}/accounts/merge`);
    await requesterPage.getByPlaceholder("OVE-ACC-00000001").fill(source.accountCode);
    await requesterPage.getByPlaceholder("OVE-ACC-00000002").fill(target.accountCode);
    await requesterPage.getByLabel("理由").fill("Playwright E2E: 重複アカウント");
    await requesterPage.getByRole("button", { name: "内容を確認する" }).click();
    await requesterPage.getByRole("button", { name: "申請する" }).click();
    await expect(requesterPage.getByText("統合の申請を送信しました。")).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });

    await requesterPage.getByRole("link", { name: "二段階承認画面" }).click();
    await requesterPage.waitForURL(/\/approval-requests$/);
    const mergeRowText = `${source.accountCode} → ${target.accountCode}`;
    await expect(requesterPage.getByText(mergeRowText)).toBeVisible();

    // 申請者本人による承認は職務分離違反として拒否される。他のテストが残した申請も
    // 一覧に並ぶため、このテストの行に絞って承認ボタンを押す。
    await requesterPage.locator("tr", { hasText: mergeRowText }).getByRole("button", { name: "承認" }).click();
    await expect(requesterPage.getByText(/失敗|separation of duties/)).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });

    // 拒否されているので、統合元の残高はまだ動いていない (利用可能残高・累計獲得の
    // 2箇所に同じ値が表示されるため、いずれかが見えていればよい)。
    await requesterPage.goto(`${ADMIN_URL}/wallets/${source.walletId}`);
    await expect(requesterPage.getByText("2,000 ORI").first()).toBeVisible();

    // 別の管理者 (承認者) が承認すると、はじめて統合が実行される。
    const approverCtx = await browser.newContext();
    const approverPage = await approverCtx.newPage();
    await login(approverPage, approver.email, approver.password);
    await approverPage.goto(`${ADMIN_URL}/approval-requests`);
    await approverPage.locator("tr", { hasText: mergeRowText }).getByRole("button", { name: "承認" }).click();
    await expect(approverPage.locator("tr", { hasText: mergeRowText })).toContainText("APPROVED", {
      timeout: NAV_TIMEOUT_SHORT,
    });

    await approverPage.goto(`${ADMIN_URL}/wallets/${target.walletId}`);
    await expect(approverPage.getByText("2,500 ORI").first()).toBeVisible({ timeout: NAV_TIMEOUT_SHORT }); // 500 + 2000
  });
});
