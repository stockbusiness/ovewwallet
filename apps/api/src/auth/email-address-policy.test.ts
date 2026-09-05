import {
  BUILT_IN_DISPOSABLE_DOMAINS,
  canonicalizeEmailForIdentity,
  emailDomain,
  isDisposableEmailDomain,
} from "./email-address-policy";

describe("emailDomain", () => {
  it("ドメイン部を小文字で返す", () => {
    expect(emailDomain("Tanaka@Example.COM")).toBe("example.com");
  });

  it("+ を含むアドレスでもドメインは変わらない", () => {
    expect(emailDomain("tanaka+shop@example.com")).toBe("example.com");
  });

  it("分解できない入力では空文字を返す", () => {
    expect(emailDomain("tanaka")).toBe("");
    expect(emailDomain("@example.com")).toBe("");
    expect(emailDomain("tanaka@")).toBe("");
    expect(emailDomain("")).toBe("");
  });
});

describe("isDisposableEmailDomain", () => {
  const blocked = new Set(["mailinator.com", "10minutemail.net"]);

  it("完全一致で弾く", () => {
    expect(isDisposableEmailDomain("mailinator.com", blocked)).toBe(true);
  });

  it("サブドメインでも弾く", () => {
    // 使い捨てメールはサブドメインを無限に生やす作りのものが多く、
    // 完全一致だけでは素通りする。
    expect(isDisposableEmailDomain("team478.mailinator.com", blocked)).toBe(true);
    expect(isDisposableEmailDomain("a.b.c.mailinator.com", blocked)).toBe(true);
  });

  it("末尾が偶然似ているだけのドメインは弾かない", () => {
    expect(isDisposableEmailDomain("notmailinator.com", blocked)).toBe(false);
    expect(isDisposableEmailDomain("mailinator.com.example.jp", blocked)).toBe(false);
  });

  it("関係のないドメインは通す", () => {
    expect(isDisposableEmailDomain("gmail.com", blocked)).toBe(false);
    expect(isDisposableEmailDomain("team478.jp", blocked)).toBe(false);
  });

  it("1ラベルの指定では判定しない (com を登録しても全ドメインを塞がない)", () => {
    expect(isDisposableEmailDomain("example.com", new Set(["com"]))).toBe(false);
  });

  it("空のドメインは通す", () => {
    expect(isDisposableEmailDomain("", blocked)).toBe(false);
  });
});

describe("組み込みリスト", () => {
  it("よく使われる使い捨てサービスが入っている", () => {
    for (const domain of ["mailinator.com", "guerrillamail.com", "yopmail.com", "temp-mail.org"]) {
      expect(BUILT_IN_DISPOSABLE_DOMAINS.has(domain)).toBe(true);
    }
  });

  it("実在の一般的なドメインは入っていない", () => {
    // 正規の利用者を締め出さないことの回帰確認。リストを差し替えたときに気づけるようにする。
    for (const domain of ["gmail.com", "yahoo.co.jp", "outlook.com", "icloud.com", "docomo.ne.jp"]) {
      expect(BUILT_IN_DISPOSABLE_DOMAINS.has(domain)).toBe(false);
    }
  });
});

describe("canonicalizeEmailForIdentity", () => {
  it("Gmailの + 以降を落とす", () => {
    expect(canonicalizeEmailForIdentity("tanaka+1@gmail.com")).toBe("tanaka@gmail.com");
    expect(canonicalizeEmailForIdentity("tanaka+1+2@gmail.com")).toBe("tanaka@gmail.com");
  });

  it("Gmailのドットを落とす", () => {
    expect(canonicalizeEmailForIdentity("ta.na.ka@gmail.com")).toBe("tanaka@gmail.com");
  });

  it("googlemail.com は gmail.com に寄せる", () => {
    expect(canonicalizeEmailForIdentity("tanaka@googlemail.com")).toBe("tanaka@gmail.com");
  });

  it("大文字は小文字に揃える", () => {
    expect(canonicalizeEmailForIdentity("Tanaka@Gmail.COM")).toBe("tanaka@gmail.com");
  });

  it("+ を潰してよいと分かっているドメインだけ潰す", () => {
    expect(canonicalizeEmailForIdentity("tanaka+1@outlook.com")).toBe("tanaka@outlook.com");
    // 一般のドメインは潰さない。+ より前が同じでも別の受信箱でありうるため、
    // 潰すと他人のアカウントに入れてしまう。
    expect(canonicalizeEmailForIdentity("tanaka+1@team478.jp")).toBe("tanaka+1@team478.jp");
  });

  it("ドットを落とすのは Gmail だけ", () => {
    expect(canonicalizeEmailForIdentity("ta.na.ka@outlook.com")).toBe("ta.na.ka@outlook.com");
  });

  it("ローカル部が消える入力では潰さない", () => {
    // 全員が同じ正規形になり、他人のアカウントへ入れてしまうため。
    expect(canonicalizeEmailForIdentity("+foo@gmail.com")).toBe("+foo@gmail.com");
  });

  it("分解できない入力は小文字化だけして返す", () => {
    expect(canonicalizeEmailForIdentity("  Tanaka  ")).toBe("tanaka");
  });
});
