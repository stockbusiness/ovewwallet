import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient, type ProfileFieldRequirement } from "@ove/database";
import {
  PROFILE_FIELD_KEYS,
  toEffectiveConfig,
  type EffectiveProfileConfig,
  type ProfileFieldKey,
} from "../accounts/profile-fields";
import { PRISMA } from "../common/prisma.module";

const CONFIG_ID = "default";

export interface ProfileConfigView extends EffectiveProfileConfig {
  updatedAt: string | null;
  updatedBy: string | null;
}

export type ProfileConfigUpdate = Partial<Record<ProfileFieldKey, ProfileFieldRequirement>> & {
  promptEnabled?: boolean;
};

/**
 * プロフィール項目をどこまで求めるかの設定 (`account_profile_config`、
 * シングルトン行) を管理画面から編集する。
 *
 * REQUIRED にしてもウォレットの利用は止まらない。入力しない人をセグメントとして
 * 残すのがこの機能の目的なので、入口で締め出すと目的そのものが達せられないため
 * (docs/account-profile.md)。
 */
@Injectable()
export class AdminProfileConfigService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async get(): Promise<ProfileConfigView> {
    const config = await this.db.accountProfileConfig.findUnique({ where: { id: CONFIG_ID } });
    return {
      ...toEffectiveConfig(config),
      updatedAt: config?.updatedAt.toISOString() ?? null,
      updatedBy: config?.updatedBy ?? null,
    };
  }

  /** 指定された項目だけを更新する (省略した項目は現状維持)。 */
  async update(params: ProfileConfigUpdate, adminId: string, reason: string): Promise<ProfileConfigView> {
    const before = await this.get();

    const fields: Record<ProfileFieldKey, ProfileFieldRequirement> = { ...before.fields };
    for (const key of PROFILE_FIELD_KEYS) {
      const value = params[key];
      if (value !== undefined) fields[key] = value;
    }
    const promptEnabled = params.promptEnabled ?? before.promptEnabled;

    const data = { ...fields, promptEnabled, updatedBy: adminId };
    await this.db.accountProfileConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, ...data },
      update: data,
    });

    const after = await this.get();

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "ACCOUNT_PROFILE_CONFIG_UPDATED",
        targetType: "account_profile_config",
        targetId: CONFIG_ID,
        result: "SUCCESS",
        reason,
        beforeData: { fields: before.fields, promptEnabled: before.promptEnabled } as Prisma.InputJsonValue,
        afterData: { fields: after.fields, promptEnabled: after.promptEnabled } as Prisma.InputJsonValue,
      },
    });

    return after;
  }
}
