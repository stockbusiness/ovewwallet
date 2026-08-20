# 運用手順: ServiceIntegrationへのscope付与

対象: `service_integrations.allowed_scopes`(PR-W2、`packages/database/prisma/migrations/20260820170000_add_service_integration_allowed_scopes/`)

## 前提

- `allowed_scopes`は既定で空配列(無権限)。`POST /api/v1/service/accounts/by-common-user-id/balance`
  等、scope制御されたAPIを外部システムが使うには、この手順で個別に付与する必要がある。
- 本番環境への付与は、この手順を実行する前に**別途Go承認**を得ること
  (千ノ国5システム改修の承認フローに従う。マイグレーション適用・機能フラグ有効化と同様、
  コード変更のマージだけでは有効化されない)。
- 現時点では管理画面(admin-wallet)に編集UIが無いため、Railwayコンソール上のPostgres接続
  (`psql`)から直接実行する。将来的に管理画面から実行できるようにする場合、または冪等な
  CLIスクリプト(`packages/database/scripts/grant-service-scope.ts`相当)を用意する場合は、
  別PRとして起票する。

## 手順

1. **対象確認**: IDとservice_codeの両方が一致することを確認する(取り違え防止)。

   ```sql
   SELECT id, service_code, status, allowed_scopes
   FROM service_integrations
   WHERE id = '<TARGET_ID>' AND service_code = '<EXPECTED_SERVICE_CODE>';
   -- 例: service_code = 'SENGOKU_PASSPORT'
   ```

   1行も返らない場合は中止し、IDとservice_codeの組み合わせを再確認する。
   返った行の`allowed_scopes`(更新前の値)を、下記4節の運用記録へ書き写しておく。

2. **トランザクション内で更新**: 既存scopeを消さず、必要scopeだけを追加する
   (`array_cat`+`DISTINCT`で重複を防ぐ)。

   ```sql
   BEGIN;

   UPDATE service_integrations
   SET allowed_scopes = (
     SELECT array_agg(DISTINCT scope)
     FROM unnest(allowed_scopes || ARRAY['wallet.balance.read.common-user']) AS scope
   )
   WHERE id = '<TARGET_ID>' AND service_code = '<EXPECTED_SERVICE_CODE>';
   ```

   直後に `psql` が表示する `UPDATE <件数>` が **必ず1件** であることを確認する。
   0件ならWHERE条件の不一致(対象が存在しない)、2件以上なら本来あり得ない
   (idがPRIMARY KEYのため) — いずれの場合も`ROLLBACK;`して原因を調査する。

3. **更新後の値を確認してからコミット**:

   ```sql
   SELECT id, service_code, allowed_scopes FROM service_integrations WHERE id = '<TARGET_ID>';
   ```

   意図した値(既存scope + 追加したscope)になっていることを目視確認してから:

   ```sql
   COMMIT;
   ```

4. **運用記録を残す**: 誰が・いつ・何を対象に・どのscopeを追加したかを、チームの運用記録
   (このリポジトリのIssue/PRコメント、または運用ログシートなど)に残す。

   | 実施者 | 実施日時(UTC) | 対象ServiceIntegration(id / service_code) | 追加scope                         | 更新前allowed_scopes | 承認者 |
   | ------ | ------------- | ----------------------------------------- | --------------------------------- | -------------------- | ------ |
   |        |               |                                           | `wallet.balance.read.common-user` |                      |        |

## 剥奪(取り消し)手順

上記2節のUPDATE文の代わりに、以下で該当scopeだけを配列から除去する(他のscopeは残す)。
同様に1件更新であることを確認してからコミットする。

```sql
UPDATE service_integrations
SET allowed_scopes = array_remove(allowed_scopes, 'wallet.balance.read.common-user')
WHERE id = '<TARGET_ID>' AND service_code = '<EXPECTED_SERVICE_CODE>';
```
