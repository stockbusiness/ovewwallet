-- 管理画面から編集するメールドメインの個別指定 (docs/email-domain-policy.md)。
-- 組み込みの使い捨てドメイン一覧はコード側 (disposable-email-domains.generated.ts) に
-- 持ち、この表はその差分だけを持つ。8000件超をDBへ入れないのは、リストの更新が
-- マイグレーションではなく通常のコード変更で済むようにするため。
CREATE TYPE "EmailDomainRuleAction" AS ENUM ('BLOCK', 'ALLOW');

CREATE TABLE "email_domain_rules" (
    "domain" TEXT NOT NULL,
    "action" "EmailDomainRuleAction" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "email_domain_rules_pkey" PRIMARY KEY ("domain")
);
