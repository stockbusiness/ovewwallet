# 実装記録 (これまでの作業ログ)

`docs/project-status.md` が「現時点の実装状況」を機能別に整理したスナップショットで
あるのに対し、このドキュメントは **時系列の作業記録** です。何を・なぜ・どの順番で
実装したかを追いたいときに参照してください。個別機能の詳細仕様は各 `docs/*.md` を
参照してください。

## フェーズ1: モノレポ基盤・コア機能

- pnpm workspaceでのモノレポ雛形作成 (`packages/*`, `apps/*`, tsconfig, docker-compose,
  `.env.example`)。
- `packages/config` (環境変数のZod検証)、`packages/shared-types` (共通enum・スキーマ)。
- `packages/database` (Prisma schema・マイグレーション)。
- `packages/ledger` (台帳コア: CREDIT/DEBIT/REVERSAL/HOLD/RELEASE、idempotencyキーに
  よる二重実行防止、行ロックによる同時更新対策、残高整合性チェック) + 単体/統合テスト。
- `packages/auth` (セッション・メールOTP・SSO・HMAC認証・TOTP等の暗号/認証ユーティリティ)。
- `apps/api` (NestJS)、`apps/user-wallet`・`apps/admin-wallet` (Next.js) の初期実装。
- README・AGENTS.md・`docs/*` 一式の作成、初回テスト実行・コミット・push。

## フェーズ2: 業務機能の拡張

- `reward_rules` の月間・上限enforcement追加。
- CSV一括付与のプレビュー機能。
- 外部サービス緊急停止機能 (APIキー即時無効化)。
- 既存ユーザー移行の実行機能 (`docs/migration.md`)。
- アカウント統合(マージ)機能。
- 二段階承認の基本ワークフロー (`ApprovalRequest`、申請者≠承認者の職務分離)。
- 管理画面: 取引一覧・取消専用画面、付与ルール管理画面、APIアクセスログ画面、
  アカウント詳細画面。

## フェーズ3: UI刷新 (戦国ウォレットデザインシステム)

- `packages/shared-ui` (デザイントークン + 共通UIコンポーネント8種) を新規作成。
- ログイン画面・ウォレットホーム画面・取引履歴一覧画面・取引詳細画面 (`apps/user-wallet`)、
  PC向け管理ダッシュボード (`apps/admin-wallet`) を新デザインで再実装。
- 375px/768px/1280pxでのレスポンシブ確認・スクリーンショット確認。

## フェーズ4: セキュリティ・コンプライアンス強化

- 利用規約同意の永続化 (`ove_accounts` に同意日時・バージョンを記録)。
- 管理画面MFA (RFC 6238準拠のTOTP二要素認証、外部ライブラリ非依存で自前実装)。
- 全セッション無効化機能 (不正利用時にアカウント単位で全端末を即座に失効)。
- Phase 1 (本番前セキュリティ): 本人向けAPI (`/me/wallet`等) と外部サービス向けAPIの
  分離、URLでOVEアカウントIDを受け取らずセッションから本人特定する方式へ変更。
  `NODE_ENV=production`かつ`AUTH_MODE`が`production`以外ならアプリ起動を失敗させる
  ガード (`assertAuthModeSafeForProduction`) を追加。
- Transactional Outbox (`integration_outbox`) + Feature Flag基盤 (すべて既定false)。
- `audit_logs`のDBトリガーによるDELETE/UPDATE禁止 (DBレベルの不変性)。
- 3アプリの本番用Dockerfile整備。
- `ENCRYPTION_KEY`ローテーション手順の文書化・CORS本番設定・レート制限見直し
  (この時点では手順書のみ、再暗号化スクリプト自体は後述フェーズ8で実装)。

## フェーズ5: 代理店システム (sengoku-ai.com) 連携

「戦国経済圏 代理店システム 外部連携API仕様書」v3.6.71を踏まえて実装 (詳細:
`docs/agency-integration.md`)。

- 二段階承認の対象拡張 (アカウント統合・オンチェーン移行等のtype追加)。
- 既存ユーザー移行の検証者フロー (実行者本人による解消の禁止)。
- 同期受信 (`POST /api/integrations/agencies`)、SSOログイン (`POST /api/v1/auth/sso/agency`、
  RS256 JWT + JWKS検証、`jti`再利用拒否)。
- 管理画面「代理店連携状態一覧」。

## フェーズ6: テスト自動化

- Playwright E2Eのリポジトリ内自動化 (`tests/e2e`): ユーザーのLINEログイン→ウォレット
  表示、管理者の個別付与→残高反映、アカウント統合の二段階承認、既存ユーザー移行の
  事前承認制・検証者フローを自動化。
- 負荷・レート制限の限界値テスト (`tests/load/run.mjs`)。実施により`GET /health`が
  通常のAPIトラフィックとレート制限を共有し高頻度ポーリングで誤って429を返す問題を
  発見・修正 (`@SkipThrottle()`追加)。

## フェーズ7: 代理店紹介トークン受け入れ (Phase 1)

「OVEウォレット代理店紹介連携機能実装指示書」v1.0と「紹介Cookie発行方式に関する
技術判断」を踏まえて実装 (詳細: `docs/agency-referral.md`)。

- `wallet_referrals`/`wallet_referral_benefits`テーブル追加。
- `/invite/{token}`受付 (APIドメインでのCookie発行、既存セッションCookieと同じ
  cross-domain構成上の理由)、LINEログイン時の紐付け、初回登録特典(3,000 OVE)の
  PENDING作成、代理店システムへの同期をoutboxへ登録。
- Playwright E2E追加 (紹介トークン受け入れ・外部連携キュー表示)。
- 決めるべき論点を非エンジニア向けにまとめた `docs/agency-referral-decisions.md` を作成。

## フェーズ8: バグチェック・実運用ギャップ対応 (2026-07-17)

ここまでの実装に対して、全体のバグチェックと「実運用に足りない機能」の洗い出しを行い、
見つかった問題を修正した。

### 8.1 コードレビューによるバグ修正 (8件)

`code-review`スキルによる8観点の並行レビュー (diff `45c77da..HEAD`) → 検証エージェント
による1票検証を経て、以下8件を修正:

1. 紹介Cookieの発行/削除オプションを一致させ、成功/失敗どちらでも確実に削除する
   (`finally`ブロック化)。
2. 移行実行の承認後、結果サマリ(成功/要確認/エラー件数)を承認画面に表示するよう変更。
3. 二段階承認の同時承認レース(TOCTOU)を条件付き更新(`updateMany`)で排除し、実行失敗時は
   PENDINGへ差し戻す。**回帰テスト追加** (2管理者が同時に承認 → 片方だけ成功)。
4. (1と同一の修正に統合)。
5. 紹介セッションの同時消費レースを条件付き更新で排除し、負けた側は紹介なしの通常登録
   として継続。**回帰テスト追加** (2つの同時登録が同じ紹介セッションを取り合う)。
6. 既存ユーザー移行のREVIEWING設定と監査ログ作成を単一トランザクションに統合
   (職務分離判定の前提となる監査ログの欠落を防止)。
7. `WalletReferral.agencyRank`フィールドを削除 (代理店ランクをウォレット側で永続管理
   しないという開発ガイドライン5.1/18章の方針に反していたため)。Prismaマイグレーション
   作成・適用、関連する管理画面・APIの参照箇所を全て除去。
8. `/invite/{token}`のリダイレクトに`Referrer-Policy: no-referrer`/`Cache-Control: no-store`
   ヘッダーを追加 (生の紹介トークンがRefererヘッダー経由で漏えいするのを防止)。

### 8.2 実運用ギャップの洗い出し

Explore agentによるコードベース横断調査で、実運用に足りない機能を8カテゴリで整理:
認証・外部連携/業務ワークフロー/運用・インフラ/コンプライアンス/デプロイ体制/負荷・
スケールテスト。優先度の高い3項目 (LINE本番連携・監視・DBバックアップ) から着手。

### 8.3 実運用ギャップの解消 (優先3項目)

- **LINE本番連携**: `LineIdTokenVerifier`を実装 (LINEの「IDトークン検証」API
  `POST https://api.line.me/oauth2/v2.1/verify`を使用、JWKSの自前検証は避ける方式)。
  `AUTH_MODE=production`かつ`LINE_CHANNEL_ID`設定時のみ使用し、それ以外は既存の
  `MockLineAuthVerifier`を使う (既存動作を破壊しない)。単体テスト6件で検証済みだが、
  実LINEチャネルでの結合テストは未実施 (LINE Developersのチャネル未発行のため)。
  戦国パスポートSSOの本番実装は、相手方API仕様が未確定のため見送り。
- **エラートラッキング (Sentry)**: `apps/api/src/common/sentry.ts`。`SENTRY_DSN`未設定
  時はno-op。想定外の例外(5xx)のみ`LedgerExceptionFilter`から送信。Sentryプロジェクト
  作成等の外部設定は別途必要 (`docs/monitoring.md`)。
- **DBバックアップ**: `scripts/backup-db.sh`/`scripts/restore-db.sh` (pg_dump/pg_restore
  ベース)。ローカルDBで実際にバックアップ→別DBへのリストアを行い、9テーブルの行数が
  完全一致することを確認済み (`docs/backup.md`)。

### 8.4 実運用ギャップの解消 (CI自動化・鍵ローテーション)

- **CI自動化**: `.github/workflows/ci.yml`。push(main)/PR時にPostgreSQL/Redisサービス
  コンテナを使って`migrate→build→lint→test`を自動実行。これまで手動デプロイ
  ワークフローしか無かった状態を解消。
- **テストの安定化**: `outbox.test.ts`が、他テストの残す未処理outboxイベントの蓄積で
  フレークする問題を発見・修正 (テスト開始時に全件クリア)。
- **ENCRYPTION_KEYローテーション**: `packages/database/src/rotate-encryption-key.ts`を
  実装 (これまで手順書のみで未実装だったメンテナンススクリプト)。管理者MFA・外部
  サービス署名鍵・紹介トークンの3カラムを対象に、旧鍵で全件復号→新鍵で再暗号化する。
  1件でも復号失敗があればDBを一切更新せず中断。DBの複製に対して実際に実行し、
  新鍵での復号成功・旧鍵拒否・失敗時の未更新まで確認済み。
- 見送った項目: Outbox自動再送(cron)は、宛先ハンドラ(`AGENCY_SYSTEM`向け実送信)自体が
  sengoku-ai.com側API仕様待ちで存在せず、cronだけ追加しても再試行の消費が早まるだけで
  実益が無いため保留。

## 未着手・今後の課題

`docs/project-status.md` 6章「未実装・今後の課題」および各機能ドキュメントの
「今後の課題」節を参照。特に:

- 代理店システムへの実際の同期送信 (Phase 2)、登録特典3,000 OVEの確定付与 (Phase 2)、
  管理者による手動確定・取消 (Phase 3)。
- 戦国パスポートSSOの本番実装 (相手方API仕様待ち)。
- LINE本番連携の実チャネルでの結合テスト。
- ステージング環境、コンプライアンス文書 (個人情報保護・データ保持ポリシー)、
  本番相当の負荷テストは業務判断・外部契約が絡むため未着手。
