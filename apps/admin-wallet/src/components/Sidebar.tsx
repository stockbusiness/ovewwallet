"use client";

import { ThemeToggle } from "@ove/shared-ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface NavLink {
  href: string;
  label: string;
}

interface NavGroup {
  title: string;
  links: NavLink[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "概要",
    links: [{ href: "/dashboard", label: "ダッシュボード" }],
  },
  {
    title: "アカウント・取引",
    links: [
      { href: "/accounts", label: "アカウント一覧" },
      { href: "/wallets", label: "ウォレット一覧" },
      { href: "/transactions", label: "取引一覧" },
      { href: "/bulk-grants", label: "CSV一括付与" },
      { href: "/profile-config", label: "お客様情報の入力設定" },
      { href: "/email-domains", label: "メールドメイン設定" },
      { href: "/legal", label: "規約・ポリシー・会社情報" },
    ],
  },
  {
    title: "付与・お知らせ",
    links: [
      { href: "/reward-rules", label: "付与ルール管理" },
      { href: "/notices", label: "お知らせ管理" },
    ],
  },
  {
    title: "NFTコレクション",
    links: [
      { href: "/collectible-cards", label: "カードマスター管理" },
      { href: "/collectible-holdings", label: "カード保有一覧" },
    ],
  },
  {
    title: "外部連携",
    links: [
      { href: "/agency-setup", label: "代理店連携セットアップ" },
      { href: "/service-integrations", label: "外部サービス管理" },
      { href: "/common-event-signing-keys", label: "共通イベント Signing Key" },
      { href: "/common-user-hub-config", label: "共通顧客HUB送信設定" },
      { href: "/mail-config", label: "メール送信設定" },
      { href: "/agency-links", label: "代理店連携状態" },
      { href: "/wallet-referrals", label: "紹介トークン受け入れ" },
    ],
  },
  {
    title: "移行・承認",
    links: [
      { href: "/migrations", label: "既存ユーザー移行" },
      { href: "/approval-requests", label: "二段階承認" },
    ],
  },
  {
    title: "会計・レポート",
    links: [{ href: "/reports/point-liability", label: "ポイント負債レポート" }],
  },
  {
    title: "ログ・監査",
    links: [
      { href: "/audit-logs", label: "操作ログ" },
      { href: "/api-access-logs", label: "APIアクセスログ" },
      { href: "/outbox", label: "外部連携キュー" },
    ],
  },
  {
    title: "設定",
    links: [
      { href: "/security", label: "セキュリティ設定" },
      { href: "/admins", label: "管理者アカウント" },
    ],
  },
];

const COLLAPSE_STORAGE_KEY = "ove-admin-sidebar-collapsed-groups";

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
    >
      <path d="M7 5l6 5-6 5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string): boolean {
    return pathname === href || (href !== "/dashboard" && (pathname?.startsWith(`${href}/`) ?? false));
  }

  const activeGroupTitle = NAV_GROUPS.find((group) => group.links.some((link) => isActive(link.href)))?.title;

  // 初期状態: 現在地を含むグループだけ開く。localStorageに保存された折りたたみ状態があればそれを尊重する。
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      // localStorage未対応・壊れたJSON等は無視してデフォルト挙動にフォールバックする。
    }
    return new Set(NAV_GROUPS.filter((g) => g.title !== activeGroupTitle).map((g) => g.title));
  });

  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(collapsed)));
  }, [collapsed]);

  function toggleGroup(title: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  async function logout() {
    await apiFetch("/api/v1/admin/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-sengoku-border bg-sengoku-navy-deep">
      <div className="border-b border-sengoku-border px-4 py-4">
        <span className="font-heading text-sm font-bold text-sengoku-gold">千ノ国ウォレット</span>
        <p className="text-xs text-sengoku-faint">管理画面</p>
      </div>

      <nav className="flex-1 px-2 py-3">
        {NAV_GROUPS.map((group) => {
          const expanded = !collapsed.has(group.title);
          return (
            <div key={group.title} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.title)}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sengoku-faint hover:text-sengoku-muted"
              >
                <ChevronIcon expanded={expanded} />
                {group.title}
              </button>
              {expanded && (
                <ul className="mb-2">
                  {group.links.map((link) => {
                    const active = isActive(link.href);
                    return (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className={
                            active
                              ? "block rounded-md bg-sengoku-gold/15 px-2 py-1.5 pl-6 text-sm font-semibold text-sengoku-gold"
                              : "block rounded-md px-2 py-1.5 pl-6 text-sm text-sengoku-muted hover:bg-sengoku-navy hover:text-sengoku-text"
                          }
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center justify-between border-t border-sengoku-border px-3 py-3">
        <ThemeToggle />
        <button onClick={logout} className="text-xs text-sengoku-muted underline hover:text-sengoku-text">
          ログアウト
        </button>
      </div>
    </aside>
  );
}
