import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type CollectibleHolding, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { CollectibleAssetsRepository } from "./collectible-assets.repository";
import { CollectibleHoldingsRepository } from "./collectible-holdings.repository";

export interface GrantCollectibleParams {
  oveAccountId: string;
  entitlementId: string;
  assetCode: string;
  name: string;
  imageUrl: string;
  productCode?: string | null;
  thumbnailUrl?: string | null;
  rarity?: string | null;
  sourceSystemKey: string;
  orderId?: string | null;
  orderItemId?: string | null;
  acquiredAt: Date;
  eventId: string;
}

export interface GrantCollectibleResult {
  holding: CollectibleHolding;
  assetCreated: boolean;
}

/**
 * NFTコレクション実装指示書9章。`entitlement.granted`受信時のAsset解決・Holding作成を
 * 1つの整合性単位にまとめる。
 *
 * 冪等性 (指示書9.1章「別event_id・同じentitlement_id → 既存Holdingを返す」):
 * `entitlement_id`はUNIQUE制約を持つため、事前確認で見つからなくても後続のINSERTが
 * 一意制約違反になりうる (TOCTOU)。その場合は再検索して既存Holdingを返す
 * (`ExternalAccountProvisioningService`等、既存のP2002キャッチパターンと同じ設計)。
 *
 * Asset更新方針 (指示書9章): 既存`asset_code`がある場合、name/image_urlを自動上書き
 * しない。incoming値が異なる場合はAuditLogへ記録するのみで、Assetは変更しない
 * (CollectibleAsset=マスター、CollectibleHolding.metadata=購入時スナップショット)。
 */
@Injectable()
export class GrantCollectibleUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly assets: CollectibleAssetsRepository,
    private readonly holdings: CollectibleHoldingsRepository,
  ) {}

  async execute(params: GrantCollectibleParams): Promise<GrantCollectibleResult> {
    const existing = await this.holdings.findByEntitlementId(params.entitlementId);
    if (existing) return { holding: existing, assetCreated: false };

    try {
      return await this.db.$transaction(async (tx) => {
        const existingInTx = await this.holdings.findByEntitlementId(params.entitlementId, tx);
        if (existingInTx) return { holding: existingInTx, assetCreated: false };

        let asset = await this.assets.findByAssetCode(params.assetCode, tx);
        let assetCreated = false;
        if (!asset) {
          asset = await this.assets.create(
            {
              id: generateId(),
              assetCode: params.assetCode,
              productCode: params.productCode,
              name: params.name,
              imageUrl: params.imageUrl,
              thumbnailUrl: params.thumbnailUrl,
              rarity: params.rarity,
            },
            tx,
          );
          assetCreated = true;
        } else if (asset.name !== params.name || asset.imageUrl !== params.imageUrl) {
          await tx.auditLog.create({
            data: {
              id: generateId(),
              actorType: "EXTERNAL_SERVICE",
              actorId: params.sourceSystemKey,
              actionType: "COLLECTIBLE_ASSET_MISMATCH",
              targetType: "collectible_asset",
              targetId: asset.id,
              result: "FAILURE",
              reason: `incoming name/image_url differs from existing CollectibleAsset (asset_code="${params.assetCode}"); asset left unchanged`,
              beforeData: { name: asset.name, imageUrl: asset.imageUrl } as unknown as Prisma.InputJsonValue,
              afterData: { name: params.name, imageUrl: params.imageUrl } as unknown as Prisma.InputJsonValue,
            },
          });
        }

        const holding = await this.holdings.create(
          {
            id: generateId(),
            oveAccountId: params.oveAccountId,
            collectibleAssetId: asset.id,
            entitlementId: params.entitlementId,
            sourceSystemKey: params.sourceSystemKey,
            orderId: params.orderId,
            orderItemId: params.orderItemId,
            acquiredAt: params.acquiredAt,
            metadata: {
              assetCode: params.assetCode,
              name: params.name,
              imageUrl: params.imageUrl,
              thumbnailUrl: params.thumbnailUrl ?? null,
              rarity: params.rarity ?? null,
            } as unknown as Prisma.InputJsonValue,
          },
          tx,
        );

        await tx.auditLog.create({
          data: {
            id: generateId(),
            actorType: "EXTERNAL_SERVICE",
            actorId: params.sourceSystemKey,
            actionType: "COLLECTIBLE_GRANTED",
            targetType: "collectible_holding",
            targetId: holding.id,
            result: "SUCCESS",
            afterData: {
              eventId: params.eventId,
              entitlementId: params.entitlementId,
              oveAccountId: params.oveAccountId,
              orderId: params.orderId ?? null,
              productCode: params.productCode ?? null,
              sourceSystemKey: params.sourceSystemKey,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        return { holding, assetCreated };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const race = await this.holdings.findByEntitlementId(params.entitlementId);
        if (race) return { holding: race, assetCreated: false };
      }
      throw error;
    }
  }
}
