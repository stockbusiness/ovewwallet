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

## フェーズ9: UI刷新v2・ライトモード・未実装4画面・お知らせ機能・不具合修正 (2026-07-19)

「戦国ウォレット UIデザイン仕様 v1.0」への完全準拠を目指した2回目のUI刷新と、
それ以降にユーザーから報告された不具合の修正、および未実装のまま「準備中」
トースト止まりだった4画面の実装を行った。

### 9.1 UI刷新v2 (仕様書完全準拠版)

- ログイン画面にCastleHero(自作SVGの山並み演出)・AuthButton(認証方式ごとの
  配色・アイコン出し分け)を追加。
- `TransactionItem`/`StatusBadge`を「獲得=緑・利用=赤」の色分けに変更
  (`sengoku-green`トークン新設)。
- `AppHeader`/`ActionGrid`/`InfoCard`コンポーネントを新規作成し、ウォレットホームを
  再構築。`BalanceCard`に金枠グロー・城シルエット装飾を追加。
- 375px/768px/1280pxでレスポンシブ再確認・スクリーンショット確認。

### 9.2 ライトモード追加

- CSS変数 (`globals.css`の`:root`/`[data-theme="light"]`) + `data-theme`属性による
  切り替え方式を採用。Tailwind側は`rgb(var(--sengoku-x) / <alpha-value>)`方式で
  参照するため、透過度モディファイア (`bg-sengoku-gold/10`等) も両テーマで機能する。
- `packages/shared-ui/src/theme.ts` (`applyTheme()`/`getCurrentTheme()`/
  `THEME_INIT_SCRIPT`) と `ThemeToggle`コンポーネントを新規作成。
  `THEME_INIT_SCRIPT`は`layout.tsx`の`<head>`に同期実行スクリプトとして埋め込み、
  ハイドレーション前に属性を確定させてFOUCを防止。
- ログイン画面・ウォレットホーム・管理ダッシュボードに`ThemeToggle`を設置。
- 詳細: `docs/ui-design.md`「ダーク/ライトテーマ」。

### 9.3 不具合修正: 未実装メニューの無反応

`ActionGrid`/`BottomNavigation`の未実装項目 (`href`なし) が非活性な`<div>`扱いで
タップしても無反応だった問題を、タップ時に「準備中」トーストを表示する方式に修正
(ユーザー報告「メニューなどクリックしても反応しない」への対応)。

### 9.4 未実装4画面の実装

計画に基づき、それまで「準備中」トースト止まりだった4画面を実装:

- `GET /api/v1/me/linked-services` / `GET /api/v1/rewards/public` を新設。
- `/wallet/menu` (アカウント情報・残高サマリ・ログアウト)、`/wallet/services`
  (連携サービス一覧)、`/wallet/earn` (貯める方法一覧)、`/wallet/use`
  (使えるサービス一覧・残高表示) を実装。

### 9.5 不具合修正: 「読み込み中」固まり (エラーハンドリング統一)

多くの画面のエラーハンドリングが`err.status === 401`のみを処理し、それ以外の
エラー (5xx・ネットワークエラー等) では何もせず`null`のまま放置していたため、
「読み込み中」表示のまま画面が固まる (一覧画面では空リストのまま無言で表示される)
問題を発見。新設4画面・取引履歴一覧・管理ダッシュボードおよび管理画面12画面
(`agency-links`/`wallets`/`wallets/[walletId]`/`audit-logs`/`api-access-logs`/
`approval-requests`/`reward-rules`/`outbox`/`service-integrations`/`accounts`/
`accounts/[accountId]`/`security`) に、エラー状態の保持・表示を追加して修正。

### 9.6 お知らせ機能

- `Notice`モデル・`NoticeStatus`enumを追加 (Prismaマイグレーション)。
- 管理画面 `/notices`: お知らせの作成・公開・アーカイブ。
- `GET /api/v1/me/notices`: ウォレットホーム (最新1件をInfoCardに表示、
  詳細不明時のためお知らせ取得は本体データ取得と別のtry/catchに分離し、失敗しても
  ホーム画面自体は表示する設計) / `/wallet/notices` (全件一覧) から利用。

### 9.7 不具合修正: ログアウト後の再ログインで「unexpected error」

ユーザー報告 (ログアウトして再ログインすると遷移しなくなる、「unexpected error」表示)
を、デバッグログのタイムスタンプと画面表示時刻の照合により、iOSのLIFF pageshow
リロード対策で保存済みIDトークンを複数回再送する構成上、期限切れトークンでの
再送が発生していることを特定。根本原因は`LineIdTokenVerifier.verifyIdToken()`
(および`SengokuSsoService.exchangeCode()`・`AgencySsoVerifier.verify()`) が
検証失敗時に素の`Error`を投げ、呼び出し元で捕捉されないまま`ledger-exception.filter.ts`
の汎用500フォールバックに落ちていたこと (本番投入前から存在していた既存バグ)。
`auth.service.ts`に3つのラッパーメソッド (`verifyLineIdToken`/
`exchangeSengokuSsoCode`/`verifyAgencySso`) を追加し、検証失敗を`UnauthorizedException`
として401で返すよう修正。ユーザー確認済み (「ログインできました」)。

## フェーズ10: 追加機能10件の実装 (2026-07-19)

ユーザーからの機能ブレインストーム依頼に対して提案した10個のアイデアを、優先度順に
1件ずつ実装・テスト・コミットした。実装順に:

1. **OVE有効期限・自動失効バッチ** (`docs/credit-expiry.md`): `reward_rules.expiry_days`
   でルール単位に有効期限を設定可能にし、`ove_credit_lots`テーブルでロット単位の
   残額をFIFO消費 (有効期限が近い順)。管理画面から失効バッチを手動実行できる
   `POST /api/v1/admin/expire-credits`を追加。
2. **お知らせのLINE配信連携** (`docs/notices-line-broadcast.md`): お知らせ公開時に
   LINE Messaging APIのbroadcastで同じ内容を配信する`LineBroadcastService`を追加。
   `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`未設定時はno-op。
3. **お知らせの既読管理・重要度フラグ** (`docs/notices-read-tracking.md`):
   `Notice.importance` (NORMAL/IMPORTANT) と`NoticeRead`テーブル (アカウント単位の
   既読状態) を追加。
4. **保留中残高の内訳表示** (`docs/ledger-rules.md`, 新規ドキュメント無し):
   `wallets.pending_balance`が未使用フィールドだったことを確認したため、実際に
   意味を持つ`WalletHold`を対象に`GET /api/v1/me/wallet/holds`を新設。
5. **紹介登録特典状況の確認** (`docs/referral-status.md`): このシステムの「紹介」が
   代理店発行の紹介URL経由の新規登録であり、ユーザー間の紹介ではないことを踏まえ、
   `GET /api/v1/me/referral-status`で自分の登録特典状況のみを確認できるようにした。
6. **累計獲得OVEに応じたランク/称号表示** (`docs/wallet-rank.md`): 既存の
   `lifetime_credited`を戦国ブランドの階級名 (足軽→侍→武将→大名→天下人) に変換する
   純粋な表示機能。新しいAPI・DBテーブルは追加していない。
7. **継続ログイン/デイリーボーナス** (`docs/daily-login-bonus.md`):
   `DailyBonusClaim`テーブルで1アカウント・1暦日1回の請求を管理し、7日サイクルの
   固定スケジュールでOVEを付与する。
8. **ユーザー向けログインデバイス一覧** (`docs/login-devices.md`):
   `user_sessions.ip_address`/`user_agent`が未使用フィールドだったため、ログイン時に
   実際に記録するようにし、`GET/POST /api/v1/accounts/me/sessions`で本人が自分の
   ログイン中端末を確認・個別ログアウトできるようにした。
9. **ユーザー向け退会/アカウント削除フロー** (`docs/account-closure.md`):
   `OveAccount.status`の`CLOSED`と`closedAt`も未使用フィールドだったため、
   `POST /api/v1/accounts/me/close`で実際に使うようにした。残高0が条件、退会後は
   同一identityでの再ログインも拒否する。
10. **自分の取引履歴CSVエクスポート** (`docs/transaction-export.md`):
    `GET /api/v1/me/transactions/export`でUTF-8 BOM付きCSVをダウンロードできる
    ようにした。

10機能すべてにe2eテストを追加し (計23件)、既存の125件 (ledger 21 + auth 37 + API旧91)
と合わせて計174件が引き続き全てグリーンであることを確認済み。「未使用フィールドの
発見→実際に使う機能を実装する」というパターンが3回 (pending_balance→held_balance
ベースの保留内訳、user_sessions.ip_address/user_agent→ログインデバイス一覧、
OveAccount.status=CLOSED→退会機能) 続けて発生しており、実装済みのスキーマと
実際に配線されている機能の間にギャップがあったことが今回の作業で明らかになった。

### 追記: 実ブラウザ確認 (2026-07-19)

e2eテストはAPI層のみを検証しており、クライアント側の楽観的更新の整合性までは
見ていなかったため、10機能について改めてPlaywrightによる実ブラウザ確認を実施した
(22件のチェック、全て合格)。この過程で、e2eテストでは検出できなかった実際の不具合を
1件発見・修正した: 継続ログインボーナス受け取り時、`wallet/page.tsx`の
`claimDailyBonus()`が残高の楽観的更新で`available_balance`のみ更新し
`lifetime_credited`を更新していなかったため、ランク表示 (`docs/wallet-rank.md`)
が古い累計獲得量のまま止まって見えていた。各機能ドキュメントの「動作確認」節に
確認内容を追記済み。なお、紹介登録の実際の捕捉フロー (`ENABLE_WALLET_REFERRAL_TOKEN`
が必要) と複数端末を同時に並べてのログインデバイス一覧確認は、今回の手動確認の
範囲外 (今後の課題)。この環境ではDockerデーモンが起動できない制約
(`ulimit`権限エラー) が継続しているため、確認は`node`直接実行によるローカル起動で
行った。

## 未着手・今後の課題

`docs/project-status.md` 6章「未実装・今後の課題」および各機能ドキュメントの
「今後の課題」節を参照。特に:

- 代理店システムへの実際の同期送信 (Phase 2)、登録特典3,000 OVEの確定付与 (Phase 2)、
  管理者による手動確定・取消 (Phase 3)。
- 戦国パスポートSSOの本番実装 (相手方API仕様待ち)。
- LINE本番連携の実チャネルでの結合テスト。
- ステージング環境、コンプライアンス文書 (個人情報保護・データ保持ポリシー)、
  本番相当の負荷テストは業務判断・外部契約が絡むため未着手。
- 後発5画面 (メニュー・連携サービス・貯める・使う・お知らせ一覧) の768px/1280px
  確認、管理画面「お知らせ管理」の1280px確認 (`docs/ui-design.md`「レスポンシブ確認」参照)。
