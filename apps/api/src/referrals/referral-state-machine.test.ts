import { assertValidReferralTransition, isValidReferralTransition } from "./referral-state-machine";

describe("referral-state-machine (指示書Phase 3 §9 状態遷移)", () => {
  it("CAPTURED から PENDING / EXPIRED への遷移は許可する", () => {
    expect(isValidReferralTransition("CAPTURED", "PENDING")).toBe(true);
    expect(isValidReferralTransition("CAPTURED", "EXPIRED")).toBe(true);
  });

  it("PENDING から CONFIRMED/REJECTED/CANCELLED/ERROR/EXPIRED/MANUALLY_CONFIRMED への遷移は許可する", () => {
    for (const to of ["CONFIRMED", "REJECTED", "CANCELLED", "ERROR", "EXPIRED", "MANUALLY_CONFIRMED"] as const) {
      expect(isValidReferralTransition("PENDING", to)).toBe(true);
    }
  });

  it("CAPTURED から CONFIRMED へ直接遷移することは許可しない (PENDINGを飛ばせない)", () => {
    expect(isValidReferralTransition("CAPTURED", "CONFIRMED")).toBe(false);
  });

  it("終端状態 (CONFIRMED等) からは一切遷移できない", () => {
    for (const from of ["CONFIRMED", "REJECTED", "MANUALLY_CONFIRMED", "CANCELLED", "ERROR", "EXPIRED"] as const) {
      expect(isValidReferralTransition(from, "PENDING")).toBe(false);
      expect(isValidReferralTransition(from, "CAPTURED")).toBe(false);
    }
  });

  it("assertValidReferralTransitionは不正遷移でBadRequestExceptionを投げる", () => {
    expect(() => assertValidReferralTransition("CONFIRMED", "PENDING")).toThrow(
      /invalid wallet_referral status transition/,
    );
  });

  it("assertValidReferralTransitionは正当な遷移では何も投げない", () => {
    expect(() => assertValidReferralTransition("PENDING", "CONFIRMED")).not.toThrow();
  });
});
