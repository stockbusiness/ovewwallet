"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

const LINKS = [
  { href: "/dashboard", label: "ダッシュボード" },
  { href: "/accounts", label: "アカウント一覧" },
  { href: "/wallets", label: "ウォレット一覧" },
  { href: "/transactions", label: "取引一覧" },
  { href: "/bulk-grants", label: "CSV一括付与" },
  { href: "/service-integrations", label: "外部サービス管理" },
  { href: "/migrations", label: "既存ユーザー移行" },
  { href: "/approval-requests", label: "二段階承認" },
  { href: "/audit-logs", label: "操作ログ" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch("/api/v1/admin/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <nav className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div className="flex items-center gap-6">
        <span className="font-bold text-brand-700">OVE管理画面</span>
        <ul className="flex gap-4 text-sm">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={pathname?.startsWith(link.href) ? "font-semibold text-brand-600" : "text-neutral-600"}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <button onClick={logout} className="text-sm text-neutral-500 underline">
        ログアウト
      </button>
    </nav>
  );
}
