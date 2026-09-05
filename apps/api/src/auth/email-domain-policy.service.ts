import { Inject, Injectable, Logger } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import {
  BUILT_IN_DISPOSABLE_DOMAINS,
  emailDomain,
  isDisposableEmailDomain,
} from "./email-address-policy";

/**
 * 管理画面の個別指定 (`email_domain_rules`) を短時間だけ覚えておく。
 *
 * 判定はワンタイムコードの発行ごとに走るため、毎回DBを引かない。運用者が
 * 追加・削除したとき最大この時間だけ反映が遅れるが、ドメインの追加は
 * 急を要さないので許容する。
 */
const RULES_CACHE_MS = 60_000;

interface CachedRules {
  blocked: ReadonlySet<string>;
  allowed: ReadonlySet<string>;
  expiresAt: number;
}

/** 使い捨てメールドメインかどうかを判定する。 */
@Injectable()
export class EmailDomainPolicyService {
  private readonly logger = new Logger(EmailDomainPolicyService.name);
  private cache: CachedRules | null = null;

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** 管理画面で追加・削除した直後に反映させる。 */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * 登録に使えないアドレスなら `true`。
   *
   * DBが引けないときは**通す**。使い捨てアドレスが1つ混ざることより、
   * DBの一時的な不調で正規の利用者が全員ログインできなくなる方が害が大きい。
   * 組み込みリストだけは常に効かせる。
   */
  async isDisposable(email: string): Promise<boolean> {
    const domain = emailDomain(email);
    if (domain.length === 0) return false;

    const rules = await this.loadRules();
    // ALLOW は BLOCK より優先する。組み込みリストの誤検知を、コードを変えずに
    // 運用者が解除できるようにするため。
    if (isDisposableEmailDomain(domain, rules.allowed)) return false;
    if (isDisposableEmailDomain(domain, rules.blocked)) return true;
    return isDisposableEmailDomain(domain, BUILT_IN_DISPOSABLE_DOMAINS);
  }

  private async loadRules(): Promise<{ blocked: ReadonlySet<string>; allowed: ReadonlySet<string> }> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) return this.cache;

    try {
      const rows = await this.db.emailDomainRule.findMany({
        select: { domain: true, action: true },
      });
      const blocked = new Set<string>();
      const allowed = new Set<string>();
      for (const row of rows) {
        (row.action === "ALLOW" ? allowed : blocked).add(row.domain.toLowerCase());
      }
      this.cache = { blocked, allowed, expiresAt: now + RULES_CACHE_MS };
      return this.cache;
    } catch (err) {
      this.logger.warn(
        `could not read email domain rules, falling back to the built-in list: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
      return { blocked: new Set<string>(), allowed: new Set<string>() };
    }
  }
}
