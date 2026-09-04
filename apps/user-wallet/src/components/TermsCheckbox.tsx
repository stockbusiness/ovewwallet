import Link from "next/link";

/**
 * 利用規約への同意チェックボックス。ログイン画面と代理店SSO受信画面が共有する
 * (どちらも「新規アカウント作成には同意が必要」という同じ制約を持つため、
 * 文言がずれないよう1箇所にまとめる)。
 */
export function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 text-xs leading-relaxed text-sengoku-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-sengoku-gold"
      />
      <span>
        <Link href="/terms" target="_blank" className="text-sengoku-gold underline underline-offset-2">
          利用規約
        </Link>
        に同意する (初めてご利用の方は同意が必要です)
      </span>
    </label>
  );
}
