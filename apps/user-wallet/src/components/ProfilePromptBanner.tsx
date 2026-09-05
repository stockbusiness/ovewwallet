"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, type AccountProfileResponse } from "@/lib/api";
import { promptMessage } from "@/lib/profile-labels";

/**
 * プロフィール入力をお願いする帯 (docs/account-profile.md)。
 *
 * 出すかどうかはサーバーが決める (`prompt.show`)。画面側で条件を持たないのは、
 * 管理画面で必須項目を変えたときに再ビルド無しで追随させるため。
 *
 * 読み込みに失敗しても**何も出さない**。ウォレットの本来の用途を邪魔しないため。
 */
export function ProfilePromptBanner() {
  const [data, setData] = useState<AccountProfileResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AccountProfileResponse>("/api/v1/accounts/me/profile")
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        /* 出せないだけ。エラーは見せない */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data?.prompt.show) return null;

  return (
    <Link
      href="/wallet/profile"
      className="flex items-center justify-between gap-3 rounded-xl border border-sengoku-gold/30 bg-sengoku-gold/10 px-4 py-3"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-sengoku-gold">
          {promptMessage(data.prompt.missingRequired)}
        </span>
        <span className="mt-0.5 block text-xs text-sengoku-muted">
          特典のご案内とお届けに使用します
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-sengoku-gold px-3 py-1.5 text-xs font-bold text-sengoku-ink">
        入力する
      </span>
    </Link>
  );
}
