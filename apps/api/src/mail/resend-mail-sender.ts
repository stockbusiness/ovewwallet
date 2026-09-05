import { Logger } from "@nestjs/common";
import type { MailMessage, MailSender } from "./mail-sender";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

export interface ResendOptions {
  apiKey: string;
  /** 差出人。SPF/DKIMを設定したドメインのアドレスであること (例: `no-reply@sennokuni-wallet.com`)。 */
  from: string;
}

export class MailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailSendError";
  }
}

/**
 * Resend (https://resend.com) 経由でメールを送る。
 *
 * ## 失敗したら例外を投げる
 *
 * 他の外部連携 (`AgencyReferralAdapter`等) は「失敗しても本処理は続ける」
 * ベストエフォートだが、ここは逆。**送信に失敗したのに「送信しました」と
 * 画面に出すと、利用者はコードを待ち続けて詰む**。呼び出し側が失敗を利用者へ
 * 伝えられるよう、握り潰さずに投げる。
 *
 * ## ログに残さないもの
 *
 * 本文 (=ワンタイムコード) とAPIキーは絶対に出さない
 * (AGENTS.md「OTP・APIシークレットをログに残さない」)。失敗時もHTTPステータスと
 * Resend側のエラー種別までに留める。
 */
export class ResendMailSender implements MailSender {
  private readonly logger = new Logger(ResendMailSender.name);

  constructor(private readonly options: ResendOptions) {}

  async send(message: MailMessage): Promise<void> {
    let res: Response;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // 宛先アドレスも出さない (誰がいつログインしようとしたかの記録になるため)。
      this.logger.error(`mail send request failed: ${err instanceof Error ? err.name : "unknown error"}`);
      throw new MailSendError("failed to reach the mail delivery service");
    }

    if (!res.ok) {
      const detail = await this.readErrorName(res);
      this.logger.error(`mail send rejected: status=${res.status}${detail ? ` name=${detail}` : ""}`);
      throw new MailSendError(`mail delivery service returned status ${res.status}`);
    }
  }

  /** Resendのエラー応答は`{ name, message }`。`message`は宛先を含みうるので`name`だけ読む。 */
  private async readErrorName(res: Response): Promise<string | null> {
    try {
      const body = (await res.json()) as { name?: unknown };
      return typeof body.name === "string" ? body.name : null;
    } catch {
      return null;
    }
  }
}
