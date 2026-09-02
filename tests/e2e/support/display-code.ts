/**
 * 事業コードの表示用変換。正本は `packages/shared-ui/src/business-code.ts` で、
 * こちらはE2E側の同じ規則の写し。
 *
 * shared-ui を直接importするとReactコンポーネント (.tsx) まで型解決に巻き込むため、
 * Node専用のこのワークスペースには持ち込まない。規則が変わってこちらを直し忘れた
 * 場合は、画面の表示と期待値が食い違ってspecが落ちる (黙って通ることはない)。
 */
export function toDisplayCode(code: string): string {
  return code.startsWith("OVE-") ? `ORI-${code.slice("OVE-".length)}` : code;
}
