"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, ApiError, API_BASE_URL } from "@/lib/api";
import type { CurrentLiability, RollForwardPeriod } from "@/lib/point-liability";
import { LiabilitySummary } from "@/components/reports/LiabilitySummary";
import { RollForwardTable } from "@/components/reports/RollForwardTable";

const MONTH_OPTIONS = [6, 12, 24, 36];

export default function PointLiabilityPage() {
  const router = useRouter();
  const [current, setCurrent] = useState<CurrentLiability | null>(null);
  const [rows, setRows] = useState<RollForwardPeriod[]>([]);
  const [months, setMonths] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [liability, rollForward] = await Promise.all([
          apiFetch<CurrentLiability>("/api/v1/admin/reports/point-liability"),
          apiFetch<RollForwardPeriod[]>(`/api/v1/admin/reports/point-liability/roll-forward?months=${months}`),
        ]);
        if (cancelled) return;
        setCurrent(liability);
        setRows(rollForward);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(
          err instanceof ApiError && err.status === 403
            ? "このレポートを閲覧する権限がありません (SUPER_ADMIN または AUDITOR のみ)"
            : "読み込みに失敗しました",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, months]);

  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold">ポイント負債レポート</h1>
        <a
          href={`${API_BASE_URL}/api/v1/admin/reports/point-liability/roll-forward/export?months=${months}`}
          className="rounded-md border border-sengoku-border px-4 py-1.5 text-sm text-sengoku-text"
        >
          増減表をCSVで取得
        </a>
      </div>
      <p className="mb-6 text-sm text-sengoku-muted">
        発行済みで未使用のORI残高。保留中の分も利用者への債務が残っているため含みます。
      </p>

      {error && <p className="mb-4 text-sm text-sengoku-red">{error}</p>}
      {loading && !current && <p className="text-sm text-sengoku-muted">読み込み中...</p>}

      {current && <LiabilitySummary liability={current} />}

      <div className="mb-3 mt-8 flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold">月次増減表</h2>
        <label className="flex items-center gap-2 text-sm text-sengoku-muted">
          表示期間:
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="rounded-md border border-sengoku-border px-2 py-1 text-sm"
          >
            {MONTH_OPTIONS.map((m) => (
              <option key={m} value={m}>
                過去{m}か月
              </option>
            ))}
          </select>
        </label>
      </div>
      <RollForwardTable rows={rows} />
    </>
  );
}
