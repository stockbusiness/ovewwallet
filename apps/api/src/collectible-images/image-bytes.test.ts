import {
  assertStorableImage,
  detectImageFormat,
  extensionFor,
  InvalidImageBytesError,
  MAX_IMAGE_BYTES,
} from "./image-bytes";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP = Buffer.concat([
  Buffer.from([0x52, 0x49, 0x46, 0x46]),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x57, 0x45, 0x42, 0x50]),
]);

describe("detectImageFormat", () => {
  it("PNG / JPEG / GIF / WebP を見分ける", () => {
    expect(detectImageFormat(PNG)).toBe("image/png");
    expect(detectImageFormat(JPEG)).toBe("image/jpeg");
    expect(detectImageFormat(GIF)).toBe("image/gif");
    expect(detectImageFormat(WEBP)).toBe("image/webp");
  });

  it("SVGは画像として認めない", () => {
    // 中にスクリプトを書けるため。拡張子だけでなく実体でも弾く。
    expect(detectImageFormat(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });

  it("HTMLやテキストは認めない", () => {
    expect(detectImageFormat(Buffer.from("<!doctype html><html></html>"))).toBeNull();
    expect(detectImageFormat(Buffer.from("just text"))).toBeNull();
  });

  it("RIFFで始まってもWEBPでなければ認めない", () => {
    const wav = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from([0x57, 0x41, 0x56, 0x45]),
    ]);
    expect(detectImageFormat(wav)).toBeNull();
  });

  it("短すぎるバイト列で誤検知しない", () => {
    expect(detectImageFormat(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(detectImageFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe("assertStorableImage", () => {
  it("画像なら判定した形式を返す", () => {
    expect(assertStorableImage(PNG)).toBe("image/png");
  });

  it("空は拒否する", () => {
    expect(() => assertStorableImage(Buffer.alloc(0))).toThrow(InvalidImageBytesError);
  });

  it("上限を超える大きさは拒否する", () => {
    const tooBig = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    expect(() => assertStorableImage(tooBig)).toThrow(/exceeds/);
  });

  it("画像として判定できないものは拒否する", () => {
    expect(() => assertStorableImage(Buffer.from("<svg></svg>"))).toThrow(/PNG, JPEG, GIF, WebP/);
  });
});

describe("extensionFor", () => {
  it("形式ごとの拡張子を返す", () => {
    expect(extensionFor("image/png")).toBe("png");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/gif")).toBe("gif");
    expect(extensionFor("image/webp")).toBe("webp");
  });
});
