import { Global, Logger, Module } from "@nestjs/common";
import { NoopMailSender, type MailSender } from "./mail-sender";
import { ResendMailSender } from "./resend-mail-sender";

export const MAIL_SENDER = "MAIL_SENDER";

export const DEFAULT_MAIL_FROM = "no-reply@sennokuni-wallet.com";

/**
 * 設定から送信実装を選ぶ。`RESEND_API_KEY`があればResend、無ければ何もしない実装。
 *
 * 本番で鍵が無いまま`ENABLE_EMAIL_LOGIN=true`にしてしまう事故は
 * `assertProductionEnvSafe()`が起動時に止めるので、ここでは黙って
 * `NoopMailSender`に落として構わない (開発・テストがこの分岐を通る)。
 */
export function createMailSender(env: NodeJS.ProcessEnv = process.env): MailSender {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    new Logger("MailModule").log("RESEND_API_KEY is not set; outgoing mail is disabled");
    return new NoopMailSender();
  }
  return new ResendMailSender({ apiKey, from: env.MAIL_FROM || DEFAULT_MAIL_FROM });
}

@Global()
@Module({
  providers: [{ provide: MAIL_SENDER, useFactory: () => createMailSender() }],
  exports: [MAIL_SENDER],
})
export class MailModule {}
