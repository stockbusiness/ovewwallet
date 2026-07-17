# 独立OVEウォレット 実装状況整理 (2026-07-17時点)

このドキュメントは、現時点までに実装が完了している機能・未着手の機能・今後の連携方針を
1枚で把握できるように整理したものです。個別の詳細仕様は各 `docs/*.md` を参照してください。
時系列の作業記録 (何をいつ・なぜ実装したか) は `docs/implementation-log.md` を参照してください。

## 1. 全体構成

```
apps/
  api/            NestJS製REST API (ユーザー向け・外部サービス向け・管理者向けを統合)
  user-wallet/    ユーザー向けNext.jsアプリ (スマートフォン優先, 戦国ウォレットデザイン)
  admin-wallet/   管理者向けNext.jsアプリ (PC向け)
packages/
  database/       Prisma schema・マイグレーション
  ledger/         台帳コア (CREDIT/DEBIT/REVERSAL/HOLD/RELEASE・整合性チェック)
  auth/           セッション・OTP・SSO・HMAC認証・TOTP等の暗号/認証ユーティリティ
  shared-types/   共通enum・Zodスキーマ
  shared-ui/      戦国ウォレットデザインシステム (共通UIコンポーネント)
  config/         環境変数検証
```

PostgreSQL 16 + Redis (KVストア、未設定時はインメモリへフォールバック) を使用。
DBスキーマ・API・管理画面・ユーザー画面のすべてに対して、実DBに対する自動テスト
(現時点で API 73件 + `packages/auth` 31件 + `packages/ledger` 21件 = 計125件、すべて成功)
と、実ブラウザ (Playwright) での動作確認を行っています。

Railway (API) + Vercel (`user-wallet`/`admin-wallet`、Vercelダッシュボードの
Git連携デプロイ) への動作確認用デプロイも完了し、実際にブラウザから表示・操作できる
ことを確認済みです (詳細・制約は `docs/deployment.md` 「このデプロイの制約」参照)。

## 2. 実装済み機能

### 2.1 台帳・ウォレット基盤
- OVEアカウント・ウォレットの自動作成、CREDIT/DEBIT/REVERSAL/HOLD/RELEASEの5種類の
  取引タイプ、idempotencyキーによる二重実行防止、行ロックによる並行更新の安全性。
- 残高整合性チェック (`GET /api/v1/admin/reconciliation`)。
- 取引の直接UPDATE/DELETEを一切行わない設計 (訂正は必ずREVERSALで記録)。
- 詳細: `docs/ledger-rules.md`, `docs/database.md`

### 2.2 認証・アカウント
- ログイン手段: メールOTP (実装済み・本番相当)、LINE (**モック実装**、後述)、
  戦国パスポートSSO (**モック実装**)。
- OVE独自セッション (HttpOnly Cookieトークン)。
- **利用規約同意の永続化**: 新規アカウント作成時に同意を必須化し、`ove_accounts` に
  同意日時・バージョンを記録 (既存アカウントの再ログインでは再同意不要)。
- **全セッション無効化**: 管理者がアカウント単位で全端末のセッションを即座に失効させる
  機能 (不正利用時の対応用)。
- 詳細: `docs/authentication.md`

### 2.3 外部サービスAPI連携 (代理店システム等の連携もこの仕組みを利用する想定)
- `service_integrations` テーブルで連携先ごとにAPIキー・署名シークレット・
  1日あたり/1リクエストあたりの上限を管理。
- HMAC-SHA256署名 + タイムスタンプ + nonceによるリプレイ防止 (`docs/external-api.md`)。
- 主要エンドポイント: ポイント付与 (`/rewards/grant`)、利用 (`/transactions/debit`)、
  取消 (`/transactions/{id}/reverse`)、残高照会・取引履歴照会。
- 連携先の緊急停止・再開機能 (即座にAPIキーを無効化)。
- APIアクセスログ (成功・認証失敗の両方を記録、管理画面で検索可能)。
- **この仕組みは戦国パスポート/AIアート教室などの想定連携先に限定されておらず、
  新しい連携先を `service_integrations` に1行追加するだけで同じ認証・上限管理・ログの
  仕組みに乗せられます**。実際に戦国経済圏代理店システム (sengoku-ai.com) との連携
  (同期受信・SSOログイン) をこの仕組みの上に実装済みです (下記4章を参照)。

### 2.4 管理画面 (`apps/admin-wallet`, PC向け)
実装済み画面: ダッシュボード (KPI・過去30日推移グラフ・最近の取引・整合性チェック、
戦国ウォレットデザイン刷新済み)、アカウント一覧・アカウント詳細 (連携ID・外部サービス
連携・操作ログ・全セッション無効化)、ウォレット一覧・詳細、取引一覧・取消、CSV一括付与、
付与ルール管理、外部サービス管理、既存ユーザー移行、アカウント統合、二段階承認
(高額操作の職務分離)、操作ログ、APIアクセスログ、セキュリティ設定 (**管理者MFA**:
RFC 6238準拠のTOTP二要素認証、外部ライブラリ非依存で自前実装)、**外部連携キュー**
(Transactional Outboxの一覧・ステータス/連携先での絞り込み・手動再送・Feature Flag確認)、
**代理店連携状態一覧** (`account_links`のうち代理店システム分を状態絞り込み・詳細確認。
`docs/agency-integration.md`参照)。

### 2.5 ユーザー向けウォレット画面 (`apps/user-wallet`, スマートフォン優先)
「戦国ウォレット UIデザイン仕様 v1.0」(黒・濃紺・金・深紅を基調としたデザイン) で
以下の画面を実装済み: ログイン (LINE/メール/戦国パスポートIDの3方式 + 利用規約同意)、
ウォレットホーム、取引履歴一覧 (獲得/利用/失効フィルタ)、取引詳細。
共通コンポーネント (`packages/shared-ui`) として切り出し済み。375px/768px/1280pxで
レスポンシブ確認済み。詳細: `docs/ui-design.md`

### 2.6 セキュリティ
入力値検証・SQLインジェクション対策・XSS対策・CSRF対策・ブルートフォース対策・
レート制限・監査ログ (削除不可)・高額操作の二段階承認・管理者MFA・全セッション無効化まで
実装済み。詳細と既知の残課題は `docs/security.md`。

## 3. LINE連携について

LINEログインは `AUTH_MODE` で実装を切り替える構成です
(`packages/auth/src/sso.ts`)。

- `AUTH_MODE=mock` (既定): `MockLineAuthVerifier`。`mock.<lineUserId>` 形式のIDトークンを
  そのまま信用する開発用の仮実装で、LINE Platform APIとの実通信は行わない。
- `AUTH_MODE=production` かつ `LINE_CHANNEL_ID` 設定時: `LineIdTokenVerifier` (本番実装)。
  LINEの「IDトークン検証」API (`POST https://api.line.me/oauth2/v2.1/verify`) へ
  問い合わせて `sub`/`email`/`aud` を取得する。単体テスト (`fetch`モック) のみ検証済みで、
  **実LINEチャネル・実IDトークンを使った結合テストは未実施**。本番投入前に
  LINE Developersでチャネルを発行し、実際のLIFF/LINE Login SDK経由のログインで
  一度は確認する必要がある。

戦国パスポートSSO (`SengokuSsoService`) については、相手方のAPI仕様がまだ確定していない
(sengoku-ai.com側からの仕様共有待ち) ため、引き続きモック実装のままで着手を保留している。

## 4. 代理店システム (sengoku-ai.com) 連携 — 実装済み

「戦国経済圏 代理店システム 外部連携API仕様書」v3.6.71と、それを踏まえた
`docs/development-guardrails.md` (2026-07-15付) に基づき、以下を実装済みです。
詳細・実装範囲外の項目は `docs/agency-integration.md` を参照してください。

1. **同期受信** (仕様書7章): `POST /api/integrations/agencies`。専用テーブルは作らず、
   `service_integrations` (`ServiceCode.AGENCY_SYSTEM`) + `account_links`
   (`oveAccountId`をnullable化し、未紐付け時は`status: PENDING`で保留) を再利用。
   認証は`x-api-key`/Bearerのみのシンプルな鍵認証 (`AgencyApiKeyGuard`、既存のHMAC
   必須ガードとは別物)。`ENABLE_AGENCY_REFERRAL_SYNC`フラグ(既定false)でON/OFF。
2. **SSOログイン** (仕様書12章): `POST /api/v1/auth/sso/agency`。sengoku-ai.comが
   発行するRS256 JWTをJWKS (`SENGOKU_AI_JWKS_URL`)で検証し (`jose`ライブラリ、
   `jti`再利用拒否あり)、`AccountIdentity` (identityType: `SENGOKU_AGENCY`) で
   OVEアカウントを解決してログインさせる。
3. **管理画面「代理店連携状態一覧」** (2.4節参照、ガイドライン15章の必須項目)。

**範囲外 (今後の課題)**: OVE Wallet側からsengoku-ai.comへの同期送信 (仕様書6章の
逆方向)、同期失敗の自動再送 (`ENABLE_AGENCY_SYNC_RETRY`)。紹介トークン・紹介セッション
受け入れフロー (`ref_token`のURL経由登録・登録ボーナス連動) は、実装指示書v1.0を受けて
Phase 1 (`/invite/{token}`受付・LINEログイン時の紐付け・特典保留まで) を実装済み
(`docs/agency-referral.md`参照)。代理店システムへの実際の同期送信・特典確定はPhase 2、
管理者による手動確定・取消はPhase 3として今後対応する。

## 5. 「OVEウォレット開発・連携上の留意事項 v1.0」への対応状況

代理店システム等の外部連携を見据えたガイドライン文書 (2026-07-15付) を踏まえ、
その17章のPhase区分に沿って以下の対応を行っています。

- **Phase 1 (本番前セキュリティ) — 完了**:
  - 本人向けAPIを `GET /api/v1/me/wallet` / `/me/transactions` / `/me/transactions/{id}`
    に分離し、URLでOVEアカウントIDを受け取らずセッションから本人を特定する方式へ変更。
  - 外部サービス向け残高照会 `GET /api/v1/service/accounts/{externalUserId}/balance`
    を新設し、認証済みの連携先自身に紐づく利用者のみ照会できるようにした
    (他サービスの利用者は404)。
  - 旧 `GET /api/v1/wallets/{oveAccountId}/...` (誰でも`oveAccountId`を知っていれば
    参照できた実装) は廃止。
  - `NODE_ENV=production` かつ `AUTH_MODE` が `production` 以外ならアプリ起動を
    失敗させるガードを追加 (モック認証のまま本番稼働することを防止)。
  - 詳細: `docs/security.md`, `docs/external-api.md`, `docs/authentication.md`
- **Phase 1.5 (素地インフラ: Transactional Outbox・Feature Flag) — 完了**:
  代理店システム側の実装と並行して進められる、契約仕様に依存しない基盤部分のみ着手
  (ガイドライン10章・13章)。
  - `integration_outbox` テーブルと `OutboxService` を実装。`enqueue()`は既存の業務トランザクション
    内から呼び出す想定の冪等な登録 (同一`idempotencyKey`では重複登録しない)、
    `processPendingEvents()`は宛先ハンドラへの送信・失敗時の指数バックオフ再送
    (最大8回、最終的に`FAILED`)を行う。宛先ハンドラは`registerDestination()`で後から
    差し込む方式 (LINE/SSOのモック→実装差し替えパターンと同様)。実際の代理店連携先
    ハンドラはまだ登録されていない (キューの土台のみ)。
  - Feature Flag基盤 (`ENABLE_PLATFORM_USER_ID`等7個、すべて既定false) を実装。
    どのコードもまだこれらのフラグを参照しておらず、OFFのままで既存機能に影響しないことを
    自動テストで確認済み。
  - 管理画面に「外部連携キュー」画面を追加 (キュー一覧・ステータス/連携先での絞り込み・
    試行回数・最終エラー内容・手動再送・Feature Flag確認)。
  - この時点では**紹介情報受入 (ref_token/referral_session) や代理店システムとの実際の
    通信は含まれていなかった**が、その後代理店システム側の仕様書 (v3.6.71) が確定した
    ため、現状調査と影響範囲の整理 (ガイドライン19章の指示通り) を経て次のPhase 2
    (同期受信・SSOログイン) に着手・完了した。
- **Phase 2 (代理店システム連携: 同期受信・SSOログイン) — 完了**: 4章参照。
- **Phase 2で範囲外とした紹介情報受入基盤・登録特典連動**: その後「代理店紹介連携機能
  実装指示書」v1.0を受けて、外部APIキー不要な範囲 (Phase 1) を実装済み。
  `wallet_referrals`/`wallet_referral_benefits`テーブルが存在する
  (`docs/agency-referral.md`参照)。実際の代理店システムへの同期送信・特典確定は
  引き続き未着手 (Phase 2)。

## 6. 未実装・今後の課題

- 代理店紹介トークン受け入れのPhase 2・3 (代理店システムへの実際の同期送信・
  登録特典3,000 OVEの確定付与・管理者による手動確定/取消): `docs/agency-referral.md`
  「今後の課題」参照。外部APIキー不要なPhase 1 (受付・紐付け・特典保留) は対応済み。
- 代理店システム連携 (12章) の範囲外項目: OVE Wallet→sengoku-ai.comへの同期送信、
  同期失敗の自動再送。4章末尾・`docs/agency-integration.md` 「今後の課題」参照。
- LINE本番連携・戦国パスポート本番SSO交換 (今回保留)。
- 二段階承認のオンチェーン移行・外部ウォレット変更・APIサービス上限変更への拡張
  (対応する機能自体が未実装のため)。アカウント統合は対応済み (`docs/admin-operations.md`
  「二段階承認」参照。金額によらず常に承認が必要)。
- 既存ユーザー移行: REVIEWINGアカウントの事後解消フロー、移行実行そのものの事前承認制・
  検証者(承認者)と実行者(申請者)の職務分離、解消フロー側での実行者本人による解消の禁止、
  CSVの文字コード対応 (UTF-8/Shift_JIS、ブラウザ側`TextDecoder`のみで対応しサーバー側API
  は無変更) まですべて対応済み (`docs/migration.md` 参照)。
- インフラ整備は一通り対応済み: `audit_logs`のDBレベルDELETE/UPDATE禁止、ログイン系
  エンドポイントのレート制限強化、CORS本番設定、3アプリの本番用Dockerfile、
  `ENCRYPTION_KEY`ローテーションスクリプト (`packages/database/src/rotate-encryption-key.ts`、
  DBの複製に対して実際に実行し動作確認済み)、エラートラッキング(Sentry、DSN未設定時は
  no-op)、DBバックアップ/リストアスクリプト (`scripts/backup-db.sh`/`restore-db.sh`、
  実際にバックアップ→別DBへのリストアを行い行数の完全一致まで確認済み)、push/PR時の
  CI自動化 (`.github/workflows/ci.yml`)。ただし本番用Dockerfileは、このリポジトリの開発
  コンテナにDockerデーモンが無く `docker build`/`docker run` そのものは未実行
  (各ビルドステップに相当する処理は個別に成功確認済み。`docs/deployment.md`
  「Dockerイメージ (本番)」の「検証状況」参照)。実際にDockerが使える環境での
  エンドツーエンド検証が必要。監視のうちSentryプロジェクト作成・外部死活監視・ログ収集
  基盤の契約は未着手 (`docs/monitoring.md`「残作業」参照)。詳細は`docs/security.md`・
  `docs/deployment.md`・`docs/monitoring.md`・`docs/backup.md`参照。
- Playwright E2Eのリポジトリ内自動化: `tests/e2e`として土台を整備し、4フロー
  (ユーザーのLINEログイン→ウォレット表示、管理者の個別付与→残高反映、アカウント統合の
  二段階承認、既存ユーザー移行の事前承認制・検証者フロー) を自動化した (`pnpm test:e2e`)。
  いずれも2管理者セッション (申請者・承認者) を使い、申請者本人による承認/解消が
  拒否されることまで含めて検証している。管理者MFA・外部連携キュー・代理店連携状態
  一覧・紹介トークン受け入れ画面等、他のフローはまだ手動実行での確認のみ
  (`docs/test-plan.md`「Playwright E2Eのリポジトリ内自動化」参照)。
- 負荷・レート制限の限界値テスト: `tests/load/run.mjs`として簡易実装した (3エンドポイント、
  Node組み込みfetchのみ)。実施により`GET /health`が通常のAPIトラフィックと同じレート制限を
  共有しており高頻度ポーリングで誤って429を返しうる問題を発見・修正した
  (`@SkipThrottle()`追加。`docs/test-plan.md`「負荷・レート制限の限界値テスト」参照)。
  本番相当の持続負荷テストや外部サービスAPIのレート制限限界値テストは未実施。

## 7. 参考: 主要ドキュメント一覧

| ドキュメント | 内容 |
|---|---|
| `docs/architecture.md` | 全体構成・技術選定理由 |
| `docs/database.md` | データモデル詳細 |
| `docs/authentication.md` | 認証設計 (MFA・利用規約同意を含む) |
| `docs/ledger-rules.md` | 台帳ルール・整合性チェック |
| `docs/external-api.md` | 外部サービスAPI仕様 (代理店連携の土台) |
| `docs/agency-integration.md` | 代理店システム(sengoku-ai.com)連携: 同期受信・SSOログイン |
| `docs/agency-referral.md` | 代理店紹介トークン受け入れ・登録特典 (Phase 1) |
| `docs/agency-referral-decisions.md` | 紹介トークン受け入れの残論点 (非エンジニア向け) |
| `docs/integration-outbox.md` | Transactional Outbox・Feature Flag基盤 |
| `docs/admin-operations.md` | 管理画面の全画面説明 |
| `docs/ui-design.md` | 戦国ウォレットデザインシステム |
| `docs/security.md` | セキュリティ対策と既知の課題 |
| `docs/test-plan.md` | テスト計画と実施結果 |
| `docs/migration.md` | 既存ユーザー移行 |
| `docs/deployment.md` | デプロイ手順 |
| `docs/monitoring.md` | 監視・アラート (エラートラッキング・ヘルスチェック・ログ収集・CI) |
| `docs/backup.md` | DBバックアップ・リストア手順 |
| `docs/implementation-log.md` | 時系列の実装記録 (このドキュメントとは別に、何を・いつ・なぜ実装したかを追える) |
| `docs/implementation-plan.md` | 初期実装計画・フェーズ進行状況 |
| `docs/development-guardrails.md` | 代理店システム等の外部連携に向けた開発基準 (このドキュメントの元) |
