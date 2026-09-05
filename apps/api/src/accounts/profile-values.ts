/**
 * プロフィール入力値の正規化 (DBにもNestにも依存しない純粋関数)。
 *
 * 電話番号と郵便番号は**数字だけに揃えてから**保存する。表記ゆれ
 * (`090-1234-5678` / `０９０１２３４５６７８`) のまま貯めると、後のアップセルで
 * 名寄せや配信リストに使うときに突き合わせられなくなるため。
 */

/** 全角英数字・全角ハイフン・全角スペースを半角へ。 */
export function toHalfWidth(value: string): string {
  return value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐‑‒–—―−ーｰ－]/g, "-")
    .replace(/\u3000/g, " ");
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** 日本の電話番号。ハイフン・空白を落として `0` 始まりの10桁か11桁だけ通す。 */
export function normalizePhone(value: string): string | null {
  const digits = toHalfWidth(value).replace(/[-\s()]/g, "");
  if (!/^0\d{9,10}$/.test(digits)) return null;
  return digits;
}

/** 郵便番号。ハイフンを落として7桁だけ通す。 */
export function normalizePostalCode(value: string): string | null {
  const digits = toHalfWidth(value).replace(/[-\s]/g, "");
  if (!/^\d{7}$/.test(digits)) return null;
  return digits;
}

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export type Prefecture = (typeof PREFECTURES)[number];

export function isPrefecture(value: string): value is Prefecture {
  return (PREFECTURES as readonly string[]).includes(value);
}

/** カナ氏名。全角カタカナ・長音・スペースのみ (ひらがなや漢字が混ざった入力を弾く)。 */
export function isKana(value: string): boolean {
  return /^[゠-ヿ\s]+$/.test(value);
}
