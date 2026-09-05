"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import { apiFetch, ApiError, type EmailDomainRule, type EmailDomainRuleList } from "@/lib/api";

/**
 * 使い捨てメールドメインの個別指定 (docs/email-domain-policy.md)。
 *
 * 既定のリストはコード側に持っているため、ここで扱うのはその差分だけ。
 */
export default function EmailDomainsPage() {
  const router = useRouter();
  const [data, setData] = useState<EmailDomainRuleList | null>(null);
  const [domain, setDomain] = useState("");
  const [action, setAction] = useState<EmailDomainRule["action"]>("BLOCK");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<EmailDomainRuleList>("/api/v1/admin/email-domains"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!domain.trim()) {
      setError("ドメインを入力してください");
      return;
    }
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      await apiFetch<EmailDomainRule>("/api/v1/admin/email-domains", {
        method: "POST",
        body: JSON.stringify({
          domain: domain.trim(),
          action,
          reason: reason.trim() || undefined,
        }),
      });
      setDomain("");
      setReason("");
      setMessage("保存しました");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function remove(target: string) {
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/v1/admin/email-domains/${encodeURIComponent(target)}`, { method: "DELETE" });
      setMessage(`${target} を削除しました`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "削除に失敗しました");
    }
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">メールドメイン設定</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        使い捨てメールアドレスでの新規登録を防ぎます。よく知られた使い捨てサービスは
        {data ? ` ${data.built_in_count.toLocaleString()} 件` : ""}
        が最初から登録済みで、ここで設定するのはその追加・除外だけです。変更は1分以内に反映されます。
      </p>

      <HelpPanel storageKey="email-domains" title="このページについて">
        <div>
          <p className="font-semibold text-sengoku-text">2つの設定値</p>
          <ul className="ml-4 list-disc">
            <li>
              <strong>拒否</strong>: 既定のリストに無いドメインを、新たに使えなくします。
            </li>
            <li>
              <strong>許可</strong>: 既定のリストに載っているドメインを、使えるように戻します。
              <strong>許可は拒否より優先されます。</strong>正規のお客様が誤って弾かれたときは、
              ここにそのドメインを「許可」で登録してください。
            </li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">サブドメインもまとめて対象になります</p>
          <p>
            <code>mailinator.com</code> を登録すると <code>abc.mailinator.com</code> も対象です。
            使い捨てメールはサブドメインを無限に作れる作りのものが多いためです。
          </p>
        </div>
        <div>
          <p className="font-semibold text-sengoku-text">Gmailの「+」付きアドレスについて</p>
          <p>
            <code>tanaka+1@gmail.com</code> と <code>tanaka+2@gmail.com</code> は同じ受信箱なので、
            ウォレットでは<strong>同一のお客様として扱います</strong>。別々のアカウントは作られないため、
            ここでの設定は不要です。
          </p>
        </div>
      </HelpPanel>

      {error && <p className="mb-3 rounded bg-red-950 p-2 text-sm text-red-300">{error}</p>}
      {message && <p className="mb-3 rounded bg-green-950 p-2 text-sm text-green-300">{message}</p>}

      <section className="mb-6 rounded border border-sengoku-border p-4">
        <h2 className="mb-3 text-sm font-semibold">ドメインを追加する</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">ドメイン</span>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.com"
              className="w-64 rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">扱い</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as EmailDomainRule["action"])}
              className="rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            >
              <option value="BLOCK">拒否</option>
              <option value="ALLOW">許可</option>
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block text-sengoku-muted">理由 (任意)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="スパム登録が続いたため"
              className="w-72 rounded border border-sengoku-border bg-transparent px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={add}
            disabled={saving}
            className="rounded bg-sengoku-accent px-3 py-1 text-sm text-black disabled:opacity-50"
          >
            {saving ? "保存中..." : "追加"}
          </button>
        </div>
      </section>

      <table className="w-full text-left text-sm">
        <thead className="border-b border-sengoku-border text-xs text-sengoku-muted">
          <tr>
            <th className="py-2">ドメイン</th>
            <th className="py-2">扱い</th>
            <th className="py-2">理由</th>
            <th className="py-2">登録日</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {data?.rules.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-xs text-sengoku-muted">
                個別の指定はありません (既定のリストのみが有効です)。
              </td>
            </tr>
          )}
          {data?.rules.map((rule) => (
            <tr key={rule.domain} className="border-b border-sengoku-border/50">
              <td className="py-2 font-mono text-xs">{rule.domain}</td>
              <td className="py-2">
                <span className={rule.action === "ALLOW" ? "text-green-400" : "text-red-400"}>
                  {rule.action === "ALLOW" ? "許可" : "拒否"}
                </span>
              </td>
              <td className="py-2 text-xs text-sengoku-muted">{rule.reason ?? "-"}</td>
              <td className="py-2 text-xs text-sengoku-muted">
                {new Date(rule.createdAt).toLocaleDateString("ja-JP")}
              </td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => remove(rule.domain)}
                  className="text-xs text-sengoku-muted underline"
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
