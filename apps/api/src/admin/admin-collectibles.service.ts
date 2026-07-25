import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type CollectibleAsset, type CollectibleHolding, type CollectibleHoldingStatus } from "@ove/database";
import {
  CollectibleAssetsRepository,
  type CreateCollectibleAssetParams,
} from "../collectibles/collectible-assets.repository";
import { CollectibleHoldingsRepository, type CollectibleHoldingWithAsset } from "../collectibles/collectible-holdings.repository";
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
 */
@Injectable()
export class AdminCollectiblesService {
  constructor(
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

  async createAsset(params: Omit<CreateCollectibleAssetParams, "id">): Promise<CollectibleAsset> {
    const existing = await this.assets.findByAssetCode(params.assetCode);
    if (existing) throw new ConflictException(`collectible asset ${params.assetCode} already exists`);
    return this.assets.create({ id: generateId(), ...params });
  }

  async updateAsset(id: string, params: UpdateCollectibleAssetParams): Promise<CollectibleAsset> {
    await this.getAsset(id);
    return this.assets.update(id, params);
  }

  async searchHoldings(params: AdminSearchHoldingsParams): Promise<CollectibleHoldingWithAsset[]> {
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

  async getHolding(id: string): Promise<CollectibleHoldingWithAsset> {
    const holding = await this.holdings.findByIdWithAsset(id);
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
    if (result.status === "not_found") throw new NotFoundException("collectible holding not found");
    return result.holding;
  }
}
