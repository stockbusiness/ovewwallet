import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { CommonEventBody } from "@ove/shared-types";
import {
  assertTargetSiteKeyMatchesWallet,
  normalizeEntitlementEnvelope,
  normalizeEntitlementType,
} from "./nft-market-event-normalizer";

/** テスト用の最小限のCommonEventBody。未指定フィールドはoptionalなので省略する。 */
function baseBody(overrides: Partial<CommonEventBody> = {}): CommonEventBody {
  return {
    event_id: "evt_1",
    event_type: "entitlement.granted",
    event_version: "1.0",
    occurred_at: "2026-08-14T00:00:00Z",
    source_system_key: "sennokuni-nft-market",
    ...overrides,
  };
}

describe("nft-market-event-normalizer (千ノ国NFTマーケット契約v2指示書16〜19章)", () => {
  describe("normalizeEntitlementEnvelope", () => {
    it("prefers data.field over the legacy top-level field when only data is present", () => {
      const body = baseBody({ data: { entitlement_id: "ent_from_data" } });
      expect(normalizeEntitlementEnvelope(body).entitlement_id).toBe("ent_from_data");
    });

    it("falls back to the legacy top-level field when data is absent (旧フラット契約)", () => {
      const body = baseBody({ entitlement_id: "ent_legacy" });
      expect(normalizeEntitlementEnvelope(body).entitlement_id).toBe("ent_legacy");
    });

    it("allows the same value present in both data and the legacy top-level field", () => {
      const body = baseBody({ entitlement_id: "ent_same", data: { entitlement_id: "ent_same" } });
      expect(normalizeEntitlementEnvelope(body).entitlement_id).toBe("ent_same");
    });

    it("rejects with CONTRACT_CONFLICT when data and the legacy top-level field disagree", () => {
      const body = baseBody({ entitlement_id: "ent_legacy", data: { entitlement_id: "ent_from_data" } });
      expect(() => normalizeEntitlementEnvelope(body)).toThrow(BadRequestException);
      expect(() => normalizeEntitlementEnvelope(body)).toThrow(/CONTRACT_CONFLICT/);
    });

    it("normalizes all 5 documented fields (entitlement_id/order_id/order_item_id/product_code/common_user_id)", () => {
      const body = baseBody({
        data: {
          entitlement_id: "ent_1",
          order_id: "ord_1",
          order_item_id: "item_1",
          product_code: "prod_1",
          common_user_id: "cu_1",
        },
      });
      const envelope = normalizeEntitlementEnvelope(body);
      expect(envelope).toEqual({
        entitlement_id: "ent_1",
        order_id: "ord_1",
        order_item_id: "item_1",
        product_code: "prod_1",
        common_user_id: "cu_1",
      });
    });

    it("falls back to the legacy top-level common_user_id when the official contract does not nest it under data (指示書17章の注記)", () => {
      const body = baseBody({ common_user_id: "cu_top_level", data: { entitlement_id: "ent_1" } });
      expect(normalizeEntitlementEnvelope(body).common_user_id).toBe("cu_top_level");
    });
  });

  describe("normalizeEntitlementType", () => {
    it("normalizes the new Market uppercase value to the internal lowercase value", () => {
      expect(normalizeEntitlementType("DIGITAL_COLLECTIBLE")).toBe("digital_collectible");
    });

    it("accepts the legacy lowercase value as-is", () => {
      expect(normalizeEntitlementType("digital_collectible")).toBe("digital_collectible");
    });

    it("rejects an unknown entitlement_type instead of silently lowercasing it", () => {
      expect(normalizeEntitlementType("passport_membership")).toBeNull();
      expect(normalizeEntitlementType("Digital_Collectible")).toBeNull();
    });

    it("rejects a non-string value", () => {
      expect(normalizeEntitlementType(undefined)).toBeNull();
      expect(normalizeEntitlementType(123)).toBeNull();
    });
  });

  describe("assertTargetSiteKeyMatchesWallet", () => {
    it("passes when target_site_key is absent (legacy event without this field)", () => {
      expect(() => assertTargetSiteKeyMatchesWallet(baseBody())).not.toThrow();
    });

    it("passes when target_site_key matches this wallet", () => {
      expect(() => assertTargetSiteKeyMatchesWallet(baseBody({ target_site_key: "ovew-wallet" }))).not.toThrow();
    });

    it("rejects when target_site_key is for a different service (誤配送防止)", () => {
      expect(() => assertTargetSiteKeyMatchesWallet(baseBody({ target_site_key: "sengoku-passport" }))).toThrow(
        ForbiddenException,
      );
    });
  });
});
