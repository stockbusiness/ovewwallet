import { BadRequestException } from "@nestjs/common";
import { type WalletReferralStatus } from "@ove/database";

/**
 * リファクタリング指示書 Phase 3 (§9 状態遷移): `wallet_referrals.status`の
 * 許可された遷移のみを定義する。CAPTURED→EXPIRED (登録前にセッションが失効する
 * 既存フロー、`ReferralCaptureUseCase.resolvePendingSession`) を除き、
 * 指示書の状態遷移図の通りPENDINGを経由しない遷移は許可しない。
 */
const ALLOWED_TRANSITIONS: Record<WalletReferralStatus, ReadonlySet<WalletReferralStatus>> = {
  CAPTURED: new Set<WalletReferralStatus>(["PENDING", "EXPIRED"]),
  PENDING: new Set<WalletReferralStatus>(["CONFIRMED", "REJECTED", "CANCELLED", "ERROR", "EXPIRED", "MANUALLY_CONFIRMED"]),
  CONFIRMED: new Set<WalletReferralStatus>(),
  REJECTED: new Set<WalletReferralStatus>(),
  MANUALLY_CONFIRMED: new Set<WalletReferralStatus>(),
  CANCELLED: new Set<WalletReferralStatus>(),
  ERROR: new Set<WalletReferralStatus>(),
  EXPIRED: new Set<WalletReferralStatus>(),
};

export function isValidReferralTransition(from: WalletReferralStatus, to: WalletReferralStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

/** 不正な状態遷移をここで確実に止める (指示書「不正遷移を禁止する」)。 */
export function assertValidReferralTransition(from: WalletReferralStatus, to: WalletReferralStatus): void {
  if (!isValidReferralTransition(from, to)) {
    throw new BadRequestException(`invalid wallet_referral status transition: ${from} -> ${to}`);
  }
}
