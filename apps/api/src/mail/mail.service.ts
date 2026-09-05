import { Injectable, Logger } from "@nestjs/common";
import { MailConfigService } from "./mail-config.service";
import type { MailMessage } from "./mail-sender";
import { MailSendError, ResendMailSender } from "./resend-mail-sender";

export class MailNotConfiguredError extends Error {
  constructor() {
    super("mail delivery is not configured");
    this.name = "MailNotConfiguredError";
  }
}

/**
 * メール送信の入口。設定 (管理画面またはRESEND_API_KEY) を毎回読み直してから送る。
 *
 * ## 未設定のときの扱いが環境で変わる
 *
 * - **本番**: 例外を投げる。呼び出し側が利用者へ失敗を伝えられるようにするため。
 *   黙って成功にすると、届かないコードを待たせることになる。
 * - **本番以外**: 何もせず成功にする。ワンタイムコードは応答の`devCode`で
 *   確認できるので、開発・テストに送信基盤を要求しない
 *   (REDIS_URL未設定でインメモリへ落ちるのと同じ考え方)。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: MailConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const config = await this.config.resolve();
    if (!config) {
      if (process.env.NODE_ENV === "production") {
        this.logger.error("mail delivery is not configured; set the API key from the admin screen");
        throw new MailNotConfiguredError();
      }
      return;
    }
    await new ResendMailSender(config).send(message);
  }

  /** 送信できる状態か。ログイン画面にメールの選択肢を出すかの判定に使う。 */
  async isConfigured(): Promise<boolean> {
    return this.config.isConfigured();
  }

  /**
   * 管理画面の「テスト送信」。保存済みの設定でそのまま1通送る。
   *
   * 結果を分類して返すのは、失敗したときに**何を直せばよいか**が画面から
   * 分かるようにするため (`AdminAgencyConnectionTestService`と同じ方針)。
   */
  async sendTest(to: string): Promise<MailTestResult> {
    const config = await this.config.resolve();
    if (!config) {
      return {
        outcome: "not_configured",
        message: "APIキーが未設定です。Resendで発行したキーを先に保存してください。",
        mailFrom: null,
      };
    }

    try {
      await new ResendMailSender(config).send(buildTestMail(to));
      return {
        outcome: "ok",
        message: `${to} 宛に送信しました。数分待っても届かない場合は、迷惑メールフォルダと、差出人ドメインのSPF/DKIM設定を確認してください。`,
        mailFrom: config.from,
      };
    } catch (err) {
      if (err instanceof MailSendError) {
        return {
          outcome: "failed",
          // 例外メッセージには鍵も宛先も含まれない (ResendMailSender参照)。
          message: `送信できませんでした: ${err.message}。APIキーと差出人アドレス (${config.from}) がResendで検証済みのドメインか確認してください。`,
          mailFrom: config.from,
        };
      }
      throw err;
    }
  }
}

export interface MailTestResult {
  outcome: "ok" | "failed" | "not_configured";
  /** 管理画面にそのまま出す説明。原因と次にやることを含める。 */
  message: string;
  mailFrom: string | null;
}

/** テスト送信の本文。ワンタイムコードは**含めない** (テストに実コードを流さない)。 */
export function buildTestMail(to: string): MailMessage {
  return {
    to,
    subject: "【千ノ国ウォレット】メール送信テスト",
    text: [
      "このメールは、管理画面からの送信テストです。",
      "",
      "このメールが届いていれば、ワンタイムコードも同じ経路で届きます。",
      "お心当たりが無い場合は破棄してください。",
    ].join("\n"),
  };
}
