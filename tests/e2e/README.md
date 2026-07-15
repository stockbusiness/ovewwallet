# Playwright E2E (リポジトリ内自動化)

これまで手動でしか行っていなかったブラウザ確認 (`docs/test-plan.md` の「手動E2E」セクション参照)
の一部を、繰り返し実行できるテストコードとして自動化したもの。

## 前提条件

他の自動テスト (`packages/auth`, `packages/ledger`, `apps/api`) と異なり、実際に3アプリを
起動してブラウザから操作するため、以下がすべて必要:

1. PostgreSQL・Redisが起動していること (`docker compose up -d` または同等の手段)。
2. `packages/database` のマイグレーションが `.env.test` の対象DBに適用済みであること
   (`pnpm db:migrate:test`)。
3. `apps/api`・`apps/user-wallet`・`apps/admin-wallet` が (開発サーバーとして、または
   ビルド済みの本番サーバーとして) `.env.test` の設定で起動していること。
   既に起動済みのサーバーがあればそれを再利用する (`playwright.config.ts` の
   `reuseExistingServer`)。起動していなければ `playwright test` が
   `pnpm --filter @ove/api start` 等を自動実行しようとするが、これは事前に
   `pnpm build` されたビルド成果物が必要 (CI向け)。

## 実行方法

```bash
# リポジトリルートから
pnpm test:e2e

# このディレクトリから直接
pnpm test
```

## ブラウザバイナリについて

この開発コンテナには特定リビジョンのChromiumが事前インストールされており
(`PLAYWRIGHT_BROWSERS_PATH`)、`@playwright/test` が期待するリビジョンと一致しないことがある
(`npx playwright install` でのダウンロードに頼れない実行環境向け)。その場合は
`OVE_E2E_CHROMIUM_PATH` 環境変数で実行ファイルパスを明示する:

```bash
OVE_E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test
```

未設定の場合は `@playwright/test` の通常のブラウザ解決 (CI等) にフォールバックする。

## 現在のテスト内容

| ファイル | 内容 |
|---|---|
| `specs/user-wallet.spec.ts` | LINEモックログイン → ウォレットホーム表示 → 取引履歴ページ (空状態) |
| `specs/admin-wallet.spec.ts` | 管理者ログイン → 個別付与 → 残高・取引一覧への反映確認 |

`support/seed.ts` はテストデータ投入用のヘルパー (`@ove/database`/`@ove/auth` を直接使い、
テストごとにユニークなアカウント/管理者を作成する。テスト同士が状態を共有しない)。

## 今後の拡張候補

このセッションで手動確認した以下のフローは、今回は自動化していない (今後の課題):

- 管理者MFAのセットアップ→ログイン
- アカウント統合の二段階承認 (2管理者セッション)
- 既存ユーザー移行の検証者フロー
- 外部連携キュー画面
- 戦国ウォレットデザインのレスポンシブ確認 (375/768/1280px)
