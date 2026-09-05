import { prisma, generateId } from "@ove/database";
import { CollectibleImagesService, MAX_INGEST_ATTEMPTS, servedUrlFor, storageKeyFor } from "./collectible-images.service";
import type { FetchLike } from "./image-fetcher";
import type { ObjectStorageService } from "./object-storage";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22]);

/** 実際のオブジェクトストレージの代わり。put されたものを覚えておく。 */
class FakeStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  configured = true;
  putCalls = 0;

  async isConfigured(): Promise<boolean> {
    return this.configured;
  }
  async put(params: { key: string; body: Buffer; contentType: string }): Promise<void> {
    this.putCalls += 1;
    this.objects.set(params.key, { body: params.body, contentType: params.contentType });
  }
  async get(key: string): Promise<{ body: Buffer; contentType: string | null } | null> {
    return this.objects.get(key) ?? null;
  }
}

function okFetch(body: Buffer = PNG): FetchLike {
  return async () => new Response(new Uint8Array(body), { status: 200, headers: { "content-type": "image/png" } });
}

const failingFetch: FetchLike = async () => new Response(null, { status: 500 });

describe("CollectibleImagesService", () => {
  let storage: FakeStorage;
  let service: CollectibleImagesService;
  const createdUrls: string[] = [];

  function newUrl(): string {
    const url = `https://cdn.example.com/${generateId()}.png`;
    createdUrls.push(url);
    return url;
  }

  beforeEach(() => {
    storage = new FakeStorage();
    service = new CollectibleImagesService(prisma, storage as unknown as ObjectStorageService);
  });

  afterAll(async () => {
    await prisma.collectibleImage.deleteMany({ where: { sourceUrl: { in: createdUrls } } });
    await prisma.$disconnect();
  });

  it("取り込むとストレージへ保存され、STOREDになる", async () => {
    const url = newUrl();
    await service.register(url);
    const row = await service.ingest(url, okFetch());

    expect(row?.status).toBe("STORED");
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.contentType).toBe("image/png");
    expect(row?.byteSize).toBe(PNG.length);
    expect(storage.objects.has(storageKeyFor(row!.sha256!, "image/png"))).toBe(true);
  });

  it("取り込み済みなら再取得しない", async () => {
    const url = newUrl();
    await service.register(url);
    await service.ingest(url, okFetch());
    expect(storage.putCalls).toBe(1);

    await service.ingest(url, okFetch());
    expect(storage.putCalls).toBe(1);
  });

  it("同じ内容が別URLで来てもストレージ上は1つで済む", async () => {
    const a = newUrl();
    const b = newUrl();
    await service.register(a);
    await service.register(b);
    await service.ingest(a, okFetch());
    await service.ingest(b, okFetch());

    // 保存キーは内容のハッシュから決まる。
    expect(storage.objects.size).toBe(1);
  });

  it("取得に失敗するとFAILEDとして理由を残す", async () => {
    const url = newUrl();
    await service.register(url);
    const row = await service.ingest(url, failingFetch);

    expect(row).toBeNull();
    const saved = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
    expect(saved.status).toBe("FAILED");
    expect(saved.attemptCount).toBe(1);
    expect(saved.lastError).toMatch(/status 500/);
  });

  it("取得に失敗しても例外を外へ出さない (付与を止めない)", async () => {
    const url = newUrl();
    await expect(service.registerAndIngest([url], failingFetch)).resolves.toBeUndefined();
    const saved = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
    expect(saved.status).toBe("FAILED");
  });

  it("DBの記録自体に失敗しても例外を外へ出さない", async () => {
    // ここが本命。取得の失敗は ingest が内側で受け止めるため、外側の catch は
    // 「記録すらできなかった」場合のためにある。カードの付与を巻き込んで
    // 失敗させないことを確かめる。
    jest.spyOn(service, "register").mockRejectedValueOnce(new Error("database is unavailable"));
    await expect(service.registerAndIngest([newUrl()])).resolves.toBeUndefined();
  });

  it("ストレージ未設定なら何もしない", async () => {
    storage.configured = false;
    const url = newUrl();
    await service.registerAndIngest([url]);

    expect(await prisma.collectibleImage.findUnique({ where: { sourceUrl: url } })).toBeNull();
  });

  describe("配信URLの解決", () => {
    it("取り込み済みのURLだけ差し替える", async () => {
      const stored = newUrl();
      const notStored = newUrl();
      await service.register(stored);
      const row = await service.ingest(stored, okFetch());

      const resolved = await service.resolveStoredUrls([stored, notStored, null, undefined]);
      expect(resolved.get(stored)).toBe(servedUrlFor(row!.sha256!, "image/png"));
      expect(resolved.has(notStored)).toBe(false);
    });

    it("失敗したものは差し替えない (取得元URLのまま出す)", async () => {
      const url = newUrl();
      await service.register(url);
      await service.ingest(url, failingFetch);

      expect((await service.resolveStoredUrls([url])).has(url)).toBe(false);
    });

    it("空の入力ではDBを引かない", async () => {
      expect((await service.resolveStoredUrls([])).size).toBe(0);
      expect((await service.resolveStoredUrls([null, undefined, ""])).size).toBe(0);
    });
  });

  describe("再取得", () => {
    it("失敗したものを拾い直す", async () => {
      const url = newUrl();
      await service.register(url);
      await service.ingest(url, failingFetch);

      const result = await service.retryPending(10, okFetch());
      expect(result.stored).toBeGreaterThanOrEqual(1);
      const saved = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(saved.status).toBe("STORED");
    });

    it("試行回数の上限に達したものは対象外", async () => {
      const url = newUrl();
      await service.register(url);
      await prisma.collectibleImage.update({
        where: { sourceUrl: url },
        data: { status: "FAILED", attemptCount: MAX_INGEST_ATTEMPTS },
      });

      const result = await service.retryPending(10, okFetch());
      const saved = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(saved.status).toBe("FAILED");
      expect(result.attempted).toBe(0);
    });

    it("ストレージ未設定なら何もしない", async () => {
      storage.configured = false;
      expect(await service.retryPending(10, okFetch())).toEqual({ attempted: 0, stored: 0 });
    });
  });
});
