/**
 * 付与ルールの案内先URL (`RewardRule.landingUrl`) の検証。
 *
 * この値は管理画面から入力され、そのまま利用者の画面のリンクになる。`javascript:` や
 * `data:` を入れられると、リンクを踏んだ利用者のブラウザで任意のスクリプトが動きうる
 * (管理者アカウントが乗っ取られた場合の被害を、利用者側まで広げないための多層防御)。
 * そのため**httpsのみ**を許可する。
 *
 * httpを許さないのは、LINEの友だち追加URLをはじめ現実の案内先がすべてhttpsであり、
 * 平文を許す理由が無いため。
 */
const ALLOWED_PROTOCOL = "https:";

export class InvalidLandingUrlError extends Error {
  constructor(reason: string) {
    super(`invalid landing url: ${reason}`);
    this.name = "InvalidLandingUrlError";
  }
}

/**
 * 入力を正規化して返す。空文字は「未設定」(null) として扱う
 * (管理画面のフォームで値を消したときに、URLを外せるようにするため)。
 *
 * @throws InvalidLandingUrlError https以外・URLとして解釈できない場合
 */
export function normalizeLandingUrl(input: string | null | undefined): string | null {
  if (input === undefined || input === null) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new InvalidLandingUrlError("not a valid absolute URL");
  }
  if (parsed.protocol !== ALLOWED_PROTOCOL) {
    throw new InvalidLandingUrlError(`protocol must be ${ALLOWED_PROTOCOL}`);
  }
  return parsed.toString();
}
