import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { EntitlementGrantedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { GrantCollectibleUseCase } from "../../collectibles/grant-collectible.use-case";
import { DIGITAL_COLLECTIBLE_ENTITLEMENT_TYPE, SENGOKU_MARKET_SOURCE_SYSTEM_KEY } from "../../collectibles/constants";
import { assertValidCollectibleImageUrl, InvalidCollectibleImageUrlError } from "../../common/image-url-validator";
import { PRISMA } from "../../common/prisma.module";
import { CommonEventAccountResolver } from "../common-event-account-resolver";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

const EXPECTED_SOURCE_SYSTEM_KEY = SENGOKU_MARKET_SOURCE_SYSTEM_KEY;
const EXPECTED_ENTITLEMENT_TYPE = DIGITAL_COLLECTIBLE_ENTITLEMENT_TYPE;

interface CardMetadata {
  assetCode: string;
  name: string;
  description?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  imageHash?: string;
  rarity?: string;
  serialNumber?: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** PR#2最終修正 P1-2: 外部イベントで受け取る画像URLはHTTPS/SVG拒否/private IP拒否等を通す。 */
function requireValidImageUrl(url: string, field: string): void {
  try {
    assertValidCollectibleImageUrl(url);
  } catch (error) {
    if (error instanceof InvalidCollectibleImageUrlError) {
      throw new BadRequestException(`metadata.${field} is invalid: ${error.message}`);
    }
    throw error;
  }
}

function extractCardMetadata(body: CommonEventBody): CardMetadata {
  const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
  if (metadata["entitlement_type"] !== EXPECTED_ENTITLEMENT_TYPE) {
    throw new BadRequestException(`metadata.entitlement_type must be "${EXPECTED_ENTITLEMENT_TYPE}"`);
  }

  const assetCode = optionalString(metadata["asset_code"]);
  const name = optionalString(metadata["name"]);
  const imageUrl = optionalString(metadata["image_url"]);
  if (!assetCode) throw new BadRequestException("metadata.asset_code is required");
  if (!name) throw new BadRequestException("metadata.name is required");
  if (!imageUrl) throw new BadRequestException("metadata.image_url is required");
  requireValidImageUrl(imageUrl, "image_url");

  const thumbnailUrl = optionalString(metadata["thumbnail_url"]);
  if (thumbnailUrl) requireValidImageUrl(thumbnailUrl, "thumbnail_url");

  return {
    assetCode,
    name,
    description: optionalString(metadata["description"]),
    imageUrl,
    thumbnailUrl,
    imageHash: optionalString(metadata["image_hash"]),
    rarity: optionalString(metadata["rarity"]),
    // PR#2最終修正 P1-4: serial_numberはマーケット側の値をそのまま保存する不変値
    // (数値ではなく"0034"のような桁固定表記もあるため文字列として扱う)。
    serialNumber: optionalString(metadata["serial_number"]),
  };
}

/**
 * entitlement.granted (NFTコレクション実装指示書8〜9章)。戦国マーケットで購入した
 * デジタルカードの利用権付与を受け取り、CollectibleHoldingを作成する。
 *
 * PR#2最終修正 P0-3: `ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX`のガードは
 * `CommonEventsController`側 (Inbound Event作成前)へ移した。ここに到達する時点でFlagは
 * 常にONである。
 * common_user_id競合時は既存の`CommonEventAccountResolver`と同じ設計 (0件/1件/2件以上を
 * 明示的に分岐) で自動処理せず、指示書16章の`COLLECTIBLE_GRANT_CONFLICT`監査ログを残す。
 */
@Injectable()
export class EntitlementGrantedHandler implements CommonEventHandler {
  readonly eventType = "entitlement.granted";
  readonly schema = EntitlementGrantedEventSchema;

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountResolver: CommonEventAccountResolver,
    private readonly grantCollectible: GrantCollectibleUseCase,
  ) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (context.authenticatedSourceSystemKey !== EXPECTED_SOURCE_SYSTEM_KEY) {
      throw new BadRequestException(
        `entitlement.granted must originate from "${EXPECTED_SOURCE_SYSTEM_KEY}" (authenticated source: "${context.authenticatedSourceSystemKey}")`,
      );
    }

    if (!body.common_user_id) throw new BadRequestException("common_user_id is required");
    if (!body.entitlement_id) throw new BadRequestException("entitlement_id is required");

    const quantity = body.quantity ?? 1;
    if (quantity !== 1) {
      throw new BadRequestException("quantity must be exactly 1 (multi-unit entitlement.granted events are not supported)");
    }

    const { assetCode, name, description, imageUrl, thumbnailUrl, imageHash, rarity, serialNumber } = extractCardMetadata(body);

    const resolved = await this.accountResolver.resolveByCommonUserId(
      body.common_user_id,
      "COLLECTIBLE_GRANTED",
      context.authenticatedSourceSystemKey,
    );
    if (resolved.status === "not_found") {
      throw new NotFoundException(`no OVE account linked to common_user_id "${body.common_user_id}"`);
    }
    if (resolved.status === "conflict") {
      await this.db.auditLog.create({
        data: {
          id: generateId(),
          actorType: "EXTERNAL_SERVICE",
          actorId: context.authenticatedSourceSystemKey,
          actionType: "COLLECTIBLE_GRANT_CONFLICT",
          targetType: "collectible_holding",
          targetId: null,
          result: "FAILURE",
          reason: `common_user_id "${body.common_user_id}" is linked to multiple OVE accounts; refusing to grant until reviewed`,
          afterData: {
            eventId: body.event_id,
            entitlementId: body.entitlement_id,
            commonUserId: body.common_user_id,
            orderId: body.order_id ?? null,
            productCode: body.product_code ?? null,
            sourceSystemKey: context.authenticatedSourceSystemKey,
            accountIds: resolved.accountIds,
          },
        },
      });
      return { action: "common_user_id_conflict_requires_review", account_ids: resolved.accountIds };
    }

    const result = await this.grantCollectible.execute({
      oveAccountId: resolved.account.id,
      entitlementId: body.entitlement_id,
      assetCode,
      name,
      description,
      imageUrl,
      thumbnailUrl,
      imageHash,
      rarity,
      serialNumber,
      productCode: body.product_code,
      sourceSystemKey: context.authenticatedSourceSystemKey,
      orderId: body.order_id,
      orderItemId: body.order_item_id,
      acquiredAt: new Date(body.occurred_at),
      eventId: body.event_id,
    });

    // PR#2最終修正 P0-2: 冪等成功と判断できない再送 (別所有者・別order等)。AuditLogは
    // UseCase内のtransactionで既にcommit済みなので、ここで例外を投げてもロールバックされない。
    if (result.status === "conflict") {
      throw new ConflictException(
        `entitlement_id "${body.entitlement_id}" was already granted with different details`,
      );
    }

    return {
      action: "granted",
      holding_id: result.holding.id,
      ove_account_id: result.holding.oveAccountId,
      asset_created: result.assetCreated,
    };
  }
}
