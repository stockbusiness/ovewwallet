# 「千ノ国 代理店システム 外部開発者向け連携ガイド」(v3.6.78-draft) と現行実装の照合結果

対象文書: `EXTERNAL_DEVELOPER_GUIDE.md`（sengoku-ai.com代理店システムの外部連携API仕様、
v3.6.78-draft）。既存の4/5システム方針書（`docs/policy-diff-report-5systems.md`）で
「代理店システム内共通顧客HUB」として抽象的に記述されていたものの**具体的なAPI契約**に
相当する。

> **更新 (実装済み)**: 以下が対応済み。以下の2〜5章の記述は対応前の調査結果を
> 保持しつつ、実施済み事項には注記を付けている。
> - 「2. 受信側: 代理店同期Webhook」の`event`値による分岐処理
> - 「4. 送信側」のうち`POST /api/common-users/resolve`(新規登録時)
> - 「5. エラーフォーマット」の外部連携4エンドポイント分
>
> `agent_code`キー化、`system-links`の実際の呼び出し、`referrals/capture`・
> `confirm`・`hierarchy.php`は引き続き未着手。

---

## 1. 総括

このガイドで定義される代理店システム(sengoku-ai.com)との連携は、大きく3方向に分かれる。

| 方向 | 実装状況 |
|---|---|
| **受信**: sengoku-ai.com → ウォレット（代理店同期Webhook） | 実装済み。イベント種別分岐は対応済み(下記2章参照)。`agent_code`キー化は未対応 |
| **受信**: sengoku-ai.com → ウォレット（SSOログイン） | 実装済み、ガイドとほぼ整合 |
| **送信**: ウォレット → sengoku-ai.com（共通顧客ID解決・紹介capture/confirm・階層取得） | **未実装（コード上一切存在しない）** |

既存ドキュメント(`docs/agency-referral.md`, `docs/agency-integration.md`)で
「Phase 2（代理店システム接続）は未実装」としていた内容と一致する。今回のガイドにより、
その「未実装部分」の具体的なAPI仕様（エンドポイント・リクエスト/レスポンス形式・
認証方式）が明確になった。

---

## 2. 受信側: 代理店同期Webhook `POST /api/integrations/agencies`

> **対応済み**: `event`値による分岐処理・`deactivated`/`deleted`時のREVOKED遷移・
> `common_user.merged`等のHUBイベントを`account_links`へ誤ってupsertしない対応は
> 実装済み(`apps/api/src/agency/agency.controller.ts`, `agency.service.ts`,
> `packages/shared-types/src/api-schemas.ts`)。以下の差分記述は着手前の調査時点の
> ものを保持する(何が問題だったかの記録として)。`agent_code`キー化のみ未対応のまま。

### 差分（対応前の調査結果）

- 現行実装のリクエストスキーマ `AgencySyncRequestSchema`
  (`packages/shared-types/src/api-schemas.ts:65-83`, Zod, `.passthrough()`) が受け取るのは
  `event` / `dry_run` / `source` / `external_id`(必須) / `parent_external_id` /
  `common_user_id` / `referral_token` / `name` / `contact_name` / `contact_email` /
  `login_email` / `phone` / `role` / `role_label` / `status` のみ。
- **`event`値による分岐処理が存在しない**。
  `apps/api/src/agency/agency.controller.ts:32` は `event === "connection_test"` の
  特殊扱いのみで、ガイド§11.1が列挙する `admin_created` / `admin_updated` /
  `role_updated` / `approved` / `promoted` / `deactivated` / `deleted` / `lead_created` /
  `common_user.merged` / `common_user.assigned_agent.updated` は**すべて同じ汎用
  `syncAgency()`（`agency.service.ts:35-74`）にフォールスルーし、単純なupsertとして
  処理される**。
- 特に `common_user.merged` イベント（ガイド§11.2でペイロード例が示されている
  `identities[]` / `system_links[]` / `agency_relations[]` /
  `details.{source_common_user_id, target_common_user_id, reason, operated_by_type}`）は、
  対応するフィールドが現行スキーマに存在せず、`.passthrough()`により`rawPayload`
  (`agency.service.ts:48`)には保存されるものの、**意味的な解釈・反映は一切行われない**
  （アカウント統合や担当代理店変更としての処理が起きない）。
- アカウント紐づけキーは **`external_id`**（`agency.service.ts:51`:
  `{ serviceIntegrationId, externalUserId: body.external_id }`）であり、ガイド§4が
  明示的に推奨する **`agent_code`（代理店の公開一意識別子）とは異なる**。現行スキーマに
  `agent_code`フィールド自体が存在しない。

### 影響範囲

- `lead_created`（LP問い合わせ発生）や`common_user.merged`（アカウント統合）等の
  意味的に重要なイベントが送られてきても、ウォレット側では単なる代理店情報の
  upsertとして処理されるだけで、統合履歴の記録・担当代理店の更新・問い合わせ管理画面への
  反映等は起きない。管理画面`/agency-links`はあくまで`account_links`のPENDING/ACTIVE/
  REVOKED状態を表示するのみで、共通顧客HUBの統合・担当変更を表示する機能もない。
- `external_id`ベースのキー設計は、sengoku-ai.com側で内部ID体系が変わった場合に
  追随できないリスクを持つ（ガイド§4がまさにこの理由で`agent_code`使用を推奨している）。

### 必要API・スキーマ変更（案）

- ~~`event`値によるハンドラ分岐（特に`common_user.merged`/
  `common_user.assigned_agent.updated`の専用処理）の新設。~~ **対応済み**
  (`AGENCY_HUB_EVENT_TYPES`/`AGENCY_DEACTIVATION_EVENT_TYPES`,
  `AgencyService.recordHubEvent()`)。
- `AgencySyncRequestSchema`に`agent_code`フィールドを追加し、アカウント紐づけの主キーを
  `external_id`から`agent_code`へ移行するかどうかの判断は**未対応のまま**
  (今回は`agent_code`を任意フィールドとしてmetadataに保存するのみ追加し、
  紐づけキーは互換性維持のため`external_id`を継続使用)。

### データ移行の有無

**要検討**。既に`external_id`をキーとして作成済みの`AccountLink`行がある場合、
`agent_code`への切替えは移行（またはマッピング）が必要になる可能性がある。

---

## 3. 受信側: SSOログイン (`packages/auth/src/agency-sso.ts`)

### 差分（ガイドとほぼ整合、軽微な差分あり）

- 署名検証(RS256/JWKS)・`iss`/`aud`/`exp`/`iat`検証・`jti`のリプレイ防止は実装済みで
  ガイド§12.2・12.5と整合。JWKS URL既定値(`SENGOKU_AI_JWKS_URL`、
  `docs/agency-integration.md:92`)もガイド記載の
  `https://sengoku-ai.com/api/sso/jwks.php`と完全一致。
- ガイド記載の全クレーム(`role_level`/`role_label`/`agency_name`/`contact_name`/
  `contact_email`/`actor_id`/`actor_name`/`actor_email`/`client_key`/`client_name`)は
  読み取り済み(`agency-sso.ts:94-103`)。
- 差分1: **`return_to`クレームが一切読まれていない**
  （`AgencySsoClaims`インターフェース`agency-sso.ts:12-25`に存在しない）。ガイドでは
  「外部ポータル内の遷移先パス」を指定する任意項目だが、現行実装ではSSOログイン後の
  遷移先制御にこの値を使えない。
- 差分2: ガイド§12.2は「JWT有効期限: 発行から60秒」という**厳格な短時間ウィンドウ**を
  仕様として明記しているが、現行実装は`jose.jwtVerify`の一般的な`exp`検証
  （`clockTolerance`既定5秒、`agency-sso.ts:70-75`）のみで、「60秒以内」という
  仕様値そのものを追加検証してはいない（`exp`自体を信頼する設計。実害は小さいが、
  仕様上の防御的二重チェックは行っていない）。
- 差分3: ガイド§12.1の起動URL(`GET /agent/sso_launch.php?client={client_key}`)は
  sengoku-ai.com側の実装であり、ウォレット側は関与不要（検証側のみ実装すればよい）。
  現状これに対応するコード・ドキュメント言及は無いが、**ウォレット側の実装対象では
  ないため問題ない**。

### 影響範囲

軽微。`return_to`未対応によりSSOログイン後の遷移先をURLパラメータで制御できない
（現状は固定の遷移先と推測される）程度。

### 必要API

無し（クライアント側の追加パース処理のみ）。

### データ移行の有無

無し。

---

## 4. 送信側: ウォレット → sengoku-ai.com（共通顧客ID・紹介capture/confirm・階層取得）

> **部分対応済み**: `POST /api/common-users/resolve`のみ実装した
> (`apps/api/src/common-user-hub/common-user-hub.client.ts`)。新規アカウント登録時
> (メール/LINE/戦国パスポートSSO/代理店SSOの4経路、既存ユーザーの一括移行は対象外)に
> ベストエフォートで呼び出し、`OveAccount.commonUserId`へ保存する。
> `ENABLE_PLATFORM_USER_ID`(既定false、Feature Flagのため環境変数のみ)と、
> 送信先URL・system_key・APIキーの両方が揃わないと動作しない。後者3つは環境変数
> ではなく、管理画面(`/common-user-hub-config`、`AdminCommonUserHubService`)から
> `common_user_hub_config`テーブル(シングルトン行、APIキーはAES-256-GCM暗号化)へ
> 設定する — 当初は環境変数のみだったが、管理画面からAPIキーをローテーションできる
> 必要があったため追加対応した。`POST /api/common-users/{id}/system-links`は
> クライアントメソッドとしては実装済みだが、まだどこからも呼び出していない
> (resolve単体で新規登録時のリンクは完結するため。既知のcommon_user_idへ後から
> 追加リンクするユースケース向けに残してある)。`referrals/capture`・`confirm`・
> `hierarchy.php`は引き続き未実装。以下の差分記述は着手前の調査結果を保持する。

### 差分（対応前の調査結果）

**該当するコードが一切存在しない**。具体的に確認した内容:

- `AgencyReferralClient`のようなクラスは実装コード上に存在せず、ドキュメント内でのみ
  言及されている（`docs/agency-referral.md:128`,
  `docs/integration/AGENCY_REFERRAL_PHASE2_PLAN.md:22,34-40`）。
- `apps/api/src`・`packages/`全体を検索しても、sengoku-ai.comへ向けた
  outbound HTTPクライアント（`fetch`/`axios`/`HttpService`/`got`等）は存在しない。
- ガイドが定義する以下のAPIはすべて未呼出:
  - `POST /api/common-users/resolve`（`system_key`+`external_user_id`から
    `common_user_id`を解決・新規発行）
  - `POST /api/common-users/{common_user_id}/system-links`（ウォレットの
    `wallet_account_id`相当を追加紐づけ）
  - `POST /api/referrals/capture`（紹介URL流入時の記録）
  - `POST /api/referrals/confirm`（登録・購入確定時の成果反映）
  - `GET /api/hierarchy.php`（代理店階層・LP URL取得）
- 現行の紹介受付フロー(`/invite/{token}` → `GET /api/v1/referrals/capture`)は、
  **ウォレット内部の`wallet_referrals`テーブルに完結して保存するのみ**で、
  sengoku-ai.comの`referrals/capture`/`confirm`APIを呼び出す設計にはなっていない
  （`integration_outbox`に登録して将来送信する計画のみで、実際の宛先ハンドラは
  未登録。`AGENCY_REFERRAL_PHASE2_PLAN.md:16-17`参照）。
- `GET /api/hierarchy.php`が未呼出であること自体は、既存の設計判断
  （`WalletReferral`モデルのコメント「代理店のランク・階層情報自体はウォレット側で
  永続管理しない」）と**整合的**であり、単純な抜け漏れではなく意図した範囲外という
  位置づけ。ただし将来、管理画面で代理店階層を表示する要件が出た場合は新規実装が必要。
- **「AI受信用APIキー」（ウォレットがsengoku-ai.comへ送信する際に使う、
  sengoku-ai.com発行の鍵）が env/config のどこにも存在しない**
  （`.env.example`, `packages/config/src/env.ts:50-51`は`ENABLE_AGENCY_REFERRAL_SYNC`/
  `ENABLE_AGENCY_SYNC_RETRY`のみ）。現行実装は「外部サービス受信用APIキー」
  （sengoku-ai.comがウォレットへ送る際に使う鍵、`service_integrations`テーブルに保存済み）
  しか持っておらず、**送信方向の鍵がそもそも発行・保管されていない**。
- `Idempotency-Key`ヘッダーの送受信ロジックはコード上どこにも存在しない
  （ウォレット自身の外部連携APIが持つ`idempotency_key`はリクエストボディの
  フィールドであり、ガイドが規定するHTTPヘッダー方式とは別の仕組み）。

### 影響範囲

- Phase 2（代理店システムへの実送信・確認結果反映）着手時に、**ゼロから実装が必要**。
  既存の`integration_outbox`基盤（送信キュー・再送機構）は流用できるが、
  実際にsengoku-ai.comのAPIを叩くクライアントコード・認証鍵管理・レスポンス
  ハンドリング（`common_user_id`の受領・`agent_link_status`の反映等）はすべて新設。
- 現行の紹介トークン受付フロー自体（Cookie発行・DB保存・冪等性制御）は
  「sengoku-ai.comへの送信」を除けば方針書の要求とおおむね整合しており、
  **送信部分だけを後付けで接続する設計は可能**（`docs/agency-referral-decisions.md`の
  「進め方の提案」で示されていた段階的実装方針がそのまま活きる）。

### 必要API（新設、ウォレット側に実装すべきクライアントコード）

- sengoku-ai.comへの`POST /api/common-users/resolve`呼び出し
  （ウォレット新規登録時、または既存アカウントとの初回連携時）
- `POST /api/common-users/{common_user_id}/system-links`呼び出し
  （ウォレットの`wallet_account_id`をHUBへ登録）
- `POST /api/referrals/capture`/`POST /api/referrals/confirm`呼び出し
  （現行の`wallet_referrals`ローカル保存に加えて、または置き換えて）
- 必要であれば`GET /api/hierarchy.php`呼び出し（管理画面表示用、優先度低）
- 「AI受信用APIキー」の受け取り・保管の仕組み（既存の`service_integrations`の
  `signingSecretEncrypted`的な暗号化保存の仕組みを転用可能と推測されるが、
  現状`AGENCY_SYSTEM`の`service_integrations`行は「外部サービス受信用」の鍵のみを
  保持する設計になっており、送信用鍵を別途保持するにはスキーマ拡張が必要）

### データ移行の有無

無し（新規に呼び出すAPIであり、既存データの構造変更は伴わない）。ただし
`POST /api/common-users/resolve`を初めて呼び出す際、既存の全`OveAccount`に対して
一括で`common_user_id`解決を行うバッチが必要になる可能性がある
（これは既報告の「共通ID移行」の一部として吸収される）。

---

## 5. エラーフォーマットの不一致

> **対応済み**: sengoku-ai.com等の外部システムが直接叩くAPI
> (`POST /api/integrations/agencies`、`POST /api/v1/rewards/grant`、
> `POST /api/v1/transactions/debit`、`POST /api/v1/transactions/{id}/reverse`)
> のみ、ガイド形式 `{ok:false, error:{code,message}}` を返す
> `ExternalApiExceptionFilter`(`apps/api/src/common/external-api-exception.filter.ts`)
> を個別適用した。ウォレット自身のフロントエンド(apps/user-wallet, apps/admin-wallet)
> が使うセッション認証APIは`lib/api.ts`が`body.message`を直接読む実装のため、
> 影響範囲をこの4エンドポイントに限定し、グローバルの`LedgerExceptionFilter`
> (内部向け・全体適用)は変更していない。以下の差分記述は着手前の調査結果を保持する。

### 差分（対応前の調査結果）

- ガイド§13の標準エラー形式は `{ok: false, error: {code, message}}`
  （`code`は`INVALID_API_KEY`/`VALIDATION_ERROR`等の安定した文字列）。
- 現行ウォレットの外部向けAPIのエラー形式（`apps/api/src/common/ledger-exception.filter.ts`）
  は `{error: <例外クラス名>, message, requestId}` という**独自形式**で、`ok`フィールドも
  無く、`code`も安定した機械可読コードではなく例外クラス名そのもの
  （例: `InsufficientBalanceError`）。NestJSの汎用`HttpException`分岐
  （同ファイル51-58行目）はNestデフォルトの`{statusCode, message, error}`形式のままで、
  こちらもガイド形式と異なる。

### 影響範囲

- 双方向で影響し得る:
  1. sengoku-ai.com側がウォレットの`POST /api/integrations/agencies`受信結果を
     ガイド標準形式で解釈しようとした場合、現行のエラーレスポンス形式とは
     一致しない（相手側の実装次第では単なるHTTPステータスコードのみで
     十分機能する可能性もあり、実害の有無は要確認）。
  2. ウォレットが将来sengoku-ai.comへ送信する側になった際（前項4）、
     受け取るエラーレスポンスの`{ok, error.code}`形式を正しくパースする
     クライアントコードの実装が必要（現行にはそのようなパーサーは存在しない）。

### 必要API・実装内容（対応済み）

- `apps/api/src/common/ledger-error-classification.ts`: 台帳コアの例外クラス→
  HTTPステータス区分の対応表を`LedgerExceptionFilter`と共有する形で切り出し。
- `apps/api/src/common/external-api-exception.filter.ts`: 新規の
  `ExternalApiExceptionFilter`。`BadRequestException`→`VALIDATION_ERROR`、
  `UnauthorizedException`→`API_KEY_REQUIRED`/`INVALID_API_KEY`(メッセージに
  "missing"を含むかで判定)、`ServiceUnavailableException`→`FEATURE_DISABLED`、
  台帳ドメイン例外→例外クラス名、その他→`INTERNAL_ERROR`にマッピングする。
- `AgencyController`(クラス単位)・`TransactionsController`(クラス単位、
  debit/reverse共に外部向けのため)・`RewardsController.grant`(メソッド単位、
  同controllerの`GET /rewards/public`はセッション認証の内部APIのため対象外)へ
  `@UseFilters(ExternalApiExceptionFilter)`を適用。

### データ移行の有無

無し。

---

## まとめ（サマリ表）

| 領域 | 実装状況 | 差分の大きさ | 必要な対応 |
|---|---|---|---|
| 受信Webhook (`/api/integrations/agencies`) | event別分岐・REVOKED遷移・HUBイベント監査ログ化まで対応済み | 小 | `agent_code`キー化のみ残 |
| SSOログイン | 実装済み・ほぼ整合 | 小 | `return_to`クレーム対応（任意） |
| 送信系（resolve/system-links/capture/confirm/hierarchy） | resolveのみ新規登録時に実装済み。system-linksはクライアント実装のみで未呼出。capture/confirm/hierarchyは未実装 | 中 | 送信用APIキーの実際の発行依頼、capture/confirm/hierarchyの実装判断 |
| エラーフォーマット | 対象4エンドポイントのみ`{ok,error:{code,message}}`形式に統一済み | 小 | 送信系API新設時にレスポンスパーサー実装が必要 |

---

以上が調査結果である。本レポート作成にあたり、コード改修は一切行っていない。既存の
`docs/policy-diff-report-4systems.md` / `docs/policy-diff-report-5systems.md` で
「代理店システム内共通顧客HUB」として抽象的に指摘していた内容が、今回のガイドにより
**送信側(resolve/capture/confirm/hierarchy)が実装コード上ゼロである**という具体的事実として
裏付けられた。実装範囲・優先順位は、引き続き個別指示書の提示を待って確定する。
