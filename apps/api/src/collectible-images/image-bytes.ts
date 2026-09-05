/**
 * 取り込んだ画像バイト列の検証。
 *
 * **Content-Typeヘッダーを信用しない。** 送り手が申告した値であり、実体と一致する
 * 保証がない。先頭バイト (マジックナンバー) から実際の形式を判定し、許可した形式で
 * なければ捨てる。SVGを弾いているのは、中にスクリプトを書けてしまうため
 * (`image-url-validator.ts`が拡張子で弾いているのと同じ理由を、実体側でも守る)。
 */

/** 1枚あたりの上限。カード画像としては十分で、悪意ある巨大ファイルを弾ける大きさ。 */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type DetectedImageFormat = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

interface Signature {
  format: DetectedImageFormat;
  /** 先頭からのオフセットと、そこに現れるべきバイト列。 */
  parts: { offset: number; bytes: number[] }[];
}

const SIGNATURES: Signature[] = [
  { format: "image/png", parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { format: "image/jpeg", parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { format: "image/gif", parts: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }] },
  // WebP は "RIFF" + 4バイトのサイズ + "WEBP"。サイズ部分は可変なので飛ばして照合する。
  {
    format: "image/webp",
    parts: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
    ],
  },
];

function matches(buffer: Uint8Array, part: { offset: number; bytes: number[] }): boolean {
  if (buffer.length < part.offset + part.bytes.length) return false;
  return part.bytes.every((byte, index) => buffer[part.offset + index] === byte);
}

/** 実体から形式を判定する。判定できなければ `null`。 */
export function detectImageFormat(buffer: Uint8Array): DetectedImageFormat | null {
  for (const signature of SIGNATURES) {
    if (signature.parts.every((part) => matches(buffer, part))) return signature.format;
  }
  return null;
}

export class InvalidImageBytesError extends Error {}

/**
 * 保存してよいバイト列かを確かめ、実体から判定した Content-Type を返す。
 *
 * 空・大きすぎる・画像として判定できないものは受け付けない。
 */
export function assertStorableImage(buffer: Uint8Array): DetectedImageFormat {
  if (buffer.length === 0) {
    throw new InvalidImageBytesError("image is empty");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageBytesError(
      `image exceeds ${MAX_IMAGE_BYTES} bytes (got ${buffer.length})`,
    );
  }
  const format = detectImageFormat(buffer);
  if (format === null) {
    throw new InvalidImageBytesError("image format is not one of PNG, JPEG, GIF, WebP");
  }
  return format;
}

/** 拡張子。保存キーに付けて、配信時に形式が一目で分かるようにする。 */
export function extensionFor(format: DetectedImageFormat): string {
  switch (format) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
  }
}
