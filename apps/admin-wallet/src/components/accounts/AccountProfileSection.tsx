import type { AccountDetailItem } from "@/lib/api";

/**
 * アカウント詳細の「お客様情報」欄 (docs/account-profile.md)。
 *
 * LINE登録のアカウントは表示名が空のままなので (IDトークンから取れるのは
 * lineUserIdとemailだけ)、ここが「誰なのか」を知る唯一の手がかりになることが多い。
 *
 * 未入力・本人が断った・入力済みの3つを区別して出す。断ったことはセグメントとして
 * 意味を持つため、単に「未入力」と同じ見た目にしない。
 */
export default function AccountProfileSection({ profile }: { profile: AccountDetailItem["profile"] }) {
  const address = profile
    ? [profile.prefecture, profile.city, profile.addressLine, profile.building].filter(Boolean).join(" ")
    : "";

  return (
    <section className="mb-6 rounded-lg border border-sengoku-border bg-sengoku-navy p-4">
      <h2 className="mb-3 text-sm font-semibold">お客様情報</h2>
      {!profile && <p className="text-xs text-sengoku-faint">未入力です</p>}
      {profile?.declinedAt && (
        <p className="mb-2 text-xs text-sengoku-gold-soft">
          本人が「入力しない」を選択 ({new Date(profile.declinedAt).toLocaleString("ja-JP")})
        </p>
      )}
      {profile && (
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-xs">
          <dt className="text-sengoku-muted">お名前</dt>
          <dd>{profile.fullName ?? "-"}</dd>
          <dt className="text-sengoku-muted">お名前 (カナ)</dt>
          <dd>{profile.fullNameKana ?? "-"}</dd>
          <dt className="text-sengoku-muted">電話番号</dt>
          <dd>{profile.phone ?? "-"}</dd>
          <dt className="text-sengoku-muted">郵便番号</dt>
          <dd>{profile.postalCode ?? "-"}</dd>
          <dt className="text-sengoku-muted">住所</dt>
          <dd>{address || "-"}</dd>
          <dt className="text-sengoku-muted">最終更新</dt>
          <dd>{new Date(profile.updatedAt).toLocaleString("ja-JP")}</dd>
        </dl>
      )}
    </section>
  );
}
