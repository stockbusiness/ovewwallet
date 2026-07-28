import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@ove/database";
import { disconnect } from "../support/seed";
import { NAV_TIMEOUT, NAV_TIMEOUT_SHORT } from "../support/timeouts";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/**
 * NFTカードClaim導線実装指示書16章。必須E2E:
 * 受取URL → LINEログイン → Claim復帰 → Confirm → DELIVERY_PENDING → DELIVERED → コレクション。
 * ENABLE_COLLECTIBLE_CLAIM_FLOWとSENGOKU_MARKET_CLAIM_BASE_URL(fake-market-server.mjs)は
 * playwright.config.tsのwebServer.envでこのAPIプロセスにだけ有効化している。
 */
test.describe("NFTカードClaim導線: 受取URL → ログイン → Claim復帰 → 受取完了", () => {
  test.afterAll(async () => {
    await disconnect();
  });

  test("未ログインで受取URLを開き、LINEログインを経てClaimへ復帰し、受け取るとコレクションへ遷移できる", async ({
    page,
  }) => {
    const claimToken = `e2e-claim-${randomUUID()}`;

    // 1. 未ログインで受取URLを開く → 「ログインが必要」
    await page.goto(`${APP_URL}/claim/${claimToken}`);
    await expect(page.getByText("ログインが必要", { exact: false })).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });

    // 2. ログインする → /login?return_to=/claim/<safe-session-id> へ遷移
    await page.getByRole("button", { name: "ログインする" }).click();
    await page.waitForURL(/\/login\?return_to=/, { timeout: NAV_TIMEOUT_SHORT });

    // 3. LINEモックログイン
    const [loginResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/v1/auth/line/login") && res.request().method() === "POST"),
      (async () => {
        await page.getByRole("checkbox").check();
        await page.getByRole("button", { name: "LINEでログイン" }).click();
      })(),
    ]);
    expect(loginResponse.ok()).toBe(true);
    const { ove_account_id: oveAccountId } = (await loginResponse.json()) as { ove_account_id: string };

    // common_user_id解決はENABLE_PLATFORM_USER_ID配下の別経路 (代理店システム連携) の
    // 対象であり、このE2Eの主眼(Claim確定→送付→受取)ではないため直接DBへ投入する。
    await prisma.oveAccount.update({ where: { id: oveAccountId }, data: { commonUserId: `cu_e2e_${randomUUID()}` } });

    // 4. Claim画面へ復帰する (/walletではなく/claim/<safe-session-id>)。
    await page.waitForURL(/\/claim\/.+/, { timeout: NAV_TIMEOUT });
    await expect(page.url()).not.toContain(claimToken);

    // 5. 受け取る
    await page.getByRole("button", { name: "受け取る" }).click();
    await expect(page.getByText("NFTカードをウォレットへ送付しています。")).toBeVisible({ timeout: NAV_TIMEOUT_SHORT });

    // 6. 送付完了 (fake-market-serverは最初のポーリングでDELIVEREDを返す)
    await expect(page.getByText("NFTカードを受け取りました。")).toBeVisible({ timeout: NAV_TIMEOUT });

    // 7. コレクションへ遷移
    await page.getByRole("button", { name: "コレクションを見る" }).click();
    await page.waitForURL(/\/wallet\/collection$/, { timeout: NAV_TIMEOUT_SHORT });
  });
});
