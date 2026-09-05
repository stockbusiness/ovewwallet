import type { ProfileFieldKey } from "./api";

/** 画面に出す項目名。エラー文言と入力欄で同じ言葉を使うためにここへ集約する。 */
export const PROFILE_FIELD_LABELS: Record<ProfileFieldKey, string> = {
  fullName: "お名前",
  fullNameKana: "お名前 (カナ)",
  phone: "電話番号",
  postalCode: "郵便番号",
  address: "住所",
};

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/**
 * 未入力の必須項目から帯の文面を作る。
 *
 * **未入力でもウォレットは使える**ので、「できません」ではなく「お願いします」の
 * 言い方にする (docs/account-profile.md)。
 */
export function promptMessage(missingRequired: ProfileFieldKey[]): string {
  if (missingRequired.length === 0) {
    return "お届け先の登録にご協力ください";
  }
  const names = missingRequired.map((key) => PROFILE_FIELD_LABELS[key]).join("・");
  return `${names}のご登録にご協力ください`;
}
