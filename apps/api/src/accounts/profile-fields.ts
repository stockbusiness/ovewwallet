import type { AccountProfile, AccountProfileConfig, ProfileFieldRequirement } from "@ove/database";

/**
 * プロフィール項目の扱いを決める純粋ロジック (DBに触らない)。
 *
 * ORI付与を入口にしたリスト取りが目的なので、**入力しないこと自体が情報**になる。
 * そのため REQUIRED でもウォレットの利用は止めず、帯で促すだけにしている
 * (docs/account-profile.md)。
 */

/** 管理画面で切り替えられる単位。住所は県・市区町村・番地をまとめて1つとして扱う。 */
export const PROFILE_FIELD_KEYS = ["fullName", "fullNameKana", "phone", "postalCode", "address"] as const;
export type ProfileFieldKey = (typeof PROFILE_FIELD_KEYS)[number];

/** 設定行が無いとき (初期状態) の既定値。schema.prismaの`@default`と一致させる。 */
export const DEFAULT_PROFILE_FIELD_CONFIG: Record<ProfileFieldKey, ProfileFieldRequirement> = {
  fullName: "OPTIONAL",
  fullNameKana: "HIDDEN",
  phone: "OPTIONAL",
  postalCode: "OPTIONAL",
  address: "OPTIONAL",
};

export const DEFAULT_PROMPT_ENABLED = true;

export interface EffectiveProfileConfig {
  fields: Record<ProfileFieldKey, ProfileFieldRequirement>;
  promptEnabled: boolean;
}

export function toEffectiveConfig(config: AccountProfileConfig | null): EffectiveProfileConfig {
  if (!config) {
    return { fields: { ...DEFAULT_PROFILE_FIELD_CONFIG }, promptEnabled: DEFAULT_PROMPT_ENABLED };
  }
  return {
    fields: {
      fullName: config.fullName,
      fullNameKana: config.fullNameKana,
      phone: config.phone,
      postalCode: config.postalCode,
      address: config.address,
    },
    promptEnabled: config.promptEnabled,
  };
}

/** 住所は県・市区町村・番地が揃って初めて「入力済み」とみなす (建物名は常に任意)。 */
function isFilled(profile: Pick<AccountProfile, ProfileValueKey> | null, key: ProfileFieldKey): boolean {
  if (!profile) return false;
  if (key === "address") {
    return !!profile.prefecture && !!profile.city && !!profile.addressLine;
  }
  return !!profile[key];
}

type ProfileValueKey =
  | "fullName"
  | "fullNameKana"
  | "phone"
  | "postalCode"
  | "prefecture"
  | "city"
  | "addressLine"
  | "building";

export interface ProfilePromptState {
  /** 入力を促す帯を出すか。 */
  show: boolean;
  /** 未入力のREQUIRED項目。帯の文面に使う。 */
  missingRequired: ProfileFieldKey[];
}

/**
 * 入力を促すかどうか。
 *
 * - 「入力しない」を明示的に選んだ人には出さない (断った相手に出し続けない。
 *   断ったこと自体は`declinedAt`に残るのでセグメントには使える)。
 * - 未入力のREQUIRED項目があれば出す。
 * - REQUIREDが1つも無くても、**一度も入力画面に来ていない**なら出す。
 *   全項目OPTIONALの運用でも最初の1回は促したいため。
 */
export function decideProfilePrompt(params: {
  config: EffectiveProfileConfig;
  profile: (Pick<AccountProfile, ProfileValueKey> & { declinedAt: Date | null }) | null;
}): ProfilePromptState {
  const { config, profile } = params;
  const visible = PROFILE_FIELD_KEYS.filter((key) => config.fields[key] !== "HIDDEN");
  const missingRequired = visible.filter(
    (key) => config.fields[key] === "REQUIRED" && !isFilled(profile, key),
  );

  if (!config.promptEnabled) return { show: false, missingRequired };
  if (profile?.declinedAt) return { show: false, missingRequired };
  if (visible.length === 0) return { show: false, missingRequired };
  if (missingRequired.length > 0) return { show: true, missingRequired };

  const neverAnswered = !profile;
  return { show: neverAnswered, missingRequired };
}

/**
 * お客様情報の登録が「完了」したか (docs/milestone-rewards.md)。
 *
 * **管理画面で必須 (REQUIRED) にした項目がすべて埋まっていること**を条件にする
 * (2026-09-05 運用判断)。任意項目は条件に含めない。
 *
 * 必須項目が1つも無い設定では**完了にしない**。埋めるべきものが無い状態を
 * 「完了」と扱うと、何も入力していない人に特典が出てしまうため。
 */
export function isProfileComplete(params: {
  config: EffectiveProfileConfig;
  profile: (Pick<AccountProfile, ProfileValueKey> & { declinedAt: Date | null }) | null;
}): boolean {
  const { config, profile } = params;
  const required = PROFILE_FIELD_KEYS.filter((key) => config.fields[key] === "REQUIRED");
  if (required.length === 0) return false;
  return required.every((key) => isFilled(profile, key));
}

/** HIDDENの項目は保存しない。設定を閉じた後に古い入力欄から送られても書き込ませないため。 */
export function isFieldEditable(config: EffectiveProfileConfig, key: ProfileFieldKey): boolean {
  return config.fields[key] !== "HIDDEN";
}
