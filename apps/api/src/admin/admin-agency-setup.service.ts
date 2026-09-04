import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { getAllFeatureFlags } from "../common/feature-flags";

/**
 * 代理店システム(sengoku-ai.com)連携を有効にするまでの設定状況を、1回の問い合わせで
 * まとめて返す。設定項目が「共通顧客HUB送信設定」「外部サービス管理」「Feature Flag
 * (環境変数)」の3か所に分かれており、どれが済んでどれが残っているのかを画面ごとに
 * 見て回らないと分からなかったため (運用からの指摘)。
 *
 * この画面は**状態を見せるだけ**で、設定の変更は行わない。変更は既存の各画面
 * (監査ログを残す実装) をそのまま使う。
 */
@Injectable()
export class AdminAgencySetupService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /**
   * 代理店システムへ送る `system_key` / `source_system_key` の期待値。
   *
   * この値は固定値ではなく、共通顧客HUB送信設定に保存された `system_key` が
   * そのまま送られる (`agency-referral.adapter.ts`)。既定値の `ove-wallet` のままだと
   * 代理店システム側の登録値と一致せず、登録完了通知が弾かれる
   * (`docs/integration/AGENCY_POINT_AWARD.md`)。
   */
  static readonly EXPECTED_SYSTEM_KEY = "orly-wallet";

  /** 連携に必要なFeature Flag。順序は設定手順の順に合わせてある。 */
  static readonly REQUIRED_FLAGS = [
    "ENABLE_PLATFORM_USER_ID",
    "ENABLE_WALLET_REFERRAL_TOKEN",
    "ENABLE_AGENCY_REFERRAL_SYNC",
    "ENABLE_AGENCY_POINT_AWARD_INBOX",
  ] as const;

  async get() {
    const [hubConfig, integration, referralCounts, linkCounts] = await Promise.all([
      this.db.commonUserHubConfig.findFirst(),
      this.db.serviceIntegration.findUnique({
        where: { serviceCode: "AGENCY_SYSTEM" },
        select: { id: true, status: true, createdAt: true, lastAccessedAt: true },
      }),
      this.db.walletReferral.groupBy({ by: ["status"], _count: { _all: true } }),
      this.db.accountLink.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const systemKey = hubConfig?.systemKey ?? "ove-wallet";
    const flags = getAllFeatureFlags();

    return {
      systemKey: {
        current: systemKey,
        expected: AdminAgencySetupService.EXPECTED_SYSTEM_KEY,
        matches: systemKey === AdminAgencySetupService.EXPECTED_SYSTEM_KEY,
      },
      // 代理店システムが発行し、ORI側が共通ID解決に使う鍵。下の受信用APIキーとは別物。
      hubApiKey: {
        set: !!hubConfig?.apiKeyEncrypted,
        preview: hubConfig?.apiKeyPreview ?? null,
        updatedAt: hubConfig?.updatedAt ?? null,
      },
      // ORI側が発行し、代理店システムが付与イベント送信に使う鍵。
      // 生値は保存していないため「発行済みか」と「相手が実際に使ったか」しか分からない。
      inboundApiKey: {
        issued: !!integration,
        status: integration?.status ?? null,
        issuedAt: integration?.createdAt ?? null,
        lastAccessedAt: integration?.lastAccessedAt ?? null,
      },
      flags: Object.fromEntries(
        AdminAgencySetupService.REQUIRED_FLAGS.map((key) => [key, flags[key] ?? false]),
      ) as Record<(typeof AdminAgencySetupService.REQUIRED_FLAGS)[number], boolean>,
      referrals: countsByStatus(referralCounts),
      agencyLinks: countsByStatus(linkCounts),
    };
  }
}

function countsByStatus(rows: { status: string; _count: { _all: number } }[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}
