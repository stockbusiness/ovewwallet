import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WalletsService } from "./wallets.service";

@ApiTags("wallets")
@Controller("api/v1/wallets")
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  /** GET /api/v1/wallets/{oveAccountId}/balance (指示書11章) */
  @Get(":oveAccountId/balance")
  async balance(@Param("oveAccountId") oveAccountId: string) {
    return this.wallets.getBalance(oveAccountId);
  }

  /** GET /api/v1/wallets/{oveAccountId}/transactions (指示書11章) */
  @Get(":oveAccountId/transactions")
  async transactions(
    @Param("oveAccountId") oveAccountId: string,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
  ) {
    return this.wallets.listTransactions(oveAccountId, limit ? Number(limit) : undefined, before);
  }

  /** GET /api/v1/wallets/{oveAccountId}/transactions/{transactionId} (指示書13章 取引詳細画面) */
  @Get(":oveAccountId/transactions/:transactionId")
  async transactionDetail(
    @Param("oveAccountId") oveAccountId: string,
    @Param("transactionId") transactionId: string,
  ) {
    return this.wallets.getTransaction(oveAccountId, transactionId);
  }
}
