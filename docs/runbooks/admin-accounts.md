# 管理者アカウントの運用手順

管理者の追加・ロール変更・停止/再開・パスワードの取り扱い
(`apps/api/src/admin/admin-users.service.ts`)。

導入前は初期投入スクリプト (`packages/database/src/seed.ts`) が作る SUPER_ADMIN 1件
しか存在できず、次の機能が実装済みにもかかわらず運用できなかった。

- 6種類のロールによる権限分離 (`RolesGuard`)
- 高額操作の二段階承認 (申請者と承認者に**別々の**管理者が必要)
- 退職者のアカウント無効化 (DBを直接操作するしか手段がなかった)
- 初期パスワードの変更 (変更用のエンドポイントが存在しなかった)

## ロール

| ロール | 想定する担当 |
|---|---|
| `SUPER_ADMIN` | 全操作。管理者アカウントの管理はこのロールのみ |
| `OVE_OPERATOR` | ORIの付与・利用・取消・保留などの日常運用 |
| `INTEGRATION_ADMIN` | 外部サービス連携の設定・APIキー管理 |
| `EVENT_OPERATOR` | イベント関連の運用 |
| `AUDITOR` | 監査ログ・管理者一覧の参照 (変更操作は不可) |
| `VIEWER` | 参照のみ |

最小権限の原則に従い、日常運用は `OVE_OPERATOR` 以下で行い、`SUPER_ADMIN` は
管理者管理が必要なときだけ使うことを推奨する。

## API

| 操作 | エンドポイント | 必要なロール |
|---|---|---|
| 一覧 | `GET /api/v1/admin/admins` | SUPER_ADMIN / AUDITOR |
| 追加 | `POST /api/v1/admin/admins` | SUPER_ADMIN |
| 変更 (表示名・ロール・状態) | `PATCH /api/v1/admin/admins/:id` | SUPER_ADMIN |
| パスワード再発行 | `POST /api/v1/admin/admins/:id/reset-password` | SUPER_ADMIN |
| 自分のパスワード変更 | `POST /api/v1/admin/password` | ログイン中の管理者本人 |

すべての変更操作は `audit_logs` に記録される (`ADMIN_USER_CREATE` /
`ADMIN_USER_UPDATE` / `ADMIN_USER_PASSWORD_RESET` / `ADMIN_PASSWORD_CHANGED`)。
監査ログはDBトリガーで削除・変更できない。

## 手順

### 管理者を追加する

1. SUPER_ADMIN でログインし `POST /api/v1/admin/admins` を実行する
   (`email` / `displayName` / `role`)
2. レスポンスの `initialPassword` を**その場で控える**。ハッシュのみ保存するため、
   後から再表示はできない
3. 初期パスワードは口頭・別経路など、メールとは別の手段で本人へ渡す
4. 本人は初回ログイン後、速やかに `POST /api/v1/admin/password` で変更する
5. 併せて `POST /api/v1/admin/mfa/setup` → `/mfa/enable` でMFAを設定してもらう

### 退職者のアカウントを止める

`PATCH /api/v1/admin/admins/:id` に `{"status": "SUSPENDED", "reason": "..."}` を送る。

**停止は即時反映される。** `AdminAuthGuard` がリクエストのたびにDBから管理者を読み直し
`status !== "ACTIVE"` を拒否するため、ログイン済みのセッションもその場で無効になる
(セッションの有効期限12時間を待つ必要はない)。再ログインも当然できない。

誤って停止した場合は `{"status": "ACTIVE"}` で戻せる。

### パスワードを紛失した管理者を復旧する

SUPER_ADMIN が `POST /api/v1/admin/admins/:id/reset-password` を実行し、返ってきた
`newPassword` を本人へ渡す。古いパスワードは即座に使えなくなる。

**MFAは解除されない。** MFA端末も失っている場合は、パスワードリセットだけでは
ログインできない。これは意図的な設計で、パスワードリセット1操作で二要素を無効化できると
SUPER_ADMIN権限の乗っ取りが1操作で完結してしまうため。MFA端末の紛失時は、DB上の
`mfa_enabled` を落とす作業を別途、記録を残した上で行う。

## 安全のための制限

- **自分自身のロールは変更できない** — 誤操作で自分の権限を失うと復旧できないうえ、
  権限昇格を1人で完結させないため。別の SUPER_ADMIN に依頼する
- **自分自身のアカウントは停止できない**
- この2つにより「有効な SUPER_ADMIN が0人になる」状態は構造的に起こらない。
  このAPIを呼べるのは有効な SUPER_ADMIN 本人に限られ、その本人は自分を降格・停止
  できないため、どの操作の後も操作者自身が必ず残る
- パスワードハッシュ・MFAシークレットはAPIレスポンスに一切含まれない
- 自分でパスワードを変更するときは現在のパスワードを要求する
  (端末を放置した隙の乗っ取り防止)。最小12文字

## 初期管理者について

初期投入スクリプトが `admin@ovewallet.local` を1件作る。本番では次を行うこと。

1. 実担当者の SUPER_ADMIN アカウントを追加する
2. 初期管理者のパスワードを変更するか、アカウントごと `SUSPENDED` にする
   (共有アカウントを残すと監査ログの `actor_id` から実行者を特定できなくなる)

`admin_code` は `code_counters` から採番する (`OVE-ADM-00000001` 形式)。
既存環境では初期投入スクリプトが固定値で作成していたため最初の1回だけ番号が衝突しうるが、
その場合は次の番号で自動的に採り直す (移行用のマイグレーションは不要)。

## 関連ドキュメント

- `docs/admin-operations.md` — 管理画面の全画面説明
- `docs/authentication.md` — 管理者MFA・セッション
- `docs/security.md` — 権限分離・二段階承認
