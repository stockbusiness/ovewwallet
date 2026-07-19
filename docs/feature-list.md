# 機能一覧

独立OVEウォレットで実装済みの機能を、領域ごとに一覧化したものです。時系列の経緯は
`docs/implementation-log.md`、現状の実装状況の解説は `docs/project-status.md`、
各機能の詳細仕様は該当する `docs/*.md` を参照してください。

状態ラベル (`docs/project-status.md`「0. 状態表記ルール」参照) を明記していない項目は
`IMPLEMENTED` (コード・テスト・画面/APIまで完成し動作確認済み) を意味します。それ以外の
状態 (`CONFIGURATION_REQUIRED`/`PARTIALLY_IMPLEMENTED`/`BUSINESS_DECISION_REQUIRED`等)
の項目のみ、明示的にラベルを付けています。

## 1. 台帳・ウォレット基盤

- OVEアカウント・ウォレットの自動作成
- 5種類の取引タイプ: CREDIT(付与) / DEBIT(利用) / REVERSAL(取消) / HOLD(保留) / RELEASE(保留解除)
- idempotencyキーによる二重実行防止 (同じキーでの再送は同一結果を返す)
- 行ロックによる同時更新対策 (残高のマイナス突入・二重付与を防止)
- 残高整合性チェック (ウォレット残高と取引履歴の突合)
- 取引の直接UPDATE/DELETEを一切行わない設計 (訂正は必ずREVERSALで記録として残す)
- 付与ルール管理 (`reward_rules`): ルールごとの月間上限・1回あたり上限
- CSV一括付与 (プレビュー→実行、同じCSVの再実行でも二重付与されない)
- 既存ユーザー移行 (旧システムのuser_id・残高をCSVで取り込み、残高不明時はREVIEWING状態に)
- アカウント統合(マージ) (統合元→統合先へ残高・連携情報を移管)
- OVE有効期限・自動失効 (付与ルール単位で設定可能、有効期限が近い順にFIFO消費、
  取消(REVERSAL)との整合性込み)

詳細: `docs/ledger-rules.md`, `docs/database.md`, `docs/migration.md`, `docs/credit-expiry.md`

## 2. 認証・ログイン

- メールワンタイムコード (6桁・有効期限10分・試行5回まで、本番相当で実装済み)
- LINEログイン (バックエンド`LineIdTokenVerifier`・フロントエンドLIFF SDK統合とも
  実チャネル(実LIFFアプリ・実LINEアカウント)でのログイン→ウォレット画面表示までの
  結合試験を完了。本番相当で動作確認済み。既定はモック実装、`AUTH_MODE=production`
  かつ`NEXT_PUBLIC_LINE_LIFF_ID`設定時のみ本番実装が使われる)
- 戦国パスポートSSO (モック実装、相手方API仕様待ちで本番連携は未着手) —
  **`BUSINESS_DECISION_REQUIRED`**
- 戦国経済圏代理店システム(sengoku-ai.com)SSOログイン (RS256 JWT + JWKS検証、本番相当)
- OVE独自セッション (HttpOnly Cookie、DBにはハッシュのみ保存)
- 利用規約同意の永続化 (新規登録時に必須化、バージョン・日時を記録)
- 管理者MFA (RFC 6238準拠のTOTP二要素認証、外部ライブラリ非依存の自前実装)
- 全セッション無効化 (不正利用時、管理者がアカウント単位で全端末のセッションを即時失効)
- モック認証の本番誤起動防止 (`NODE_ENV=production`時に`AUTH_MODE=production`の明示設定を必須化)

詳細: `docs/authentication.md`

## 3. ユーザー向けウォレットアプリ (`apps/user-wallet`, スマートフォン優先)

| 画面 | パス | 内容 |
|---|---|---|
| ログイン | `/login` | LINE / メール / 戦国パスポートIDの3方式 + 利用規約同意、ダーク/ライト切替 |
| ウォレットホーム | `/wallet` | 残高表示・クイックアクション・お知らせ (最新1件)・保留中残高の内訳 (`GET /api/v1/me/wallet/holds`、進行中の保留のみ理由・金額・保留日を表示)・累計獲得OVEに応じた階級表示 (`docs/wallet-rank.md`)・継続ログインボーナス (`docs/daily-login-bonus.md`) |
| 取引履歴一覧 | `/wallet/transactions` | 獲得/利用/失効フィルタ、CSVダウンロード (`docs/transaction-export.md`) |
| 取引詳細 | `/wallet/transactions/[transactionId]` | 個別取引の詳細 |
| メニュー | `/wallet/menu` | アカウント情報・残高サマリ・紹介登録特典状況 (紹介登録済みの場合のみ、`docs/referral-status.md`)・ログアウト・退会 (`docs/account-closure.md`) |
| 連携サービス | `/wallet/services` | 外部サービスとの連携状況一覧 (`GET /api/v1/me/linked-services`) |
| 貯める | `/wallet/earn` | OVEを貯める方法の一覧 (公開付与ルール、`GET /api/v1/rewards/public`) |
| 使う | `/wallet/use` | OVEを使える連携サービス一覧・残高表示 |
| お知らせ一覧 | `/wallet/notices` | 運営からのお知らせ全件 (`GET /api/v1/me/notices`) |
| ログイン中の端末 | `/wallet/devices` | 有効なセッション一覧・個別ログアウト (`docs/login-devices.md`) |
| 紹介リンク受付 | `/invite/[token]` | 代理店紹介URLの受付 (Cookie発行後ログインへリダイレクト) |
| 利用規約 | `/terms` | 規約本文 |
| このアプリについて | `/about` | サービス説明 |

「戦国ウォレット UIデザイン仕様 v1.0」(黒・濃紺・金・深紅) に基づくデザイン。
ダーク/ライト両テーマ対応 (CSS変数 + `ThemeToggle`)。375px幅で全画面確認済み、
うちログイン・ウォレットホーム・取引履歴一覧・取引詳細の4画面は768px/1280pxでも
確認済み。詳細: `docs/ui-design.md`

## 4. 管理画面 (`apps/admin-wallet`, PC向け)

| 画面 | パス | 内容 |
|---|---|---|
| 管理者ログイン | `/login` | メール+パスワード (MFA設定済みなら二要素認証を要求) |
| ダッシュボード | `/dashboard` | ウォレット数・発行済み残高・累計付与/利用・残高整合性チェック結果 |
| アカウント一覧・詳細 | `/accounts`, `/accounts/[accountId]` | 基本情報・連携ID・外部サービス連携・操作ログ・全セッション無効化・REVIEWING解消 |
| ウォレット一覧・詳細 | `/wallets`, `/wallets/[walletId]` | 残高・個別付与/減算/保留・保留解除・最近の取引 |
| 取引一覧 | `/transactions` | 全ウォレット横断の検索・取消 |
| CSV一括付与 | `/bulk-grants` | アップロード・プレビュー・実行・結果サマリ |
| 付与ルール管理 | `/reward-rules` | ルールの作成・状態切替・上限値調整 |
| 外部サービス管理 | `/service-integrations` | 一覧・緊急停止・再開 |
| 既存ユーザー移行 | `/migrations` | CSVアップロード・事前承認制での実行・結果サマリ・REVIEWINGアカウント一覧 |
| アカウント統合 | `/accounts/merge` | 統合元→統合先へ残高・連携情報を移管 |
| 二段階承認 | `/approval-requests` | 高額付与/減算・アカウント統合・移行実行の承認待ち一覧、承認/却下、履歴 (移行実行は結果サマリも表示) |
| 操作ログ | `/audit-logs` | 監査ログ一覧 (削除UIなし、DBレベルでも削除不可) |
| APIアクセスログ | `/api-access-logs` | 外部サービスAPIへのリクエスト履歴 (認証失敗含む)、ステータスコード絞り込み |
| セキュリティ設定 | `/security` | 自分自身のMFA設定・有効化・無効化 |
| 外部連携キュー | `/outbox` | Transactional Outboxの一覧・絞り込み・試行回数/エラー確認・手動再送 |
| 代理店連携状態一覧 | `/agency-links` | 代理店システムとの連携状態を一覧・絞り込み・詳細確認 |
| 代理店紹介一覧 | `/wallet-referrals` | 紹介トークン受け入れ状況・登録特典の状態を確認 (Phase 1: 確認のみ、手動確定/取消はPhase 3) |
| お知らせ管理 | `/notices` | ユーザー向けお知らせの作成 (通常/重要の重要度選択込み)・公開・アーカイブ (`GET/POST /api/v1/admin/notices`, `POST /api/v1/admin/notices/:id/archive`)。公開時にLINE Messaging APIへも配信 (`docs/notices-line-broadcast.md`、`LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`未設定時はスキップ)。既読管理は`docs/notices-read-tracking.md`参照 |

詳細: `docs/admin-operations.md`

## 5. 外部サービスAPI連携基盤

戦国パスポート/AIアート教室など、任意の外部サービスと連携するための共通基盤。新しい
連携先は`service_integrations`に1行追加するだけで同じ仕組みに乗せられる。

- APIキー・署名シークレット・1日あたり/1リクエストあたりの上限をサービスごとに管理
- HMAC-SHA256署名 + タイムスタンプ + nonceによるリプレイ防止
- 主要エンドポイント: ポイント付与・利用・取消・残高照会・取引履歴照会
- 連携先の緊急停止・再開機能 (即座にAPIキーを無効化)
- APIアクセスログ (成功・認証失敗の両方を記録)
- Transactional Outbox (`integration_outbox`): 業務トランザクションと同一トランザクションで
  外部連携イベントを登録し、送信は指数バックオフ付きで再試行 (最大8回)。宛先ハンドラは
  後から差し込み可能な設計 (現時点で実際に登録されているハンドラは無く、管理画面からの
  手動ディスパッチのみ)
- Feature Flag基盤 (7種、すべて既定false。OFFのままで既存機能に影響しないことを確認済み)
- AIアート教室連携: `AIART`サービスコード・`AIART_ATTENDANCE_REWARD`付与ルール
  (開催回単位の重複防止`perEventLimit`込み)は上記共通基盤の上に登録済みで技術的には
  呼び出し可能。ただし出席状態の確認・付与金額の`reward_rules`照合などアート教室固有の
  業務フローは未実装。**状態: `PARTIALLY_IMPLEMENTED`** (実装計画:
  `docs/integration/AIART_REWARD_INTEGRATION_PLAN.md`)

詳細: `docs/external-api.md`, `docs/integration-outbox.md`

## 6. 代理店システム (sengoku-ai.com) 連携

- 同期受信 (`POST /api/integrations/agencies`): 代理店情報の受け取り、未紐付け時は
  `PENDING`で保留
- SSOログイン (`POST /api/v1/auth/sso/agency`): RS256 JWT + JWKS検証、jti再利用拒否
- 管理画面「代理店連携状態一覧」

**状態: `IMPLEMENTED`**。範囲外 (未着手): OVE Wallet→sengoku-ai.comへの同期送信、
同期失敗の自動再送。

詳細: `docs/agency-integration.md`

## 7. 代理店紹介トークン受け入れ (Phase 1)

- `/invite/{token}`受付 (APIドメインでのCookie発行、Referrer-Policy/Cache-Control
  ヘッダーによるトークン漏えい対策)
- LINEログイン時の紐付け (紹介セッションの同時消費レース対策込み)
- 初回登録特典 (3,000 OVE) のPENDING作成
- 代理店システムへの同期をoutboxへ登録 (実送信はPhase 2で未着手)
- 管理画面での確認 (`/wallet-referrals`)

**状態: `PARTIALLY_IMPLEMENTED`** (Phase 1のみ完了、Phase 2の実送信先契約は
`BUSINESS_DECISION_REQUIRED`)。範囲外 (未着手): 代理店システムへの実際の同期送信・
特典確定(Phase 2)、管理者による手動確定・取消・紹介者訂正(Phase 3)。実装計画:
`docs/integration/AGENCY_REFERRAL_PHASE2_PLAN.md`

詳細: `docs/agency-referral.md`

## 8. セキュリティ機能

- 入力値検証 (Zod)・SQLインジェクション対策 (Prisma)・XSS対策・CSRF対策
- ブルートフォース対策・レート制限 (ログイン系エンドポイントは特に厳しい制限)
- 監査ログのDBレベル不変性 (DBトリガーでDELETE/UPDATEを常に拒否)
- 高額操作の二段階承認 (申請者と承認者の職務分離、同時承認レース対策込み)
- 管理者MFA・全セッション無効化
- 本人向けAPIはURLでアカウントIDを受け取らずセッションから本人特定 (推測URLでの
  他人の情報参照を防止)
- ENCRYPTION_KEYローテーションスクリプト (`packages/database/src/rotate-encryption-key.ts`)

詳細: `docs/security.md`

## 9. 運用・インフラ機能

- 3アプリ (`api`/`user-wallet`/`admin-wallet`) の本番用Dockerfile
- エラートラッキング (Sentry、`SENTRY_DSN`未設定時はno-op)
- ヘルスチェック (`GET /health`、レート制限を共有しないよう分離済み)
- DBバックアップ/リストアスクリプト (`scripts/backup-db.sh`/`restore-db.sh`)
- push/PR時のCI自動化 (`.github/workflows/ci.yml`: migrate→build→lint→test)
- Railway (API) + Vercel (フロントエンド2アプリ) への動作確認用デプロイ手順

詳細: `docs/deployment.md`, `docs/monitoring.md`, `docs/backup.md`

## 10. テスト・品質保証

- apps/api: jest e2eテスト 87件 (実DB・実Redisに対する統合テスト)
- packages/auth: vitest 37件、packages/ledger: vitest 21件
- Playwright E2E (実ブラウザ): 7フロー (ユーザーログイン、個別付与、アカウント統合の
  二段階承認、既存ユーザー移行の事前承認制、外部連携キュー、代理店紹介トークン受け入れ、
  管理者MFA)
- 負荷・レート制限の限界値テスト (`tests/load/run.mjs`)
- コードレビュー(8観点並行レビュー)による不具合検出・修正の実施記録あり
  (`docs/implementation-log.md` フェーズ8参照)

詳細: `docs/test-plan.md`
