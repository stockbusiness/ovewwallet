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

## P0-2. LINE実チャネル結合試験 — 完了 (2026-07-18〜19)

`LineIdTokenVerifier`(`packages/auth/src/sso.ts`)の実チャネルでの結合試験が完了した。
iPhone実機のChrome/SafariからLINEログイン→ウォレット画面表示までの一連の動作を
確認済み (`docs/authentication.md`参照)。

**経緯**:
- LINE Developersでチャネル・LIFFアプリを発行 (channel_id: 2010749243、
  LIFF ID: 2010749243-Zu7AV5nR)、`LINE_CHANNEL_ID`/`NEXT_PUBLIC_LINE_LIFF_ID`を
  それぞれRailway/Vercelに設定済み。
- `apps/user-wallet`のログイン画面がLIFF/LINE Login SDKを一切呼んでいなかった
  (疑似IDを直接送信するモック専用実装だった) ことが判明したため、`@line/liff`を
  導入しLIFF経由の本番ログインフローを実装した (`apps/user-wallet/src/lib/liff.ts`、
  `apps/user-wallet/src/app/login/page.tsx`)。`NEXT_PUBLIC_LINE_LIFF_ID`が未設定の
  環境 (ローカル開発・CI・Playwright) では従来通りモック実装のまま動作し、既存の
  Playwright E2E (`tests/e2e/specs/user-wallet.spec.ts`) が無改修で成功することを確認済み。
- `AUTH_MODE`を`production`に切り替え、実チャネルでの結合試験を実施。試験の過程で
  以下3件の不具合が見つかり、いずれも対応済み:
  1. `liff.login({redirectUri})`にクエリパラメータ付きの独自URLを渡すとLINE側との
     トークン交換が失敗する問題 → `redirectUri`のカスタマイズをやめ、状態は
     `localStorage`で引き継ぐ方式に変更。
  2. iOS上のLIFF SDKが`pageshow`イベントで無条件に`window.location.reload()`する
     挙動により、API送信・画面遷移が完了する前にリロードが繰り返されるループが
     発生 → IDトークン取得後は`liff.init()`を再度呼ばず、保存済みのIDトークンで
     直接送信し直す方式に変更。
  3. ログインAPI自体は成功するのに、直後の`/wallet`でのAPI呼び出しでセッション
     Cookieが送信されず401→`/login`への差し戻しが発生 → 原因はVercel(フロント
     エンド)とRailway(API)が別ドメインのため`SameSite=None`で発行していた
     セッションCookieを、iOS Safari/WebKitのIntelligent Tracking Prevention(ITP)が
     制限していたため。`apps/user-wallet/next.config.mjs`の`rewrites()`で`/api/*`を
     同一オリジンに見せかけてAPIへ転送する方式に変更し解決。

### 事前に用意するもの

| # | 項目 | 内容 | 状態 |
|---|---|---|---|
| 1 | LINE Developersでのチャネル作成 | LINEログインチャネルを作成し、`channel_id`を取得する | `IMPLEMENTED` |
| 2 | `LINE_CHANNEL_ID`環境変数 | 上記チャネルIDを設定 (`.env.example`に既存項目あり) | `IMPLEMENTED` |
| 3 | LIFFアプリの作成 | 同じチャネル配下にLIFFアプリを追加し、Endpoint URLに実際の`apps/user-wallet`の`/login`URLを設定、scopeに`openid`/`profile`を含める | `IMPLEMENTED` |
| 4 | `NEXT_PUBLIC_LINE_LIFF_ID`環境変数 | 上記LIFFアプリのIDを`apps/user-wallet`のビルド時環境変数に設定 (Vercel) | `IMPLEMENTED` |
| 5 | Cookieドメイン設定 | `COOKIE_DOMAIN`が実際のドメインと一致しているか確認 | `NOT_IMPLEMENTED` (本番ドメイン未確定のため。現状はVercelのrewriteによる同一オリジン化で回避しているため、`vercel.app`ドメインのままでも動作する) |
| 6 | `apps/user-wallet`へのLIFF/LINE Login SDK組み込み | ログイン画面を、疑似ID直接送信ではなく実際のLIFF `liff.login()`経由でIDトークンを取得する実装に変更する | `IMPLEMENTED` |

### 確認する項目 (指示書5.2章)

- ~~LINE内LIFFブラウザでのログイン~~ — 未確認 (今回試験したのは外部ブラウザ経由のみ。
  LINEアプリのトーク画面等からLIFF URLを開いた場合の動作は別途確認が必要)
- Safari/ChromeからのLINE Login (通常のWebブラウザ経由) — `IMPLEMENTED` (iPhone実機で確認済み)
- IDトークン検証が実際に成功すること (`LineIdTokenVerifier`が本物のLINE APIに問い合わせて
  `sub`/`email`/`aud`を正しく取得できるか) — `IMPLEMENTED` (確認済み)
- audience(`aud`)不一致時の拒否が実際に機能すること — 未確認 (異常系は本番チャネル
  でのみ発生しうるため未実施。単体テストでは検証済み)
- 有効期限切れトークンの拒否 — `IMPLEMENTED` (試験中に実際に「IdToken expired」で
  拒否される事象を確認した)
- コールバックURLの実際の動作確認 — `IMPLEMENTED` (確認済み)
- Cookieドメインが正しく機能すること (セッションCookie・紹介Cookieの両方) — `IMPLEMENTED`
  (セッションCookieはVercelのrewriteによる同一オリジン化で対応。紹介Cookieは別途確認が必要)
- 紹介URLからLINEログイン後、紹介情報が維持されること — 未確認 (今回の試験範囲外)
- LINE認証失敗時に紹介Cookieが削除されること — 未確認 (今回の試験範囲外)
- 同一LINEアカウントで重複OVEアカウントが作成されないこと — 未確認 (今回の試験範囲外、
  ロジック自体は`findOrCreateByIdentity`の一意制約で担保)

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
| P0-2 LINE実チャネル結合試験 | `IMPLEMENTED` (2026-07-18〜19完了。iPhone実機でログイン→ウォレット画面表示までを確認済み) |
| P0-3 ステージング環境 | `BUSINESS_DECISION_REQUIRED` (外部アカウント作成の判断が必要) |
| P0-4 Sentry設定 | `CONFIGURATION_REQUIRED` (コードは`IMPLEMENTED`、外部設定が未着手) |
| P0-5 定期バックアップ・復旧試験 | `CONFIGURATION_REQUIRED` (スクリプトは`IMPLEMENTED`、運用が未着手) |
| P0-6 本番環境変数・Cookie・CORS確認 | `CONFIGURATION_REQUIRED` (本番ドメイン確定待ち) |
