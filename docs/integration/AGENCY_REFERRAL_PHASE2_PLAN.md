# 代理店紹介連携 Phase 2 実装計画

「OVEウォレット 今後の実装・運用指示書 v1.0」6章に基づく、代理店紹介トークン受け入れ
Phase 2 (代理店システムへの実送信・紹介関係確定・登録特典の確定付与) の実装計画。

**前提**: `docs/integration/EXTERNAL_API_GAPS.md`の「1. 代理店システム紹介関係API」の
未確認項目が確定するまで、本計画に基づく実コードの実装には着手しない。本ドキュメントは
仕様確定後にすぐ着手できるよう、現状把握と設計方針を先に整理したもの。

## 現在の実装 (Phase 1、完了済み)

- `/invite/{token}`受付、APIドメインでの紹介Cookie発行 (`apps/api/src/referrals/referrals.controller.ts`)
- LINEログイン時の紐付け (`apps/api/src/referrals/referrals.service.ts`の`attachToNewAccount()`)
- `WalletReferral`/`WalletReferralBenefit`テーブルへの記録 (`status: PENDING`)
- `integration_outbox`への`wallet.referral.registered`イベント登録
  (destinationService: `AGENCY_SYSTEM`) — ただしこのdestinationに対応する送信ハンドラは
  まだ登録されていない (`OutboxService.registerDestination()`が呼ばれていない)
- 管理画面`/wallet-referrals`での確認 (Phase 1は確認のみ、操作ボタンなし)

## 不足機能 (Phase 2で実装するもの)

1. `AgencyReferralClient` (代理店紹介関係APIの呼び出しクライアント)
2. `integration_outbox`の`AGENCY_SYSTEM`宛イベントに対する送信ハンドラの登録
3. 紹介関係確定結果の受信・反映 (代理店側からの`CONFIRMED`/`REJECTED`等の反映)
4. 登録特典3,000 OVEの確定付与 (`WalletReferralBenefit.status: PENDING → CONFIRMED`
   + 台帳CREDIT取引の作成)
5. 紹介競合時の処理 (既存紹介関係があるユーザーが別の代理店URLを開いた場合)
6. 自動ディスパッチ (定期実行、6.5章。**ハンドラ実装が完了するまでは追加しない**
   — cronだけ先に追加すると再試行の消費が早まるだけで実益が無いため、本セッションの
   実運用ギャップ対応でも同じ理由で見送り済み)

## 対象ファイル・対象クラス/関数 (想定)

- 新規: `apps/api/src/referrals/agency-referral-client.ts` — `AgencyReferralClient`クラス。
  責務: 紹介トークン検証・紹介関係登録・紹介関係照会・タイムアウト処理・レスポンス変換・
  外部エラー→内部エラーコード変換・`request_id`/`idempotency_key`付与・秘密情報を
  除いたログ出力 (指示書6.3章の推奨責務に準拠)。
- 変更: `apps/api/src/referrals/referrals.module.ts` — `AgencyReferralClient`を
  `OutboxService.registerDestination("AGENCY_SYSTEM", ...)`で登録する初期化コードを追加
  (モジュール初期化時、`onModuleInit()`等)。
- 変更: `apps/api/src/referrals/referrals.service.ts` — 紹介関係確定結果を受け取って
  `WalletReferralBenefit`をCONFIRMEDにし、台帳CREDIT取引を作成するメソッドを追加。
- 新規: `apps/api/src/referrals/referral-confirmation.controller.ts` (仮) —
  代理店システムから紹介関係確定結果を受け取るWebhook相当のエンドポイント
  (契約確定後、方式(Webhook/ポーリング)に応じて要調整)。

## DB変更 (想定、要検討)

- `WalletReferral.status`に既存の`CONFIRMED`/`REJECTED`が定義済み
  (`WalletReferralStatus`enum、`packages/database/prisma/schema.prisma`)。追加のenum値は
  現時点で不要と見込むが、`CONFLICT`/`RETRYABLE_ERROR`/`PERMANENT_ERROR`相当の状態を
  `WalletReferral`自体に持たせるか、`lastErrorCode`/`lastErrorMessage`(既存フィールド)で
  表現するかは実装時に決定する。
- 3,000 OVEの確定付与にあたり、既存の`WalletReferralBenefit`(status: PENDING)を
  正規の状態遷移でCONFIRMEDにする案と、PENDINGを承認記録として残し確定CREDIT取引を
  別途作成する案がある (指示書6.6章)。**既存台帳の不変性 (`ove_transactions`は
  COMPLETED取引の主要項目を変更不可) を壊さない方式を選ぶ**必要があり、後者
  (PENDINGは承認記録、確定は新規CREDIT取引) が安全と見込む。

## API変更 (想定、契約確定後に確定)

- 代理店システムへ送信するAPIのエンドポイント・認証方式は`EXTERNAL_API_GAPS.md`の
  確認結果次第。
- 代理店システムから紹介関係確定結果を受け取るインターフェース (Webhook or ポーリング)
  も同様に契約確定後に決定。

## Feature Flag

- 既存の`ENABLE_AGENCY_REFERRAL_SYNC`(代理店同期受信で使用中)とは別に、Phase 2固有の
  機能を制御するフラグを追加するか検討する。既存の`ENABLE_AGENCY_SYNC_RETRY`
  (自動再送用、現状未使用)を実際の自動ディスパッチ実装時に使う想定。

## セキュリティリスク

- 紹介トークンは暗号化保存済み (`referralTokenEncrypted`、Phase 1で対応済み)。
  `AgencyReferralClient`が送信時に復号する処理は既存の`decryptSecret`を再利用し、
  新たな平文保存箇所を作らない。
- 代理店システムからの確定結果受信エンドポイントは、既存のHMAC認証基盤
  (`docs/external-api.md`)またはAPIキー認証(`AgencyApiKeyGuard`)のいずれかを再利用し、
  新しい認証方式を作らない (開発ガイドライン4.3章・9.1章)。

## 回帰リスク

- 既存のPhase 1テスト (`apps/api/src/e2e/agency-referral.test.ts`)・Playwright
  (`tests/e2e/specs/wallet-referrals.spec.ts`)がPhase 2実装後も引き続き成功することを
  確認する。特に、送信ハンドラ登録後は`outbox.test.ts`等の既存テストが誤って
  `AGENCY_SYSTEM`宛イベントを実送信してしまわないよう、テスト環境では
  ハンドラを差し替える/モック化する設計にする。

## テスト項目 (指示書6.9章の受入試験に対応)

- 正常な紹介URLで登録できる
- 無効トークンで登録特典が付与されない
- 期限切れトークンで付与されない
- 紹介URLなし新規登録は指定状態になる
- 同じ紹介URLを複数人が使用できる
- 同じユーザーに3,000 OVEが二重付与されない
- 同じOutboxイベントを再送しても二重関係が作成されない
- 代理店APIタイムアウト時に再送される
- 成功したが応答を受信できなかった場合でも冪等に回復できる
- 別代理店URLを開いても既存関係を上書きしない
- 紹介確定後だけ3,000 OVEが利用可能になる
- 管理者操作とAPI送信が監査ログに残る

## 完了条件

- 上記テスト項目がすべて自動テストで検証済み
- `AgencyReferralClient`が実際の代理店システムのステージング環境に対して疎通確認済み
- 登録特典3,000 OVEの確定付与が既存台帳の不変性 (`ove_transactions`のDBレベル保護) を
  壊さずに実装されている
- 管理画面(`/wallet-referrals`)から紹介関係確定状況・失敗理由が確認できる
