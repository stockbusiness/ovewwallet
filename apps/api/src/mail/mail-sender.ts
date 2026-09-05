/**
 * メール送信の契約だけを定義する (`LineAuthVerifier`と同じ考え方)。
 *
 * 実装を差し替えられるようにしているのは、開発・テストで実際にメールを送らない
 * ようにするためと、配信サービスを乗り換えても呼び出し側を変えずに済ませるため。
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** 本文 (プレーンテキスト)。HTMLメールは使わない (下記の理由)。 */
  text: string;
}

export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/**
 * 何も送らない実装。開発・テスト用。
 *
 * ワンタイムコードは`NODE_ENV`が本番以外のときレスポンスの`devCode`で確認できるので、
 * ここでログに出す必要はない。**むしろ出してはいけない**
 * (AGENTS.md「OTPを含む秘密情報をログに残さない」)。
 */
export class NoopMailSender implements MailSender {
  async send(): Promise<void> {
    // 意図的に何もしない
  }
}
