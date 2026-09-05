import type { ImageStorageConfig } from "@/lib/api";

/**
 * カード画像の保管先の現在の状態 (docs/collectible-images.md)。
 * 設定フォームとは別に切り出している (ページ側の見通しを保つため)。
 */
export default function ImageStorageStatus({ config }: { config: ImageStorageConfig }) {
  return (
    <section className="mb-6 rounded border border-sengoku-border p-4 text-sm">
      <h2 className="mb-2 text-sm font-semibold">現在の状態</h2>
      <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-xs">
        <dt className="text-sengoku-muted">取り込み</dt>
        <dd className={config.configured ? "text-green-400" : "text-yellow-400"}>
          {config.configured ? "有効" : "無効 (設定が揃っていません)"}
        </dd>

        <dt className="text-sengoku-muted">シークレット</dt>
        <dd>
          {config.secretAccessKeySet ? (config.secretAccessKeyPreview ?? "設定済み") : "未設定"}
        </dd>

        {config.fallbackFromEnv && (
          <>
            <dt className="text-sengoku-muted">補足</dt>
            <dd className="text-sengoku-muted">
              この画面では未設定ですが、環境変数の値で動いています。
            </dd>
          </>
        )}

        <dt className="text-sengoku-muted">最終更新</dt>
        <dd className="text-sengoku-muted">
          {config.updatedAt ? new Date(config.updatedAt).toLocaleString("ja-JP") : "-"}
        </dd>
      </dl>
    </section>
  );
}
