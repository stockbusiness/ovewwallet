import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { generateId, type EmailDomainRuleAction, type PrismaClient } from "@ove/database";
import { BUILT_IN_DISPOSABLE_DOMAINS } from "../auth/email-address-policy";
import { EmailDomainPolicyService } from "../auth/email-domain-policy.service";
import { PRISMA } from "../common/prisma.module";

export interface EmailDomainRuleView {
  domain: string;
  action: EmailDomainRuleAction;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
}

/** 1ラベルのドメインを弾くための最低限の形式検査。 */
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * メールドメインの個別指定 (`email_domain_rules`) を管理画面から編集する。
 *
 * 組み込みの使い捨てドメイン一覧はコード側にあり、この表はその差分だけを持つ
 * (docs/email-domain-policy.md)。
 */
@Injectable()
export class AdminEmailDomainsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly policy: EmailDomainPolicyService,
  ) {}

  /** 組み込みリストの件数。運用者が「何件を既定で弾いているか」を把握できるようにする。 */
  builtInCount(): number {
    return BUILT_IN_DISPOSABLE_DOMAINS.size;
  }

  async list(): Promise<EmailDomainRuleView[]> {
    const rows = await this.db.emailDomainRule.findMany({ orderBy: { domain: "asc" } });
    return rows.map((row) => ({
      domain: row.domain,
      action: row.action,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    }));
  }

  async upsert(
    params: { domain: string; action: EmailDomainRuleAction; reason?: string },
    adminId: string,
  ): Promise<EmailDomainRuleView> {
    const domain = normalizeDomain(params.domain);

    const before = await this.db.emailDomainRule.findUnique({ where: { domain } });
    const row = await this.db.emailDomainRule.upsert({
      where: { domain },
      create: {
        domain,
        action: params.action,
        reason: params.reason ?? null,
        createdBy: adminId,
      },
      update: { action: params.action, reason: params.reason ?? null },
    });

    await this.writeAuditLog({
      adminId,
      domain,
      actionType: before ? "EMAIL_DOMAIN_RULE_UPDATED" : "EMAIL_DOMAIN_RULE_ADDED",
      before: before ? { action: before.action, reason: before.reason } : undefined,
      after: { action: row.action, reason: row.reason },
    });

    // 追加した瞬間から効かせる。キャッシュ切れを待つと、運用者が
    // 「追加したのに登録できてしまう」と受け取るため。
    this.policy.invalidateCache();

    return {
      domain: row.domain,
      action: row.action,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    };
  }

  async remove(domainInput: string, adminId: string): Promise<void> {
    const domain = normalizeDomain(domainInput);
    const before = await this.db.emailDomainRule.findUnique({ where: { domain } });
    if (!before) throw new BadRequestException("this domain is not registered");

    await this.db.emailDomainRule.delete({ where: { domain } });
    await this.writeAuditLog({
      adminId,
      domain,
      actionType: "EMAIL_DOMAIN_RULE_REMOVED",
      before: { action: before.action, reason: before.reason },
    });
    this.policy.invalidateCache();
  }

  private async writeAuditLog(params: {
    adminId: string;
    domain: string;
    actionType: string;
    before?: { action: EmailDomainRuleAction; reason: string | null };
    after?: { action: EmailDomainRuleAction; reason: string | null };
  }): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: params.adminId,
        actionType: params.actionType,
        targetType: "email_domain_rules",
        targetId: params.domain,
        result: "SUCCESS",
        beforeData: params.before ?? undefined,
        afterData: params.after ?? undefined,
      },
    });
  }
}

/**
 * 入力を小文字のドメインへ整える。
 *
 * `@` 付きで貼られることを見越して、あればドメイン部だけを取る。1ラベル
 * (`com` など) を弾いているのは、登録すると全ドメインが塞がるため。
 */
function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  const domain = at >= 0 ? trimmed.slice(at + 1) : trimmed;

  if (!DOMAIN_PATTERN.test(domain)) {
    throw new BadRequestException("domain must be a valid domain name with at least two labels");
  }
  return domain;
}
