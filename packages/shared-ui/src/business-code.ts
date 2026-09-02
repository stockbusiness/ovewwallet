/**
 * 事業コード (`OVE-ACC-...` / `OVE-WLT-...` / `OVE-TXN-...` / `OVE-ADM-...`) の
 * 表示用変換。
 *
 * これらのコードはDBに保存された識別子で、監査ログ・外部連携・エクスポート・
 * 過去の問い合わせ記録から参照されている。値そのものを書き換えると、それらの
 * 追跡可能性を壊してしまうため**保存値は `OVE-` のまま**にし、
 * 画面に出すときだけ `ORI-` へ読み替える。
 *
 * 利用者と運用担当者が同じ文字列を見るように、user-wallet と admin-wallet の
 * **両方**で通すこと。片方だけ変えると、利用者が読み上げたコードで管理画面を
 * 検索しても見つからなくなる。
 */
const STORED_PREFIX = "OVE-";
const DISPLAY_PREFIX = "ORI-";

/** 保存値 → 画面表示。先頭の `OVE-` だけを置き換える (コード中の他の位置は触らない)。 */
export function toDisplayCode<T extends string | null | undefined>(code: T): T {
  if (typeof code !== "string") return code;
  if (!code.startsWith(STORED_PREFIX)) return code;
  return (DISPLAY_PREFIX + code.slice(STORED_PREFIX.length)) as T;
}

/**
 * 画面表示 → 保存値。運用担当者が利用者から聞いた `ORI-` のコードをそのまま
 * 検索欄へ貼れるようにする。`OVE-` を入力された場合はそのまま通す
 * (過去の記録や外部システムから転記されるのはこちらの形のため)。
 */
export function toStoredCode(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.toUpperCase().startsWith(DISPLAY_PREFIX)) return trimmed;
  return STORED_PREFIX + trimmed.slice(DISPLAY_PREFIX.length);
}
