import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface UpdateAgencyAssignmentParams {
  assignedAgencyId?: string;
  registrationReferrerAgencyId?: string;
}

/**
 * リファクタリング指示書 Phase 8「DBアクセス境界」。`OveAccount.assignedAgencyId`
 * (現在の顧客担当代理店、変更可能) / `registrationReferrerAgencyId`
 * (登録時の紹介元代理店、初回のみ設定してロック) という「代理店帰属情報」を
 * 表す2フィールドへの更新を集約する。専用テーブルは持たず (指示書9章「Phase 9で
 * 将来必要になった段階で構造化を検討」)、既存の`OveAccount`テーブル内のフィールドを
 * 対象とする。ロック判定・変更要否の判定 (差分計算) は呼び出し元
 * (`CustomerAssignmentChangedHandler`) の業務ロジックとして残し、このRepositoryは
 * 素朴な更新のみを担う。
 */
@Injectable()
export class AgencyAssignmentRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async updateAssignment(accountId: string, data: UpdateAgencyAssignmentParams, client: Db = this.db): Promise<void> {
    await client.oveAccount.update({ where: { id: accountId }, data });
  }
}
