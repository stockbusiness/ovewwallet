import { Inject, Injectable } from "@nestjs/common";
import { ServiceCode, type Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

function isServiceCode(value: string): value is ServiceCode {
  return Object.prototype.hasOwnProperty.call(ServiceCode, value);
}

/**
 * 追加整合性対策P0-3。`ServiceIntegration`は現状`rewards`/`admin`モジュール内で
 * 直接Prismaアクセスされているが、日次上限の並行制御に必要な行ロックだけをここに
 * 切り出す (`RewardsModule`内でのみ使用、cross-module fan-outが無いため`@Global()`
 * にはしない)。
 */
@Injectable()
export class ServiceIntegrationRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /**
   * `ServiceIntegration`行を`SELECT...FOR UPDATE`でロックする
   * (`packages/ledger`の`lockWallet`と同じ設計)。同一サービス連携への並行付与
   * リクエストを直列化し、`dailyAmountLimit`集計とCREDITを同一整合性単位にする。
   * ロック順序: ServiceIntegration → RewardRule → Wallet (デッドロック防止のため統一)。
   */
  async lockById(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT id FROM service_integrations WHERE id = ${id} FOR UPDATE`;
  }

  async findById(id: string, client: Db = this.db) {
    return client.serviceIntegration.findUnique({ where: { id } });
  }

  /**
   * 認証済みの送信元キーから連携先を引く。`ServiceCode`列挙にない文字列は
   * nullを返す (共通イベントの署名鍵が持つ`source_system_key`は自由文字列で、
   * `ServiceCode`とは限らないため。そのままPrismaへ渡すと実行時エラーになる)。
   */
  async findByServiceCode(serviceCode: string, client: Db = this.db) {
    if (!isServiceCode(serviceCode)) return null;
    return client.serviceIntegration.findUnique({ where: { serviceCode } });
  }
}
