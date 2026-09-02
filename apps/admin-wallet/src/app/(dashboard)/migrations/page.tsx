"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError, type AccountListItem } from "@/lib/api";
import { toDisplayCode } from "@ove/shared-ui";

interface MigrationRequestResult {
  result: "PENDING_APPROVAL";
  approvalRequestId: string;
}

/** 移行CSVの文字コード選択肢。Shift_JISは古い社内システムからのエクスポートで多い。 */
const CSV_ENCODINGS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "shift_jis", label: "Shift_JIS" },
] as const;
type CsvEncoding = (typeof CSV_ENCODINGS)[number]["value"];

export default function MigrationsPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>("utf-8");
  const [batchName, setBatchName] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<MigrationRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewingAccounts, setReviewingAccounts] = useState<AccountListItem[]>([]);

  const loadReviewingAccounts = useCallback(async () => {
    try {
      const list = await apiFetch<AccountListItem[]>("/api/v1/admin/accounts?status=REVIEWING&limit=200");
      setReviewingAccounts(list);
    } catch {
      // ログイン切れ等はページ本体のAPI呼び出し側で処理されるため、ここでは静かに無視する
    }
  }, []);

  useEffect(() => {
    loadReviewingAccounts();
  }, [loadReviewingAccounts]);

  function decodeFile(file: File, enc: CsvEncoding) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buffer = reader.result as ArrayBuffer;
        setCsvContent(new TextDecoder(enc).decode(buffer));
      } catch {
        setCsvContent(null);
        setError("CSVの読み込みに失敗しました (文字コードの選択が正しいか確認してください)");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setResult(null);
    decodeFile(file, encoding);
  }

  function onEncodingChange(enc: CsvEncoding) {
    setEncoding(enc);
    if (selectedFile) decodeFile(selectedFile, enc);
  }

  async function requestExecution() {
    if (!csvContent || !selectedFile || !batchName || !reason) return;
    setError(null);
    try {
      const res = await apiFetch<MigrationRequestResult>("/api/v1/admin/migrations/request", {
        method: "POST",
        body: JSON.stringify({ fileName: selectedFile.name, csvContent, batchName, reason }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "申請に失敗しました");
    }
  }

  return (
    <>
        <h1 className="mb-1 text-xl font-bold">既存ユーザー移行</h1>
        <p className="mb-4 text-xs text-sengoku-muted">
          形式: old_user_id,old_balance (old_balance を空欄にすると「残高不明」として扱われ、
          推定値を入れずアカウントは REVIEWING 状態になります)。旧システムのエクスポートが
          Shift_JISの場合は文字コードを切り替えてください (文字化けする場合はCSVを
          読み込み直します)。移行の実行は事前承認制であり、ここでの申請だけでは実行されません。
          申請者本人以外の管理者が「二段階承認」画面でCSVの内容を確認し承認した時点で
          初めて実行されます。
        </p>

        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs">
              バッチ名
              <input
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                className="ml-2 rounded-md border border-sengoku-border px-2 py-1 text-sm"
                placeholder="2026年7月度移行"
              />
            </label>
            <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="text-sm" />
            <label className="text-xs">
              文字コード
              <select
                value={encoding}
                onChange={(e) => onEncodingChange(e.target.value as CsvEncoding)}
                className="ml-2 rounded-md border border-sengoku-border px-2 py-1 text-sm"
              >
                {CSV_ENCODINGS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs">
            申請理由
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="ml-2 w-96 rounded-md border border-sengoku-border px-2 py-1 text-sm"
              placeholder="旧システム終了に伴う移行 (2026年7月分)"
            />
          </label>
          <button
            onClick={requestExecution}
            disabled={!csvContent || !batchName || !reason}
            className="rounded-md bg-sengoku-gold px-4 py-2 text-sm font-semibold text-sengoku-navy-deep disabled:opacity-50"
          >
            承認を申請
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-sengoku-red">{error}</p>}

        {result && (
          <section className="mb-6 rounded-lg border border-sengoku-green/30 bg-sengoku-green/10 p-4 text-sm text-sengoku-green">
            承認待ちとして申請しました。
            <Link href="/approval-requests" className="ml-1 underline">
              「二段階承認」画面
            </Link>
            で別の管理者が承認すると実行されます。
          </section>
        )}

        <section className="rounded-lg border border-sengoku-gold-soft/30 bg-sengoku-gold-soft/10 p-4">
          <h2 className="mb-1 text-sm font-semibold text-sengoku-gold-soft">
            検証待ちアカウント (REVIEWING) — {reviewingAccounts.length}件
          </h2>
          <p className="mb-3 text-xs text-sengoku-gold-soft">
            残高不明のまま移行されたアカウント。検証者が旧システム側の記録などで残高を調査し、
            各アカウントの詳細画面から確認済み残高を入力して解消してください。
          </p>
          {reviewingAccounts.length === 0 ? (
            <p className="text-xs text-sengoku-muted">検証待ちのアカウントはありません</p>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="text-sengoku-muted">
                <tr>
                  <th className="pb-1">アカウントコード</th>
                  <th className="pb-1">メール</th>
                  <th className="pb-1">登録日</th>
                  <th className="pb-1"></th>
                </tr>
              </thead>
              <tbody>
                {reviewingAccounts.map((a) => (
                  <tr key={a.id} className="border-t border-sengoku-gold-soft/30">
                    <td className="py-1">{toDisplayCode(a.accountCode)}</td>
                    <td className="py-1">{a.primaryEmail ?? "-"}</td>
                    <td className="py-1">{new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
                    <td className="py-1">
                      <Link href={`/accounts/${a.id}`} className="text-sengoku-gold underline">
                        検証する
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </>  );
}
