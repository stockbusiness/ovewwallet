import { WalletsService } from "./wallets.service";

/**
 * 利用者向けの連携サービス一覧に、代理店システムを出さないことを固定する。
 *
 * 代理店がSSOでログインすると `account_links` がACTIVEになるため、除外しないと
 * 「ORIを使う」に運用管理用の名前 ("戦国経済圏代理店システム (sengoku-ai.com)") が
 * そのまま並ぶ。代理店システムはORIを付与する側で、利用者がORIを使う先ではない。
 */
type PrismaStub = ConstructorParameters<typeof WalletsService>[0];

const INTEGRATIONS = [
  { id: "si_agency", serviceCode: "AGENCY_SYSTEM", serviceName: "戦国経済圏代理店システム (sengoku-ai.com)" },
  { id: "si_aiart", serviceCode: "AIART", serviceName: "AIアート教室" },
];

function buildService() {
  /** findManyへ渡されたwhereを覗くために控える。 */
  let lastWhere: Record<string, unknown> | undefined;

  const db = {
    serviceIntegration: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        lastWhere = args.where;
        const notIn = (args.where.serviceCode as { notIn?: readonly string[] } | undefined)?.notIn ?? [];
        return INTEGRATIONS.filter((i) => !notIn.includes(i.serviceCode));
      },
    },
    accountLink: {
      // どちらの連携先にも紐付いている状態にする (除外がACTIVEリンクの有無ではなく
      // serviceCodeで効いていることを確かめるため)。
      findMany: async () => [
        { serviceIntegrationId: "si_agency", linkedAt: new Date("2026-09-04T10:38:24Z") },
        { serviceIntegrationId: "si_aiart", linkedAt: new Date("2026-09-01T00:00:00Z") },
      ],
    },
  } as unknown as PrismaStub;

  const service = new WalletsService(
    db,
    {} as ConstructorParameters<typeof WalletsService>[1],
    {} as ConstructorParameters<typeof WalletsService>[2],
  );
  return { service, getLastWhere: () => lastWhere };
}

describe("WalletsService.listLinkedServices", () => {
  it("does not list AGENCY_SYSTEM even when the account is linked to it", async () => {
    const { service } = buildService();

    const list = await service.listLinkedServices("acc_1");

    expect(list.map((s) => s.service_code)).toEqual(["AIART"]);
    expect(list.some((s) => s.service_name.includes("sengoku-ai.com"))).toBe(false);
  });

  it("excludes it in the query rather than after fetching", async () => {
    const { service, getLastWhere } = buildService();

    await service.listLinkedServices("acc_1");

    // 画面側やmap後で消すと、他の画面やURL直打ちで漏れる。DBへ問い合わせる時点で除く。
    expect(getLastWhere()).toMatchObject({
      status: "ACTIVE",
      serviceCode: { notIn: ["AGENCY_SYSTEM"] },
    });
  });

  it("still reports linked services that are not hidden", async () => {
    const { service } = buildService();

    const list = await service.listLinkedServices("acc_1");

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      service_code: "AIART",
      linked: true,
      linked_at: "2026-09-01T00:00:00.000Z",
    });
  });
});
