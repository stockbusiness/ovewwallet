# 戦国経済圏代理店システム外部連携 (sengoku-ai.com)

対象仕様: 「戦国経済圏 代理店システム 外部連携API仕様書」v3.6.71、
「千ノ国 代理店システム 外部開発者向け連携ガイド」v3.6.78-draft
開発基準: `docs/development-guardrails.md` (特に4.3章・9.1章・13章)

## 実装範囲

今回実装したのは以下の2つのみ。仕様書5章の紹介トークン・紹介セッションの
受け入れフロー（URL経由の紹介登録・登録ボーナス連動）は範囲外。

1. **同期受信** (仕様書7章): sengoku-ai.comが代理店情報の作成・更新・停止等を
   `POST /api/integrations/agencies` へ送信してくる。
2. **SSOログイン** (仕様書12章): sengoku-ai.comが発行するRS256 JWTを検証し、
   OVE Walletへログインさせる。
3. **管理画面: 代理店連携状態一覧** (開発ガイドライン15章「必須」項目):
   `/agency-links` で `account_links` (AGENCY_SYSTEM分) を一覧・状態絞り込み・
   詳細確認できる。

## イベント種別による分岐 (外部開発者向け連携ガイド11.1章)

`POST /api/integrations/agencies` は `event` フィールドの値によって処理を
分ける (`apps/api/src/agency/agency.controller.ts`)。

| `event` | 扱い |
|---|---|
| `connection_test` (または `dry_run: true`) | 何も保存せず2xxのみ返す (従来通り) |
| `admin_created` / `admin_updated` / `role_updated` / `approved` / `promoted` など、`external_id`を伴う代理店レコードのイベント | `AgencyService.syncAgency()` で `account_links` へupsert (従来通り) |
| `deactivated` / `deleted` | 同じく`syncAgency()`を通るが、**`account_links.status`を`REVOKED`へ強制的に遷移させ`revokedAt`を記録する**。従来はイベント種別を見ずmetadataのみ更新していたため、代理店が停止・削除されてもリンクがACTIVE/PENDINGのまま残り続けるバグがあった |
| `lead_created` / `common_user.merged` / `common_user.assigned_agent.updated` | 代理店レコードの同期ではなく共通顧客HUBのイベントのため、`account_links`へは書き込まず`AgencyService.recordHubEvent()`で`audit_logs`(`target_type: "agency_common_user_hub_event"`, `action_type: "AGENCY_HUB_EVENT_<EVENT>"`)へ記録するのみ。ウォレット側に`common_user_id`とアカウントの紐づけがまだ無い(共通ID接続機能は別途)ため、自動反映はできない。手動確認は`audit_logs`を参照する |

`external_id`は代理店レコード同期のイベントでは必須(無い場合は400)。HUB系
イベントは`external_id`を持たないことがあるため任意項目にしてある。

## 設定手順 (管理画面)

**外部連携 > 代理店連携セットアップ** (`/agency-setup`) に、必要な設定と現在の状態が
順番に並んでいる。設定が「共通顧客HUB送信設定」「外部サービス管理」「Feature Flag
(環境変数)」の3か所に分かれていて、どこまで済んだか分からないという運用からの指摘への
対応 (この画面は**状態を表示するだけ**で、変更は各設定画面で行う)。

| # | 内容 | 完了の判定 |
|---|---|---|
| 1 | `system_key` を代理店システム側の登録値に合わせる | 現在値が `orly-wallet` か |
| 2 | 共通顧客HUBのAPIキーを設定 (**代理店システムが発行**) | `apiKeySet` |
| 3 | 受信用APIキーを発行して渡す (**ORI側が発行**) | `service_integrations.last_accessed_at` に接続実績があるか |
| 4 | Feature Flag 4つを有効化 | 環境変数のON/OFF |
| 5 | 接続テストと実績確認 | 紹介・紐付けの件数 |

APIキーが2種類あり向きが逆なので混同しやすい (2はORI→代理店の問い合わせ用、
3は代理店→ORIの付与イベント用)。画面上でも明記している。

3の完了判定に `last_accessed_at` を使うのは、「鍵を渡した」ことはシステム側から
分からないが、「相手が実際にその鍵で接続できた」ことは分かるため。

## 管理画面でできること・できないこと

`AGENCY_SYSTEM` は既存の `service_integrations` を再利用しているため、既存の
「外部サービス管理」画面 (`/service-integrations`) にも自動的に表示され、
緊急停止・再開ができる。加えて `/agency-links` で以下ができる。

- 状態 (PENDING=同期のみ受信/未紐付け、ACTIVE=紐付け済み、REVOKED=解除済み)
  での絞り込み
- 各行の「詳細」展開で `parent_external_id` / `common_user_id` /
  `referral_token` / ロール / 同期ステータス / 連携方法を確認
- 各行の「詳細」展開から、**ORIアカウントとの手動での紐付け・解除**
  (下記「手動での紐付け」)

以下はできない (今後の課題、または他の理由で意図的に対象外)。

- APIキーの発行・閲覧・ローテーション (ハッシュ化保存のため、生成時に
  サーバーログへ一度だけ出力される。他の外部サービス連携と同じ仕様)
- `SENGOKU_AI_SSO_AUDIENCE` / `SENGOKU_AI_JWKS_URL` /
  `ENABLE_AGENCY_REFERRAL_SYNC` の管理画面からの変更 (環境変数のみ)
- FAILED/CONFLICT状態の表示・自動再送・手動再送 (`ENABLE_AGENCY_SYNC_RETRY`
  実装時に追加予定。現在の実装ではsyncAgency/loginWithAgencySsoは常に
  成功するかHTTPレベルで失敗するかのどちらかで、部分失敗状態が残ることはない)

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
    ログインで解決されたOVEアカウントを設定する。管理者が手動で紐付けた場合も
    同じ状態になり、`link_method` が `ADMIN_MANUAL` になる (下記)。
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

連携に必要なFlagは4つある (`ENABLE_PLATFORM_USER_ID` /
`ENABLE_WALLET_REFERRAL_TOKEN` / `ENABLE_AGENCY_REFERRAL_SYNC` /
`ENABLE_AGENCY_POINT_AWARD_INBOX`)。`.github/workflows/deploy.yml` で明示的に
設定しており、手順が済んだものから個別に `true` へ変えてデプロイする。

`ENABLE_PLATFORM_USER_ID` は単独の機能ではなく**紹介確定の前提**である。
common_user_id が未解決だと確定のOutboxハンドラが例外を投げて再送し続ける
(`agency-referral-outbox-handler.ts`)。この共通IDは共通顧客HUB経由でしか
設定されないため、このFlagがOFFのままだと紹介が永久に確定しない。

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

## 手動での紐付け

```
POST /api/v1/admin/agency-links/:id/link    { "account": "OVE-ACC-...", "reason": "..." }
POST /api/v1/admin/agency-links/:id/unlink  { "reason": "..." }
```

代理店の担当者とORIアカウントの紐付けは、通常は代理店SSOログインが作る。ただし
次の場合はSSOを通らないため `PENDING` (同期のみ) のまま残り、**その担当者宛の
ORI付与イベントが 404 になり続ける** (`docs/integration/AGENCY_POINT_AWARD.md` 4章)。

- 代理店SSOがまだ接続されていない (`SENGOKU_AI_SSO_*` 未設定 / `ENABLE_AGENCY_LOGIN` が無効)
- その担当者がLINEログインで先にウォレットを作ってしまった

管理画面 `/agency-links` の「詳細」から、ORIアカウントのコード (`ORI-ACC-...`) と
理由を入れて紐付けられる。内部IDでも指定できる。

権限は `SUPER_ADMIN` / `INTEGRATION_ADMIN`。**閲覧専用の `AUDITOR` には開けていない**
(残高の行き先を決める操作のため)。誰がいつどの紐付けをなぜ変えたかは
`AGENCY_LINK_MANUAL_LINK` / `AGENCY_LINK_MANUAL_UNLINK` として監査ログに残る
(連携先の生ペイロードは残さない)。

次の場合は受け付けない。

| 状況 | 応答 | 理由 |
|---|---|---|
| `REVOKED` の連携 | 400 | 代理店システム側が「退会・削除された」と言っている状態。ウォレット側から復活させると正本と食い違う |
| 既に別の `external_id` へ紐付いているORIアカウント | 409 | 別々の担当者宛の付与がすべて同じ残高へ入ってしまう |
| `ACTIVE` でないORIアカウント | 400 | 付与先が既に存在しない残高になる |

**解除しても、それまでに入った付与は取り消されない** (台帳を遡って書き換えないため)。
返金が必要な場合は管理画面のウォレット詳細から減算する。

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
  同期→SSOの順で紐付けが完成する場合とその逆順の場合の両方、
  管理画面API `/agency-links` の一覧・絞り込み・詳細・アクセス制御)。

## 今後の課題 (範囲外)

- 紹介トークン・紹介セッション受け入れフロー (`ref_token`のURL除去、`referral_session`
  テーブル、登録ボーナス連動)。着手前に確認が必要な事項を
  `docs/agency-referral-decisions.md` (非エンジニア向け) にまとめてある。
- OVE Wallet側からsengoku-ai.comへの同期送信 (仕様書6章の逆方向)。
  実装する場合は既存の`integration_outbox` (`docs/integration-outbox.md`) を
  再利用する。
- `ENABLE_AGENCY_SYNC_RETRY`を使った同期失敗の自動再送、および管理画面での
  手動再送UI (FAILED/CONFLICT状態が実際に発生するようになった場合に追加)。
