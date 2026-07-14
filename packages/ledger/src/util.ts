import { Prisma } from "@ove/database";
import { InvalidAmountError, WalletNotActiveError } from "./errors";

export interface LockedWalletRow {
  id: string;
  status: string;
  availableBalance: bigint;
  heldBalance: bigint;
  lifetimeCredited: bigint;
  lifetimeDebited: bigint;
}

export function toPositiveBigInt(value: bigint | number): bigint {
  const amount = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
  if (amount <= 0n) {
    throw new InvalidAmountError(value);
  }
  return amount;
}

/**
 * ウォレット行を SELECT ... FOR UPDATE でロックする。同一トランザクション内で
 * 呼び出すことで、同じウォレットへの並行 CREDIT/DEBIT/HOLD を直列化する。
 */
export async function lockWallet(
  tx: Prisma.TransactionClient,
  walletId: string,
): Promise<LockedWalletRow | undefined> {
  const rows = await tx.$queryRaw<LockedWalletRow[]>`
    SELECT
      id,
      status,
      available_balance AS "availableBalance",
      held_balance AS "heldBalance",
      lifetime_credited AS "lifetimeCredited",
      lifetime_debited AS "lifetimeDebited"
    FROM wallets
    WHERE id = ${walletId}
    FOR UPDATE
  `;
  return rows[0];
}

export function assertWalletActive(wallet: LockedWalletRow): void {
  if (wallet.status !== "ACTIVE") {
    throw new WalletNotActiveError(wallet.id, wallet.status);
  }
}

/** Prisma の一意制約違反 (idempotency_key など) かどうかを判定する。 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}
