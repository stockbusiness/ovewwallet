import { BadRequestException, Injectable } from "@nestjs/common";
import { EntitlementRevokedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { RevokeCollectibleUseCase } from "../../collectibles/revoke-collectible.use-case";
import { isFeatureEnabled } from "../../common/feature-flags";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * entitlement.revoked (NFTコレクション実装指示書8・10章)。全額返金等でカードの利用権が
 * 取り消された際にHoldingをACTIVE→REVOKEDへ遷移させる。Holding物理削除・
 * 他Holdingの一括取消・entitlement_id変更は行わない (禁止事項)。
 */
@Injectable()
export class EntitlementRevokedHandler implements CommonEventHandler {
  readonly eventType = "entitlement.revoked";
  readonly schema = EntitlementRevokedEventSchema;

  constructor(private readonly revokeCollectible: RevokeCollectibleUseCase) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!isFeatureEnabled("ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX")) {
      return { action: "skipped", reason: "ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX is disabled" };
    }
    if (!body.entitlement_id) throw new BadRequestException("entitlement_id is required");

    const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
    const reason = typeof metadata["reason"] === "string" ? (metadata["reason"] as string) : "entitlement.revoked";

    const result = await this.revokeCollectible.execute({
      entitlementId: body.entitlement_id,
      reason,
      sourceSystemKey: context.authenticatedSourceSystemKey,
      eventId: body.event_id,
    });

    if (result.status === "not_found") {
      return { action: "not_found", entitlement_id: body.entitlement_id };
    }
    return {
      action: result.status === "already_revoked" ? "already_revoked" : "revoked",
      holding_id: result.holding.id,
    };
  }
}
