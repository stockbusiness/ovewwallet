# ユーザー向け退会/アカウント削除フロー

2026-07-19実装。`OveAccount.status`の`CLOSED`値と`closedAt`列は以前から
スキーマに存在していたが、これまでどのコードからも設定されていなかった
(`pending_balance`等と同様の「存在するだけの未使用項目」)。この機能実装で
実際に使うようにした。

## 設計方針

台帳システムであるため、退会は物理的なデータ削除ではなく`OveAccount.status`を
`CLOSED`にするソフトクローズとして実装した (取引履歴は監査要件上そのまま残る)。

- **残高が残っている場合は退会できない** (`available_balance`・`held_balance`が
  共に0であることが条件)。失効させて没収するのではなく、使い切ってから退会して
  もらう方針 (`docs/credit-expiry.md`の失効機能とは別物で、退会時の残高は自動的には
  失効しない)。
- 退会に成功すると、そのアカウントの有効なセッションを全て失効させる
  (`revokeReason: "USER_ACCOUNT_CLOSURE"`、管理者の「全セッション無効化」と同様の
  仕組みを流用)。
- 退会済みアカウントは**同じidentity (LINEユーザーID等) で再ログインしようとしても
  拒否される** (`AccountsService.findOrCreateByIdentity`で`status === "CLOSED"`を
  検出し403を返す)。新しいアカウントとして再作成することもしない (同一identityでの
  退会→再登録の繰り返しを許さない)。
- `SessionAuthGuard`にも`status === "CLOSED"`のチェックを多層防御として追加している
  (通常は退会処理自体が全セッションを失効させるため到達しないはずの経路)。

## API

- `POST /api/v1/accounts/me/close`: 退会する。残高が残っていれば400、既に退会済み
  なら409、成功時は`{ closed: true }`を返す。

## UI

`/wallet/menu`画面の一番下に「退会する」リンクを設置。`window.confirm`で確認した後
API呼び出し、成功時はブラウザ側のCookieを消すため`POST /api/v1/auth/logout`も
続けて呼び (サーバー側セッションは既に退会処理で失効済みのため、これは単なる
Cookie削除)、ログイン画面へ遷移する。残高が残っている場合のエラーメッセージは
「残高が残っているため退会できません。OVEを使い切ってから再度お試しください。」
と具体的に案内する。

## 動作確認

`apps/api/src/e2e/account-closure.test.ts` (3件): 残高が残っている場合の400、
残高0での退会成功・以後のセッション無効化・同一LINEユーザーIDでの再ログイン拒否、
既に退会済みアカウントへの重複退会リクエストの409 (サービス層を直接検証、退会に
成功すると自分のセッションも失効するためHTTP経由では再現できないケース)。実ブラウザ
での確認は未実施 (今後の課題)。

## 既知の制約・今後の課題

- Walletの`status`は変更していない (`WalletStatus`enumに`CLOSED`相当の値が無く、
  台帳コア(`packages/ledger`)の`assertWalletActive`等への影響範囲が大きいため今回は
  見送った)。退会条件で残高を0に限定しているため実害は小さいが、理論上は退会後の
  アカウントに対して外部サービスからの新規CREDITが技術的には可能なままである
  (`findOrCreateByServiceLink`はaccount_linksからの解決であり、今回のCLOSEDチェックは
  `findOrCreateByIdentity`側にしか入れていない)。
- 管理者側の「全セッション無効化」機能 (`docs/admin-operations.md`) とは別の仕組み
  として実装しており、管理画面から退会済みアカウントを一覧で確認する機能は無い
  (`AdminAccountsService`等への追加は今回の範囲外)。
- 退会の取り消し (再開) 機能は無い。
