# AGENTS.md

このリポジトリで作業する人間・AIエージェント双方に適用される禁止事項。
指示書25章に基づく。

## 絶対禁止事項

1. **OVE残高を直接UPDATEする処理を書かない。** `wallets.available_balance` 等を
   `packages/ledger` を経由せず直接更新するコードは追加しない。
2. **完了済み (`COMPLETED`) 取引を削除しない。** delete系のAPI/関数を `ove_transactions`
   に対して追加しない。
3. **完了済み取引の金額・種別・理由を上書きしない。** 訂正は必ず
   `packages/ledger` の `reverseTransaction()` で新しい `REVERSAL` 取引を追加すること。
   元取引の `status` を `REVERSED` に遷移させることのみ許可する。
4. **外部サービスからOVEのデータベースを直接更新する実装を作らない。** 外部連携は
   必ず `apps/api` のREST API (HMAC認証済み) を経由させる。
5. **idempotency keyを省略した付与/減算APIを追加しない。** `packages/ledger` の
   `creditWallet`/`debitWallet`/`reverseTransaction`/`holdBalance`/`releaseHold` は
   すべて `idempotencyKey` を必須パラメータとしており、この制約を緩めない。
6. **秘密情報をログ出力しない。** ワンタイムコード・IDトークン本文・アクセストークン・
   APIシークレット・Cookie・セッション原文・秘密鍵・パスワードをログに出力するコードを
   追加しない。
7. **秘密鍵・シードフレーズを実装しない。** 暗号資産ウォレットの秘密鍵管理機能は
   指示書のMVP対象外であり、実装してはならない。
8. **APIキー・署名シークレット・ワンタイムコードを平文保存しない。**
   - APIキー・パスワード・OTP → `packages/auth` の `hashSecret`/`verifySecret` (scrypt)
   - HMAC署名シークレット → `packages/auth` の `encryptSecret`/`decryptSecret`
     (AES-256-GCM、平文の再取得が必要なため一方向ハッシュにしないこと)
   - セッショントークン → `packages/auth` の `sha256Hex` (検索キーとして使うため
     決定的ハッシュ。scryptは検索キーには使えないので使わないこと)
9. **認証トークンをLocalStorageへ保存しない。** Cookieは `HttpOnly`, `Secure`,
   `SameSite=Lax` を必須とする。
10. **テストなしで台帳処理 (`packages/ledger`) を変更しない。** 変更時は
    `pnpm --filter @ove/ledger test` が通ることを確認し、可能であれば回帰テストを追加する。
11. **マイナス残高を許可する処理を追加しない。** `debitWallet()` の残高チェックを
    バイパスする経路を作らない。
12. **監査ログ (`audit_logs`) を削除できるAPI/画面を追加しない。**

## 変更時の注意 (禁止事項ではないが遵守すること)

- 台帳の整合性チェック式 (`packages/ledger/src/reconcile.ts`) を変更する場合は、
  `HOLD`/`RELEASE`/`REVERSED` の扱いについて `docs/ledger-rules.md` を必ず読むこと。
  実装中にこの式を2回誤り、残高の過大計上バグを作り込んだ経緯がある。
- `apps/api` のテストは Vitest ではなく Jest+ts-jest を使うこと。NestJSの
  デコレータメタデータがesbuild系トランスパイラでは正しく生成されないため。
