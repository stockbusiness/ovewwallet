import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <Link href="/wallet" className="text-sm text-brand-600">
        ← ウォレットトップ
      </Link>
      <h1 className="text-lg font-bold text-brand-700">OVEについて</h1>
      <div className="space-y-3 text-sm leading-relaxed text-neutral-700">
        <p>
          OVEは、千の国パスポート・AIアート教室・戦国ガチャ・EC・NFTマーケット・将来のメタバースなどから
          共通利用される、千の国ウォレット内のポイント・取引台帳です。
        </p>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
          現在のOVEは、千の国ウォレット内で管理されるサービス内ポイントです。
          現時点ではブロックチェーン上の暗号資産ではありません。
          売買・日本円への換金・ユーザー間送金・外部取引所への送付はできません。
        </p>
        <p>
          すべてのOVEの増減は取引台帳に記録され、いつ・誰が・どのような理由で
          OVEを取得・利用したかを後から確認できます。
        </p>
      </div>
    </main>
  );
}
