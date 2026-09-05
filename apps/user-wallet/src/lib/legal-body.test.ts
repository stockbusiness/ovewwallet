import { describe, expect, it } from "vitest";
import { parseLegalBody } from "./legal-body";

describe("法的文書の本文の解釈", () => {
  it("## で始まる行を見出しにする", () => {
    expect(parseLegalBody("## 第1条 (ORIの性質)\n本文です。")).toEqual([
      { kind: "heading", text: "第1条 (ORIの性質)" },
      { kind: "paragraph", text: "本文です。" },
    ]);
  });

  it("空行で段落を分ける", () => {
    expect(parseLegalBody("ひとつめ。\n\nふたつめ。")).toEqual([
      { kind: "paragraph", text: "ひとつめ。" },
      { kind: "paragraph", text: "ふたつめ。" },
    ]);
  });

  it("連続した行は1つの段落にまとめる", () => {
    expect(parseLegalBody("一行目\n二行目")).toEqual([{ kind: "paragraph", text: "一行目\n二行目" }]);
  });

  it("HTMLタグは解釈せず、ただの文字として残す", () => {
    // 管理画面の入力がそのままスクリプトとして動く経路を作らない
    const blocks = parseLegalBody("<script>alert(1)</script>");
    expect(blocks).toEqual([{ kind: "paragraph", text: "<script>alert(1)</script>" }]);
  });

  it("見出し記号だけの行は見出しにしない (空の見出しを作らない)", () => {
    expect(parseLegalBody("## \n本文")).toEqual([{ kind: "paragraph", text: "本文" }]);
  });

  it("空の本文では何も返さない", () => {
    expect(parseLegalBody("")).toEqual([]);
    expect(parseLegalBody("\n\n")).toEqual([]);
  });

  it("改行コードがCRLFでも同じ結果になる", () => {
    expect(parseLegalBody("## 見出し\r\n本文")).toEqual([
      { kind: "heading", text: "見出し" },
      { kind: "paragraph", text: "本文" },
    ]);
  });
});
