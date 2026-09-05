import { prisma, generateId } from "@ove/database";
import { CollectibleImagesService, MAX_INGEST_ATTEMPTS, servedUrlFor, storageKeyFor } from "./collectible-images.service";
import { findUnregisteredCatalogUrls } from "./image-catalog";
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
  const createdAssetIds: string[] = [];
  const createdHoldingIds: string[] = [];
  const createdAccountIds: string[] = [];

  function newUrl(): string {
    const url = `https://cdn.example.com/${generateId()}.png`;
    createdUrls.push(url);
    return url;
  }

  beforeEach(() => {
    storage = new FakeStorage();
    service = new CollectibleImagesService(prisma, storage as unknown as ObjectStorageService);
  });

  beforeAll(async () => {
    // 取りこぼしの拾い直しはDB全体のカードを見る。他のテストが作ったカードのURLを
    // 先に対象外にしておかないと、この suite が無関係なURLへ実際に通信してしまう。
    for (const url of await findUnregisteredCatalogUrls(prisma, 1000)) {
      await prisma.collectibleImage.create({
        data: {
          id: generateId(),
          sourceUrl: url,
          status: "FAILED",
          attemptCount: MAX_INGEST_ATTEMPTS,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.collectibleHolding.deleteMany({ where: { id: { in: createdHoldingIds } } });
    await prisma.collectibleAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
    await prisma.oveAccount.deleteMany({ where: { id: { in: createdAccountIds } } });
    // このテーブルはこの機能の作業領域なので丸ごと消す。残しておくと、後続の suite が
    // 「取り込み済み」として配信URLへ差し替えてしまう。
    await prisma.collectibleImage.deleteMany({});
    await prisma.$disconnect();
  });

  /** カードマスターを1件作る。画像URLは取り込み対象へ**登録しない**。 */
  async function createAsset(imageUrl: string, thumbnailUrl?: string) {
    const id = generateId();
    createdAssetIds.push(id);
    return prisma.collectibleAsset.create({
      data: {
        id,
        assetCode: `TEST-${id}`,
        name: "テストカード",
        imageUrl,
        thumbnailUrl: thumbnailUrl ?? null,
      },
    });
  }

  /** 付与済みの保有を1件作る。スナップショットのURLだけがカタログに載る状態を作る。 */
  async function createHolding(snapshotUrl: string) {
    const asset = await createAsset(`https://cdn.example.com/${generateId()}-master.png`);
    createdUrls.push(asset.imageUrl);

    const accountId = generateId();
    createdAccountIds.push(accountId);
    await prisma.oveAccount.create({
      data: { id: accountId, accountCode: `OVE-ACC-TEST-${accountId}` },
    });

    const holdingId = generateId();
    createdHoldingIds.push(holdingId);
    await prisma.collectibleHolding.create({
      data: {
        id: holdingId,
        oveAccountId: accountId,
        collectibleAssetId: asset.id,
        entitlementId: `ent-${holdingId}`,
        sourceSystemKey: "sennokuni-nft-market",
        logicalMarket: "nft-art-market",
        acquiredAt: new Date(),
        imageUrlSnapshot: snapshotUrl,
      },
    });
  }

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

      // 対象の行が触られないことで確かめる。`attempted`の総数はテーブル全体の
      // 状態に左右され、この行の性質ではない。
      await service.retryPending(100, okFetch());
      const saved = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(saved.status).toBe("FAILED");
      expect(saved.attemptCount).toBe(MAX_INGEST_ATTEMPTS);
    });

    it("ストレージ未設定なら何もしない", async () => {
      storage.configured = false;
      expect(await service.retryPending(10, okFetch())).toEqual({ attempted: 0, stored: 0 });
    });
  });

  describe("取りこぼしの拾い直し", () => {
    it("カードマスターの画像URLとサムネイルURLを取り込み対象へ入れる", async () => {
      // 保管先を設定する前に登録されたカードを再現する。registerAndIngest は
      // 未設定のとき登録ごと行わないため、collectible_images に行が無い。
      const imageUrl = newUrl();
      const thumbnailUrl = newUrl();
      await createAsset(imageUrl, thumbnailUrl);

      expect(await service.backfillFromCatalog(50)).toBeGreaterThanOrEqual(2);

      for (const url of [imageUrl, thumbnailUrl]) {
        const row = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
        expect(row.status).toBe("PENDING");
      }
    });

    it("保有側のスナップショットURLも拾う", async () => {
      // カードマスターを差し替えても、配布済みの保有は付与時のURLを表示し続ける。
      // マスターだけを見ると、実際に表示されているURLを取りこぼす。
      const snapshotUrl = newUrl();
      await createHolding(snapshotUrl);

      await service.backfillFromCatalog(50);

      expect(
        await prisma.collectibleImage.findUnique({ where: { sourceUrl: snapshotUrl } }),
      ).not.toBeNull();
    });

    it("既に取り込み済みのURLは対象にしない (状態を巻き戻さない)", async () => {
      const url = newUrl();
      await createAsset(url);
      await service.register(url);
      await service.ingest(url, okFetch());

      await service.backfillFromCatalog(50);

      const row = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(row.status).toBe("STORED");
    });

    it("ストレージ未設定なら何もしない (試行回数だけが減るのを避ける)", async () => {
      storage.configured = false;
      const url = newUrl();
      await createAsset(url);

      expect(await service.backfillFromCatalog(50)).toBe(0);
      expect(await prisma.collectibleImage.findUnique({ where: { sourceUrl: url } })).toBeNull();
    });
  });

  describe("打ち切った分の戻し", () => {
    it("上限に達したものを対象へ戻す。失敗の理由は消さない", async () => {
      const url = newUrl();
      await service.register(url);
      await prisma.collectibleImage.update({
        where: { sourceUrl: url },
        data: { status: "FAILED", attemptCount: MAX_INGEST_ATTEMPTS, lastError: "status 404" },
      });

      expect(await service.resetExhausted()).toBeGreaterThanOrEqual(1);

      const row = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(row.status).toBe("PENDING");
      expect(row.attemptCount).toBe(0);
      // 取得元が直ったのかを、戻したあとも運用者が読めるようにしている。
      expect(row.lastError).toBe("status 404");
    });

    it("取り込み済みは戻さない (取り直して外部を叩き直さない)", async () => {
      const url = newUrl();
      await service.register(url);
      await service.ingest(url, okFetch());
      await prisma.collectibleImage.update({
        where: { sourceUrl: url },
        data: { attemptCount: MAX_INGEST_ATTEMPTS },
      });

      await service.resetExhausted();

      const row = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(row.status).toBe("STORED");
      expect(row.attemptCount).toBe(MAX_INGEST_ATTEMPTS);
    });
  });

  describe("取り込み状況の内訳", () => {
    it("取り込み済み・打ち切り・対象外を数える", async () => {
      const before = await service.stats();

      const storedUrl = newUrl();
      await service.register(storedUrl);
      await service.ingest(storedUrl, okFetch());

      const exhaustedUrl = newUrl();
      await service.register(exhaustedUrl);
      await prisma.collectibleImage.update({
        where: { sourceUrl: exhaustedUrl },
        data: { status: "FAILED", attemptCount: MAX_INGEST_ATTEMPTS },
      });

      // カードには載っているが取り込み対象へ入っていないURL。
      await createAsset(newUrl());

      const after = await service.stats();
      expect(after.stored).toBe(before.stored + 1);
      expect(after.exhausted).toBe(before.exhausted + 1);
      expect(after.unregistered).toBeGreaterThanOrEqual(before.unregistered + 1);
    });
  });

  describe("手動実行の打ち切り", () => {
    it("期限を過ぎていれば1件も取得しない", async () => {
      const url = newUrl();
      await service.register(url);

      const result = await service.retryPending(10, okFetch(), Date.now() - 1);

      expect(result).toEqual({ attempted: 0, stored: 0 });
      const row = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(row.status).toBe("PENDING");
    });

    it("期限内なら通常どおり取得する", async () => {
      const url = newUrl();
      await service.register(url);

      // 上の取りこぼしテストが積んだ分より大きい枚数を渡す。lastAttemptAtがnullの
      // 行同士の順序は決まらないため、少ない枚数だと対象の1件が入らないことがある。
      await service.retryPending(100, okFetch(), Date.now() + 60_000);

      const row = await prisma.collectibleImage.findUniqueOrThrow({ where: { sourceUrl: url } });
      expect(row.status).toBe("STORED");
    });
  });
});
