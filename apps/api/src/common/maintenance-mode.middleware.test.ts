import type { NextFunction, Request, Response } from "express";
import { maintenanceMode, maintenanceModeMiddleware } from "./maintenance-mode.middleware";

function buildRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; headers: Record<string, string>; body: unknown };
}

function run(method: string, path: string) {
  // ミドルウェアは`req.path`ではなく`originalUrl`を見る (Nestのマウント位置の影響を
  // 受けないため)。実際のリクエストと同じ形にしないと、この単体テストだけが通って
  // 本物のアプリでは除外が効かない、という取り違えが起きる。
  const req = { method, originalUrl: path } as Request;
  const res = buildRes();
  const next = jest.fn() as unknown as NextFunction;
  maintenanceModeMiddleware(req, res, next);
  return { res, next: next as unknown as jest.Mock };
}

describe("maintenanceModeMiddleware", () => {
  const original = process.env.MAINTENANCE_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = original;
    delete process.env.MAINTENANCE_RETRY_AFTER_SECONDS;
    delete process.env.MAINTENANCE_MESSAGE;
  });

  describe("モードの解釈", () => {
    it("未設定・不正値はoffとして扱う", () => {
      delete process.env.MAINTENANCE_MODE;
      expect(maintenanceMode()).toBe("off");
      // 綴り間違いで全リクエストを止めるより、入り損ねる方が安全側
      expect(maintenanceMode({ MAINTENANCE_MODE: "readonyl" })).toBe("off");
      expect(maintenanceMode({ MAINTENANCE_MODE: "" })).toBe("off");
      expect(maintenanceMode({ MAINTENANCE_MODE: "true" })).toBe("off");
    });

    it("大文字・前後の空白を許容する", () => {
      expect(maintenanceMode({ MAINTENANCE_MODE: " ReadOnly " })).toBe("readonly");
      expect(maintenanceMode({ MAINTENANCE_MODE: "FULL" })).toBe("full");
    });
  });

  describe("off", () => {
    it("すべて素通しする", () => {
      delete process.env.MAINTENANCE_MODE;
      expect(run("POST", "/api/v1/admin/login").next).toHaveBeenCalled();
      expect(run("GET", "/api/v1/me/wallet").next).toHaveBeenCalled();
    });
  });

  describe("readonly", () => {
    beforeEach(() => {
      process.env.MAINTENANCE_MODE = "readonly";
    });

    it("閲覧は通す", () => {
      for (const method of ["GET", "HEAD", "OPTIONS"]) {
        expect(run(method, "/api/v1/me/wallet").next).toHaveBeenCalled();
      }
    });

    it("更新系は503にし、Retry-Afterを付ける", () => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const { res, next } = run(method, "/api/v1/me/notices/x/read");
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(503);
        expect(res.headers["Retry-After"]).toBe("300");
      }
    });

    it("管理画面も同じ扱いにする (素通しにすると更新を止めた意味が無くなる)", () => {
      const { res, next } = run("POST", "/api/v1/admin/rewards/grant");
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
    });
  });

  describe("full", () => {
    beforeEach(() => {
      process.env.MAINTENANCE_MODE = "full";
    });

    it("閲覧も含めて503にする", () => {
      const { res, next } = run("GET", "/api/v1/me/wallet");
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(503);
      expect(res.body).toMatchObject({ statusCode: 503, maintenance: true });
    });
  });

  describe("ヘルスチェック", () => {
    it("どのモードでも必ず通す (クエリ付きでも)", () => {
      // 止めるとオーケストレータがコンテナを再起動し続け、メンテナンスのつもりが
      // 本物の障害になる
      for (const mode of ["readonly", "full"]) {
        process.env.MAINTENANCE_MODE = mode;
        expect(run("GET", "/health").next).toHaveBeenCalled();
        expect(run("GET", "/health?probe=readiness").next).toHaveBeenCalled();
      }
    });
  });

  describe("文言と復帰見込み", () => {
    it("環境変数で上書きでき、不正値は既定値に落ちる", () => {
      process.env.MAINTENANCE_MODE = "full";
      process.env.MAINTENANCE_MESSAGE = "本日2:00まで停止しています";
      process.env.MAINTENANCE_RETRY_AFTER_SECONDS = "60";
      const withCustom = run("GET", "/api/v1/me/wallet");
      expect(withCustom.res.headers["Retry-After"]).toBe("60");
      expect(withCustom.res.body).toMatchObject({ message: "本日2:00まで停止しています" });

      process.env.MAINTENANCE_RETRY_AFTER_SECONDS = "0";
      expect(run("GET", "/api/v1/me/wallet").res.headers["Retry-After"]).toBe("300");
    });
  });
});
