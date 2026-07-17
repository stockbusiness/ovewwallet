import * as Sentry from "@sentry/node";
import { initSentry, captureException } from "./sentry";

jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

describe("sentry (SENTRY_DSN未設定時はno-op)", () => {
  const originalDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
  });

  it("does not call Sentry.init or captureException when SENTRY_DSN is unset", () => {
    delete process.env.SENTRY_DSN;

    initSentry();
    captureException(new Error("boom"));

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("initializes and forwards exceptions when SENTRY_DSN is set", () => {
    process.env.SENTRY_DSN = "https://example@o0.ingest.sentry.io/0";

    initSentry();
    expect(Sentry.init).toHaveBeenCalledTimes(1);

    const error = new Error("boom");
    captureException(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
