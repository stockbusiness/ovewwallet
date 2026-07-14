/**
 * Prisma の BigInt (残高等) を JSON レスポンスへそのまま含められるようにする。
 * main.ts からのみ副作用importすると、AppModule を直接importするテスト
 * (main.ts を経由しない) でパッチが当たらずBigIntフィールドの直接返却で
 * クラッシュするため、AppModule 側でも読み込まれるようこのファイルに分離する。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function (this: bigint) {
  return this.toString();
};
