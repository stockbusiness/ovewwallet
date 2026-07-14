# テスト計画と実施結果

## 単体・統合テスト (`packages/ledger`, Vitest, 実PostgreSQL接続)

実行: `pnpm --filter @ove/ledger test`

| テストファイル | 内容 | 結果 |
|---|---|---|
| `credit-debit.test.ts` | CREDIT/DEBIT・idempotency・残高不足拒否・非ACTIVEウォレット拒否 | 5件 成功 |
| `reversal-hold.test.ts` | REVERSAL (CREDIT/DEBIT双方向)・元取引不変・HOLD/RELEASE | 5件 成功 |
| `concurrency.test.ts` | **指示書18章の必須テスト**: 同一idempotency keyで10並列 → 1件のみ作成、
  同一ウォレットへの10並列DEBITで残高がマイナスにならない | 2件 成功 |
| `reconcile.test.ts` | 整合性一致/不一致検出・自動修正しないこと・REVERSAL/HOLD混在時の整合性 | 4件 成功 |

**合計 16件 全て成功** (最終実行時点)。

## API E2E (`apps/api`, Jest + ts-jest + supertest, 実PostgreSQL接続)

実行: `pnpm --filter @ove/api test`

`src/e2e/golden-path.test.ts`: 新規アカウント作成 → ウォレット自動作成 →
管理者ログイン → 個別付与 → 残高確認 → 取引履歴確認 → 残高不足時の減算拒否(409) →
正常な減算(利用) → ログアウト、の一連のゴールデンパスを自動検証。**1件 成功**。

> 注: NestJSの依存性注入・Swaggerのパラメータ型解決は `emitDecoratorMetadata` に依存するため、
> esbuild系トランスパイラ (tsx, vitestのデフォルト変換) では正しく動作しない
> (実装中に実際に遭遇した問題)。そのため `apps/api` のテストランナーは実TypeScriptコンパイラ
> を使う ts-jest を採用した (Vitestを使う `packages/*` とは異なる構成)。

## 手動E2E (実ブラウザ, Playwright, 実サーバー3本起動)

自動テストに加え、実際に `apps/api` (NestJS) / `apps/user-wallet` / `apps/admin-wallet` の
3サーバーを起動し、Playwrightでヘッドレスブラウザから操作して確認した:

- ユーザー: メールOTPログイン → ウォレットトップ表示 → 取引履歴ページ → OVEについてページ
- 管理者: ログイン → ダッシュボード (整合性チェック結果表示) → ウォレット一覧 →
  ウォレット詳細で個別付与を実行 → 反映確認 → 監査ログページ → CSV一括付与ページ
- 外部API: HMAC署名付きリクエストで rewards/grant, transactions/debit, reverse を実行し、
  正しい署名は成功、リプレイは401、上限超過・重複はそれぞれ想定通りのレスポンスになることを
  curl/Pythonスクリプトで確認

## 実施中に発見・修正した不具合 (実際に見つかったもの)

1. セッショントークンのハッシュ方式が検索キーとして機能しない設計ミス
2. HMAC署名シークレットを一方向ハッシュで保存していた設計ミス (検証不可能)
3. 外部API付与処理で、上限チェックがidempotencyチェックより先に走り、正当な再送が
   誤って拒否される不具合
4. 管理API (`GET /admin/wallets` 等) がPrismaのBigIntフィールドをJSONシリアライズできず
   500エラーになる不具合
5. 整合性チェック式で `REVERSED` 取引を除外していたため、取消のたびに残高が過大計上される不具合
6. 整合性チェック式で `RELEASE` 取引だけを合計に含め `HOLD` を除外し続けていたため、
   保留解除のたびに残高が過大計上される不具合

いずれも実際にAPIを呼び出して初めて発覚したものであり、修正後に自動テスト
(回帰テストを追加したものを含む) と手動確認の両方で解消を確認済み。

## 未実施のテスト (今後の課題)

- LINE本番連携・戦国パスポート本番SSO交換の実機テスト (モックのみ)。
- 管理画面のPlaywright E2Eをリポジトリ内のテストコードとして自動化すること
  (今回は手動実行のみで、CIに組み込めるテストファイルとしては未整備)。
- 負荷・レート制限の限界値テスト。
