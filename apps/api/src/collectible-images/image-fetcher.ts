import { createHash } from "node:crypto";
import { assertValidCollectibleImageUrl } from "../common/image-url-validator";
import {
  assertStorableImage,
  InvalidImageBytesError,
  MAX_IMAGE_BYTES,
  type DetectedImageFormat,
} from "./image-bytes";

/**
 * 外部の画像URLからバイト列を取り込む。
 *
 * ここは**こちらのサーバーが外部の指定した宛先へ接続する**処理なので、SSRFの入口に
 * なりうる。`assertValidCollectibleImageUrl` の検証を**リダイレクト先にも毎回かける**
 * のがこの実装の要点で、最初のURLだけ検証して自動追従すると、検証を通したURLから
 * 内部ホストへ飛ばされてすり抜けられる。
 */

export class ImageFetchError extends Error {}

export interface FetchedImage {
  bytes: Buffer;
  contentType: DetectedImageFormat;
  sha256: string;
  /** リダイレクトを追った結果、実際に取得できたURL。監査用に残す。 */
  finalUrl: string;
}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

/** テストから差し替えるための最小の口。 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchCollectibleImage(
  sourceUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<FetchedImage> {
  let currentUrl = sourceUrl;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    // 毎回検証する。リダイレクト先が内部ホストでないことを、追う前に確かめる。
    try {
      assertValidCollectibleImageUrl(currentUrl);
    } catch (error) {
      throw new ImageFetchError(
        `image URL rejected${redirect > 0 ? " after redirect" : ""}: ${
          error instanceof Error ? error.message : "unknown reason"
        }`,
      );
    }

    const response = await requestOnce(currentUrl, fetchImpl);

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new ImageFetchError(`redirect ${response.status} without a location header`);
      // 相対Locationも絶対URLへ直してから検証する。
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new ImageFetchError(`image request failed with status ${response.status}`);
    }

    const bytes = await readBoundedBody(response);
    let contentType: DetectedImageFormat;
    try {
      contentType = assertStorableImage(bytes);
    } catch (error) {
      if (error instanceof InvalidImageBytesError) throw new ImageFetchError(error.message);
      throw error;
    }

    return {
      bytes,
      contentType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      finalUrl: currentUrl,
    };
  }

  throw new ImageFetchError(`too many redirects (more than ${MAX_REDIRECTS})`);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function requestOnce(url: string, fetchImpl: FetchLike): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      // 自動追従させない。追う前にリダイレクト先を検証したいため。
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "image/*" },
    });
  } catch (error) {
    throw new ImageFetchError(
      `image request failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 本文を上限つきで読む。
 *
 * Content-Lengthの申告を信じて確保するのではなく、**読みながら上限を超えた時点で
 * 打ち切る**。申告と実体が違う場合や、そもそも申告が無い場合に備えるため。
 */
async function readBoundedBody(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    throw new ImageFetchError(`image declares ${declared} bytes, over the ${MAX_IMAGE_BYTES} limit`);
  }

  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new ImageFetchError(`image exceeds ${MAX_IMAGE_BYTES} bytes`);
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new ImageFetchError(`image exceeds ${MAX_IMAGE_BYTES} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
