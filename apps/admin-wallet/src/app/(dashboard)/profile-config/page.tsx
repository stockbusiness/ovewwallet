"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import HelpPanel from "@/components/HelpPanel";
import {
  apiFetch,
  ApiError,
  type ProfileConfig,
  type ProfileFieldKey,
  type ProfileFieldRequirement,
} from "@/lib/api";

const FIELDS: { key: ProfileFieldKey; label: string; note?: string }[] = [
  { key: "fullName", label: "お名前" },
  { key: "fullNameKana", label: "お名前 (カナ)" },
  { key: "phone", label: "電話番号" },
  { key: "postalCode", label: "郵便番号" },
  { key: "address", label: "住所", note: "都道府県・市区町村・町名番地をまとめて1項目として扱います (建物名は常に任意)" },
];

const LEVELS: { value: ProfileFieldRequirement; label: string }[] = [
  { value: "HIDDEN", label: "非表示" },
  { value: "OPTIONAL", label: "任意" },
  { value: "REQUIRED", label: "必須" },
];

/**
 * プロフィール項目 (氏名・電話・住所) をどこまで求めるかの設定
 * (docs/account-profile.md)。
 *
 * 「必須」にしてもウォレットの利用は止まらない。入力しない人をセグメントとして
 * 残すのがこの機能の目的なので、入口で締め出すと目的そのものが達せられないため。
 */
export default function ProfileConfigPage() {
  const router = useRouter();
  const [config, setConfig] = useState<ProfileConfig | null>(null);
  const [fields, setFields] = useState<Record<ProfileFieldKey, ProfileFieldRequirement> | null>(null);
  const [promptEnabled, setPromptEnabled] = useState(true);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const current = await apiFetch<ProfileConfig>("/api/v1/admin/profile-config");
      setConfig(current);
      setFields(current.fields);
      setPromptEnabled(current.promptEnabled);
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

  async function save() {
    if (!reason.trim()) {
      setError("変更理由を入力してください");
      return;
    }
    if (!fields) return;
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const updated = await apiFetch<ProfileConfig>("/api/v1/admin/profile-config", {
        method: "POST",
        body: JSON.stringify({ ...fields, promptEnabled, reason: reason.trim() }),
      });
      setConfig(updated);
      setFields(updated.fields);
      setPromptEnabled(updated.promptEnabled);
      setReason("");
      setMessage("保存しました");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-bold">お客様情報の入力設定</h1>
      <p className="mb-4 text-xs text-sengoku-muted">
        ウォレット利用者に、氏名・電話番号・住所をどこまで求めるかを項目ごとに設定します。
        変更は保存した時点で利用者の画面に反映されます (再ビルドは不要です)。
      </p>

      <HelpPanel storageKey="profile-config" title="このページについて">
        <div>
          <p className="font-semibold text-sengoku-text">3つの設定値</p>
          <ul className="ml-4 list-disc">
            <li>
              <strong>非表示</strong>: 入力欄そのものを出しません。保存しようとしても受け付けません。
            </li>
            <li>
              <strong>任意</strong>: 入力欄は出しますが、空欄のままでも構いません。
            </li>
            <li>
              <strong>必須</strong>: 入力をお願いする表示が出ます。
            </li>
          </ul>
        </div>
        <p className="text-sengoku-gold-soft">
          重要: 「必須」にしても<strong>ウォレットは今までどおり使えます</strong>。
          入力しないと使えない、という制限にはなりません。これは仕様です。
          入力しない方を「入力しない層」として区別できることに価値があるため、
          入口で締め出すと本来の目的が達せられなくなります。
        </p>
        <div>
          <p className="font-semibold text-sengoku-text">入力のお願いを出す</p>
          <p>
            オフにすると、未入力でもホーム画面にお願いの帯を出しません。
            項目の設定 (必須・任意) はそのまま残るので、メニューからは入力できます。
          </p>
        </div>
        <p>
          入力された内容は個人情報です。利用目的・保管期間・削除の扱いを利用規約に
          記載したうえで運用してください。退会後の匿名化処理が動くと、この情報は
          行ごと削除されます。
        </p>
      </HelpPanel>

      {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}
      {message && <p className="mb-3 text-sm text-sengoku-green">{message}</p>}

      {config?.updatedAt && (
        <div className="mb-4 rounded-lg border border-sengoku-border bg-sengoku-navy-deep p-3 text-xs text-sengoku-muted">
          最終更新: {new Date(config.updatedAt).toLocaleString("ja-JP")}
          {config.updatedBy ? ` (管理者ID: ${config.updatedBy})` : ""}
        </div>
      )}

      {fields && (
        <div className="space-y-4 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
          {FIELDS.map(({ key, label, note }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-sengoku-muted">{label}</label>
              <div className="mt-1 flex gap-2">
                {LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setFields({ ...fields, [key]: level.value })}
                    className={
                      fields[key] === level.value
                        ? "rounded-md bg-sengoku-gold px-3 py-1 text-xs font-bold text-sengoku-navy-deep"
                        : "rounded-md border border-sengoku-border px-3 py-1 text-xs text-sengoku-muted"
                    }
                  >
                    {level.label}
                  </button>
                ))}
              </div>
              {note && <p className="mt-1 text-[11px] text-sengoku-faint">{note}</p>}
            </div>
          ))}

          <div className="border-t border-sengoku-border pt-4">
            <label className="flex items-center gap-2 text-xs font-medium text-sengoku-muted">
              <input
                type="checkbox"
                checked={promptEnabled}
                onChange={(e) => setPromptEnabled(e.target.checked)}
              />
              ホーム画面に入力のお願いを表示する
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-sengoku-muted">変更理由 (監査ログに記録されます)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 発送を伴うキャンペーン開始のため住所を必須へ"
              className="mt-1 block w-full rounded-md border border-sengoku-border px-2 py-1 text-sm"
            />
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-sengoku-gold px-4 py-1.5 text-sm text-sengoku-navy-deep disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      )}
    </>
  );
}
