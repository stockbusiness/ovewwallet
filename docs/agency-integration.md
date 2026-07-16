# 戦国経済圏代理店システム外部連携 (sengoku-ai.com)

対象仕様: 「戦国経済圏 代理店システム 外部連携API仕様書」v3.6.71
開発基準: `docs/development-guardrails.md` (特に4.3章・9.1章・13章)

## 実装範囲

今回実装したのは以下の2つのみ。仕様書5章の紹介トークン・紹介セッションの
受け入れフロー（URL経由の紹介登録・登録ボーナス連動）は範囲外。

1. **同期受信** (仕様書7章): sengoku-ai.comが代理店情報の作成・更新・停止等を
   `POST /api/integrations/agencies` へ送信してくる。
2. **SSOログイン** (仕様書12章): sengoku-ai.comが発行するRS256 JWTを検証し、
   OVE Walletへログインさせる。

## データモデル

開発ガイドライン4.3章・9.1章の方針に従い、専用テーブルは作らず既存の
`service_integrations` / `account_links` を再利用する。

- `service_integrations` に `ServiceCode.AGENCY_SYSTEM` の行を1つ持つ。
  `signingSecretEncrypted` は使わない（sengoku-ai.com側がHMAC署名に対応していない
  ため、ダミー値を保存しているだけ）。
- `account_links` に `service_integration_id = AGENCY_SYSTEM.id` /
  `external_user_id = external_id` の行を1つ持つ。
  - まだOVEアカウントと紐付いていない（=同期は受信したがSSOログインは
    未実施）場合、`status = PENDING` / `ove_account_id = null`。
  - SSOログインが行われた時点で `status = ACTIVE` / `ove_account_id` に
    ログインで解決されたOVEアカウントを設定する。
  - `metadata` (JSON) に `parent_external_id` / `common_user_id` /
    `referral_token` / 氏名・連絡先・ロール等、仕様書のフィールドをそのまま
    保存する（将来のフィールド追加にも耐えられるよう `rawPayload` も含める）。
  - `account_links.ove_account_id` はこの連携のためにnullableにした
    (`20260716153055_add_agency_system_service_integration` マイグレーション)。
    既存の外部サービスAPI (`findOrCreateByServiceLink`) は従来通りoveAccountIdを
    即座に設定するため、PENDING状態が生まれることはない。

SSOログインでは、OVEアカウント自体の解決には（LINE/戦国パスポートSSOと同じ
既存の仕組みである）`AccountIdentity` (identityType: `SENGOKU_AGENCY`,
provider: `"sengoku-ai"`) を使う。`account_links` はそれとは別に、
「この代理店external_idとOVEアカウントが紐付いている」という事実を
既存の管理画面・他の外部サービス連携と同じ形で参照できるようにするための
ものであり、SSOログインの成否そのものには影響しない
(`AgencyService.getServiceIntegrationId()`がAGENCY_SYSTEMのservice_integration
行を見つけられない場合はaccount_linkの更新をスキップし、ログイン自体は
成功させる)。

## 認証

`AgencyApiKeyGuard` (`apps/api/src/common/agency-api-key.guard.ts`) が
`x-api-key` または `Authorization: Bearer` ヘッダーを検証する。既存の
`ExternalApiAuthGuard` (HMAC署名・タイムスタンプ・nonce必須) とは別の、
より単純な鍵認証のみのガードである。sengoku-ai.com側がHMAC署名を計算できない
（仕様書5章に単純なAPIキー認証としか書かれていない）ため、既存のHMACガードを
そのまま使うことはできない。

## Feature Flag

`ENABLE_AGENCY_REFERRAL_SYNC` (既定`false`) がOFFの間、
`POST /api/integrations/agencies` は503を返す。SSOログイン
(`POST /api/v1/auth/sso/agency`) はフラグの影響を受けない
(LINE/戦国パスポートSSOと同様、ログイン導線自体はフラグで止めない)。

## 環境変数

| 変数名 | 内容 | 既定値 |
|---|---|---|
| `SENGOKU_AI_JWKS_URL` | SSO用JWT検証に使うJWKS URL | `https://sengoku-ai.com/api/sso/jwks.php` |
| `SENGOKU_AI_SSO_ISSUER` | JWTの`iss`として期待する値 | `https://sengoku-ai.com` |
| `SENGOKU_AI_SSO_AUDIENCE` | JWTの`aud`として期待する値 (sengoku-ai.com側で本連携用に発行された値) | 未設定時は実在しないプレースホルダー (検証は必ず失敗する安全側デフォルト) |
| `ENABLE_AGENCY_REFERRAL_SYNC` | 同期受信APIの有効化 | `false` |

`SENGOKU_AI_SSO_AUDIENCE`は必ず実際の値を設定すること。未設定のままでは
SSOログインは常に失敗する（起動時にエラーにはしない安全側の設計）。

## APIキーの発行

`packages/database/src/seed.ts` が初回実行時に `ServiceCode.AGENCY_SYSTEM` の
`service_integrations` 行と、そのAPIキー（ログにのみ表示、ハッシュ化して保存）を
作成する。このAPIキーをsengoku-ai.com側の管理画面に登録してもらう
(仕様書17章「外部システム受信用APIキー」に相当)。

## JWT検証の詳細 (SSOログイン)

`packages/auth/src/agency-sso.ts` の `AgencySsoVerifier` が以下を検証する
(仕様書12章)。

- 署名: RS256、JWKSから`kid`一致の公開鍵を取得して検証 (`jose`ライブラリ)
- `iss` / `aud` / `exp` / `iat`
- `jti`の再利用拒否 (KVストアにJWTの残り有効期限と同じTTLで記録)

## テスト

- `packages/auth/src/agency-sso.test.ts`: JWT検証ロジックの単体テスト
  (正常系、リプレイ、期限切れ、aud不一致、kid不一致、必須クレーム欠落)。
- `apps/api/src/e2e/agency-integration.test.ts`: HTTP経由のe2eテスト
  (認証、Feature Flag、connection_test、同期upsert、SSOログイン、
  同期→SSOの順で紐付けが完成する場合とその逆順の場合の両方)。

## 今後の課題 (範囲外)

- 仕様書5章の紹介トークン・紹介セッション受け入れフロー
  (`ref_token`のURL除去、`referral_session`テーブル、登録ボーナス連動)。
- OVE Wallet側からsengoku-ai.comへの同期送信 (仕様書6章の逆方向)。
  実装する場合は既存の`integration_outbox` (`docs/integration-outbox.md`) を
  再利用する。
- `ENABLE_AGENCY_SYNC_RETRY`を使った同期失敗の自動再送。
- 管理画面での連携状態一覧・手動再送UI (開発ガイドライン15章)。
