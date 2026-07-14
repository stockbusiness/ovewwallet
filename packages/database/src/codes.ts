import type { PrismaClient } from "@prisma/client";

/**
 * code_counters テーブルを単一の UPDATE ... RETURNING で原子的にインクリメントし、
 * 表示用コード (例: OVE-ACC-00001234) を発行する。呼び出し前にカウンタ行が
 * 存在しない場合は 1 から採番を開始する。
 */
export async function nextDisplayCode(
  client: Pick<PrismaClient, "$queryRaw" | "$executeRaw">,
  counterKey: string,
  prefix: string,
  padLength = 8,
): Promise<string> {
  await client.$executeRaw`
    INSERT INTO code_counters (id, next_value)
    VALUES (${counterKey}, 1)
    ON CONFLICT (id) DO NOTHING
  `;

  const rows = await client.$queryRaw<{ value: bigint }[]>`
    UPDATE code_counters
    SET next_value = next_value + 1
    WHERE id = ${counterKey}
    RETURNING next_value - 1 AS value
  `;

  const value = rows[0]?.value;
  if (value === undefined) {
    throw new Error(`Failed to allocate code for counter: ${counterKey}`);
  }

  return `${prefix}-${value.toString().padStart(padLength, "0")}`;
}

export const ACCOUNT_CODE_COUNTER = "OVE_ACCOUNT";
export const WALLET_CODE_COUNTER = "OVE_WALLET";
export const TRANSACTION_CODE_COUNTER = "OVE_TRANSACTION";
