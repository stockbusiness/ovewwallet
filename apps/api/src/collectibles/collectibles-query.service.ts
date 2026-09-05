import { Injectable, NotFoundException } from "@nestjs/common";
import { CollectibleImagesService } from "../collectible-images/collectible-images.service";
import {
  CollectibleHoldingsRepository,
  type CollectibleHoldingWithAsset,
} from "./collectible-holdings.repository";

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
  constructor(
    private readonly holdings: CollectibleHoldingsRepository,
    private readonly images: CollectibleImagesService,
  ) {}

  async listMyCollectibles(
    oveAccountId: string,
    params: ListMyCollectiblesParams,
  ) {
    const limit = Math.min(
      Math.max(params.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const rows = await this.holdings.listForAccount({
      oveAccountId,
      includeRevoked: params.includeRevoked,
      limit: limit + 1,
      cursor: params.cursor,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const stored = await this.resolveImages(page);
    const items = page.map((holding) => this.toDto(holding, stored));
    return { items, next_cursor: hasMore ? page[page.length - 1]!.id : null };
  }

  /** 他人のHoldingは (存在有無を問わず) 404にする。 */
  async getMyCollectibleDetail(oveAccountId: string, holdingId: string) {
    const holding = await this.holdings.findByIdForAccountWithAsset(
      holdingId,
      oveAccountId,
    );
    if (!holding) throw new NotFoundException("collectible holding not found");
    return this.toDto(holding, await this.resolveImages([holding]));
  }

  /**
   * 取り込み済みならウォレット自身の配信URLへ差し替える。取り込めていないものは
   * 取得元URLのまま返す (画像が出ないより、外部URLでも出た方がよいため)。
   */
  private async resolveImages(
    holdings: CollectibleHoldingWithAsset[],
  ): Promise<Map<string, string>> {
    const urls = holdings.flatMap((holding) => [
      holding.imageUrlSnapshot ?? holding.asset.imageUrl,
      holding.thumbnailUrlSnapshot ?? holding.asset.thumbnailUrl,
    ]);
    return this.images.resolveStoredUrls(urls);
  }

  private toDto(holding: CollectibleHoldingWithAsset, stored: Map<string, string>) {
    const imageUrl = holding.imageUrlSnapshot ?? holding.asset.imageUrl;
    const thumbnailUrl = holding.thumbnailUrlSnapshot ?? holding.asset.thumbnailUrl;
    return {
      holding_id: holding.id,
      status: holding.status,
      serial_number: holding.serialNumber,
      acquired_at: holding.acquiredAt,
      revoked_at: holding.revokedAt,
      // PR-W3-a: 外部システム(Market)からの自由記述(revokeReason)はユーザー画面へ直接
      // 表示しない。フロントエンドはrevoke_reason_codeを固定文言表(collectible-revoke-reason.ts)
      // へマッピングして表示する(未知コードは汎用文言へフォールバック)。
      revoke_reason_code: holding.revokeReasonCode,
      asset: {
        asset_code: holding.asset.assetCode,
        name: holding.displayNameSnapshot ?? holding.asset.name,
        description: holding.descriptionSnapshot ?? holding.asset.description,
        image_url: stored.get(imageUrl) ?? imageUrl,
        thumbnail_url: thumbnailUrl === null ? null : (stored.get(thumbnailUrl) ?? thumbnailUrl),
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
