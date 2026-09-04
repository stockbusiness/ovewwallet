import { ApiError } from "./api";

export interface LineLoginErrorInfo {
  /** 画面に出す日本語のメッセージ。 */
  message: string;
  /**
   * 同じIDトークンで送り直す価値があるか。falseのときは送信待ち
   * (`PENDING_SUBMIT_KEY`) を捨てる — 残すと同じ失敗を再送上限まで繰り返し、
   * 利用者は原因が分からないまま先へ進めなくなる。
   */
  retryable: boolean;
}

/**
 * `POST /api/v1/auth/line/login` の失敗を、利用者が次に何をすればよいか分かる
 * 日本語にする。
 *
 * これまではAPIのメッセージをそのまま画面に出していたため、規約未同意のとき
 * "terms of service agreement is required to create a new account" という英文が
 * 出ていた (2026-09-04に実機で確認)。何を直せばよいのか読み取れない。
 *
 * このエンドポイントのステータスは用途が分かれている。
 * - 400: 新規アカウント作成に規約同意が必要 (`AccountRegistrationService`)。
 *        `idToken` はスキーマ検証済みで必ず送っているため、他の400は起きない。
 * - 401: IDトークンの検証失敗 (期限切れ等)。APIが日本語で理由を返す。
 * - 403: 退会済みアカウント。
 */
export function describeLineLoginError(err: unknown): LineLoginErrorInfo {
  if (!(err instanceof ApiError)) {
    return { message: "LINEログインに失敗しました", retryable: true };
  }

  switch (err.status) {
    case 400:
      return {
        message:
          "利用規約への同意が必要です。「利用規約に同意する」にチェックを入れてから、もう一度LINEでログインしてください。",
        retryable: false,
      };
    case 403:
      return {
        message: "このアカウントは退会済みのためログインできません。",
        retryable: false,
      };
    default:
      return { message: err.message || "LINEログインに失敗しました", retryable: true };
  }
}
