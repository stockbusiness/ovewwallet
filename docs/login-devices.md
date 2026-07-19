# ユーザー向けログインデバイス一覧

2026-07-19実装。`user_sessions`テーブルの`device_id`/`ip_address`/`user_agent`列は
これまでどのコードからも書き込まれておらず(`pending_balance`と同様、存在するだけの
未使用カラムだった)、この機能実装の一環で`ip_address`/`user_agent`を実際に記録する
ようにした (`device_id`は今回も未使用のまま)。

## 変更点

- `AuthService`の各ログインメソッド (`verifyEmailOtpAndLogin`/`loginWithLineMock`/
  `loginWithSengokuSso`/`loginWithAgencySso`) に`SessionMeta`
  (`{ ipAddress?, userAgent? }`) を追加し、`createSessionForAccount()`が
  `user_sessions.ip_address`/`user_agent`に保存するようにした。呼び出し元
  (`AuthController`) は`req.ip`/`req.headers["user-agent"]`をそのまま渡す。
- `SessionAuthGuard`は検証済みセッションの`id`を`req.sessionId`に積むようにした
  (「この端末」判定用)。

## API

- `GET /api/v1/accounts/me/sessions`: 有効なセッション (失効・期限切れを除く) を
  発行日時の新しい順で返す。各行は`id`・`device_label`(User-Agentからの簡易推定、
  「iPhone / Safari」等)・`ip_address`・`issued_at`・`last_used_at`・`is_current`
  (このリクエストで使われているセッションかどうか)。
- `POST /api/v1/accounts/me/sessions/:sessionId/revoke`: 指定したセッションを
  個別に無効化する。`oveAccountId`でスコープしているため、他人のセッションIDを
  指定しても404になる。現在のセッション自身を指定した場合は既存の
  `POST /api/v1/auth/logout`と役割が重複するため拒否はしていないが、UI側では
  「この端末」にログアウトボタンを表示しないことで実質的に防いでいる。
- `POST /api/v1/accounts/me/sessions/revoke-others` (2026-07-19追加): 現在の
  セッション以外を一括で無効化する (「不正利用が疑われる」場合の自衛策)。
  個別ログアウトと同じ理由で、現在のセッション自身は対象外にする。`{ revoked_count }`
  を返す。ルーティング上、動的セグメント`:sessionId`より前に登録している
  (`docs/transaction-export.md`「ルーティング上の注意」と同じ理由で、後に登録すると
  `revoke-others`という文字列がsessionIdとして解決されてしまう)。

## UI

`/wallet/devices` (メニュー画面から「ログイン中の端末」でアクセス)。各端末の
User-Agent推定ラベル・最終利用日時・ログイン日時を表示し、「この端末」以外には
個別ログアウトボタンを表示する。2端末以上ログイン中の場合のみ、「この端末以外から
すべてログアウト」ボタンを表示する。

## 動作確認

`apps/api/src/e2e/login-devices.test.ts` (4件): 2端末ログイン時にそれぞれ
is_currentが正しく判定されること、個別ログアウト後にそのセッションのCookieでは
以後認証できなくなること、他人のセッションIDを指定すると404になること、3端末中
2端末を一括ログアウトすると現在のセッションだけが残ることを検証済み。

2026-07-19、Playwrightによる実ブラウザ確認を実施し、`/wallet/devices`画面で
自分の端末が「この端末」ラベル付きで表示されることを確認した。この確認は単一
セッションでの表示のみであり、2端末を同時にブラウザで開いて一覧に並べて表示・
個別ログアウトする操作までは実施していない (今後の課題、APIレベルでは
`login-devices.test.ts`で検証済み)。

## 既知の制約

- `device_label`はUser-Agent文字列からの簡易な文字列マッチングのみで、専用の
  UA解析ライブラリは使っていない (今後より精密なOS/ブラウザ判定が必要になれば
  差し替える)。
- `device_id`カラムは引き続き未使用。
