/**
 * OTP・SSOワンタイムコード・レート制限カウンタなど短命な値を保存するための
 * 最小限のキー・バリューストア抽象。Redis / インメモリの双方をこのインター
 * フェースで差し替えられるようにし、「Redisがなくてもローカル開発できる」
 * フォールバックを満たす。
 */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** 存在しなければ 0 から開始して +1 した値を返す。TTL はキー未存在時のみ設定する。 */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

interface Entry {
  value: string;
  expiresAt: number;
}

/** Redis 未設定のローカル開発・テスト用フォールバック実装。 */
export class InMemoryKeyValueStore implements KeyValueStore {
  private store = new Map<string, Entry>();

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt <= Date.now();
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.store.get(key);
    if (!entry || this.isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const current = await this.get(key);
    const next = (current ? Number(current) : 0) + 1;
    if (!current) {
      await this.set(key, String(next), ttlSeconds);
    } else {
      const entry = this.store.get(key)!;
      entry.value = String(next);
    }
    return next;
  }
}

/** ioredis クライアントを受け取るラッパー。型は最小限のダックタイピングで定義する。 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<unknown>;
}

export class RedisKeyValueStore implements KeyValueStore {
  constructor(private readonly client: RedisLike) {}

  async get(key: string): Promise<string | undefined> {
    const value = await this.client.get(key);
    return value ?? undefined;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string, ttlSeconds: number): Promise<number> {
    const next = await this.client.incr(key);
    if (next === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return next;
  }
}
