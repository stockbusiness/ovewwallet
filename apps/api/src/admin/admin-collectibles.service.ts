import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type CollectibleAsset, type CollectibleHolding, type CollectibleHoldingStatus, type Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import {
  CollectibleAssetsRepository,
  type CreateCollectibleAssetParams,
} from "../collectibles/collectible-assets.repository";
import {
  CollectibleHoldingsRepository,
  type CollectibleHoldingWithAssetAndAccount,
} from "../collectibles/collectible-holdings.repository";
import { RevokeCollectibleUseCase } from "../collectibles/revoke-collectible.use-case";

export interface UpdateCollectibleAssetParams {
  name?: string;
  description?: string | null;
  imageUrl?: string;
  thumbnailUrl?: string | null;
  rarity?: string | null;
  category?: string | null;
  editionSize?: number | null;
  status?: "ACTIVE" | "ARCHIVED";
}

export interface AdminSearchHoldingsParams {
  commonUserId?: string;
  accountCode?: string;
  entitlementId?: string;
  orderId?: string;
  productCode?: string;
  status?: CollectibleHoldingStatus;
  tokenId?: string;
  limit?: number;
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * NFTコレクション実装指示書14章。カードマスター(CollectibleAsset)のCRUDと、
 * 保有(CollectibleHolding)の検索・手動取消を管理画面向けに提供する。
 *
 * PR#2最終修正 P2-1: カードマスターの作成・更新はDB更新とAuditLogを同一トランザクションで
 * 実行する。ステータスをACTIVE/ARCHIVEDへ変更した場合は専用のactionType
 * (COLLECTIBLE_ASSET_ARCHIVED/COLLECTIBLE_ASSET_ACTIVATED) を、それ以外の項目変更は
 * COLLECTIBLE_ASSET_UPDATEDを記録する。
 */
@Injectable()
export class AdminCollectiblesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly assets: CollectibleAssetsRepository,
    private readonly holdings: CollectibleHoldingsRepository,
    private readonly revokeCollectible: RevokeCollectibleUseCase,
  ) {}

  async listAssets(limit = DEFAULT_LIST_LIMIT): Promise<CollectibleAsset[]> {
    return this.assets.list({ limit: Math.min(limit, MAX_LIST_LIMIT) });
  }

  async getAsset(id: string): Promise<CollectibleAsset> {
    const asset = await this.assets.findById(id);
    if (!asset) throw new NotFoundException("collectible asset not found");
    return asset;
  }

  async createAsset(params: Omit<CreateCollectibleAssetParams, "id">, adminId: string): Promise<CollectibleAsset> {
    const existing = await this.assets.findByAssetCode(params.assetCode);
    if (existing) throw new ConflictException(`collectible asset ${params.assetCode} already exists`);

    return this.db.$transaction(async (tx) => {
      const asset = await this.assets.create({ id: generateId(), ...params }, tx);
      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "ADMIN",
          actorId: adminId,
          actionType: "COLLECTIBLE_ASSET_CREATED",
          targetType: "collectible_asset",
          targetId: asset.id,
          result: "SUCCESS",
          afterData: { assetCode: asset.assetCode, name: asset.name, imageUrl: asset.imageUrl } as unknown as Prisma.InputJsonValue,
        },
      });
      return asset;
    });
  }

  async updateAsset(id: string, params: UpdateCollectibleAssetParams, adminId: string): Promise<CollectibleAsset> {
    const before = await this.getAsset(id);

    return this.db.$transaction(async (tx) => {
      const updated = await this.assets.update(id, params, tx);
      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "ADMIN",
          actorId: adminId,
          actionType: this.updateActionType(before.status, params.status),
          targetType: "collectible_asset",
          targetId: updated.id,
          result: "SUCCESS",
          beforeData: {
            name: before.name,
            description: before.description,
            imageUrl: before.imageUrl,
            thumbnailUrl: before.thumbnailUrl,
            rarity: before.rarity,
            category: before.category,
            editionSize: before.editionSize,
            status: before.status,
          } as unknown as Prisma.InputJsonValue,
          afterData: {
            name: updated.name,
            description: updated.description,
            imageUrl: updated.imageUrl,
            thumbnailUrl: updated.thumbnailUrl,
            rarity: updated.rarity,
            category: updated.category,
            editionSize: updated.editionSize,
            status: updated.status,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return updated;
    });
  }

  private updateActionType(previousStatus: string, nextStatus: string | undefined): string {
    if (nextStatus && nextStatus !== previousStatus) {
      return nextStatus === "ARCHIVED" ? "COLLECTIBLE_ASSET_ARCHIVED" : "COLLECTIBLE_ASSET_ACTIVATED";
    }
    return "COLLECTIBLE_ASSET_UPDATED";
  }

  async searchHoldings(params: AdminSearchHoldingsParams): Promise<CollectibleHoldingWithAssetAndAccount[]> {
    return this.holdings.adminList({
      commonUserId: params.commonUserId,
      accountCode: params.accountCode,
      entitlementId: params.entitlementId,
      orderId: params.orderId,
      productCode: params.productCode,
      status: params.status,
      tokenId: params.tokenId,
      limit: Math.min(params.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
    });
  }

  async getHolding(id: string): Promise<CollectibleHoldingWithAssetAndAccount> {
    const holding = await this.holdings.findByIdWithAssetAndAccount(id);
    if (!holding) throw new NotFoundException("collectible holding not found");
    return holding;
  }

  /** 管理画面からの手動取消 (指示書14章)。監査ログの`sourceSystemKey`にはadminIdを記録する。 */
  async revokeHolding(id: string, adminId: string, reason: string): Promise<CollectibleHolding> {
    const holding = await this.getHolding(id);
    const result = await this.revokeCollectible.execute({
      entitlementId: holding.entitlementId,
      reason,
      sourceSystemKey: adminId,
      actorType: "ADMIN",
      eventId: `admin-revoke:${generateId()}`,
    });
    // "tombstoned"はactorType==="ADMIN"では発生しない(revoke-collectible.use-case参照)が、
    // 型としては存在するため念のため同じくnot_found扱いにする。
    if (result.status === "not_found" || result.status === "tombstoned") {
      throw new NotFoundException("collectible holding not found");
    }
    return result.holding;
  }
}
