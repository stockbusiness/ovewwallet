// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

// リファクタリング指示書 Phase 0 (§6) 対応の静的解析基盤。
// - 未使用import/変数検出、import順序統一 (typescript-eslint + eslint-plugin-import)
// - モジュール境界検出 (import/no-restricted-paths): packages/* はapps/*に依存しない、
//   apps同士は直接依存しない (HTTP経由のみ) という現行アーキテクチャの境界を検査する。
//   eslint-plugin-boundariesも検討したが、7.1.0/6.0.2いずれも
//   `boundaries/elements`のpattern一致を内部で正しく評価できない既知の不具合を確認した
//   ため採用を見送り、実績のあるimport/no-restricted-pathsで代替する。
//   apps/api/src配下の modules/ 分割 (Phase 5以降) はまだ存在しないため、
//   そこへの詳細な境界ルールは対象フェーズで追加する。
// - ファイル行数・複雑度は警告のみ (既存コードを壊さないため error にしない)。
// - process.env直接使用の段階的制限 (packages/config, apps/*/共通env読み込み層は除外)。
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "packages/database/src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: {
          // 各tsconfig.jsonは本番buildの対象を絞るため `src/**/*.test.ts` を除外している。
          // lint対象には含めたいので、テストファイル・vitest設定ファイルのみ
          // デフォルトプロジェクトへのフォールバックを許可する
          // (typescript-eslintの制約でワイルドカードは1階層のみ対応)。
          allowDefaultProject: [
            "apps/api/src/*.test.ts",
            "apps/api/src/admin/*.test.ts",
            "apps/api/src/auth/*.test.ts",
            "apps/api/src/collectible-claims/*.test.ts",
            "apps/api/src/collectibles/*.test.ts",
            "apps/api/src/common/*.test.ts",
            "apps/api/src/common-events/*.test.ts",
            "apps/api/src/e2e/*.test.ts",
            "apps/api/src/integrations/*.test.ts",
            "apps/api/src/notices/*.test.ts",
            "apps/api/src/referrals/*.test.ts",
            "apps/api/src/rewards/*.test.ts",
            "apps/api/src/scheduler/*.test.ts",
            "apps/api/src/wallets/*.test.ts",
            "apps/api/vitest.config.ts",
            "packages/auth/src/*.test.ts",
            "packages/auth/vitest.config.ts",
            "packages/ledger/src/*.test.ts",
            "packages/shared-ui/src/*.test.ts",
            "packages/shared-ui/vitest.config.ts",
            "packages/ledger/vitest.config.ts",
          ],
          // 上限に達するとlintがパースエラー (=CI失敗) になる。テストファイルが増える
          // たびに上げ直すことになるため、当面の増加を吸収できる値にしてある
          // (2026-08-31時点で101ファイル)。lintの実行時間が問題になったら、
          // テスト用のtsconfigを分けてデフォルトプロジェクトへのフォールバック自体を
          // 無くす方が筋が良い。
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 200,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import/resolver": {
        typescript: true,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "never",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-cycle": "error",
      "max-lines": [
        "warn",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["warn", 15],
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages",
              from: "./apps",
              message: "packages/* は共有ライブラリのため apps/* に依存してはいけません。",
            },
            {
              target: "./apps/user-wallet",
              from: ["./apps/api", "./apps/admin-wallet"],
              message: "apps同士はHTTP経由でのみ連携し、直接importしてはいけません。",
            },
            {
              target: "./apps/admin-wallet",
              from: ["./apps/api", "./apps/user-wallet"],
              message: "apps同士はHTTP経由でのみ連携し、直接importしてはいけません。",
            },
            {
              target: "./apps/api",
              from: ["./apps/user-wallet", "./apps/admin-wallet"],
              message: "apps同士はHTTP経由でのみ連携し、直接importしてはいけません。",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "warn",
        {
          selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
          message:
            "process.envの直接参照は禁止予定です。packages/config の env スキーマ経由で取得してください (指示書 Phase 0 段階的制限、現状はwarn)。",
        },
      ],
    },
  },
  {
    // env読み込み層そのものはprocess.env直参照を許可する。
    files: [
      "packages/config/src/**/*.ts",
      "**/*.test.ts",
      "apps/api/src/e2e/**/*.ts",
      "apps/api/src/main.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // テストファイルは行数上限の対象外にする (既存の大きめのe2eテストを壊さない)。
    files: ["**/*.test.ts", "tests/**/*.ts"],
    rules: {
      "max-lines": "off",
      complexity: "off",
    },
  },
);
