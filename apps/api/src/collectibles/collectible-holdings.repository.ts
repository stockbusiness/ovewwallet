import { Inject, Injectable } from "@nestjs/common";
import type { CollectibleHolding, CollectibleHoldingStatus, Prisma, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateCollectibleHoldingParams {
  id: string;
  oveAccountId: string;
  collectibleAssetId: string;
  entitlementId: string;
  sourceSystemKey: string;
  orderId?: string | null;
  orderItemId?: string | null;
  acquiredAt: Date;
  metadata?: Prisma.InputJsonValue;
}

export interface ListMyHoldingsParams {
  oveAccountId: string;
  includeRevoked: boolean;
  limit: number;
  /** 前ページ最後のholding.id (キーセットページネーション)。 */
  cursor?: string;
}

export interface AdminListHoldingsParams {
  commonUserId?: string;
  accountCode?: string;
  entitlementId?: string;
  orderId?: string;
  productCode?: string;
  status?: CollectibleHoldingStatus;
  tokenId?: string;
  limit: number;
}

const HOLDING_WITH_ASSET_INCLUDE = { asset: true } as const;
export type CollectibleHoldingWithAsset = CollectibleHolding & { asset: Prisma.CollectibleAssetGetPayload<object> };

/**
 * NFTコレクション実装指示書11章。`CollectibleHolding`(ユーザーごとのカード保有権) への
 * Prismaアクセスを集約する。
 */
@Injectable()
export class CollectibleHoldingsRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findById(id: string, client: Db = this.db): Promise<CollectibleHolding | null> {
    return client.collectibleHolding.findUnique({ where: { id } });
  }

  async findByIdWithAsset(id: string, client: Db = this.db): Promise<CollectibleHoldingWithAsset | null> {
    return client.collectibleHolding.findUnique({ where: { id }, include: HOLDING_WITH_ASSET_INCLUDE });
  }

  async findByEntitlementId(entitlementId: string, client: Db = this.db): Promise<CollectibleHolding | null> {
    return client.collectibleHolding.findUnique({ where: { entitlementId } });
  }

  /**
   * `entitlement.revoked`のACTIVE→REVOKED遷移を排他制御する
   * (`packages/ledger`の`lockWallet`と同じ設計)。呼び出し元の`$transaction`内で、
   * 現在状態の再取得より前に呼ぶこと。
   */
  async lockByEntitlementId(entitlementId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT id FROM collectible_holdings WHERE entitlement_id = ${entitlementId} FOR UPDATE`;
  }

  async create(data: CreateCollectibleHoldingParams, client: Db = this.db): Promise<CollectibleHolding> {
    return client.collectibleHolding.create({ data });
  }

  async revoke(
    id: string,
    data: { revokedAt: Date; revokeReason: string },
    client: Db = this.db,
  ): Promise<CollectibleHolding> {
    return client.collectibleHolding.update({ where: { id }, data: { status: "REVOKED", ...data } });
  }

  /** ユーザー向け一覧 (指示書12章)。取得日降順・id降順でキーセットページネーションする。 */
  async listForAccount(params: ListMyHoldingsParams, client: Db = this.db): Promise<CollectibleHoldingWithAsset[]> {
    return client.collectibleHolding.findMany({
      where: {
        oveAccountId: params.oveAccountId,
        status: params.includeRevoked ? undefined : "ACTIVE",
      },
      include: HOLDING_WITH_ASSET_INCLUDE,
      orderBy: [{ acquiredAt: "desc" }, { id: "desc" }],
      take: params.limit,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  /** 同一カード内での取得順 (指示書12章`serial_number`表示用)。1始まりの順位を返す。 */
  async countAcquiredBeforeOrAt(collectibleAssetId: string, acquiredAt: Date, id: string, client: Db = this.db): Promise<number> {
    return client.collectibleHolding.count({
      where: {
        collectibleAssetId,
        OR: [{ acquiredAt: { lt: acquiredAt } }, { acquiredAt, id: { lte: id } }],
      },
    });
  }

  /** 管理画面向け検索一覧 (指示書14章)。 */
  async adminList(params: AdminListHoldingsParams, client: Db = this.db): Promise<CollectibleHoldingWithAsset[]> {
    return client.collectibleHolding.findMany({
      where: {
        entitlementId: params.entitlementId,
        orderId: params.orderId,
        status: params.status,
        tokenId: params.tokenId,
        account: params.commonUserId || params.accountCode ? { commonUserId: params.commonUserId, accountCode: params.accountCode } : undefined,
        asset: params.productCode ? { productCode: params.productCode } : undefined,
      },
      include: HOLDING_WITH_ASSET_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: params.limit,
    });
  }
}
