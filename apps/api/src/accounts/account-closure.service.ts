import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { AccountRepository } from "./account.repository";

/**
 * リファクタリング指示書 Phase 2: `AccountsService`から分離した退会責務
 * (残高確認・CLOSED更新・セッション失効・AuditLogを同一トランザクションで実行)。
 */
@Injectable()
export class AccountClosureService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * ユーザー本人による退会 (docs/account-closure.md参照)。残高(available/held)が
   * 0でなければ拒否する (使い切ってから退会してもらう、失効ではなく利用を促す方針)。
   * 成功時はアカウントをCLOSEDにし、有効なセッションを全て失効させる。
   */
  async requestClosure(oveAccountId: string): Promise<{ closed: true }> {
    const account = await this.accountRepository.findById(oveAccountId);
    if (!account) throw new NotFoundException("account not found");
    if (account.status === "CLOSED") throw new ConflictException("account is already closed");

    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId } });
    if (wallet && (wallet.availableBalance > 0n || wallet.heldBalance > 0n)) {
      throw new BadRequestException("available_balance and held_balance must be zero before closing the account");
    }

    await this.db.$transaction(async (tx) => {
      await this.accountRepository.closeAccount(tx, oveAccountId);

      await tx.userSession.updateMany({
        where: { oveAccountId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "USER_ACCOUNT_CLOSURE" },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "USER",
          actorId: oveAccountId,
          actionType: "ACCOUNT_CLOSED",
          targetType: "ove_account",
          targetId: oveAccountId,
          result: "SUCCESS",
        },
      });
    });

    return { closed: true };
  }
}
