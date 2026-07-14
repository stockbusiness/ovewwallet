import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { mergeAccounts } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";

/** アカウント統合 (指示書6章・13章)。高額操作に準じ SUPER_ADMIN のみに限定する。 */
@Injectable()
export class AdminAccountMergeService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async merge(params: {
    sourceAccountCode: string;
    targetAccountCode: string;
    reason: string;
    adminId: string;
  }) {
    const [source, target] = await Promise.all([
      this.db.oveAccount.findUniqueOrThrow({ where: { accountCode: params.sourceAccountCode } }),
      this.db.oveAccount.findUniqueOrThrow({ where: { accountCode: params.targetAccountCode } }),
    ]);

    return mergeAccounts(
      {
        sourceAccountId: source.id,
        targetAccountId: target.id,
        reason: params.reason,
        idempotencyKey: `ACCOUNT_MERGE:${source.id}:${target.id}`,
        createdByType: "ADMIN",
        createdById: params.adminId,
      },
      this.db,
    );
  }
}
