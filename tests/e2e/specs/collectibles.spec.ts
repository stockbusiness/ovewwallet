import { test, expect } from "@playwright/test";
import { createTestAdmin, createTestCollectible, disconnect } from "../support/seed";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

/**
 * NFTコレクション実装指示書 Phase 4。ENABLE_DIGITAL_COLLECTIONは
 * playwright.config.tsのwebServer.envでこのAPIプロセスにだけ有効化している。
 */
test.describe("NFTコレクション: ユーザー一覧・詳細 → 管理画面での手動取消", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("メニューからコレクションへ遷移し、カード詳細を見た後、管理画面で取消すると一覧から消える", async ({
    page,
  }) => {
    // 1. LINEモックログインしてOVEアカウントIDを取得する
    await page.goto(`${APP_URL}/login`);
    const [loginResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/v1/auth/line/login") && res.request().method() === "POST"),
      (async () => {
        await page.getByRole("checkbox").check();
        await page.getByRole("button", { name: "LINEでログイン" }).click();
      })(),
    ]);
    const { ove_account_id: oveAccountId } = (await loginResponse.json()) as { ove_account_id: string };
    await page.waitForURL(/\/wallet$/, { timeout: NAV_TIMEOUT });

    // 2. カードを直接DBへ投入する (entitlement.grantedの実イベント経路は別途Jest e2eで検証済み)
    const { holdingId, assetName } = await createTestCollectible(oveAccountId);

    // 3. メニューの「コレクション」導線 (Feature Flag ON時のみ表示)
    await page.goto(`${APP_URL}/wallet/menu`);
    const collectionLink = page.getByRole("link", { name: "コレクション" });
    await expect(collectionLink).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
    await collectionLink.click();
    await page.waitForURL(/\/wallet\/collection$/, { timeout: NAV_TIMEOUT_SHORT });
    await expect(page.getByText(assetName)).toBeVisible();

    // 4. 詳細画面: Mint前の文言を確認する (指示書で必須の文言)
    await page.getByText(assetName).click();
    await page.waitForURL(/\/wallet\/collection\/.+/, { timeout: NAV_TIMEOUT_SHORT });
    await expect(page.getByText("千ノ国ウォレット内で保管中")).toBeVisible();
    await expect(page.getByText("ブロックチェーン未発行")).toBeVisible();

    // 5. 管理画面から手動取消する
    const { email, password } = await createTestAdmin();
    await page.goto(`${ADMIN_URL}/login`);
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("パスワード").fill(password);
    await page.getByRole("button", { name: "ログイン" }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });

    await page.goto(`${ADMIN_URL}/collectible-holdings/${holdingId}`);
    await expect(page.getByText(assetName)).toBeVisible();
    await page.getByLabel("取消理由").fill("Playwright E2E自動テスト");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "取消する" }).click();
    await expect(page.getByText("取消しました")).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });

    // 6. ユーザー側一覧から (既定では) 消えていることを確認する
    await page.goto(`${APP_URL}/wallet/collection`);
    await expect(page.getByText("まだカードを保有していません")).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });
  });
});
