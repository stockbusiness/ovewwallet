"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type StepState = "done" | "todo" | "blocked" | "info";

const STATE_LABEL: Record<StepState, string> = {
  done: "完了",
  todo: "未完了",
  blocked: "エンジニア作業",
  info: "確認のみ",
};

const STATE_CLASS: Record<StepState, string> = {
  done: "bg-sengoku-green/15 text-sengoku-green",
  todo: "bg-sengoku-gold-soft/15 text-sengoku-gold-soft",
  blocked: "bg-sengoku-faint/15 text-sengoku-faint",
  info: "bg-sengoku-faint/15 text-sengoku-faint",
};

/**
 * セットアップ手順の1ステップ。番号・状態・やること・移動先を1行で示す。
 *
 * 設定が「共通顧客HUB送信設定」「外部サービス管理」「Feature Flag(環境変数)」に
 * 分かれていて、どこまで済んだか分からないという運用からの指摘への対応。
 * 操作そのものは各既存画面 (監査ログを残す実装) へ誘導し、ここでは行わない。
 */
export default function AgencySetupStep({
  number,
  title,
  state,
  children,
  href,
  linkLabel,
}: {
  number: number;
  title: string;
  state: StepState;
  children: ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <li className="rounded-lg border border-sengoku-line bg-sengoku-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sengoku-line text-sm">
          {number}
        </span>
        <h3 className="font-semibold">{title}</h3>
        <span className={`rounded px-2 py-0.5 text-xs ${STATE_CLASS[state]}`}>{STATE_LABEL[state]}</span>
      </div>

      <div className="mt-2 pl-10 text-sm text-sengoku-faint">{children}</div>

      {href ? (
        <div className="mt-3 pl-10">
          <Link href={href} className="text-sm text-sengoku-gold-soft underline underline-offset-4">
            {linkLabel ?? "この設定画面を開く"}
          </Link>
        </div>
      ) : null}
    </li>
  );
}
