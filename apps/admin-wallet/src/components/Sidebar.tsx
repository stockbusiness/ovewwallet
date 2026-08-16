"use client";

import { ThemeToggle } from "@ove/shared-ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
      { href: "/service-integrations", label: "外部サービス管理" },
      { href: "/common-event-signing-keys", label: "共通イベント Signing Key" },
      { href: "/common-user-hub-config", label: "共通顧客HUB送信設定" },
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
    title: "ログ・監査",
    links: [
      { href: "/audit-logs", label: "操作ログ" },
      { href: "/api-access-logs", label: "APIアクセスログ" },
      { href: "/outbox", label: "外部連携キュー" },
    ],
  },
  {
    title: "設定",
    links: [{ href: "/security", label: "セキュリティ設定" }],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch("/api/v1/admin/logout", { method: "POST" });
    router.push("/login");
  }

  function isActive(href: string): boolean {
    return pathname === href || (href !== "/dashboard" && (pathname?.startsWith(`${href}/`) ?? false));
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-sengoku-border bg-sengoku-navy-deep">
      <div className="border-b border-sengoku-border px-4 py-4">
        <span className="font-heading text-sm font-bold text-sengoku-gold">千ノ国ウォレット</span>
        <p className="text-xs text-sengoku-faint">管理画面</p>
      </div>

      <nav className="flex-1 px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-sengoku-faint">
              {group.title}
            </p>
            <ul>
              {group.links.map((link) => {
                const active = isActive(link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={
                        active
                          ? "block rounded-md bg-sengoku-gold/15 px-2 py-1.5 text-sm font-semibold text-sengoku-gold"
                          : "block rounded-md px-2 py-1.5 text-sm text-sengoku-muted hover:bg-sengoku-navy hover:text-sengoku-text"
                      }
                    >
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
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
