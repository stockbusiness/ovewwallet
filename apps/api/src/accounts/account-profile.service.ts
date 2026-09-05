import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { AccountProfile, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import {
  decideProfilePrompt,
  isFieldEditable,
  toEffectiveConfig,
  type EffectiveProfileConfig,
  type ProfilePromptState,
} from "./profile-fields";
import { isKana, isPrefecture, normalizePhone, normalizePostalCode, normalizeText } from "./profile-values";

const CONFIG_ID = "default";

export interface ProfileInput {
  fullName?: string | null;
  fullNameKana?: string | null;
  phone?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  addressLine?: string | null;
  building?: string | null;
}

export interface ProfileView {
  profile: {
    fullName: string | null;
    fullNameKana: string | null;
    phone: string | null;
    postalCode: string | null;
    prefecture: string | null;
    city: string | null;
    addressLine: string | null;
    building: string | null;
    declinedAt: string | null;
    updatedAt: string | null;
  };
  config: EffectiveProfileConfig;
  prompt: ProfilePromptState;
}

const EMPTY_PROFILE: ProfileView["profile"] = {
  fullName: null,
  fullNameKana: null,
  phone: null,
  postalCode: null,
  prefecture: null,
  city: null,
  addressLine: null,
  building: null,
  declinedAt: null,
  updatedAt: null,
};

/** 空文字は「消したい」の意味として null に倒す (未指定の undefined とは区別する)。 */
function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 利用者プロフィール (氏名・電話・住所) の参照と更新。
 *
 * ORI付与を入口にしたリスト取りが目的で、後のアップセルに使う
 * (docs/account-profile.md)。REQUIRED でもウォレットの利用は止めない。
 * 入力しない人はそれ自体がセグメントになるため。
 */
@Injectable()
export class AccountProfileService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private async effectiveConfig(): Promise<EffectiveProfileConfig> {
    const config = await this.db.accountProfileConfig.findUnique({ where: { id: CONFIG_ID } });
    return toEffectiveConfig(config);
  }

  private toView(profile: AccountProfile | null, config: EffectiveProfileConfig): ProfileView {
    return {
      profile: profile
        ? {
            fullName: profile.fullName,
            fullNameKana: profile.fullNameKana,
            phone: profile.phone,
            postalCode: profile.postalCode,
            prefecture: profile.prefecture,
            city: profile.city,
            addressLine: profile.addressLine,
            building: profile.building,
            declinedAt: profile.declinedAt?.toISOString() ?? null,
            updatedAt: profile.updatedAt.toISOString(),
          }
        : EMPTY_PROFILE,
      config,
      prompt: decideProfilePrompt({ config, profile }),
    };
  }

  async get(oveAccountId: string): Promise<ProfileView> {
    const [profile, config] = await Promise.all([
      this.db.accountProfile.findUnique({ where: { oveAccountId } }),
      this.effectiveConfig(),
    ]);
    return this.toView(profile, config);
  }

  /**
   * 指定された項目だけを更新する (省略した項目は現状維持、空文字は削除)。
   *
   * HIDDENの項目は無視せず**拒否**する。設定を閉じた後に古い画面から送られてきた値を
   * 黙って捨てると、利用者には保存できたように見えてしまうため。
   */
  async update(oveAccountId: string, input: ProfileInput): Promise<ProfileView> {
    const config = await this.effectiveConfig();
    const data = this.buildUpdateData(input, config);

    const profile = await this.db.accountProfile.upsert({
      where: { oveAccountId },
      create: { oveAccountId, ...data, declinedAt: null },
      // 入力があった時点で「断った」状態は解除する。
      update: { ...data, declinedAt: null },
    });
    return this.toView(profile, config);
  }

  /** 「入力しない」を明示的に記録する。未入力放置と区別してセグメントするため。 */
  async decline(oveAccountId: string): Promise<ProfileView> {
    const config = await this.effectiveConfig();
    const profile = await this.db.accountProfile.upsert({
      where: { oveAccountId },
      create: { oveAccountId, declinedAt: new Date() },
      update: { declinedAt: new Date() },
    });
    return this.toView(profile, config);
  }

  private buildUpdateData(input: ProfileInput, config: EffectiveProfileConfig): ProfileInput {
    const data: ProfileInput = {};

    const assign = (
      key: keyof ProfileInput,
      fieldKey: Parameters<typeof isFieldEditable>[1],
      raw: string | null | undefined,
      normalize?: (value: string) => string | null,
      label?: string,
    ) => {
      const value = blankToNull(raw);
      if (value === undefined) return;
      if (!isFieldEditable(config, fieldKey)) {
        throw new BadRequestException(`${label ?? key} is not accepted`);
      }
      if (value === null) {
        data[key] = null;
        return;
      }
      const normalized = normalize ? normalize(value) : normalizeText(value);
      if (normalized === null) throw new BadRequestException(`${label ?? key} is invalid`);
      if (normalized.length > 100) throw new BadRequestException(`${label ?? key} is too long`);
      data[key] = normalized;
    };

    assign("fullName", "fullName", input.fullName, undefined, "fullName");
    assign(
      "fullNameKana",
      "fullNameKana",
      input.fullNameKana,
      (v) => {
        const text = normalizeText(v);
        return isKana(text) ? text : null;
      },
      "fullNameKana",
    );
    assign("phone", "phone", input.phone, normalizePhone, "phone");
    assign("postalCode", "postalCode", input.postalCode, normalizePostalCode, "postalCode");
    assign(
      "prefecture",
      "address",
      input.prefecture,
      (v) => (isPrefecture(v.trim()) ? v.trim() : null),
      "prefecture",
    );
    assign("city", "address", input.city, undefined, "city");
    assign("addressLine", "address", input.addressLine, undefined, "addressLine");
    assign("building", "address", input.building, undefined, "building");

    return data;
  }
}
