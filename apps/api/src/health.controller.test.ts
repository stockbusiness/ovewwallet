import { HealthController } from "./health.controller";

/**
 * `/health` が返す `commit` は、デプロイの待ち合わせ
 * (`.github/workflows/deploy.yml`) が「新しいコンテナへ入れ替わった」ことを
 * 判定する唯一の手掛かり。ここが壊れると、旧コンテナの200応答を新デプロイと
 * 誤認して成功扱いになる (run #39 で実際に起きた)。
 */
describe("HealthController", () => {
  const controller = new HealthController();
  const original = process.env.GIT_COMMIT_SHA;

  afterEach(() => {
    if (original === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = original;
  });

  it("reports the short commit of the running build", () => {
    process.env.GIT_COMMIT_SHA = "db819d7274a34228914202e32f2ae7fdaad7ea0b";
    expect(controller.check().commit).toBe("db819d7");
  });

  it("reports null when the build carries no commit", () => {
    delete process.env.GIT_COMMIT_SHA;
    expect(controller.check().commit).toBeNull();
  });

  it("keeps returning the existing status/timestamp fields", () => {
    const result = controller.check();
    expect(result.status).toBe("ok");
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
