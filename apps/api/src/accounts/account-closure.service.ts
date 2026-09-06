import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { debitWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { AccountRepository } from "./account.repository";

/**
 * リファクタリング指示書 Phase 2: `AccountsService`から分離した退会責務
 * (残高の放棄・CLOSED更新・セッション失効・AuditLogを実行)。
 */
@Injectable()
export class AccountClosureService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
  ) {}

  /**
   * ユーザー本人による退会 (docs/account-closure.md参照)。
   *
   * **残っている利用可能残高は放棄する。** 当初は「使い切ってから退会してもらう」
   * 方針で残高が0でなければ拒否していたが、ORIを使う導線がまだ無いうえに段階付与で
   * 登録直後から残高が入るため、そのままでは誰も自分のアカウントを消せなくなる。
   * 放棄は台帳へ `ACCOUNT_CLOSURE_FORFEIT` として記録するので、後から追える。
   *
   * 保留残高が残っている場合だけは拒否する。処理中の取引が残っている状態で
   * その分を消すと、確定・解除のどちらが来ても辻褄が合わなくなるため。
   *
   * 成功時はアカウントをCLOSEDにし、有効なセッションを全て失効させる。
   */
  async requestClosure(oveAccountId: string): Promise<{ closed: true; forfeitedAmount: string }> {
    const account = await this.accountRepository.findById(oveAccountId);
    if (!account) throw new NotFoundException("account not found");
    if (account.status === "CLOSED") throw new ConflictException("account is already closed");

    const forfeited = await this.forfeitRemainingBalance(oveAccountId);

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
          afterData: { forfeitedAmount: forfeited.toString() },
        },
      });
    });

    return { closed: true, forfeitedAmount: forfeited.toString() };
  }

  /**
   * 残っている利用可能残高を放棄する。放棄した額を返す (残高が無ければ0)。
   *
   * 退会本体とは別のトランザクションになる。`debitWallet`が自前でトランザクションを
   * 開くためで、記帳だけ済んで退会が失敗した場合は、利用者がもう一度退会を実行すれば
   * 続きから進む (冪等キーに額を含めているので、同じ額の再実行では二重に引かない)。
   */
  private async forfeitRemainingBalance(oveAccountId: string): Promise<bigint> {
    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId } });
    if (!wallet) return 0n;

    if (wallet.heldBalance > 0n) {
      throw new BadRequestException("held_balance must be zero before closing the account");
    }
    if (wallet.availableBalance <= 0n) return 0n;

    const amount = wallet.availableBalance;
    await debitWallet(
      {
        walletId: wallet.id,
        amount,
        transactionType: "ACCOUNT_CLOSURE_FORFEIT",
        // 額を含める。退会の途中で失敗して再実行したとき、同じ額なら二重に引かず、
        // 額が変わっていれば (退会前に新たな付与が入った場合) その分も引くため。
        idempotencyKey: `account-closure:${oveAccountId}:${amount.toString()}`,
        displayName: "退会による失効",
        description: "退会時に残っていた残高を放棄した",
        createdByType: "USER",
        createdById: oveAccountId,
      },
      this.db,
    );

    return amount;
  }
}
