import type { NextFunction, Request, Response } from "express";
import { csrfProtectionMiddleware } from "./csrf-protection.middleware";

function makeReq(overrides: {
  method?: string;
  origin?: string;
  contentType?: string;
}): Request {
  const headers: Record<string, string> = {};
  if (overrides.origin !== undefined) headers.origin = overrides.origin;
  if (overrides.contentType !== undefined) headers["content-type"] = overrides.contentType;
  return { method: overrides.method ?? "POST", headers } as unknown as Request;
}

function makeRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
}

describe("csrfProtectionMiddleware", () => {
  const ALLOWED = "https://admin.example.com";
  let next: NextFunction & jest.Mock;
  const originalAppUrl = process.env.APP_URL;
  const originalAdminUrl = process.env.ADMIN_URL;

  beforeEach(() => {
    next = jest.fn() as NextFunction & jest.Mock;
    process.env.ADMIN_URL = ALLOWED;
    delete process.env.APP_URL;
  });

  afterAll(() => {
    process.env.APP_URL = originalAppUrl;
    process.env.ADMIN_URL = originalAdminUrl;
  });

  it.each(["GET", "HEAD", "OPTIONS"])("lets %s through from any origin", (method) => {
    const { res, status } = makeRes();
    csrfProtectionMiddleware(makeReq({ method, origin: "https://evil.example.com" }), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows a JSON POST from an allowed origin", () => {
    const { res, status } = makeRes();
    csrfProtectionMiddleware(
      makeReq({ origin: ALLOWED, contentType: "application/json" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("allows a POST with no Origin header (server-to-server)", () => {
    const { res, status } = makeRes();
    csrfProtectionMiddleware(makeReq({ contentType: "application/json" }), res, next);
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects a POST from a disallowed origin", () => {
    const { res, status } = makeRes();
    csrfProtectionMiddleware(
      makeReq({ origin: "https://evil.example.com", contentType: "application/json" }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  // HTMLフォームが送信できるContent-Typeはこの3種類だけ。いずれもプリフライトが
  // 発生しない単純リクエストのため、オリジンが許可済みでも一律で拒否する。
  it.each([
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=----abc",
    "text/plain",
    "text/plain; charset=utf-8",
    "TEXT/PLAIN",
  ])("rejects the simple-request content type %s even from an allowed origin", (contentType) => {
    const { res, status } = makeRes();
    csrfProtectionMiddleware(makeReq({ origin: ALLOWED, contentType }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });

  it("skips origin validation when no allowed origins are configured", () => {
    delete process.env.APP_URL;
    delete process.env.ADMIN_URL;
    const { res, status } = makeRes();
    csrfProtectionMiddleware(
      makeReq({ origin: "https://anything.example.com", contentType: "application/json" }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it("still rejects a form-encoded POST when no allowed origins are configured", () => {
    delete process.env.APP_URL;
    delete process.env.ADMIN_URL;
    const { res, status } = makeRes();
    csrfProtectionMiddleware(
      makeReq({ origin: "https://evil.example.com", contentType: "application/x-www-form-urlencoded" }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
  });
});
