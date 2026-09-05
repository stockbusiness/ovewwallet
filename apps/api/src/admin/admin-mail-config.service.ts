import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { MailConfigService } from "../mail/mail-config.service";
import { MailService, type MailTestResult } from "../mail/mail.service";

/**
 * メール送信設定 (`mail_config`、シングルトン行) を管理画面から編集する。
 *
 * APIキーは`CommonUserHubConfig`と同じAES-256-GCM可逆暗号化で保存し、
 * 生値はレスポンスへ一切含めない (末尾4文字のみのマスク表示)。
 */
@Injectable()
export class AdminMailConfigService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly config: MailConfigService,
    private readonly mail: MailService,
  ) {}

  async get() {
    return this.config.describe();
  }

  /** 指定された項目だけを更新する (APIキーを空欄で保存すると現在の鍵を維持)。 */
  async update(params: { apiKey?: string; mailFrom?: string }, adminId: string, reason: string) {
    const before = await this.config.describe();
    await this.config.save(params, adminId);
    const after = await this.config.describe();

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "MAIL_CONFIG_UPDATED",
        targetType: "mail_config",
        targetId: "default",
        result: "SUCCESS",
        reason,
        // 鍵そのものは残さない。設定されているかと差出人だけを記録する。
        beforeData: {
          apiKeySet: before.apiKeySet,
          mailFrom: before.mailFrom,
        } as Prisma.InputJsonValue,
        afterData: { apiKeySet: after.apiKeySet, mailFrom: after.mailFrom } as Prisma.InputJsonValue,
      },
    });

    return after;
  }

  /**
   * テスト送信。保存済みの設定でそのまま1通送る。
   *
   * 本番の送信経路と鍵をそのまま使う外部への発信なので、誰がいつどこへ送ったかを
   * 監査ログに残す。**宛先は記録する** (誤送信や乱用の追跡に要るため。ワンタイム
   * コードのように秘密ではない)。
   */
  async sendTest(to: string, adminId: string): Promise<MailTestResult> {
    const result = await this.mail.sendTest(to);

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "MAIL_TEST_SENT",
        targetType: "mail_config",
        targetId: "default",
        result: result.outcome === "ok" ? "SUCCESS" : "FAILURE",
        reason: `test mail to ${to}: ${result.outcome}`,
      },
    });

    return result;
  }
}
