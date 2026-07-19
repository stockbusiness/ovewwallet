import { Controller, Get, Param, Post, Query, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WalletsService } from "./wallets.service";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";
import { ExternalApiAuthGuard, type AuthenticatedServiceRequest } from "../common/external-api-auth.guard";
import { ApiAccessLogInterceptor } from "../common/api-access-log.interceptor";

/**
 * 本人向けウォレットAPI (開発ガイドライン12章「本番公開前の必須項目」)。
 * URLでOVEアカウントIDを受け取らず、セッションから本人を特定する
 * (旧 `/api/v1/wallets/{oveAccountId}/...` はここへ統合し廃止した)。
 */
@ApiTags("me")
@Controller("api/v1/me")
export class MeController {
  constructor(private readonly wallets: WalletsService) {}

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
