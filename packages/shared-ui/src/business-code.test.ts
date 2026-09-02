import { describe, expect, it } from "vitest";
import { toDisplayCode, toStoredCode } from "./business-code";

/**
 * 表示は `ORI-`、保存は `OVE-` のまま、という取り決めを固定する。
 * ここが崩れると、利用者が読み上げたコードで管理画面を検索しても見つからない
 * (あるいは逆に、保存値を書き換えて監査ログとの対応が切れる) ことになる。
 */
describe("事業コードの表示用変換", () => {
  it("shows the ORI prefix for each stored code type", () => {
    expect(toDisplayCode("OVE-WLT-00000001")).toBe("ORI-WLT-00000001");
    expect(toDisplayCode("OVE-ACC-00000042")).toBe("ORI-ACC-00000042");
    expect(toDisplayCode("OVE-TXN-00000123")).toBe("ORI-TXN-00000123");
    expect(toDisplayCode("OVE-ADM-00000007")).toBe("ORI-ADM-00000007");
  });

  it("only rewrites the leading prefix", () => {
    // コードの途中に現れる OVE- は識別子の一部なので触らない。
    expect(toDisplayCode("OVE-WLT-OVE-1")).toBe("ORI-WLT-OVE-1");
  });

  it("leaves unrelated values alone", () => {
    expect(toDisplayCode("SENGOKU-1")).toBe("SENGOKU-1");
    expect(toDisplayCode("")).toBe("");
    expect(toDisplayCode(null)).toBeNull();
    expect(toDisplayCode(undefined)).toBeUndefined();
  });

  it("accepts either form when an operator searches", () => {
    expect(toStoredCode("ORI-ACC-00000042")).toBe("OVE-ACC-00000042");
    // 過去の記録や外部システムからの転記はこちらの形で来る。
    expect(toStoredCode("OVE-ACC-00000042")).toBe("OVE-ACC-00000042");
    expect(toStoredCode("  ORI-ACC-00000042  ")).toBe("OVE-ACC-00000042");
    expect(toStoredCode("ori-acc-00000042")).toBe("OVE-acc-00000042");
  });

  it("round-trips what the user sees back to what is stored", () => {
    const stored = "OVE-WLT-00000001";
    expect(toStoredCode(toDisplayCode(stored))).toBe(stored);
  });
});
