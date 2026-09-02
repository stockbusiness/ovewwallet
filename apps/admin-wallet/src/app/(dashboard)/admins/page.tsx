"use client";

import { toDisplayCode } from "@ove/shared-ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import {
  apiFetch,
  ApiError,
  ADMIN_ROLES,
  ADMIN_ROLE_LABELS,
  type AdminMe,
  type AdminRole,
  type AdminUser,
  type CreatedAdminUser,
} from "@/lib/api";

export default function AdminUsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [admins, setAdmins] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AdminRole>("SUPER_ADMIN");
  const [creating, setCreating] = useState(false);
  // 初期パスワードは作成時の応答にしか含まれないため、閉じるまで画面に残す。
  const [created, setCreated] = useState<CreatedAdminUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [meRes, list] = await Promise.all([
        apiFetch<AdminMe>("/api/v1/admin/me"),
        apiFetch<AdminUser[]>("/api/v1/admin/admins"),
      ]);
      setMe(meRes);
      setAdmins(list);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "読み込みに失敗しました");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createAdmin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setCreating(true);
    try {
      const res = await apiFetch<CreatedAdminUser>("/api/v1/admin/admins", {
        method: "POST",
        body: JSON.stringify({ email, displayName, role }),
      });
      setCreated(res);
      setEmail("");
      setDisplayName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "管理者の追加に失敗しました");
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(admin: AdminUser, status: "ACTIVE" | "SUSPENDED") {
    setError(null);
    setMessage(null);
    const verb = status === "SUSPENDED" ? "停止" : "再開";
    const reason = window.prompt(`${admin.email} を${verb}します。理由を入力してください (操作ログに残ります)`);
    if (reason === null) return;
    if (reason.trim() === "") {
      setError("理由を入力してください");
      return;
    }
    try {
      await apiFetch(`/api/v1/admin/admins/${admin.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason }),
      });
      setMessage(`${admin.email} を${verb}しました。`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${verb}に失敗しました`);
    }
  }

  if (error && admins === null) return <p className="p-6 text-sm text-sengoku-red">{error}</p>;
  if (!me || admins === null) return <p className="p-6 text-sm text-sengoku-muted">読み込み中...</p>;

  const canManage = me.role === "SUPER_ADMIN";

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">管理者アカウント</h1>
      <p className="mb-6 text-sm text-sengoku-muted">ログイン中: {me.displayName} ({me.email})</p>

      <HelpPanel storageKey="admins" title="このページについて・使い方">
        <p>
          管理画面にログインできるアカウントの一覧です。
          <strong className="text-sengoku-text">追加・ロール変更・停止はスーパー管理者のみ</strong>行えます。
        </p>
        <div>
          <p className="font-semibold text-sengoku-text">初期管理者を自分のアカウントに置き換える</p>
          <ol className="ml-4 list-decimal">
            <li>自分のメールアドレスでスーパー管理者を追加する</li>
            <li>表示された初期パスワードを控える (この1回しか表示されません)</li>
            <li>いったんログアウトし、追加したアカウントでログインする</li>
            <li>セキュリティ設定でパスワードを変更し、MFAを有効化する</li>
            <li>この画面に戻り、初期管理者 (admin@ovewallet.local) を停止する</li>
          </ol>
        </div>
        <p className="text-sengoku-gold-soft">
          メールアドレスは後から変更できません (APIが受け付けるのは表示名・ロール・状態のみ)。
          変更したい場合は新しいアカウントを追加し、古い方を停止してください。
          また、自分自身を停止すると管理画面に入れなくなるため、停止する前に別のスーパー管理者で
          ログインできることを必ず確認してください。
        </p>
      </HelpPanel>

      {message && <p className="mb-4 rounded-md bg-sengoku-green/10 p-3 text-sm text-sengoku-green">{message}</p>}
      {error && <p className="mb-4 rounded-md bg-sengoku-red/10 p-3 text-sm text-sengoku-red">{error}</p>}

      {created && (
        <section className="mb-6 rounded-lg border border-sengoku-gold bg-sengoku-navy p-5">
          <h2 className="mb-2 text-sm font-semibold text-sengoku-gold">初期パスワードを控えてください</h2>
          <p className="mb-3 text-sm text-sengoku-muted">
            この値が表示されるのは今回だけです。閉じると二度と確認できません
            (紛失した場合はスーパー管理者によるパスワードリセットが必要です)。
          </p>
          <dl className="mb-3 rounded-md bg-sengoku-navy-deep p-3 text-sm">
            <div className="flex gap-2">
              <dt className="text-sengoku-muted">メールアドレス</dt>
              <dd className="font-mono">{created.admin.email}</dd>
            </div>
            <div className="mt-1 flex gap-2">
              <dt className="text-sengoku-muted">初期パスワード</dt>
              <dd className="break-all font-mono font-bold">{created.initialPassword}</dd>
            </div>
          </dl>
          <button
            onClick={() => setCreated(null)}
            className="rounded-md border border-sengoku-border px-4 py-2 text-sm font-semibold"
          >
            控えたので閉じる
          </button>
        </section>
      )}

      {canManage && (
        <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-5">
          <h2 className="mb-4 text-sm font-semibold">管理者を追加</h2>
          <form onSubmit={createAdmin} className="flex max-w-md flex-col gap-3">
            <label className="text-sm font-medium">
              メールアドレス
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-sengoku-border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium">
              表示名
              <input
                type="text"
                required
                maxLength={100}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-md border border-sengoku-border px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium">
              ロール
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AdminRole)}
                className="mt-1 w-full rounded-md border border-sengoku-border px-3 py-2 text-sm"
              >
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ADMIN_ROLE_LABELS[r]} ({r})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
            >
              {creating ? "追加中..." : "追加する"}
            </button>
          </form>
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border border-sengoku-border bg-sengoku-navy">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-sengoku-border text-xs text-sengoku-muted">
            <tr>
              <th className="px-4 py-3">管理者コード</th>
              <th className="px-4 py-3">メールアドレス</th>
              <th className="px-4 py-3">表示名</th>
              <th className="px-4 py-3">ロール</th>
              <th className="px-4 py-3">MFA</th>
              <th className="px-4 py-3">状態</th>
              <th className="px-4 py-3">最終ログイン</th>
              {canManage && <th className="px-4 py-3">操作</th>}
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-b border-sengoku-border/50 last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{toDisplayCode(a.adminCode)}</td>
                <td className="px-4 py-3">{a.email}</td>
                <td className="px-4 py-3">{a.displayName}</td>
                <td className="px-4 py-3 text-xs">{ADMIN_ROLE_LABELS[a.role] ?? a.role}</td>
                <td className="px-4 py-3 text-xs">
                  {a.mfaEnabled ? (
                    <span className="text-sengoku-green">有効</span>
                  ) : (
                    <span className="text-sengoku-muted">無効</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {a.status === "ACTIVE" ? (
                    <span className="text-sengoku-green">有効</span>
                  ) : (
                    <span className="text-sengoku-red">停止中</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-sengoku-muted">
                  {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString("ja-JP") : "—"}
                </td>
                {canManage && (
                  <td className="px-4 py-3">
                    {a.id === me.id ? (
                      <span className="text-xs text-sengoku-muted">自分</span>
                    ) : a.status === "ACTIVE" ? (
                      <button
                        onClick={() => setStatus(a, "SUSPENDED")}
                        className="rounded-md border border-sengoku-red px-3 py-1 text-xs font-semibold text-sengoku-red"
                      >
                        停止
                      </button>
                    ) : (
                      <button
                        onClick={() => setStatus(a, "ACTIVE")}
                        className="rounded-md border border-sengoku-border px-3 py-1 text-xs font-semibold"
                      >
                        再開
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
