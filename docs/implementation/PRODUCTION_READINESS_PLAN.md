# 本番基盤の確認 (P0) 実装計画

「OVEウォレット 今後の実装・運用指示書 v1.0」5章・12章P0に基づく、代理店連携・
AIアート教室連携を本番運用する前に確認・完了すべき項目の状況整理。

## P0-1. `ove_transactions`のDBレベル保護 — 完了

- マイグレーション`add_ove_transactions_immutability_trigger`で実装済み。
- 対象: DELETE (常に拒否)、COMPLETED取引の`amount`/`direction`/`wallet_id`/
  `transaction_type`/`idempotency_key`変更 (拒否)。`status`のみの変更
  (COMPLETED→REVERSED) は許可。
- 対応してテストヘルパー(`packages/ledger/src/test-helpers.ts`)の`truncateLedgerTables()`
  を、`oveTransaction`を削除しない方式に変更 (`walletHold`のみ削除)。
- テスト: `apps/api/src/e2e/ove-transactions-immutability.test.ts` (新規、4件)。
- 受入条件の充足状況:
  - アプリから取引を削除できない — 満たす (トリガーで拒否)
  - SQLを直接実行しても削除できない — 満たす (アプリの特権接続でもトリガーが効く)
  - COMPLETED取引の重要項目を直接更新できない — 満たす
  - REVERSALは正常に実行できる — 満たす (status変更のみのUPDATEは許可)
  - 既存テストがすべて通る — 満たす (apps/api 91件・packages/ledger 21件・
    packages/auth 37件、いずれも成功)

## P0-2. LINE実チャネル結合試験 — 進行中 (2026-07-18: チャネル発行完了、フロントエンド未対応と判明)

`LineIdTokenVerifier`(`packages/auth/src/sso.ts`)はコードとして実装済みだが、実際の
LINEチャネルでの結合試験は未実施 (`docs/authentication.md`参照)。試験に必要な設定・
確認項目を以下に整理する。

**2026-07-18時点の進捗**: LINE Developersでチャネルを発行済み (channel_id: 2010749243)、
`LINE_CHANNEL_ID`をRailway環境変数に設定済み (`deploy.yml`)。ただし、その過程で
`apps/user-wallet`のログイン画面が実際のLIFF/LINE Login SDKを一切呼んでいないことが
判明した (現状はブラウザ内で生成した疑似IDをそのまま`/api/v1/auth/line/login`へ送る
モック専用の実装)。そのため、下記「事前に用意するもの」1-5が揃っても、
**フロントエンドへのLIFF/LINE Login SDK組み込みが完了するまでは実チャネルでの
結合試験自体を開始できない**。この作業は指示書の対象外だった「LINE本番連携
(LIFF/LINE Login SDK)」の実装そのものであり、`docs/project-status.md`「3. LINE連携に
ついて」が以前「今回の方針転換によりいったん着手を保留」としていた部分に当たる。

### 事前に用意するもの

| # | 項目 | 内容 | 状態 |
|---|---|---|---|
| 1 | LINE Developersでのチャネル作成 | LINEログインチャネルを作成し、`channel_id`を取得する | `IMPLEMENTED` |
| 2 | `LINE_CHANNEL_ID`環境変数 | 上記チャネルIDを設定 (`.env.example`に既存項目あり) | `IMPLEMENTED` |
| 3 | コールバックURL登録 | LINE Developersコンソールで、ステージング/本番のコールバックURLを登録 | `NOT_IMPLEMENTED` (コールバックURLの実装自体がまだ無い) |
| 4 | LIFF ID (LINE内ブラウザで開く場合) | `LINE_LIFF_ID`環境変数 (既存項目あり) | `NOT_IMPLEMENTED` |
| 5 | Cookieドメイン設定 | `COOKIE_DOMAIN`が実際のドメインと一致しているか確認 | `NOT_IMPLEMENTED` (本番ドメイン未確定のため) |
| 6 | **(新規)** `apps/user-wallet`へのLIFF/LINE Login SDK組み込み | ログイン画面を、疑似ID直接送信ではなく実際のLINEログインフロー (LIFF `liff.login()`、またはLINE Login Web版のOAuth認可コードフロー) 経由でIDトークンを取得する実装に変更する | `NOT_IMPLEMENTED` |

### 確認する項目 (指示書5.2章)

- LINE内LIFFブラウザでのログイン
- Safari/ChromeからのLINE Login (通常のWebブラウザ経由)
- IDトークン検証が実際に成功すること (`LineIdTokenVerifier`が本物のLINE APIに問い合わせて
  `sub`/`email`/`aud`を正しく取得できるか)
- audience(`aud`)不一致時の拒否が実際に機能すること (誤ったチャネル向けのトークンを
  弾けるか)
- 有効期限切れトークンの拒否
- コールバックURLの実際の動作確認
- Cookieドメインが正しく機能すること (セッションCookie・紹介Cookieの両方)
- 紹介URLからLINEログイン後、紹介情報が維持されること
  (`REFERRAL_SESSION_COOKIE_NAME`が正しく読み書きされるか、実ブラウザで確認)
- LINE認証失敗時に紹介Cookieが削除されること (`apps/api/src/auth/auth.controller.ts`の
  `finally`ブロックが実際に動作するか)
- 同一LINEアカウントで重複OVEアカウントが作成されないこと
  (`AccountsService.findOrCreateByIdentity`の一意制約が実際のLINEユーザーIDに対して
  機能するか)

### 完了条件

- 上記すべての項目を実際のLINEチャネル・実ブラウザで確認し、結果を
  `docs/authentication.md`に追記する
- `AUTH_MODE=production`での起動が実際に成功し、モックではなく本物のLINE認証が
  機能することを確認する

## P0-3. ステージング環境 — 未着手 (業務判断・外部契約が必要)

指示書5.3章の最低構成 (ステージング用API/ユーザー画面/管理画面/PostgreSQL/Redis/
LINEステージングチャネル/Sentryステージング環境/メール送信テスト環境) を構築する。

**現状**: Railway (API) + Vercel (フロントエンド2アプリ) への「動作確認用デプロイ」は
存在するが、`docs/deployment.md`に明記されている通り`AUTH_MODE=mock`で動作する
検証用環境であり、指示書が求める「本番と分離されたステージング」の要件
(実LINEチャネル・実Sentry環境等) は満たしていない。

**対応方針**: 新しいRailway/Vercelプロジェクトの作成、LINEステージングチャネルの発行、
Sentryプロジェクトの作成は、いずれも外部サービスのアカウント操作を伴うため、
実施前にユーザーへの確認が必要 (既存の動作確認用デプロイをそのまま「ステージング」に
昇格させるか、別環境を新設するかも含めて)。

## P0-4. Sentry設定 — コードは対応済み、外部設定が未着手

- `apps/api/src/common/sentry.ts`は実装済み (`SENTRY_DSN`未設定時はno-op)。
- 未着手: Sentryプロジェクトの作成・DSN払い出し・Railway環境変数への設定・
  5xxエラー送信の実際の確認・Outbox失敗時の通知設定。
- 詳細: `docs/monitoring.md`

## P0-5. 定期バックアップ・復旧試験 — スクリプトは対応済み、運用が未着手

- `scripts/backup-db.sh`/`restore-db.sh`は実装・ローカル動作確認済み。
- 未着手: 定期実行の自動化 (cron等)、外部ストレージ(S3等)への保存、保持期間設定、
  **本番相当DBでの復旧試験** (ローカル開発DBでの検証のみ実施済み)、バックアップ
  失敗時の通知。
- 詳細: `docs/backup.md`

## P0-6. 本番環境変数・Cookie・CORS確認 — 一部対応済み

- CORS: `APP_URL`/`ADMIN_URL`のみを許可する実装済み・フェイルクローズ確認済み
  (`docs/deployment.md`「CORS本番設定」)。
- Cookie: `SESSION_COOKIE_OPTIONS`/`REFERRAL_COOKIE_OPTIONS`は`sameSite: "none"`
  (Vercel/Railwayのクロスドメイン構成のため、`AGENTS.md`のSameSite=Laxルールからの
  意図的な既知の逸脱、本セッションのコードレビューで確認済み)。
- 未着手: 実際の本番ドメイン確定後の`APP_URL`/`ADMIN_URL`/`COOKIE_DOMAIN`の設定・
  実ブラウザでのCookie送受信確認。

## まとめ

| 項目 | 状態 |
|---|---|
| P0-1 `ove_transactions`DB保護 | `IMPLEMENTED` |
| P0-2 LINE実チャネル結合試験 | `PARTIALLY_IMPLEMENTED` (チャネル発行・環境変数設定は完了。フロントエンドのLIFF/LINE Login SDK組み込みが未着手のため試験自体は未開始) |
| P0-3 ステージング環境 | `BUSINESS_DECISION_REQUIRED` (外部アカウント作成の判断が必要) |
| P0-4 Sentry設定 | `CONFIGURATION_REQUIRED` (コードは`IMPLEMENTED`、外部設定が未着手) |
| P0-5 定期バックアップ・復旧試験 | `CONFIGURATION_REQUIRED` (スクリプトは`IMPLEMENTED`、運用が未着手) |
| P0-6 本番環境変数・Cookie・CORS確認 | `CONFIGURATION_REQUIRED` (本番ドメイン確定待ち) |
