import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hmacSign, hmacVerify } from "./crypto";

/**
 * docs/fixtures/hmac-auth-contract-fixtures.json (千ノ国パスポート等の外部連携先と
 * 共有するHMAC署名の契約テストfixture) が、実際のサーバー側実装 (hmacSign/hmacVerify、
 * `${timestamp}.${nonce}.${method}:${path}:${JSON.stringify(body ?? {})}`の組み立て)
 * から乖離していないことを検証する。fixtureの値を手で書き換えても、このテストが
 * 実装との整合性を強制する。
 */
const fixturesPath = join(
  __dirname,
  "../../../docs/fixtures/hmac-auth-contract-fixtures.json",
);
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8"));
const SECRET: string = fixtures.secretUsedForFixedCases;

function canonicalPayload(method: string, path: string, body: unknown): string {
  return `${method}:${path}:${JSON.stringify(body)}`;
}

function signaturePayload(
  timestamp: string,
  nonce: string,
  method: string,
  path: string,
  body: unknown,
): string {
  return `${timestamp}.${nonce}.${canonicalPayload(method, path, body)}`;
}

describe("HMAC契約テストfixture (docs/fixtures/hmac-auth-contract-fixtures.json)", () => {
  it("case1: 通常の付与リクエストの署名が実装と一致する", () => {
    const c = fixtures.cases.case1_normal_grant;
    expect(
      signaturePayload(c.timestamp, c.nonce, c.method, c.path, c.body),
    ).toBe(c.signaturePayload);
    expect(hmacSign(SECRET, c.signaturePayload)).toBe(c.expectedSignature);
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

  it("case3: クエリ文字列を含むfullPathの署名が実装と一致する", () => {
    const c = fixtures.cases.case3_full_path_with_query_string;
    expect(
      signaturePayload(c.timestamp, c.nonce, c.method, c.path, c.body),
    ).toBe(c.signaturePayload);
    expect(hmacSign(SECRET, c.signaturePayload)).toBe(c.expectedSignature);
  });

  it("case4: rawBodySentOverWireとJSON.stringify(body)が完全一致する", () => {
    const c = fixtures.cases.case4_raw_body_matches_signed_body;
    expect(JSON.stringify(c.body)).toBe(c.rawBodySentOverWire);
    expect(
      signaturePayload(c.timestamp, c.nonce, c.method, c.path, c.body),
    ).toBe(c.signaturePayload);
    expect(hmacSign(SECRET, c.signaturePayload)).toBe(c.expectedSignature);
  });

  it("case5: 日本語payloadがエスケープされずに署名対象文字列に含まれる", () => {
    const c = fixtures.cases.case5_japanese_payload;
    expect(c.signaturePayload).toContain("はじまりの旅");
    expect(
      signaturePayload(c.timestamp, c.nonce, c.method, c.path, c.body),
    ).toBe(c.signaturePayload);
    expect(hmacSign(SECRET, c.signaturePayload)).toBe(c.expectedSignature);
  });

  it("case6: 空bodyの署名対象文字列は '{}' である(''ではない)", () => {
    const c = fixtures.cases.case6_empty_body;
    expect(c.canonicalBodyString).toBe("{}");
    // サーバー側実装(req.body ?? {})を模した式。bodyが無い(undefined)場合でも
    // JSON.stringifyの結果は"{}"になる(""にはならない)ことを確認する。
    const missingBody: Record<string, never> | undefined = undefined;
    expect(JSON.stringify(missingBody ?? {})).toBe("{}");
    expect(hmacSign(SECRET, c.signaturePayload)).toBe(c.expectedSignature);
  });

  it("case7: JSONキー順序が異なると署名検証に失敗する", () => {
    const c = fixtures.cases.case7_json_key_order_mismatch;
    expect(hmacSign(SECRET, c.signedSignaturePayload)).toBe(c.signature);
    // サーバーは実際に送信されたbody(キー順序が異なる)から署名対象文字列を再構築するため、
    // 元の署名とは一致しない。
    const serverRecomputedPayload = signaturePayload(
      c.timestamp,
      c.nonce,
      c.method,
      c.path,
      c.butActuallySentBody,
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
});
