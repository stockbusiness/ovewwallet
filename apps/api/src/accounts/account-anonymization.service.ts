import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { isFeatureEnabled } from "../common/feature-flags";
import { anonymizationHashKey, anonymizeSubject, isAnonymizedSubject } from "./anonymized-identity";

/**
 * 退会からどれだけ経ってから匿名化するか。
 *
 * 退会直後に連絡先を消すと「誤って退会した」「残高の件で問い合わせたい」に一切
 * 対応できなくなるため、猶予を置く。既定値は暫定で、法務・社内規程で保持期間が
 * 定まったら`ACCOUNT_ANONYMIZATION_GRACE_DAYS`で上書きする。
 */
export const DEFAULT_ANONYMIZATION_GRACE_DAYS = 90;

/** 1回の実行で処理するアカウント数の上限。超過分は次回に持ち越す。 */
export const ANONYMIZATION_MAX_ACCOUNTS_PER_RUN = 500;

export interface AnonymizationPreview {
  /** 猶予期間を過ぎ、まだ匿名化されていない退会済みアカウント数。 */
  eligibleAccounts: number;
  /** 適用中の猶予日数。 */
  graceDays: number;
  /** この基準日より前に退会したアカウントが対象。 */
  closedBefore: string;
  /** 機能が有効か (無効なら実行しても0件)。 */
  enabled: boolean;
  /** ハッシュ鍵が設定されているか (未設定なら有効でも実行を中止する)。 */
  hashKeyConfigured: boolean;
}

export interface AnonymizationResult {
  anonymizedAccounts: number;
  anonymizedIdentities: number;
  /** 実行しなかった場合の理由 (実行したなら null)。 */
  skippedReason: "disabled" | "hash-key-missing" | null;
}

/** 正の整数として解釈できない値は既定値を使う (設定ミスで猶予0日にならないように)。 */
export function anonymizationGraceDays(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.ACCOUNT_ANONYMIZATION_GRACE_DAYS);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_ANONYMIZATION_GRACE_DAYS;
}

/**
 * 退会済みアカウントの個人情報の匿名化 (`docs/account-anonymization.md`)。
 *
 * 導入前の退会は`status = CLOSED`と`closed_at`を立てるだけで、氏名・メールアドレス・
 * 電話番号・LINEユーザーIDはすべて残ったままだった。
 *
 * ## 方針
 *
 * 「取引履歴は残すが、**個人にたどり着く連結情報**を消す」。取引に残る`account_id`は、
 * 氏名・連絡先・外部IDがすべて消えていれば単体では個人を特定できない。
 *
 * ## 消すもの
 *
 * - `ove_accounts`: `display_name` / `primary_email` / `primary_phone`
 * - `account_identities`: `email` / `phone` / `metadata`、`provider_subject`はハッシュ化
 * - `account_profiles`: 行ごと削除。氏名・電話・住所しか入っておらず、退会済みの
 *   相手にセグメントを残しておく理由も無いため (`docs/account-profile.md`)
 *
 * ## 消さないもの
 *
 * - `audit_logs` / `ove_transactions`: DBトリガーで削除・更新を禁止しており(設計どおり)、
 *   会計・監査の要件からも長期保管が前提。
 * - `user_sessions`: 保持ジョブ (`DataRetentionService`) が期限切れ後90日で削除済み。
 *   退会時点で全セッションが失効するため、ここで追加の処理は要らない。
 *
 * ## provider_subject をハッシュにする理由
 *
 * この値は**退会済みアカウントの再登録を拒否するためのキー**でもある
 * (`docs/account-closure.md`)。単に消すと同一人物の再登録を検出できなくなり、
 * 「退会→再登録の繰り返しを許さない」方針が静かに壊れる。ハッシュにすれば、
 * 生のLINEユーザーIDを残さないまま照合だけ続けられる
 * (照合側は`AccountRegistrationService.findOrCreateByIdentity`が生の値と
 * ハッシュ値の両方を引く)。
 *
 * ## 安全側の作り
 *
 * 削除は不可逆なので、既定OFF (`ENABLE_ACCOUNT_ANONYMIZATION`) にしてある。
 * ハッシュ鍵 (`ANONYMIZATION_HASH_KEY`) が未設定なら、有効でも実行せず中止する
 * (鍵が無いまま実行すると、二度と照合できないハッシュを書き込んでしまうため)。
 */
@Injectable()
export class AccountAnonymizationService {
  private readonly logger = new Logger(AccountAnonymizationService.name);

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private closedBefore(now: Date): Date {
    return new Date(now.getTime() - anonymizationGraceDays() * 24 * 60 * 60 * 1000);
  }

  /**
   * 対象アカウントの絞り込み条件。
   *
   * `display_name`等がすべてnullでも`account_identities`側が未処理な場合があるため、
   * 「未匿名化」の判定は identity の`provider_subject`が匿名化済みかどうかで行う。
   */
  private eligibleWhere(now: Date) {
    return {
      status: "CLOSED" as const,
      closedAt: { not: null, lte: this.closedBefore(now) },
      identities: { some: { providerSubject: { not: { startsWith: "anon:" } } } },
    };
  }

  /** 有効化する前に対象件数を確認するためのドライラン。 */
  async preview(now: Date = new Date()): Promise<AnonymizationPreview> {
    return {
      eligibleAccounts: await this.db.oveAccount.count({ where: this.eligibleWhere(now) }),
      graceDays: anonymizationGraceDays(),
      closedBefore: this.closedBefore(now).toISOString(),
      enabled: isFeatureEnabled("ENABLE_ACCOUNT_ANONYMIZATION"),
      hashKeyConfigured: anonymizationHashKey() !== null,
    };
  }

  async anonymizeClosedAccounts(now: Date = new Date()): Promise<AnonymizationResult> {
    const empty = { anonymizedAccounts: 0, anonymizedIdentities: 0 };

    if (!isFeatureEnabled("ENABLE_ACCOUNT_ANONYMIZATION")) {
      return { ...empty, skippedReason: "disabled" };
    }

    const hashKey = anonymizationHashKey();
    if (hashKey === null) {
      // 有効化されているのに鍵が無い = 設定漏れ。実行すると照合不能なハッシュを
      // 書き込んでしまうため、何もせず気づけるように警告を出す。
      this.logger.error(
        "ENABLE_ACCOUNT_ANONYMIZATION is true but ANONYMIZATION_HASH_KEY is not set; skipping (see docs/account-anonymization.md)",
      );
      return { ...empty, skippedReason: "hash-key-missing" };
    }

    const targets = await this.db.oveAccount.findMany({
      where: this.eligibleWhere(now),
      select: { id: true, identities: { select: { id: true, providerSubject: true } } },
      orderBy: { closedAt: "asc" },
      take: ANONYMIZATION_MAX_ACCOUNTS_PER_RUN,
    });

    let anonymizedAccounts = 0;
    let anonymizedIdentities = 0;

    for (const account of targets) {
      // アカウントとidentityを同一トランザクションで処理する。途中で落ちて
      // 「氏名は消えたがLINEユーザーIDは残っている」状態を作らない。
      const identityCount = await this.db.$transaction(async (tx) => {
        await tx.oveAccount.update({
          where: { id: account.id },
          data: { displayName: null, primaryEmail: null, primaryPhone: null },
        });

        // プロフィールは個人情報しか持たないので、部分的に消すのではなく行ごと消す。
        // 未登録なら何もしない (deleteだとレコード不在で例外になるためdeleteMany)。
        await tx.accountProfile.deleteMany({ where: { oveAccountId: account.id } });

        let updated = 0;
        for (const identity of account.identities) {
          if (isAnonymizedSubject(identity.providerSubject)) continue;
          await tx.accountIdentity.update({
            where: { id: identity.id },
            data: {
              providerSubject: anonymizeSubject(identity.providerSubject, hashKey),
              email: null,
              phone: null,
              // Json列にDBのNULLを入れるにはPrisma.DbNullを使う
              // (`null`はJSONの値としてのnullを意味してしまう)。
              metadata: Prisma.DbNull,
            },
          });
          updated++;
        }

        await tx.auditLog.create({
          data: {
            id: generateId(),
            actorType: "SYSTEM",
            actionType: "ACCOUNT_ANONYMIZED",
            targetType: "ove_account",
            targetId: account.id,
            result: "SUCCESS",
            // 何を消したかは残すが、消した値そのものは当然残さない。
            reason: `anonymized ${updated} identities after the grace period`,
          },
        });
        return updated;
      });

      anonymizedAccounts++;
      anonymizedIdentities += identityCount;
    }

    if (anonymizedAccounts > 0) {
      this.logger.log(
        `anonymized ${anonymizedAccounts} closed accounts (${anonymizedIdentities} identities)`,
      );
    }
    return { anonymizedAccounts, anonymizedIdentities, skippedReason: null };
  }
}
