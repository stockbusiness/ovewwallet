/**
 * リファクタリング指示書 Phase 0 (§6): 循環依存検出。
 * `pnpm depcruise` でモノレポ全体 (apps/*, packages/*) を走査し、循環依存があれば
 * 非ゼロ終了してCIを失敗させる。モジュール境界の詳細ルールはeslint-plugin-boundaries
 * (eslint.config.mjs) 側で担当するため、ここでは循環依存検出に絞る。
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "循環依存はモジュール境界を曖昧にするため禁止する。",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
    exclude: {
      path: [
        "node_modules",
        "dist",
        "\\.next",
        "(^|/)generated($|/)",
        "\\.test\\.ts$",
        "^tests/",
      ],
    },
    doNotFollow: { path: "node_modules" },
    exoticRequireStrings: [],
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
