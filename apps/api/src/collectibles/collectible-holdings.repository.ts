import { Inject, Injectable } from "@nestjs/common";
import type {
  CollectibleHolding,
  CollectibleHoldingStatus,
  Prisma,
  PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateCollectibleHoldingParams {
  id: string;
  oveAccountId: string;
  collectibleAssetId: string;
  entitlementId: string;
  sourceSystemKey: string;
  logicalMarket: string;
  orderId?: string | null;
  orderItemId?: string | null;
  acquiredAt: Date;
  metadata?: Prisma.InputJsonValue;
  /** PR#2最終修正 P1-3: 付与時点で固定する表示用スナップショット。 */
  displayNameSnapshot?: string | null;
  descriptionSnapshot?: string | null;
  imageUrlSnapshot?: string | null;
  thumbnailUrlSnapshot?: string | null;
  imageHashSnapshot?: string | null;
  raritySnapshot?: string | null;
  /** PR#2最終修正 P1-4: マーケット側の不変値。未送信ならnull。 */
  serialNumber?: string | null;
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
export type CollectibleHoldingWithAsset = CollectibleHolding & {
  asset: Prisma.CollectibleAssetGetPayload<object>;
};

const HOLDING_WITH_ASSET_AND_ACCOUNT_INCLUDE = {
  asset: true,
  account: { select: { id: true, accountCode: true, commonUserId: true } },
} as const;
export type CollectibleHoldingWithAssetAndAccount =
  CollectibleHoldingWithAsset & {
    account: { id: string; accountCode: string; commonUserId: string | null };
  };

/**
 * NFTコレクション実装指示書11章。`CollectibleHolding`(ユーザーごとのカード保有権) への
 * Prismaアクセスを集約する。
 */
@Injectable()
export class CollectibleHoldingsRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findById(
    id: string,
    client: Db = this.db,
  ): Promise<CollectibleHolding | null> {
    return client.collectibleHolding.findUnique({ where: { id } });
  }

  async findByIdWithAsset(
    id: string,
    client: Db = this.db,
  ): Promise<CollectibleHoldingWithAsset | null> {
    return client.collectibleHolding.findUnique({
      where: { id },
      include: HOLDING_WITH_ASSET_INCLUDE,
    });
  }

  /** 本人向け詳細画面 (指示書12章)。本人のOveAccountに属するHoldingのみ取得できる。 */
  async findByIdForAccountWithAsset(
    id: string,
    oveAccountId: string,
    client: Db = this.db,
  ): Promise<CollectibleHoldingWithAsset | null> {
    return client.collectibleHolding.findFirst({
      where: { id, oveAccountId },
      include: HOLDING_WITH_ASSET_INCLUDE,
    });
  }

  async findByEntitlementId(
    logicalMarket: string,
    entitlementId: string,
    client: Db = this.db,
  ): Promise<CollectibleHolding | null> {
    return client.collectibleHolding.findUnique({
      where: { logicalMarket_entitlementId: { logicalMarket, entitlementId } },
    });
  }

  /**
   * 論理Marketを絞らずに探す。**取消の可否判断には使わない。**
   *
   * 受理できない送信元からの取消要求を監査ログに残すためだけの検索
   * (`RevokeCollectibleUseCase.rejectUnknownSource`)。複数マーケットが同じ
   * entitlement_idを持ちうるので、どれが返るかは決まらない。
   */
  async findAnyByEntitlementId(
    entitlementId: string,
    client: Db = this.db,
  ): Promise<CollectibleHolding | null> {
    return client.collectibleHolding.findFirst({ where: { entitlementId } });
  }

  /** PR#2最終修正 P0-2: 再送の一致検証に`collectibleAsset.assetCode`が要るため、Asset込みで取得する。 */
  async findByEntitlementIdWithAsset(
    logicalMarket: string,
    entitlementId: string,
    client: Db = this.db,
  ): Promise<CollectibleHoldingWithAsset | null> {
    return client.collectibleHolding.findUnique({
      where: { logicalMarket_entitlementId: { logicalMarket, entitlementId } },
      include: HOLDING_WITH_ASSET_INCLUDE,
    });
  }

  /**
   * `entitlement.revoked`のACTIVE→REVOKED遷移を排他制御する
   * (`packages/ledger`の`lockWallet`と同じ設計)。呼び出し元の`$transaction`内で、
   * 現在状態の再取得より前に呼ぶこと。
   */
  async lockByEntitlementId(
    logicalMarket: string,
    entitlementId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // 論理Marketでも絞る。別マーケットの同じentitlement_idの行まで巻き込んで
    // ロックしないため。
    await tx.$executeRaw`SELECT id FROM collectible_holdings WHERE logical_market = ${logicalMarket} AND entitlement_id = ${entitlementId} FOR UPDATE`;
  }

  async create(
    data: CreateCollectibleHoldingParams,
    client: Db = this.db,
  ): Promise<CollectibleHolding> {
    return client.collectibleHolding.create({ data });
  }

  async revoke(
    id: string,
    data: {
      revokedAt: Date;
      revokeReason: string;
      revokeReasonCode?: string | null;
      revokedBySourceSystemKey?: string | null;
      revokedByEventId?: string | null;
      revokedCorrelationId?: string | null;
      revokedOccurredAt?: Date | null;
    },
    client: Db = this.db,
  ): Promise<CollectibleHolding> {
    return client.collectibleHolding.update({
      where: { id },
      data: { status: "REVOKED", ...data },
    });
  }

  /** ユーザー向け一覧 (指示書12章)。取得日降順・id降順でキーセットページネーションする。 */
  async listForAccount(
    params: ListMyHoldingsParams,
    client: Db = this.db,
  ): Promise<CollectibleHoldingWithAsset[]> {
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

  /** 管理画面向け検索一覧 (指示書14章)。 */
  async adminList(
    params: AdminListHoldingsParams,
    client: Db = this.db,
  ): Promise<CollectibleHoldingWithAssetAndAccount[]> {
    return client.collectibleHolding.findMany({
      where: {
        entitlementId: params.entitlementId,
        orderId: params.orderId,
        status: params.status,
        tokenId: params.tokenId,
        account:
          params.commonUserId || params.accountCode
            ? {
                commonUserId: params.commonUserId,
                accountCode: params.accountCode,
              }
            : undefined,
        asset: params.productCode
          ? { productCode: params.productCode }
          : undefined,
      },
      include: HOLDING_WITH_ASSET_AND_ACCOUNT_INCLUDE,
      orderBy: { createdAt: "desc" },
      take: params.limit,
    });
  }

  /** 管理画面向け詳細 (指示書14章)。保有者のアカウント情報も併せて返す。 */
  async findByIdWithAssetAndAccount(
    id: string,
    client: Db = this.db,
  ): Promise<CollectibleHoldingWithAssetAndAccount | null> {
    return client.collectibleHolding.findUnique({
      where: { id },
      include: HOLDING_WITH_ASSET_AND_ACCOUNT_INCLUDE,
    });
  }
}
