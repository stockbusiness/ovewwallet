# 実装計画

## 現状分析 (作業開始前の確認結果)

- リポジトリ `stockbusiness/ovewwallet` は空 (コミットなし) のため、新規モノレポとして構築した。
- Node.js v22.22.2 / pnpm 10.33.0 が利用可能。
- ローカル検証用に PostgreSQL 16 と Redis 7 をこの開発環境内で起動し、実データベースに対してテストを実行した (モック無し)。

## フェーズ進行状況 (今回の実装範囲: フェーズ1〜3 + フェーズ4/5/6の一部)

| フェーズ | 内容 | 状態 |
|---|---|---|
| 1 | モノレポ・Next.js・NestJS・PostgreSQL・Prisma・共通型・Swagger・Docker Compose | 完了 |
| 2 | OVE_ACCOUNT_ID・account_identities・LINE認証(モック)・メールOTP・OVEセッション・管理者認証・権限制御 | 完了 (規約同意の永続化は未実装) |
| 3 | ウォレット自動作成・CREDIT/DEBIT/REVERSAL/HOLD/RELEASE・idempotency・行ロック・残高整合性検査 | 完了 (実PostgreSQLでの並行処理テスト込み) |
| 4 (一部) | 登録特典/AIアート特典ルール・個別付与・CSV一括付与 | 完了 (簡易版、詳細は各docs参照) |
| 5 (一部) | APIキー管理・HMAC署名・戦国パスポートSSO(モック)・APIログ(最小) | 主要部分完了 |
| 6 (一部) | 発行量ダッシュボード・監査ログ検索 | 主要部分完了。アカウント統合・承認フロー本実装・オンチェーン移行は未着手 (データ構造のみ) |

## 作業単位分割

1. `packages/config`, `packages/shared-types` — 環境変数検証・共通enum/DTO
2. `packages/database` — Prisma schema (13必須テーブル + 補助テーブル4つ)、seed
3. `packages/auth` — 暗号ユーティリティ・セッション・メールOTP・SSOモック・HMAC認証
4. `packages/ledger` — 台帳コア (CREDIT/DEBIT/REVERSAL/HOLD/RELEASE/整合性チェック)
5. `apps/api` — NestJS REST API (ユーザー向け・外部サービス向け・管理者向け)
6. `apps/user-wallet` — ユーザー向けNext.jsアプリ
7. `apps/admin-wallet` — 管理者向けNext.jsアプリ
8. ドキュメント一式

各単位ごとに型チェック・テストを実行し、`apps/api` 完成後は実サーバーを起動して
ブラウザ操作 (Playwright) による実動作確認を行った。
