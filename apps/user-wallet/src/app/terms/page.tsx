import Link from "next/link";
import { ArrowLeftIcon } from "@ove/shared-ui";

export default function TermsPage() {
  return (
    <main className="flex flex-col gap-4 px-4 pb-10 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/login" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">OVE利用規約</h1>
      </header>
      <p className="text-xs text-sengoku-faint">バージョン 1.0</p>

      <div className="space-y-4 text-sm leading-relaxed text-sengoku-muted">
        <Section title="第1条 (OVEの性質)">
          OVEは、千ノ国パスポート・AIアート教室・戦国ガチャ・EC・NFTマーケット・将来のメタバースなどから
          共通利用される、千ノ国ウォレット内で管理されるサービス内ポイントです。現時点ではブロックチェーン上の
          暗号資産ではなく、法定通貨・暗号資産との交換、売買、日本円への換金、ユーザー間送金、外部取引所への
          送付はできません。
        </Section>
        <Section title="第2条 (アカウント)">
          利用者は、LINE・メールアドレス・千ノ国パスポートIDなどのいずれかの方法でOVEアカウントを作成できます。
          1人につき1つのOVEアカウントを原則とし、なりすまし・不正取得目的での複数アカウント作成を禁止します。
        </Section>
        <Section title="第3条 (OVEの付与・利用)">
          OVEの付与条件・付与量は各連携サービスの定めるルールに基づきます。付与されたOVEの増減はすべて
          取引台帳に記録され、利用者はウォレット画面からいつでも取引履歴を確認できます。
        </Section>
        <Section title="第4条 (禁止事項)">
          法令・公序良俗に反する利用、不正な手段によるOVEの取得・改ざん、システムへの不正アクセスを
          禁止します。違反が確認された場合、運営はアカウントの利用制限・OVEの取消などの措置を行うことが
          あります。
        </Section>
        <Section title="第5条 (規約の変更)">
          本規約は必要に応じて改定されることがあります。重要な変更を行う場合は、ウォレット画面上での
          告知など適切な方法で利用者に周知します。
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 text-sm font-bold text-sengoku-text">{title}</h2>
      <p>{children}</p>
    </section>
  );
}
