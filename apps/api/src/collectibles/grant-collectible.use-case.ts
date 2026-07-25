import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type CollectibleHolding, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { CollectibleAssetsRepository } from "./collectible-assets.repository";
import { CollectibleHoldingsRepository, type CollectibleHoldingWithAsset } from "./collectible-holdings.repository";

export interface GrantCollectibleParams {
  oveAccountId: string;
  entitlementId: string;
  assetCode: string;
  name: string;
  description?: string | null;
  imageUrl: string;
  productCode?: string | null;
  thumbnailUrl?: string | null;
  imageHash?: string | null;
  rarity?: string | null;
  /** PR#2最終修正 P1-4: マーケット側の不変値。未送信ならnull。 */
  serialNumber?: string | null;
  sourceSystemKey: string;
  orderId?: string | null;
  orderItemId?: string | null;
  acquiredAt: Date;
  eventId: string;
}

export type GrantCollectibleResult =
  | { status: "granted"; holding: CollectibleHolding; assetCreated: boolean }
  /** PR#2最終修正 P0-2: 再送だがowner/order/asset_codeのいずれかが既存Holdingと一致しない。 */
  | { status: "conflict"; existingHolding: CollectibleHoldingWithAsset };

/** PR#2最終修正 P1-1: asset_code単位のPostgreSQL advisory transaction lock用キー。 */
function assetLockKey(assetCode: string): string {
  return `collectible_asset:${assetCode}`;
}

/**
 * PR#2最終修正 P0-2: 既存Holdingへの再送 (別event_id・同じentitlement_id) を冪等成功として
 * 扱ってよいのは、所有者・送信元・注文・カードのすべてが一致する場合のみ。1つでも違えば
 * 他人のentitlementへ誤って結び付ける/内容を差し替えるリスクがあるため競合として拒否する。
 */
function matchesExisting(existing: CollectibleHoldingWithAsset, params: GrantCollectibleParams): boolean {
  return (
    existing.oveAccountId === params.oveAccountId &&
    existing.sourceSystemKey === params.sourceSystemKey &&
    (existing.orderId ?? null) === (params.orderId ?? null) &&
    (existing.orderItemId ?? null) === (params.orderItemId ?? null) &&
    existing.asset.assetCode === params.assetCode
  );
}

/**
 * NFTコレクション実装指示書9章。`entitlement.granted`受信時のAsset解決・Holding作成を
 * 1つの整合性単位にまとめる。
 *
 * 冪等性 (指示書9.1章「別event_id・同じentitlement_id → 既存Holdingを返す」):
 * `entitlement_id`はUNIQUE制約を持つため、事前確認で見つからなくても後続のINSERTが
 * 一意制約違反になりうる (TOCTOU)。その場合は再検索して既存Holdingを返す
 * (`ExternalAccountProvisioningService`等、既存のP2002キャッチパターンと同じ設計)。
 * ただしPR#2最終修正 P0-2以降、単なるentitlement_id一致だけでなく`matchesExisting`の
 * 全項目一致を要求する。
 *
 * Asset更新方針 (指示書9章): 既存`asset_code`がある場合、name/image_urlを自動上書き
 * しない。incoming値が異なる場合はAuditLogへ記録するのみで、Assetは変更しない
 * (CollectibleAsset=マスター、CollectibleHolding.metadata/各snapshot列=購入時スナップショット)。
 */
@Injectable()
export class GrantCollectibleUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly assets: CollectibleAssetsRepository,
    private readonly holdings: CollectibleHoldingsRepository,
  ) {}

  async execute(params: GrantCollectibleParams): Promise<GrantCollectibleResult> {
    const existing = await this.holdings.findByEntitlementIdWithAsset(params.entitlementId);
    if (existing) return this.handleExisting(this.db, existing, params);

    try {
      return await this.db.$transaction(async (tx) => {
        const existingInTx = await this.holdings.findByEntitlementIdWithAsset(params.entitlementId, tx);
        if (existingInTx) return this.handleExisting(tx, existingInTx, params);

        // PR#2最終修正 P1-1: 同じasset_codeで異なるentitlement_idの同時付与が
        // CollectibleAsset.assetCodeのUNIQUE制約に競合しないよう、Asset解決全体を
        // asset_code単位でシリアライズする (トランザクションcommit/rollbackで自動解放)。
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assetLockKey(params.assetCode)}))`;

        let asset = await this.assets.findByAssetCode(params.assetCode, tx);
        let assetCreated = false;
        if (!asset) {
          asset = await this.assets.create(
            {
              id: generateId(),
              assetCode: params.assetCode,
              productCode: params.productCode,
              name: params.name,
              description: params.description,
              imageUrl: params.imageUrl,
              thumbnailUrl: params.thumbnailUrl,
              imageHash: params.imageHash,
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
            // PR#2最終修正 P1-3: 専用snapshot列を表示用の主データとする。metadataは
            // 専用列導入以前からの非公式スナップショットとして引き続き書き込む
            // (破壊的変更禁止、後方互換のため)。
            displayNameSnapshot: params.name,
            descriptionSnapshot: params.description ?? null,
            imageUrlSnapshot: params.imageUrl,
            thumbnailUrlSnapshot: params.thumbnailUrl ?? null,
            imageHashSnapshot: params.imageHash ?? null,
            raritySnapshot: params.rarity ?? null,
            serialNumber: params.serialNumber ?? null,
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

        return { status: "granted", holding, assetCreated } satisfies GrantCollectibleResult;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const race = await this.holdings.findByEntitlementIdWithAsset(params.entitlementId);
        if (race) return this.handleExisting(this.db, race, params);
      }
      throw error;
    }
  }

  private async handleExisting(
    db: PrismaClient | Prisma.TransactionClient,
    existing: CollectibleHoldingWithAsset,
    params: GrantCollectibleParams,
  ): Promise<GrantCollectibleResult> {
    if (matchesExisting(existing, params)) {
      return { status: "granted", holding: existing, assetCreated: false };
    }

    await db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "EXTERNAL_SERVICE",
        actorId: params.sourceSystemKey,
        actionType: "COLLECTIBLE_GRANT_CONFLICT",
        targetType: "collectible_holding",
        targetId: existing.id,
        result: "FAILURE",
        reason: `entitlement_id "${params.entitlementId}" resend does not match the existing holding's owner/source/order/asset; refusing to treat as idempotent`,
        beforeData: {
          oveAccountId: existing.oveAccountId,
          sourceSystemKey: existing.sourceSystemKey,
          orderId: existing.orderId,
          orderItemId: existing.orderItemId,
          assetCode: existing.asset.assetCode,
        } as unknown as Prisma.InputJsonValue,
        afterData: {
          eventId: params.eventId,
          oveAccountId: params.oveAccountId,
          sourceSystemKey: params.sourceSystemKey,
          orderId: params.orderId ?? null,
          orderItemId: params.orderItemId ?? null,
          assetCode: params.assetCode,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { status: "conflict", existingHolding: existing };
  }
}
