import { Injectable } from "@nestjs/common";

/**
 * LINE Messaging API の broadcast (このMessaging APIチャネルを友だち追加した
 * 全ユーザーへの一斉配信) を使い、お知らせ公開時にLINEへも配信する。
 * `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` 未設定時は何もしない (Sentryの
 * SENTRY_DSN未設定時no-opと同じ方針、docs/monitoring.md参照)。
 *
 * 配信対象はLINE公式アカウントを友だち追加した全ユーザーであり、OVEウォレットの
 * 利用者・LINEログイン済みユーザーとは必ずしも一致しない (LINE Messaging APIの
 * 仕組み上の制約。個別ユーザー宛のpush/multicastには別途LINEユーザーIDが必要だが、
 * お知らせは全体告知が主目的のためbroadcastを採用した)。
 *
 * テストでは `globalThis.fetch` を直接モックする (コンストラクタ引数での差し替えは
 * NestJSのDIが型情報の無いインターフェース引数を解決できず起動時エラーになるため避けた)。
 */
@Injectable()
export class LineBroadcastService {
  async broadcastText(text: string): Promise<void> {
    const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
    if (!token) return;

    const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages: [{ type: "text", text: text.slice(0, 5000) }] }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LINE broadcast failed: status=${res.status} body=${body}`);
    }
  }
}
