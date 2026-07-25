import { Controller, Get, Param, Post, Query, Req, Res, ServiceUnavailableException, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CollectiblesQueryService } from "../collectibles/collectibles-query.service";
import { ApiAccessLogInterceptor } from "../common/api-access-log.interceptor";
import { ExternalApiAuthGuard, type AuthenticatedServiceRequest } from "../common/external-api-auth.guard";
import { isFeatureEnabled } from "../common/feature-flags";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";
import { ReferralsService } from "../referrals/referrals.service";
import { WalletsService } from "./wallets.service";

/**
 * 本人向けウォレットAPI (開発ガイドライン12章「本番公開前の必須項目」)。
 * URLでOVEアカウントIDを受け取らず、セッションから本人を特定する
 * (旧 `/api/v1/wallets/{oveAccountId}/...` はここへ統合し廃止した)。
 */
@ApiTags("me")
@Controller("api/v1/me")
export class MeController {
  constructor(
    private readonly wallets: WalletsService,
    private readonly referrals: ReferralsService,
    private readonly collectibles: CollectiblesQueryService,
  ) {}

  @Get("wallet")
  @UseGuards(SessionAuthGuard)
  async wallet(@Req() req: AuthenticatedUserRequest) {
    return this.wallets.getBalance(req.account.id);
  }

  @Get("transactions")
  @UseGuards(SessionAuthGuard)
  async transactions(
    @Req() req: AuthenticatedUserRequest,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    return this.wallets.listTransactions(req.account.id, limit ? Number(limit) : undefined, before);
  }

  /**
   * 取引履歴CSVエクスポート (docs/transaction-export.md参照)。動的セグメント
   * `transactions/:transactionId` より前に登録し、"export"がtransactionIdとして
   * 誤って解決されないようにする。
   */
  @Get("transactions/export")
  @UseGuards(SessionAuthGuard)
  async exportTransactions(@Req() req: AuthenticatedUserRequest, @Res() res: Response) {
    const csv = await this.wallets.exportTransactionsCsv(req.account.id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="transactions.csv"');
    res.send(csv);
  }

  @Get("transactions/:transactionId")
  @UseGuards(SessionAuthGuard)
  async transactionDetail(@Req() req: AuthenticatedUserRequest, @Param("transactionId") transactionId: string) {
    return this.wallets.getTransaction(req.account.id, transactionId);
  }

  @Get("linked-services")
  @UseGuards(SessionAuthGuard)
  async linkedServices(@Req() req: AuthenticatedUserRequest) {
    return this.wallets.listLinkedServices(req.account.id);
  }

  @Get("notices")
  @UseGuards(SessionAuthGuard)
  async notices(@Req() req: AuthenticatedUserRequest) {
    return this.wallets.listPublicNotices(req.account.id);
  }

  @Post("notices/:noticeId/read")
  @UseGuards(SessionAuthGuard)
  async markNoticeRead(@Req() req: AuthenticatedUserRequest, @Param("noticeId") noticeId: string) {
    return this.wallets.markNoticeRead(req.account.id, noticeId);
  }

  @Get("wallet/holds")
  @UseGuards(SessionAuthGuard)
  async walletHolds(@Req() req: AuthenticatedUserRequest) {
    return this.wallets.listActiveHolds(req.account.id);
  }

  @Get("referral-status")
  @UseGuards(SessionAuthGuard)
  async referralStatus(@Req() req: AuthenticatedUserRequest) {
    return this.referrals.getMyReferralStatus(req.account.id);
  }

  @Get("wallet/expiring-credits")
  @UseGuards(SessionAuthGuard)
  async expiringCredits(@Req() req: AuthenticatedUserRequest) {
    return this.wallets.getExpiringCreditsSummary(req.account.id);
  }

  /** メニュー画面の「コレクション」導線をFeature Flagで出し分けるための最小限の公開情報。 */
  @Get("feature-flags")
  @UseGuards(SessionAuthGuard)
  async myFeatureFlags() {
    return { digital_collection_enabled: isFeatureEnabled("ENABLE_DIGITAL_COLLECTION") };
  }

  /** NFTコレクション一覧 (指示書12章)。動的セグメント`:holdingId`より前に登録する必要はない
   * (固定パス"collectibles"の直後に来るためcollectibles/:holdingIdと衝突しない)。 */
  @Get("collectibles")
  @UseGuards(SessionAuthGuard)
  async myCollectibles(
    @Req() req: AuthenticatedUserRequest,
    @Query("include_revoked") includeRevoked?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    if (!isFeatureEnabled("ENABLE_DIGITAL_COLLECTION")) {
      throw new ServiceUnavailableException("digital collection is not enabled yet");
    }
    return this.collectibles.listMyCollectibles(req.account.id, {
      includeRevoked: includeRevoked === "true",
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get("collectibles/:holdingId")
  @UseGuards(SessionAuthGuard)
  async myCollectibleDetail(@Req() req: AuthenticatedUserRequest, @Param("holdingId") holdingId: string) {
    if (!isFeatureEnabled("ENABLE_DIGITAL_COLLECTION")) {
      throw new ServiceUnavailableException("digital collection is not enabled yet");
    }
    return this.collectibles.getMyCollectibleDetail(req.account.id, holdingId);
  }
}

/**
 * 外部サービス向け残高照会 (開発ガイドライン9.3章・12章)。認証済みの連携先が持つ
 * `external_user_id` だけを起点に解決し、任意の `oveAccountId` を直接指定させない。
 */
@ApiTags("service")
@Controller("api/v1/service/accounts")
export class ServiceAccountsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get(":externalUserId/balance")
  @UseGuards(ExternalApiAuthGuard)
  @UseInterceptors(ApiAccessLogInterceptor)
  async balance(@Req() req: AuthenticatedServiceRequest, @Param("externalUserId") externalUserId: string) {
    return this.wallets.getBalanceForServiceLink(req.serviceIntegration.id, externalUserId);
  }
}
