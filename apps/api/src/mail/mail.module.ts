import { Global, Module } from "@nestjs/common";
import { MailConfigService } from "./mail-config.service";
import { MailService } from "./mail.service";

/**
 * メール送信。設定は管理画面 (`mail_config`) または環境変数から、送信のたびに
 * 読み直す (`MailConfigService`)。起動時に固めないのは、管理画面で鍵を変えた
 * 直後から新しい鍵で送れるようにするため。
 */
@Global()
@Module({
  providers: [MailConfigService, MailService],
  exports: [MailConfigService, MailService],
})
export class MailModule {}
