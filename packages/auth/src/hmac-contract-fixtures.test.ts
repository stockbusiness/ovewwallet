import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hmacSign, hmacVerify } from "./crypto";

/**
 * docs/fixtures/hmac-auth-contract-fixtures.json (千ノ国パスポート等の外部連携先と
 * 共有するHMAC署名の契約テストfixture) が、実際のサーバー側実装 (hmacSign/hmacVerify、
 * `${timestamp}.${nonce}.${method}:${path}:${rawBody}`の組み立て) から乖離していない
 * ことを検証する。fixtureの値を手で書き換えても、このテストが実装との整合性を強制する。
 *
 * **rawBodyは「実際に送信するボディのバイト列」そのもの**であり、サーバーは受信した
 * 生ボディに署名を検証する (`ExternalApiAuthGuard`)。そのためこのテストでも、fixtureの
 * `rawBody`文字列をそのまま署名対象文字列に埋め込んで検証する — オブジェクトを
 * `JSON.stringify`し直さない。
 */
const fixturesPath = join(
  __dirname,
  "../../../docs/fixtures/hmac-auth-contract-fixtures.json",
);
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
const SECRET: string = fixtures.secretUsedForFixedCases;

function signaturePayload(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  rawBody: string,
): string {
  return `${timestamp}.${nonce}.${method}:${path}:${rawBody}`;
}

/** 固定値ケース共通: signaturePayloadの組み立てと期待署名が実装と一致することを確認する。 */
function expectFixedCaseMatchesImplementation(c: {
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  rawBody: string;
  signaturePayload: string;
  expectedSignature: string;
}): void {
  expect(
    signaturePayload(c.timestamp, c.nonce, c.method, c.path, c.rawBody),
  ).toBe(c.signaturePayload);
  expect(hmacSign(SECRET, c.signaturePayload)).toBe(c.expectedSignature);
}

describe("HMAC契約テストfixture (docs/fixtures/hmac-auth-contract-fixtures.json)", () => {
  it("署名対象文字列の書式がrawBody方式であることを明記している", () => {
    expect(fixtures.signaturePayloadFormat).toBe(
      "${timestamp}.${nonce}.${method}:${path}:${rawBody}",
    );
  });

  it("case1: 通常の付与リクエストの署名が実装と一致する", () => {
    expectFixedCaseMatchesImplementation(fixtures.cases.case1_normal_grant);
  });

  it("case2: timestamp形式(ミリ秒/秒)による署名値の違い", () => {
    const { correct_example: ms, wrong_example_seconds: sec } =
      fixtures.cases.case2_timestamp_must_be_milliseconds;
    expect(hmacSign(SECRET, ms.signaturePayload)).toBe(ms.expectedSignature);
    expect(hmacSign(SECRET, sec.signaturePayload)).toBe(sec.expectedSignature);
    // 署名値は異なる(timestampが署名対象文字列に含まれるため) — 401になるのはタイムスタンプ
    // 検証(サーバーの現在時刻との差分)の話であり、署名計算自体は成功する。
    expect(ms.expectedSignature).not.toBe(sec.expectedSignature);
  });

  it("case3: クエリ文字列を含むfullPathの署名が実装と一致する(bodyの無いGETなのでrawBodyは空)", () => {
    const c = fixtures.cases.case3_full_path_with_query_string;
    expect(c.rawBody).toBe("");
    expectFixedCaseMatchesImplementation(c);
  });

  it("case4: 署名対象文字列の末尾が、実際に送信するrawBodyと完全一致する", () => {
    const c = fixtures.cases.case4_raw_body_matches_signed_body;
    expect(c.signaturePayload.endsWith(c.rawBody)).toBe(true);
    expectFixedCaseMatchesImplementation(c);
  });

  it("case5: 日本語payloadがエスケープされずに署名対象文字列に含まれる", () => {
    const c = fixtures.cases.case5_japanese_payload;
    expect(c.signaturePayload).toContain("はじまりの旅");
    expectFixedCaseMatchesImplementation(c);
  });

  it("case6: 空bodyのrawBodyは '' である('{}'ではない)", () => {
    const c = fixtures.cases.case6_empty_body;
    expect(c.rawBody).toBe("");
    // サーバー側実装(`req.rawBody?.toString("utf8") ?? ""`)を模した式。
    const missingRawBody: Buffer | undefined = undefined;
    expect(missingRawBody?.toString("utf8") ?? "").toBe("");
    expectFixedCaseMatchesImplementation(c);
  });

  it("case7: 署名した文字列と実際に送信した文字列が違うと署名検証に失敗する", () => {
    const c = fixtures.cases.case7_json_key_order_mismatch;
    expect(hmacSign(SECRET, c.signedSignaturePayload)).toBe(c.signature);
    // サーバーは受信した生ボディから署名対象文字列を再構築するため、元の署名とは一致しない。
    const serverRecomputedPayload = signaturePayload(
      c.timestamp,
      c.nonce,
      c.method,
      c.path,
      c.actualSentRawBody,
    );
    expect(serverRecomputedPayload).not.toBe(c.signedSignaturePayload);
    expect(hmacVerify(SECRET, serverRecomputedPayload, c.signature)).toBe(
      false,
    );
  });

  it("case8: nonce再利用時も署名自体はそれぞれ正しく計算できる(拒否理由はnonceの再利用)", () => {
    const { firstRequest, secondRequestSameNonce } =
      fixtures.cases.case8_nonce_reuse;
    expect(hmacSign(SECRET, firstRequest.signaturePayload)).toBe(
      firstRequest.expectedSignature,
    );
    expect(hmacSign(SECRET, secondRequestSameNonce.signaturePayload)).toBe(
      secondRequestSameNonce.expectedSignature,
    );
    expect(firstRequest.nonce).toBe(secondRequestSameNonce.nonce);
  });

  it("case10: 不正なsignatureはhmacVerifyでfalseになる", () => {
    const c = fixtures.cases.case10_signature_mismatch;
    expect(hmacSign(SECRET, c.signaturePayload)).not.toBe(c.sentSignature);
    expect(hmacVerify(SECRET, c.signaturePayload, c.sentSignature)).toBe(false);
  });

  it("case12: 整形済み(インデント付き)bodyでも、そのrawBodyに署名すれば実装と一致する", () => {
    const c = fixtures.cases.case12_pretty_printed_body_is_accepted;
    expect(c.rawBody).toContain("\n");
    // 詰めた形とは別物であることを明示する(旧実装ではこちらでないと通らなかった)。
    expect(c.rawBody).not.toBe(JSON.stringify(c.body));
    expectFixedCaseMatchesImplementation(c);
  });
});
