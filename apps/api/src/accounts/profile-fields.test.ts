import type { AccountProfileConfig } from "@ove/database";
import {
  DEFAULT_PROFILE_FIELD_CONFIG,
  decideProfilePrompt,
  isFieldEditable,
  isProfileComplete,
  toEffectiveConfig,
  type EffectiveProfileConfig,
} from "./profile-fields";

function config(overrides: Partial<EffectiveProfileConfig["fields"]> = {}, promptEnabled = true): EffectiveProfileConfig {
  return { fields: { ...DEFAULT_PROFILE_FIELD_CONFIG, ...overrides }, promptEnabled };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    fullName: null,
    fullNameKana: null,
    phone: null,
    postalCode: null,
    prefecture: null,
    city: null,
    addressLine: null,
    building: null,
    declinedAt: null,
    ...overrides,
  } as Parameters<typeof decideProfilePrompt>[0]["profile"];
}

describe("プロフィール項目の設定", () => {
  it("設定行が無ければ既定値を使う (氏名・電話・郵便番号・住所は任意、カナは非表示)", () => {
    expect(toEffectiveConfig(null)).toEqual({
      fields: {
        fullName: "OPTIONAL",
        fullNameKana: "HIDDEN",
        phone: "OPTIONAL",
        postalCode: "OPTIONAL",
        address: "OPTIONAL",
      },
      promptEnabled: true,
    });
  });

  it("設定行があればその値を使う", () => {
    const row = {
      id: "default",
      fullName: "REQUIRED",
      fullNameKana: "OPTIONAL",
      phone: "REQUIRED",
      postalCode: "HIDDEN",
      address: "HIDDEN",
      promptEnabled: false,
      updatedAt: new Date(),
      updatedBy: null,
    } as AccountProfileConfig;

    expect(toEffectiveConfig(row)).toEqual({
      fields: {
        fullName: "REQUIRED",
        fullNameKana: "OPTIONAL",
        phone: "REQUIRED",
        postalCode: "HIDDEN",
        address: "HIDDEN",
      },
      promptEnabled: false,
    });
  });

  it("HIDDENの項目は編集できない", () => {
    const c = config({ phone: "HIDDEN" });
    expect(isFieldEditable(c, "phone")).toBe(false);
    expect(isFieldEditable(c, "fullName")).toBe(true);
  });
});

describe("入力を促すかどうか", () => {
  it("一度も入力していなければ促す (全項目が任意でも最初の1回は出す)", () => {
    expect(decideProfilePrompt({ config: config(), profile: null })).toEqual({
      show: true,
      missingRequired: [],
    });
  });

  it("必須項目が未入力なら促し、どれが足りないかを返す", () => {
    const result = decideProfilePrompt({
      config: config({ fullName: "REQUIRED", phone: "REQUIRED" }),
      profile: profile({ fullName: "田中太郎" }),
    });
    expect(result).toEqual({ show: true, missingRequired: ["phone"] });
  });

  it("必須項目が埋まっていれば促さない (任意項目が空でも出さない)", () => {
    const result = decideProfilePrompt({
      config: config({ fullName: "REQUIRED" }),
      profile: profile({ fullName: "田中太郎" }),
    });
    expect(result).toEqual({ show: false, missingRequired: [] });
  });

  it("住所は県・市区町村・番地が揃って初めて入力済みとみなす (建物名は任意)", () => {
    const c = config({ address: "REQUIRED" });
    expect(
      decideProfilePrompt({ config: c, profile: profile({ prefecture: "東京都", city: "千代田区" }) }),
    ).toEqual({ show: true, missingRequired: ["address"] });
    expect(
      decideProfilePrompt({
        config: c,
        profile: profile({ prefecture: "東京都", city: "千代田区", addressLine: "1-1-1" }),
      }),
    ).toEqual({ show: false, missingRequired: [] });
  });

  it("「入力しない」を選んだ人には必須項目が残っていても出さない", () => {
    // 断った相手に出し続けない。断ったことはdeclinedAtに残るのでセグメントには使える
    const result = decideProfilePrompt({
      config: config({ fullName: "REQUIRED" }),
      profile: profile({ declinedAt: new Date() }),
    });
    expect(result).toEqual({ show: false, missingRequired: ["fullName"] });
  });

  it("promptEnabledがfalseなら一切出さない", () => {
    const result = decideProfilePrompt({
      config: config({ fullName: "REQUIRED" }, false),
      profile: null,
    });
    expect(result.show).toBe(false);
  });

  it("全項目がHIDDENなら出さない", () => {
    const c = config({
      fullName: "HIDDEN",
      fullNameKana: "HIDDEN",
      phone: "HIDDEN",
      postalCode: "HIDDEN",
      address: "HIDDEN",
    });
    expect(decideProfilePrompt({ config: c, profile: null })).toEqual({ show: false, missingRequired: [] });
  });

  it("HIDDENにした項目はREQUIREDでなくなるので未入力扱いしない", () => {
    // 設定を閉じた後も「必須なのに未入力」と言い続けると、埋めようがない帯が出続ける
    const c = config({ phone: "HIDDEN" });
    expect(decideProfilePrompt({ config: c, profile: profile({ fullName: "田中太郎" }) })).toEqual({
      show: false,
      missingRequired: [],
    });
  });
});

describe("お客様情報の登録が完了したか (特典の付与条件)", () => {
  it("必須にした項目がすべて埋まっていれば完了", () => {
    const c = config({ fullName: "REQUIRED", phone: "REQUIRED" });
    expect(
      isProfileComplete({ config: c, profile: profile({ fullName: "田中太郎", phone: "09012345678" }) }),
    ).toBe(true);
  });

  it("必須項目が1つでも欠けていれば完了ではない", () => {
    const c = config({ fullName: "REQUIRED", phone: "REQUIRED" });
    expect(isProfileComplete({ config: c, profile: profile({ fullName: "田中太郎" }) })).toBe(false);
  });

  it("任意項目は条件に含めない", () => {
    // 必須にした項目だけが対象 (2026-09-05 運用判断)
    const c = config({ fullName: "REQUIRED", phone: "OPTIONAL", address: "OPTIONAL" });
    expect(isProfileComplete({ config: c, profile: profile({ fullName: "田中太郎" }) })).toBe(true);
  });

  it("必須項目が1つも無ければ完了にしない", () => {
    // 埋めるべきものが無い状態を完了と扱うと、何も入力していない人に特典が出てしまう
    expect(isProfileComplete({ config: config(), profile: profile() })).toBe(false);
    expect(
      isProfileComplete({ config: config(), profile: profile({ fullName: "田中太郎" }) }),
    ).toBe(false);
  });

  it("住所は県・市区町村・番地が揃って初めて完了", () => {
    const c = config({ address: "REQUIRED" });
    expect(
      isProfileComplete({ config: c, profile: profile({ prefecture: "東京都", city: "千代田区" }) }),
    ).toBe(false);
    expect(
      isProfileComplete({
        config: c,
        profile: profile({ prefecture: "東京都", city: "千代田区", addressLine: "1-1-1" }),
      }),
    ).toBe(true);
  });

  it("プロフィールが無ければ完了ではない", () => {
    expect(isProfileComplete({ config: config({ fullName: "REQUIRED" }), profile: null })).toBe(false);
  });
});
