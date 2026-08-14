import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { EntitlementRevokedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { RevokeCollectibleUseCase } from "../../collectibles/revoke-collectible.use-case";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";
import { assertTargetSiteKeyMatchesWallet, normalizeEntitlementEnvelope } from "../nft-market-event-normalizer";

/**
 * entitlement.revoked (NFTコレクション実装指示書8・10章)。全額返金等でカードの利用権が
 * 取り消された際にHoldingをACTIVE→REVOKEDへ遷移させる。Holding物理削除・
 * 他Holdingの一括取消・entitlement_id変更は行わない (禁止事項)。
 *
 * PR#2最終修正 P0-3: Feature Flag OFF時のガードは`CommonEventsController`側
 * (Inbound Event作成前)へ移した。ここに到達する時点でFlagは常にONである。
 */
@Injectable()
export class EntitlementRevokedHandler implements CommonEventHandler {
  readonly eventType = "entitlement.revoked";
  readonly schema = EntitlementRevokedEventSchema;

  constructor(private readonly revokeCollectible: RevokeCollectibleUseCase) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    // 契約v2指示書19章。target_site_keyが付与されていれば、このWallet宛てかを検証する。
    assertTargetSiteKeyMatchesWallet(body);

    // 契約v2指示書16〜17章。新data{} Envelopeと旧フラット契約を突き合わせて正規化する。
    const envelope = normalizeEntitlementEnvelope(body);
    if (!envelope.entitlement_id) throw new BadRequestException("entitlement_id is required");
    const entitlementId = envelope.entitlement_id;

    const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
    const reason = typeof metadata["reason"] === "string" ? (metadata["reason"] as string) : "entitlement.revoked";

    const result = await this.revokeCollectible.execute({
      entitlementId,
      reason,
      sourceSystemKey: context.authenticatedSourceSystemKey,
      eventId: body.event_id,
    });

    if (result.status === "not_found") {
      return { action: "not_found", entitlement_id: entitlementId };
    }
    // PR#2最終修正 P0-1: AuditLogはUseCase内のtransactionで既にcommit済みなので、
    // ここで例外を投げてもAuditLogはロールバックされない。
    if (result.status === "source_conflict") {
      throw new ForbiddenException(`entitlement.revoked source mismatch for entitlement_id "${entitlementId}"`);
    }
    // PR#2最終修正 P1-5: Mintライフサイクル中のHoldingは自動取消を拒否する。
    if (result.status === "manual_review_required") {
      return { action: "manual_review_required", holding_id: result.holding.id };
    }
    return {
      action: result.status === "already_revoked" ? "already_revoked" : "revoked",
      holding_id: result.holding.id,
    };
  }
}
