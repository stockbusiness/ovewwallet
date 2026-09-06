"use client";

import { ArrowLeftIcon } from "@ove/shared-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import SupportInquiryHistory from "@/components/SupportInquiryHistory";
import {
  apiFetch,
  ApiError,
  SUPPORT_CATEGORY_LABEL,
  type SupportInquiry,
  type SupportInquiryCategory,
} from "@/lib/api";

const CATEGORIES: SupportInquiryCategory[] = [
  "REWARD_NOT_GRANTED",
  "BALANCE_MISMATCH",
  "LOGIN_OR_ACCOUNT",
  "COLLECTIBLE",
  "OTHER",
];

/**
 * お問い合わせ (docs/support-inquiries.md)。
 *
 * ログインしたまま送るので、**どのアカウントの話かを書いてもらう必要がない。**
 * 「付与されない」「残高が合わない」は、アカウントが分からないと調べようがない。
 */
export default function SupportPage() {
  const router = useRouter();
  const [category, setCategory] = useState<SupportInquiryCategory>("REWARD_NOT_GRANTED");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SupportInquiry[]>([]);

  const load = useCallback(async () => {
    try {
      setHistory(await apiFetch<SupportInquiry[]>("/api/v1/me/support-inquiries"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      // 履歴が読めなくても、送ること自体は妨げない。
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function send() {
    if (!message.trim()) {
      setError("お困りの内容を入力してください");
      return;
    }
    setError(null);
    setSentCode(null);
    setSending(true);
    try {
      const created = await apiFetch<SupportInquiry>("/api/v1/me/support-inquiries", {
        method: "POST",
        body: JSON.stringify({ category, message: message.trim() }),
      });
      setSentCode(created.inquiry_code);
      setMessage("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="flex flex-col gap-4 px-4 pb-24 pt-6">
      <header className="flex items-center gap-3">
        <Link href="/wallet/menu" className="flex h-8 w-8 items-center justify-center text-sengoku-muted">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="font-heading text-lg font-bold text-sengoku-text">お問い合わせ</h1>
      </header>

      <p className="text-xs text-sengoku-muted">
        ログインしたままお送りいただけるので、<strong>アカウント番号を書く必要はありません。</strong>
        お返事は「お知らせ」に届きます。
      </p>

      {sentCode && (
        <p className="rounded-lg bg-green-950 p-3 text-sm text-green-300">
          受け付けました。受付番号は <strong>{sentCode}</strong> です。
          お返事は<Link href="/wallet/notices" className="underline">お知らせ</Link>に届きます。
        </p>
      )}
      {error && <p className="rounded-lg bg-red-950 p-3 text-sm text-red-300">{error}</p>}

      <section className="rounded-xl border border-sengoku-border p-4">
        <label className="mb-3 block text-xs">
          <span className="mb-1 block text-sengoku-muted">お困りの種類</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportInquiryCategory)}
            className="w-full rounded border border-sengoku-border bg-transparent px-2 py-2 text-sm"
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {SUPPORT_CATEGORY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs">
          <span className="mb-1 block text-sengoku-muted">お困りの内容</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={7}
            maxLength={2000}
            placeholder="いつ・何をしたときに、どうなったかをお書きください。"
            className="w-full rounded border border-sengoku-border bg-transparent px-2 py-2 text-sm"
          />
          <span className="mt-1 block text-right text-[11px] text-sengoku-faint">
            {message.length} / 2000
          </span>
        </label>

        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="mt-2 w-full rounded-lg bg-sengoku-accent py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "送信中..." : "送信する"}
        </button>
      </section>

      <SupportInquiryHistory inquiries={history} />
    </main>
  );
}

function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "送信に失敗しました";
  // 連打で同じ内容が並ぶのを防いでいる。利用者には「届いている」と伝えるのが正しい。
  if (err.status === 400) return "同じ内容をすでに受け付けています。お返事をお待ちください。";
  if (err.status === 429) return "短い時間に多くお送りいただいています。しばらく経ってからお試しください。";
  return err.message;
}
