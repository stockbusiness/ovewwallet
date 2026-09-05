import { fetchCollectibleImage, ImageFetchError, type FetchLike } from "./image-fetcher";
import { MAX_IMAGE_BYTES } from "./image-bytes";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

function imageResponse(body: Buffer = PNG, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-type": "image/png", ...headers },
  });
}

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/** 呼ばれたURLを記録するfetch。 */
function recordingFetch(responses: Response[]): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    const response = responses[index];
    index += 1;
    if (!response) throw new Error("unexpected extra fetch");
    return response;
  };
  return { fetch: fetchImpl, calls };
}

describe("fetchCollectibleImage", () => {
  it("画像を取得してハッシュを返す", async () => {
    const { fetch } = recordingFetch([imageResponse()]);
    const result = await fetchCollectibleImage("https://cdn.example.com/a.png", fetch);

    expect(result.contentType).toBe("image/png");
    expect(result.bytes).toEqual(PNG);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.finalUrl).toBe("https://cdn.example.com/a.png");
  });

  it("同じ内容なら同じハッシュになる (保存キーが一致する)", async () => {
    const a = await fetchCollectibleImage("https://cdn.example.com/a.png", recordingFetch([imageResponse()]).fetch);
    const b = await fetchCollectibleImage("https://other.example.com/b.png", recordingFetch([imageResponse()]).fetch);
    expect(a.sha256).toBe(b.sha256);
  });

  describe("SSRF対策", () => {
    it("httpsでないURLは取得しない", async () => {
      const { fetch, calls } = recordingFetch([]);
      await expect(fetchCollectibleImage("http://cdn.example.com/a.png", fetch)).rejects.toThrow(ImageFetchError);
      expect(calls).toEqual([]);
    });

    it("内部ホストへは接続しない", async () => {
      for (const url of [
        "https://localhost/a.png",
        "https://127.0.0.1/a.png",
        "https://10.0.0.5/a.png",
        "https://192.168.1.1/a.png",
        "https://169.254.169.254/latest/meta-data",
      ]) {
        const { fetch, calls } = recordingFetch([]);
        await expect(fetchCollectibleImage(url, fetch)).rejects.toThrow(ImageFetchError);
        expect(calls).toEqual([]);
      }
    });

    it("リダイレクト先が内部ホストなら追わない", async () => {
      // ここが要点。最初のURLだけ検証して自動追従すると、検証を通したURLから
      // 内部ホストへ飛ばされてすり抜けられる。
      const { fetch, calls } = recordingFetch([redirectTo("https://169.254.169.254/latest/meta-data")]);
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetch)).rejects.toThrow(
        /rejected after redirect/,
      );
      expect(calls).toEqual(["https://cdn.example.com/a.png"]);
    });

    it("外部への通常のリダイレクトは追う", async () => {
      const { fetch, calls } = recordingFetch([
        redirectTo("https://cdn2.example.com/a.png"),
        imageResponse(),
      ]);
      const result = await fetchCollectibleImage("https://cdn.example.com/a.png", fetch);
      expect(result.finalUrl).toBe("https://cdn2.example.com/a.png");
      expect(calls).toEqual(["https://cdn.example.com/a.png", "https://cdn2.example.com/a.png"]);
    });

    it("相対Locationも絶対URLに直して検証する", async () => {
      const { fetch, calls } = recordingFetch([redirectTo("/moved/a.png"), imageResponse()]);
      const result = await fetchCollectibleImage("https://cdn.example.com/a.png", fetch);
      expect(result.finalUrl).toBe("https://cdn.example.com/moved/a.png");
      expect(calls[1]).toBe("https://cdn.example.com/moved/a.png");
    });

    it("リダイレクトが多すぎれば諦める", async () => {
      const { fetch } = recordingFetch([
        redirectTo("https://a.example.com/1.png"),
        redirectTo("https://b.example.com/2.png"),
        redirectTo("https://c.example.com/3.png"),
        redirectTo("https://d.example.com/4.png"),
        redirectTo("https://e.example.com/5.png"),
      ]);
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetch)).rejects.toThrow(
        /too many redirects/,
      );
    });
  });

  describe("受け取った中身の検証", () => {
    it("Content-Typeの申告を信用せず実体で判定する", async () => {
      // image/png と名乗っていてもHTMLなら拒否する。
      const { fetch } = recordingFetch([
        new Response(Buffer.from("<!doctype html>"), { status: 200, headers: { "content-type": "image/png" } }),
      ]);
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetch)).rejects.toThrow(
        /PNG, JPEG, GIF, WebP/,
      );
    });

    it("SVGを名乗る中身は拒否する", async () => {
      const { fetch } = recordingFetch([
        new Response(Buffer.from("<svg onload='alert(1)'></svg>"), {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        }),
      ]);
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetch)).rejects.toThrow(ImageFetchError);
    });

    it("Content-Lengthが上限を超えていれば読み込まない", async () => {
      const { fetch } = recordingFetch([
        imageResponse(PNG, { "content-length": String(MAX_IMAGE_BYTES + 1) }),
      ]);
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetch)).rejects.toThrow(/over the/);
    });

    it("申告が無くても実体が大きすぎれば打ち切る", async () => {
      const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
      const { fetch } = recordingFetch([imageResponse(huge)]);
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetch)).rejects.toThrow(/exceeds/);
    });

    it("エラー応答は取り込まない", async () => {
      const { fetch } = recordingFetch([new Response(null, { status: 404 })]);
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetch)).rejects.toThrow(/status 404/);
    });

    it("通信自体が失敗しても例外の型を揃える", async () => {
      const fetchImpl: FetchLike = async () => {
        throw new Error("ECONNREFUSED");
      };
      await expect(fetchCollectibleImage("https://cdn.example.com/a.png", fetchImpl)).rejects.toThrow(
        ImageFetchError,
      );
    });
  });
});
