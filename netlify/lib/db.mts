// Документы хранилища и оптимистичные транзакции поверх ETag.
//   db            — сделки, справочники, служебные данные (один документ)
//   users         — пользователи и токены интеграций
//   h/<dealId>    — история карточки (переписка, комментарии, изменения)
//   base          — база анкет курса
//   backup/<дата> — ежедневная копия db
import { kv } from "./store.mts";
import { DEFAULT_SETTINGS, type Settings } from "./model.mts";
import { HttpError, now, todayTashkent } from "./http.mts";

export type Deal = Record<string, any> & { id: string; rev: number; seq: number };
export type Db = {
  v: number;
  seq: number;
  createdAt: string;
  settings: Settings;
  settingsSeq: number;
  deals: Record<string, Deal>;
  meta: { lastBackup?: string; lastSync?: any; importedAt?: string; [k: string]: any };
};
export type User = {
  id: string;
  login: string;
  name: string;
  role: "admin" | "manager" | "viewer";
  active: boolean;
  color: string;
  tg?: string;
  salt: string;
  hash: string;
  tv: number;
  createdAt: string;
  lastLoginAt?: string;
  mustChange?: boolean;
};
export type ApiToken = { id: string; name: string; hash: string; hint: string; scopes: string[]; createdAt: string; createdBy: string; lastUsedAt?: string };
export type UsersDoc = { v: number; rev: number; users: User[]; tokens: ApiToken[] };

export const SKIP = Symbol("skip-write");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function defaultDb(): Db {
  return { v: 1, seq: 0, createdAt: now(), settings: structuredClone(DEFAULT_SETTINGS), settingsSeq: 0, deals: {}, meta: {} };
}

function upgradeDb(db: Db): Db {
  db.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(db.settings || {}) };
  db.meta ||= {};
  db.deals ||= {};
  return db;
}

export async function readDb(): Promise<Db> {
  const s = await kv();
  const got = await s.get<Db>("db");
  return upgradeDb(got ? got.data : defaultDb());
}

async function mutate<T, D>(key: string, init: () => D, fn: (doc: D) => T | typeof SKIP | Promise<T | typeof SKIP>, before?: (prev: D | null, next: D) => Promise<void>): Promise<T> {
  const s = await kv();
  for (let attempt = 0; attempt < 8; attempt++) {
    const got = await s.get<D>(key);
    const doc = got ? got.data : init();
    const result = await fn(doc);
    if (result === SKIP) return undefined as T;
    if (before) await before(got ? got.data : null, doc);
    const res = got ? await s.set(key, doc, { onlyIfMatch: got.etag }) : await s.set(key, doc, { onlyIfNew: true });
    if (res.modified) return result as T;
    await sleep(40 + Math.random() * 120 * (attempt + 1));
  }
  throw new HttpError(503, "busy", "Данные сейчас меняет кто-то ещё. Повторите действие через пару секунд.");
}

/** Транзакция над главным документом. fn меняет db на месте; вернуть SKIP — ничего не записывать. */
export async function mutateDb<T>(fn: (db: Db) => T | typeof SKIP | Promise<T | typeof SKIP>): Promise<T> {
  return mutate<T, Db>(
    "db",
    defaultDb,
    async (db) => fn(upgradeDb(db)),
    async (prev, next) => {
      const today = todayTashkent();
      if (prev && next.meta.lastBackup !== today) {
        const s = await kv();
        await s.set(`backup/${today}`, prev, { onlyIfNew: true });
        next.meta.lastBackup = today;
        // храним 45 последних ежедневных копий
        const keys = await s.list("backup/");
        for (const k of keys.slice(0, Math.max(0, keys.length - 45))) await s.del(k);
      }
    },
  );
}

export function emptyUsers(): UsersDoc {
  return { v: 1, rev: 0, users: [], tokens: [] };
}

export async function readUsers(): Promise<UsersDoc> {
  const s = await kv();
  const got = await s.get<UsersDoc>("users");
  return got ? got.data : emptyUsers();
}

export async function mutateUsers<T>(fn: (u: UsersDoc) => T | typeof SKIP | Promise<T | typeof SKIP>): Promise<T> {
  return mutate<T, UsersDoc>("users", emptyUsers, async (u) => {
    const r = await fn(u);
    if (r !== SKIP) u.rev = (u.rev || 0) + 1;
    return r;
  });
}

export type HistoryItem = { id: string; at: string; label?: string; kind: string; text: string; by?: string; editedAt?: string };
export type HistoryDoc = { items: HistoryItem[] };

export async function readHistory(dealId: string): Promise<HistoryDoc> {
  const s = await kv();
  const got = await s.get<HistoryDoc>(`h/${dealId}`);
  return got ? got.data : { items: [] };
}

export async function mutateHistory<T>(dealId: string, fn: (h: HistoryDoc) => T | typeof SKIP | Promise<T | typeof SKIP>): Promise<T> {
  return mutate<T, HistoryDoc>(`h/${dealId}`, () => ({ items: [] }), fn);
}

export function sortHistory(items: HistoryItem[]) {
  return items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export type BaseDoc = { asOf: string; leads: any[] };

export async function readBase(): Promise<BaseDoc> {
  const s = await kv();
  const got = await s.get<BaseDoc>("base");
  return got ? got.data : { asOf: "", leads: [] };
}

export async function mutateBase<T>(fn: (b: BaseDoc) => T | typeof SKIP | Promise<T | typeof SKIP>): Promise<T> {
  return mutate<T, BaseDoc>("base", () => ({ asOf: "", leads: [] }), fn);
}

export async function rateLimit(key: string, limit: number, windowMs: number) {
  const s = await kv();
  const k = `rl/${key}`;
  const got = await s.get<{ n: number; t0: number }>(k);
  const t = Date.now();
  let st = got?.data;
  if (!st || t - st.t0 > windowMs) st = { n: 0, t0: t };
  return {
    blocked: st.n >= limit,
    retryInMin: Math.ceil((windowMs - (t - st.t0)) / 60000),
    async hit() {
      st!.n += 1;
      await s.set(k, st);
    },
    async reset() {
      await s.del(k);
    },
  };
}
