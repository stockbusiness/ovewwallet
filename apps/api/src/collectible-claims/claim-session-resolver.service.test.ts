import { encryptSecret, sha256Hex } from "@ove/auth";
import type { ClaimSession } from "@ove/database";
import { ClaimSessionResolver, CLAIM_SESSION_TTL_MS } from "./claim-session-resolver.service";
import type { ClaimSessionRepository, CreateClaimSessionParams } from "./claim-session.repository";

const ENCRYPTION_KEY = "test-only-insecure-encryption-key";

/** `ClaimSessionRepository`の最小限のインメモリfake (Prisma依存を持ち込まない単体テスト用)。 */
class FakeClaimSessionRepository implements Pick<ClaimSessionRepository, "findById" | "findByTokenHash" | "create" | "renewExpiry"> {
  private readonly rows = new Map<string, ClaimSession>();

  async findById(id: string): Promise<ClaimSession | null> {
    return this.rows.get(id) ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<ClaimSession | null> {
    for (const row of this.rows.values()) {
      if (row.tokenHash === tokenHash) return row;
    }
    return null;
  }

  async create(params: CreateClaimSessionParams): Promise<ClaimSession> {
    const row = { ...params, createdAt: new Date() } as ClaimSession;
    this.rows.set(row.id, row);
    return row;
  }

  async renewExpiry(id: string, expiresAt: Date): Promise<ClaimSession> {
    const row = this.rows.get(id);
    if (!row) throw new Error("not found");
    const updated = { ...row, expiresAt };
    this.rows.set(id, updated);
    return updated;
  }

  seed(row: ClaimSession): void {
    this.rows.set(row.id, row);
  }
}

function buildExpiredSession(rawToken: string, overrides: Partial<ClaimSession> = {}): ClaimSession {
  return {
    id: "session-1",
    tokenHash: sha256Hex(rawToken),
    tokenEncrypted: encryptSecret(rawToken, ENCRYPTION_KEY),
    expiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(Date.now() - CLAIM_SESSION_TTL_MS - 1000),
    ...overrides,
  } as ClaimSession;
}

describe("ClaimSessionResolver (千ノ国NFTマーケット契約v2指示書26〜28章)", () => {
  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it("creates a fresh session on first visit and returns outcome=ok", async () => {
    const repo = new FakeClaimSessionRepository();
    const resolver = new ClaimSessionResolver(repo as unknown as ClaimSessionRepository);

    const result = await resolver.resolve("raw-token-1");

    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      expect(result.rawToken).toBe("raw-token-1");
      expect(result.session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("reuses an existing non-expired session when accessed by session id", async () => {
    const repo = new FakeClaimSessionRepository();
    const resolver = new ClaimSessionResolver(repo as unknown as ClaimSessionRepository);
    const rawToken = "raw-token-2";
    const first = await resolver.resolve(rawToken);
    if (first.outcome !== "ok") throw new Error("expected ok");

    const second = await resolver.resolve(first.session.id);

    expect(second.outcome).toBe("ok");
    if (second.outcome === "ok") {
      expect(second.session.id).toBe(first.session.id);
      expect(second.rawToken).toBe(rawToken);
    }
  });

  it("returns session_expired (does not auto-renew) when accessed by an expired session id (指示書27〜28章)", async () => {
    const repo = new FakeClaimSessionRepository();
    repo.seed(buildExpiredSession("raw-token-3", { id: "expired-session" }));
    const resolver = new ClaimSessionResolver(repo as unknown as ClaimSessionRepository);

    const result = await resolver.resolve("expired-session");

    expect(result.outcome).toBe("session_expired");
  });

  it("renews the same session (same id) when the raw token is revisited after expiry (指示書28章)", async () => {
    const repo = new FakeClaimSessionRepository();
    const expired = buildExpiredSession("raw-token-4", { id: "expired-session-2" });
    repo.seed(expired);
    const resolver = new ClaimSessionResolver(repo as unknown as ClaimSessionRepository);

    const result = await resolver.resolve("raw-token-4");

    expect(result.outcome).toBe("ok");
    if (result.outcome === "ok") {
      // Session IDは変えず、有効期限だけ延長する。
      expect(result.session.id).toBe("expired-session-2");
      expect(result.session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.rawToken).toBe("raw-token-4");
    }
  });
});
