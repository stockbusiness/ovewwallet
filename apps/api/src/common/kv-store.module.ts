import { Global, Module, type OnModuleDestroy } from "@nestjs/common";
import { InMemoryKeyValueStore, RedisKeyValueStore, type KeyValueStore, type RedisLike } from "@ove/auth";
import Redis from "ioredis";

export const KV_STORE = "KV_STORE";

/**
 * REDIS_URL が設定されていれば ioredis を、未設定ならインメモリストアを使う。
 * 「Redisがなくてもローカル開発できる」フォールバック要件 (指示書5章) を満たす。
 */
function createKeyValueStore(): { store: KeyValueStore; client?: Redis } {
  const url = process.env.REDIS_URL;
  if (!url) {
    return { store: new InMemoryKeyValueStore() };
  }
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  return { store: new RedisKeyValueStore(client as unknown as RedisLike), client };
}

const { store, client } = createKeyValueStore();

@Global()
@Module({
  providers: [{ provide: KV_STORE, useValue: store }],
  exports: [KV_STORE],
})
export class KeyValueStoreModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await client?.quit().catch(() => undefined);
  }
}
