# 運用手順: 外部サービス連携(ServiceIntegration)の APIキー・署名鍵ライフサイクル

対象: `service_integrations.api_key_hash` / `service_integrations.signing_secret_encrypted`

千ノ国パスポート「はじまりの旅」連携準備■4への回答。本番Go判定の条件
「鍵の発行・保管・ローテーション・失効手順が承認済みであること」を満たすために整備した。

## 前提

- 平文のAPIキー・署名鍵は**発行時にのみ表示される**。DBには一方向ハッシュ(APIキー)・
  `ENCRYPTION_KEY`による暗号化(署名鍵)でしか保存しないため、以後Wallet側でも
  生値を再取得することはできない(`packages/database/src/issue-service-integration.ts`
  参照)。控え損ねた場合は再発行するしかない。
- **新規の`service_code`追加はエンジニアの作業**。`ServiceCode`はPrismaのenumで、
  値を増やすにはマイグレーションが必要 (`packages/database/prisma/schema.prisma`)。
  既存の`service_code`に対する鍵の再発行は管理画面から行える (下記2章)。
- 本番環境での実行は、この手順を実行する前に**別途Go承認**を得ること
  (千ノ国5システム改修の承認フローに従う。マイグレーション適用・機能フラグ有効化と
  同様、コード変更のマージだけでは有効化されない)。
- 出力される平文値は、実行したターミナルの画面にのみ表示される。ログ・Issue・
  PRコメント・チャット・スクリーンショット等、後から誰でも参照できる場所へ
  貼り付けないこと。連携先へ渡す際は、安全な伝達手段(暗号化メッセンジャー、
  対面での口頭伝達等)を使うこと。

## 1. 新規発行

対象の`service_code`がまだ`service_integrations`に存在しない場合(または存在するが
`--rotate`せず現状維持したい場合)。

```sh
SERVICE_CODE=SENGOKU_PASSPORT ENCRYPTION_KEY=<本番/staging用の実際の値> \
  pnpm --filter @ove/database issue-service-integration
```

- 既に対象の`service_code`が存在する場合、このコマンドは**何もしない**(冪等)。
- 新規作成時の`daily_amount_limit`/`per_request_amount_limit`は既定値
  (それぞれ100万・5万)。学習ミッション向けの上限が別途確定している場合は、
  作成後に個別のUPDATEで調整すること(このスクリプトの対象外)。
- 出力される`api_key`/`signing_secret`を、連携先へ安全な手段で伝達する。

## 2. ローテーション

既存の鍵を失効させ、新しい鍵に差し替える場合(定期ローテーション、鍵の漏えい疑い、
または「発行したはずのstaging既存キーが失われている」ケースの再発行を含む)。

### 管理画面から行う (推奨)

**外部連携 > 外部サービス管理**の対象行にある「APIキー再発行」または
「署名シークレット再発行」を押し、理由を入力する。再発行した値はその場で1回だけ
表示されるので、控えてから閉じる。

サーバーやDBに触れる必要がないため、通常はこちらを使う。誰がいつどの連携の鍵を
差し替えたかは監査ログ (`SERVICE_INTEGRATION_API_KEY_ROTATE` /
`SERVICE_INTEGRATION_SIGNING_SECRET_ROTATE`) に残る。**鍵の生値は監査ログには
記録しない** (記録すると監査ログの閲覧権限がそのまま外部APIの実行権限になるため)。

APIキーと署名シークレットは**別々に**再発行できる。片方だけ漏えいした場合、
連携先へ渡し直す値を最小限にできる。

### CLIから行う

管理画面へログインできない障害時などの代替手段。

```sh
SERVICE_CODE=SENGOKU_PASSPORT ENCRYPTION_KEY=<本番/staging用の実際の値> \
  pnpm --filter @ove/database issue-service-integration --rotate
```

CLIはAPIキーと署名鍵を**両方同時に**再生成する (管理画面のように片方だけにはできない)。

- `id`・`service_code`・利用上限(`daily_amount_limit`等)・`allowed_scopes`は
  変更されない。APIキー・署名鍵のみ再生成する。
- **実行した瞬間に旧キーは無効になる。ロールバックはできない。** 連携先が新しい鍵へ
  切り替える準備ができてから実行すること(切り替えのタイミングを連携先と事前調整する)。
- 新しい`api_key`/`signing_secret`を、連携先へ安全な手段で伝達する。

## 3. 失効

### 3.1 一時停止(緊急停止、鍵は保持したまま)

即座に配信を止めたいが、原因調査後に同じ鍵で再開する可能性がある場合。

```
POST /api/v1/admin/service-integrations/:id/suspend
```

`status`が`SUSPENDED`になり、`ExternalApiAuthGuard`はAPIキー照合時に`status: "ACTIVE"`の
連携のみを対象にするため、直ちに認証が通らなくなる(`docs/admin-operations.md`参照)。
鍵自体(ハッシュ・暗号化値)はDBに残る。再開する場合は同じエンドポイントの`reactivate`を使う。

### 3.2 恒久的な失効(鍵そのものを無効化)

漏えいが確認された、または連携を完全に終了する場合は、上記2節の**ローテーション**を
実行する。ローテーション後の新しい鍵を連携先へ渡さなければ、事実上その連携は使用不能に
なる(専用の「削除」操作は用意していない。`service_integrations`行自体を物理削除すると
`account_links`等の外部キー参照が壊れるため、削除ではなく鍵の無効化で対応する方針)。

## 4. staging既存キーの生存確認(至急対応が必要な場合)

`RUN_SEED_ON_BOOT=true`でのコンテナ起動時、`packages/database/src/seed.ts`が
未登録の`service_code`について自動的にAPIキー・署名鍵を発行し、発行時のログへ
出力する仕様になっている。stagingで過去にこのseedが実行済みで、かつ発行時のログが
保存されていない場合、現在のキーは事実上失われている。

1. `service_integrations`に対象の`service_code`の行が存在するか確認する。
   ```sql
   SELECT id, service_code, status, created_at, last_accessed_at
   FROM service_integrations WHERE service_code = '<対象>';
   ```
2. 行が存在し、かつ発行時のログ(コンソール出力の控え)が見つからない場合は、
   平文キーは再取得不能なので、上記2節の手順でローテーションする。
3. 行が存在しない場合は、上記1節の手順で新規発行する。

## 運用記録

発行・ローテーションを実行した場合は、誰が・いつ・何を対象に実行したかを、
チームの運用記録(このリポジトリのIssue/PRコメント、または運用ログシート等)に残す。
**平文のAPIキー・署名鍵そのものは運用記録に残さないこと。**

| 実施者 | 実施日時(UTC) | 対象ServiceIntegration(id / service_code) | 種別(新規発行/ローテーション) | 承認者 |
| ------ | ------------- | ----------------------------------------- | ------------------------------ | ------ |
|        |               |                                           |                                 |        |
