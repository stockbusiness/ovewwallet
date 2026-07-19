# 紹介登録特典状況の確認 (ユーザー向け)

2026-07-19実装。`GET /api/v1/me/referral-status`。

## このシステムにおける「紹介」の意味

`docs/agency-referral.md`で詳細を説明している通り、このシステムでの「紹介」は
**代理店システムが発行した紹介URL経由の新規登録**であり、既存のOVEウォレット利用者が
友人を紹介してどちらも得をする、という一般的なリファラルプログラムの仕組みではない。
「紹介者」は代理店であり、OVEウォレット利用者はあくまで「紹介された側」にあたる。

そのため、ユーザー本人が確認できるのは「自分が紹介登録された結果、登録特典
(`REFERRAL_SIGNUP_BONUS`, 既定3,000 OVE) がどうなっているか」のみであり、
「何人紹介したか」を確認する画面ではない (紹介登録でないユーザーが大多数)。

## API

`GET /api/v1/me/referral-status` (要セッション):

- 紹介登録でない場合: `{ "referred": false }`
- 紹介登録済みの場合: `{ "referred": true, "status": "PENDING"|"CONFIRMED"|"REJECTED"|"REVOKED", "amount": "3000", "confirmed_at": "...|null", "reason": "...|null" }`

`status`は`WalletReferralBenefit.status`をそのまま返す。`PENDING`は代理店システムからの
確認待ち (Phase 1の範囲では確定付与自体が未実装、`docs/agency-referral.md`「今後の課題」
参照)、`CONFIRMED`は確定付与済み、`REJECTED`/`REVOKED`は管理者による対象外判定・取消。

## UI

`/wallet/menu` (メニュー画面) のアカウント情報の下に、紹介登録済みユーザーにのみ
「紹介登録特典」セクションを表示する。取得失敗時は表示しないだけで、メニュー画面
自体は表示を継続する (紹介登録でないユーザーが大多数のため、致命的な扱いにしない)。

## 動作確認

`apps/api/src/e2e/referral-status.test.ts` (2件): 紹介登録でないユーザーへの応答、
紹介登録済みユーザーへのPENDING状態の返却を検証済み。

2026-07-19、Playwrightによる実ブラウザ確認を実施し、紹介登録でない通常ユーザーの
`/wallet/menu`画面に「紹介登録特典」セクションが表示されないこと (取得失敗ではなく
`referred: false`による非表示) を確認した。紹介登録URL経由での新規登録から
`CONFIRMED`/`PENDING`状態が実際に画面表示されるまでの一連の流れは、
`ENABLE_WALLET_REFERRAL_TOKEN=true`を設定した起動が必要なため今回は未実施
(今後の課題)。
