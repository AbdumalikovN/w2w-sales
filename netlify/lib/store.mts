// Хранилище: Netlify Blobs в продакшене, память — в тестах, файлы — в локальной разработке.
// Все документы — JSON. Запись с onlyIfMatch даёт оптимистическую блокировку по ETag.

export type Got<T = any> = { data: T; etag: string } | null;
export type SetOpts = { onlyIfMatch?: string; onlyIfNew?: boolean };
export type SetResult = { modified: boolean; etag?: string };

export interface KV {
  get<T = any>(key: string): Promise<Got<T>>;
  set(key: string, value: unknown, opts?: SetOpts): Promise<SetResult>;
  del(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

let current: KV | null = null;

/** Тесты и локальный сервер подменяют хранилище; в продакшене — Netlify Blobs. */
export function setKV(kv: KV) {
  current = kv;
}

export async function kv(): Promise<KV> {
  return current || blobsKV();
}

// Подключение к Blobs создаётся на каждую операцию: токен доступа выдаётся на конкретный вызов функции
// и истекает, а «тёплый» экземпляр функции живёт дольше. Закешированный getStore() через ~час
// начинает падать с «Failed to decode token: Token expired».
let blobs: typeof import("@netlify/blobs") | null = null;
async function blobsKV(): Promise<KV> {
  blobs ||= await import("@netlify/blobs");
  const store = () => blobs!.getStore({ name: "crm", consistency: "strong" });
  return {
    async get(key) {
      const r = await store().getWithMetadata(key, { type: "json", consistency: "strong" });
      if (!r || r.data == null) return null;
      return { data: r.data, etag: r.etag || "" };
    },
    async set(key, value, opts = {}) {
      const o: Record<string, unknown> = {};
      if (opts.onlyIfMatch) o.onlyIfMatch = opts.onlyIfMatch;
      if (opts.onlyIfNew) o.onlyIfNew = true;
      const r: any = await store().setJSON(key, value, o);
      return { modified: r?.modified !== false, etag: r?.etag };
    },
    async del(key) {
      await store().delete(key);
    },
    async list(prefix) {
      const { blobs: items } = await store().list({ prefix });
      return items.map((b: { key: string }) => b.key);
    },
  };
}

// ---------- память (тесты) ----------
export function memoryKV(): KV & { dump(): Record<string, unknown> } {
  const m = new Map<string, { v: string; e: number }>();
  let n = 0;
  return {
    async get(key) {
      const x = m.get(key);
      return x ? { data: JSON.parse(x.v), etag: `"e${x.e}"` } : null;
    },
    async set(key, value, opts = {}) {
      const x = m.get(key);
      if (opts.onlyIfNew && x) return { modified: false };
      if (opts.onlyIfMatch && (!x || `"e${x.e}"` !== opts.onlyIfMatch)) return { modified: false };
      const e = ++n;
      m.set(key, { v: JSON.stringify(value), e });
      return { modified: true, etag: `"e${e}"` };
    },
    async del(key) {
      m.delete(key);
    },
    async list(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
    },
    dump() {
      return Object.fromEntries([...m].map(([k, x]) => [k, JSON.parse(x.v)]));
    },
  };
}

// ---------- файлы (локальный сервер разработки) ----------
export async function fileKV(dir: string): Promise<KV> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const crypto = await import("node:crypto");
  await fs.mkdir(dir, { recursive: true });
  const file = (key: string) => path.join(dir, encodeURIComponent(key) + ".json");
  const tag = (s: string) => `"${crypto.createHash("sha1").update(s).digest("hex").slice(0, 16)}"`;
  return {
    async get(key) {
      try {
        const s = await fs.readFile(file(key), "utf8");
        return { data: JSON.parse(s), etag: tag(s) };
      } catch {
        return null;
      }
    },
    async set(key, value, opts = {}) {
      let cur: string | null = null;
      try {
        cur = await fs.readFile(file(key), "utf8");
      } catch {}
      if (opts.onlyIfNew && cur != null) return { modified: false };
      if (opts.onlyIfMatch && (cur == null || tag(cur) !== opts.onlyIfMatch)) return { modified: false };
      const s = JSON.stringify(value);
      await fs.writeFile(file(key), s);
      return { modified: true, etag: tag(s) };
    },
    async del(key) {
      await fs.rm(file(key), { force: true });
    },
    async list(prefix) {
      const names = await fs.readdir(dir);
      return names
        .filter((n) => n.endsWith(".json"))
        .map((n) => decodeURIComponent(n.slice(0, -5)))
        .filter((k) => k.startsWith(prefix))
        .sort();
    },
  };
}
