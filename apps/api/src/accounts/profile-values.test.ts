import { isKana, isPrefecture, normalizePhone, normalizePostalCode, normalizeText, toHalfWidth } from "./profile-values";

describe("プロフィール入力値の正規化", () => {
  it("電話番号はハイフン・空白を落として数字だけにする", () => {
    // 表記ゆれのまま貯めると、後で名寄せや配信リストに使うときに突き合わせられない
    expect(normalizePhone("090-1234-5678")).toBe("09012345678");
    expect(normalizePhone("090 1234 5678")).toBe("09012345678");
    expect(normalizePhone("0312345678")).toBe("0312345678");
  });

  it("全角で入力された電話番号も受け付ける", () => {
    expect(normalizePhone("０９０−１２３４−５６７８")).toBe("09012345678");
  });

  it("0始まりの10桁・11桁でない電話番号は弾く", () => {
    expect(normalizePhone("9012345678")).toBeNull();
    expect(normalizePhone("090-1234-5")).toBeNull();
    expect(normalizePhone("090-1234-56789")).toBeNull();
    expect(normalizePhone("+81-90-1234-5678")).toBeNull();
    expect(normalizePhone("abcdefghij")).toBeNull();
  });

  it("郵便番号は7桁の数字だけにする", () => {
    expect(normalizePostalCode("100-0001")).toBe("1000001");
    expect(normalizePostalCode("１０００００１")).toBe("1000001");
    expect(normalizePostalCode("1000001")).toBe("1000001");
  });

  it("7桁でない郵便番号は弾く", () => {
    expect(normalizePostalCode("100-001")).toBeNull();
    expect(normalizePostalCode("10000012")).toBeNull();
    expect(normalizePostalCode("ABC-DEFG")).toBeNull();
  });

  it("都道府県は47個のいずれかだけを通す", () => {
    expect(isPrefecture("東京都")).toBe(true);
    expect(isPrefecture("北海道")).toBe(true);
    expect(isPrefecture("沖縄県")).toBe(true);
    expect(isPrefecture("東京")).toBe(false);
    expect(isPrefecture("Tokyo")).toBe(false);
  });

  it("カナ氏名は全角カタカナと空白だけを通す", () => {
    expect(isKana("タナカ タロウ")).toBe(true);
    expect(isKana("タナカ　タロウ")).toBe(true);
    expect(isKana("たなか たろう")).toBe(false);
    expect(isKana("田中太郎")).toBe(false);
    expect(isKana("Tanaka")).toBe(false);
  });

  it("氏名などは前後の空白を落とし、連続する空白を1つにまとめる", () => {
    expect(normalizeText("  田中   太郎  ")).toBe("田中 太郎");
  });

  it("全角英数字は半角に揃える", () => {
    expect(toHalfWidth("ＡＢＣ１２３")).toBe("ABC123");
  });
});
