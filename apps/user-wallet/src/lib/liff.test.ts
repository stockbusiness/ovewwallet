import { describe, expect, it } from "vitest";
import { decideLiffReturn } from "./liff";

/**
 * 2026-09-04、紹介URLからの新規登録が
 * "terms of service agreement is required to create a new account" で止まった。
 *
 * 原因は「LINEからの復帰」の判定に `wasPending` が入っていなかったこと。
 * `liff.login()` が張ったLINEのセッションはブラウザに残るため、同意フラグを
 * 読み捨てた後の再読み込みでも `isLoggedIn()` は true のままで、
 * `termsAccepted=false` を送信して新規アカウント作成が400になっていた。
 */
describe("decideLiffReturn", () => {
  const loggedInWithToken = { loggedIn: true, idToken: "id-token-1" };

  it("ignores a visit that did not start a login, even while LINE is still logged in", () => {
    expect(
      decideLiffReturn({ wasPending: false, termsAccepted: false, ...loggedInWithToken }),
    ).toEqual({ kind: "ignore" });
  });

  it("ignores it regardless of the consumed terms flag", () => {
    // 同意フラグが残っていても、ログイン開始を経ていなければ復帰ではない。
    expect(
      decideLiffReturn({ wasPending: false, termsAccepted: true, ...loggedInWithToken }),
    ).toEqual({ kind: "ignore" });
  });

  it("resumes and carries the consent through when the login actually started", () => {
    expect(
      decideLiffReturn({ wasPending: true, termsAccepted: true, ...loggedInWithToken }),
    ).toEqual({ kind: "resume", idToken: "id-token-1", termsAccepted: true });
  });

  it("keeps termsAccepted false when the user did not agree", () => {
    expect(
      decideLiffReturn({ wasPending: true, termsAccepted: false, ...loggedInWithToken }),
    ).toEqual({ kind: "resume", idToken: "id-token-1", termsAccepted: false });
  });

  it("reports an error when the login started but LINE is not logged in", () => {
    expect(
      decideLiffReturn({ wasPending: true, termsAccepted: true, loggedIn: false, idToken: null }),
    ).toEqual({ kind: "error", reason: "not-logged-in" });
  });

  it("reports an error when the login started but no ID token came back", () => {
    expect(
      decideLiffReturn({ wasPending: true, termsAccepted: true, loggedIn: true, idToken: null }),
    ).toEqual({ kind: "error", reason: "no-id-token" });
  });
});
