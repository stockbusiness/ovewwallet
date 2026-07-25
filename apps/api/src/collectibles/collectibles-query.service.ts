import { Injectable, NotFoundException } from "@nestjs/common";
import { CollectibleHoldingsRepository, type CollectibleHoldingWithAsset } from "./collectible-holdings.repository";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export interface ListMyCollectiblesParams {
  includeRevoked: boolean;
  limit?: number;
  cursor?: string;
}

/**
 * NFTコレクション実装指示書12章。本人向け`GET /api/v1/me/collectibles`
 * (一覧・詳細) の組み立てを担う。
 *
 * PR#2最終修正 P1-3/P1-4: `serial_number`は動的COUNTでの算出をやめ、付与時に固定された
 * `holding.serialNumber`をそのまま返す (未送信ならnull・画面非表示)。カード表示情報も
 * `holding.*Snapshot`列を優先し、専用列導入以前の行 (すべてnull) のみCollectibleAssetへ
 * フォールバックする。
 */
@Injectable()
export class CollectiblesQueryService {
  constructor(private readonly holdings: CollectibleHoldingsRepository) {}

  async listMyCollectibles(oveAccountId: string, params: ListMyCollectiblesParams) {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const rows = await this.holdings.listForAccount({
      oveAccountId,
      includeRevoked: params.includeRevoked,
      limit: limit + 1,
      cursor: params.cursor,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((holding) => this.toDto(holding));
    return { items, next_cursor: hasMore ? page[page.length - 1]!.id : null };
  }

  /** 他人のHoldingは (存在有無を問わず) 404にする。 */
  async getMyCollectibleDetail(oveAccountId: string, holdingId: string) {
    const holding = await this.holdings.findByIdForAccountWithAsset(holdingId, oveAccountId);
    if (!holding) throw new NotFoundException("collectible holding not found");
    return this.toDto(holding);
  }

  private toDto(holding: CollectibleHoldingWithAsset) {
    return {
      holding_id: holding.id,
      status: holding.status,
      serial_number: holding.serialNumber,
      acquired_at: holding.acquiredAt,
      revoked_at: holding.revokedAt,
      revoke_reason: holding.revokeReason,
      asset: {
        asset_code: holding.asset.assetCode,
        name: holding.displayNameSnapshot ?? holding.asset.name,
        description: holding.descriptionSnapshot ?? holding.asset.description,
        image_url: holding.imageUrlSnapshot ?? holding.asset.imageUrl,
        thumbnail_url: holding.thumbnailUrlSnapshot ?? holding.asset.thumbnailUrl,
        rarity: holding.raritySnapshot ?? holding.asset.rarity,
        category: holding.asset.category,
        edition_size: holding.asset.editionSize,
      },
      onchain: {
        network: holding.network,
        chain_id: holding.chainId,
        contract_address: holding.contractAddress,
        token_id: holding.tokenId,
        transaction_hash: holding.transactionHash,
        owner_address: holding.ownerAddress,
        minted_at: holding.mintedAt,
      },
    };
  }
}
