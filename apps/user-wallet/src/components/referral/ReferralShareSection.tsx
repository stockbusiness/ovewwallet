"use client";

import { useState } from "react";

/**
 * 紹介URLの共有欄。
 *
 * コピーは `navigator.clipboard` が使える環境でのみ出す。iOSのプライベート
 * ブラウズや非HTTPSでは存在しない・例外を投げるため、押しても無反応という
 * 見え方にならないよう、URLそのものを選択できる形でも必ず表示しておく。
 */
export default function ReferralShareSection({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  async function copy() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // 「コピーしました」を出し続けると、次に押したときに反応が分からなくなる。
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <section className="rounded-xl border border-sengoku-border bg-sengoku-navy p-4">
      <p className="text-sm font-bold text-sengoku-text">あなたの紹介URL</p>
      <p className="mt-1 text-xs text-sengoku-muted">
        このURLから登録された方が、あなたの紹介として記録されます。
      </p>
      <p className="mt-3 break-all rounded-md border border-sengoku-border bg-sengoku-navy-deep px-3 py-2 text-xs text-sengoku-text">
        {url}
      </p>
      <button
        type="button"
        onClick={copy}
        className="mt-3 rounded-full border border-sengoku-gold/40 px-4 py-2 text-xs font-bold text-sengoku-gold"
      >
        {copied ? "コピーしました" : "URLをコピー"}
      </button>
      {copyFailed && (
        <p className="mt-2 text-xs text-sengoku-faint">
          コピーできませんでした。上のURLを長押しして選択してください。
        </p>
      )}
    </section>
  );
}
