import { test, expect } from "@playwright/test";
import { prisma } from "@ove/database";
import { createTestAdmin, disconnect } from "../support/seed";

const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
}

/**
 * 既存ユーザー移行の事前承認制・職務分離 (docs/migration.md「事前承認制・職務分離」
 * 「職務分離: 実行者本人による解消の禁止」)。これまで手動確認のみだったフローを
 * 実ブラウザで自動化する。
 */
test.describe("admin-wallet: 既存ユーザー移行の事前承認制・検証者フロー", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("requires a different admin to approve, then blocks the executor from resolving REVIEWING", async ({
    browser,
  }) => {
    const requester = await createTestAdmin("E2E Migration Requester (Playwright)");
    const approver = await createTestAdmin("E2E Migration Approver (Playwright)");
    const unknownUserId = `pw-legacy-${Date.now()}`;
    const csvContent = `old_user_id,old_balance\n${unknownUserId},\n`;
    const batchName = `Playwright検証-${Date.now()}`;

    const requesterCtx = await browser.newContext();
    const requesterPage = await requesterCtx.newPage();
    await login(requesterPage, requester.email, requester.password);

    await requesterPage.goto(`${ADMIN_URL}/migrations`);
    await requesterPage.getByPlaceholder("2026年7月度移行").fill(batchName);
    await requesterPage
      .getByPlaceholder("旧システム終了に伴う移行 (2026年7月分)")
      .fill("Playwright E2E: 残高不明ユーザーの移行");
    await requesterPage
      .locator('input[type="file"]')
      .setInputFiles({ name: "legacy.csv", mimeType: "text/csv", buffer: Buffer.from(csvContent) });
    await requesterPage.getByRole("button", { name: "承認を申請" }).click();
    await expect(requesterPage.getByText("承認待ちとして申請しました。")).toBeVisible({ timeout: 10_000 });

    await requesterPage.goto(`${ADMIN_URL}/approval-requests`);
    await expect(requesterPage.getByText(batchName, { exact: false })).toBeVisible();

    // 申請者本人による承認は職務分離違反として拒否される。他のテストが残した申請とも
    // 混在するため、このテストのバッチ名を含む行に絞って承認ボタンを押す。
    await requesterPage.locator("tr", { hasText: batchName }).getByRole("button", { name: "承認" }).click();
    await expect(requesterPage.getByText(/失敗|separation of duties/)).toBeVisible({ timeout: 10_000 });

    // 別の管理者 (承認者) が承認すると、この時点ではじめて移行が実行される。
    const approverCtx = await browser.newContext();
    const approverPage = await approverCtx.newPage();
    await login(approverPage, approver.email, approver.password);
    await approverPage.goto(`${ADMIN_URL}/approval-requests`);
    await approverPage.locator("tr", { hasText: batchName }).getByRole("button", { name: "承認" }).click();
    await expect(approverPage.locator("tr", { hasText: batchName })).toContainText("APPROVED", { timeout: 10_000 });

    // 承認によって作成されたREVIEWINGアカウントをDBから特定し、直接その詳細画面へ移動する
    // (一覧は他のテストが残したREVIEWING行とも混在するため、リンクの位置に依存しない)。
    const identity = await prisma.accountIdentity.findUniqueOrThrow({
      where: { provider_providerSubject: { provider: "LEGACY_SYSTEM", providerSubject: unknownUserId } },
    });
    const accountUrl = `${ADMIN_URL}/accounts/${identity.oveAccountId}`;

    // 移行実行者 (requester) 本人による解消は拒否される。
    await requesterPage.goto(accountUrl);
    await requesterPage.getByPlaceholder(/例: 7000/).fill("4200");
    await requesterPage.getByPlaceholder(/例: 旧システムの管理画面で残高/).fill("Playwright E2E: 実行者本人による解消");
    requesterPage.once("dialog", (dialog) => dialog.accept());
    await requesterPage.getByRole("button", { name: "検証結果を反映してACTIVEにする" }).click();
    await expect(requesterPage.getByText(/失敗|separation of duties/)).toBeVisible({ timeout: 10_000 });

    // 承認者 (執行者とは別の管理者) は問題なく解消できる。
    await approverPage.goto(accountUrl);
    await approverPage.getByPlaceholder(/例: 7000/).fill("4200");
    await approverPage.getByPlaceholder(/例: 旧システムの管理画面で残高/).fill("Playwright E2E: 承認者による解消");
    approverPage.once("dialog", (dialog) => dialog.accept());
    await approverPage.getByRole("button", { name: "検証結果を反映してACTIVEにする" }).click();
    await expect(approverPage.getByText("検証結果を反映し、アカウントをACTIVEにしました。")).toBeVisible({
      timeout: 10_000,
    });
  });
});
