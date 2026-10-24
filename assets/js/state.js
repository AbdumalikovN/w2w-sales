/* Состояние приложения: данные с сервера, оптимистичные правки, опрос изменений. */
import { get, patch as apiPatch, post, ApiError } from "./api.js";
import { todayTash, diffDays, store } from "./core.js";

export const S = {
  me: null,
  users: [],
  usersById: new Map(),
  settings: null,
  C: null, // константы: статусы, этапы, чек-листы
  deals: new Map(),
  seq: 0,
  lastSync: null,
  today: todayTash(),
  loaded: false,
  ui: {
    pipeline: store.get("w2w-pipeline") || "sales",
  },
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(what = "all", ids = null) {
  for (const fn of [...listeners]) {
    try {
      fn(what, ids);
    } catch (e) {
      console.error(e);
    }
  }
}

export const statusOf = (id) => S.C?.statuses.find((s) => s.id === id) || { id, label: id || "—", group: "new", rank: 0 };
export const stageOf = (id) => S.C?.devStages.find((s) => s.id === id) || null;
export const userName = (id) => (id === "sync" ? "Синхронизация Telegram" : id === "import" ? "Перенос из Notion" : S.usersById.get(id)?.name || "");
export const pipelineOf = (id) => S.settings?.pipelines.find((p) => p.id === id) || { id, label: id };
export const can = (lvl) => {
  const r = S.me?.role;
  if (lvl === "admin") return r === "admin";
  if (lvl === "write") return r === "admin" || r === "manager";
  return !!r;
};

/** Вычисляемые признаки сделки (как в прежнем дашборде). */
export function enrich(d) {
  const st = statusOf(d.status);
  const today = S.today;
  // «Архив 2025» — замороженная история старой CRM: без сигналов «без движения», «ждёт ответа», «просрочено».
  const frozen = d.pipeline === "archive";
  const ref = d.lastTouch || (d.updatedAt || d.createdAt || "").slice(0, 10);
  const idle = ref && !frozen ? Math.max(0, diffDays(today, ref)) : null;
  d._ = {
    frozen,
    g: st.group,
    rank: st.rank,
    tracked: !!d.firstTouch,
    replied: d.status !== "potential",
    meetingSet: !!d.meetingAt || !!d.meetingHeld || d.status === "meeting" || st.group === "won",
    proposal: ["tz", "kp", "sale"].includes(d.status) || st.group === "won",
    won: st.group === "won",
    idle,
    owner: d.contactRole === "Владелец или директор",
    hired: d.contactRole === "Наёмный сотрудник",
    waiting: !frozen && !!d.waiting && st.group !== "lost",
    meetingDate: d.meetingAt ? (d.meetingAt.length > 10 ? new Date(d.meetingAt).toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" }) : d.meetingAt) : "",
    due: !frozen && d.nextStepDue && d.nextStepDue < today && st.group !== "lost" && st.group !== "won",
    statusDays: d.statusAt ? Math.max(0, diffDays(today, d.statusAt.slice(0, 10))) : null,
  };
  d._.interest = d._.g === "active" || d._.g === "won" || d._.meetingSet;
  return d;
}

export function setUsers(list) {
  S.users = list || [];
  S.usersById = new Map(S.users.map((u) => [u.id, u]));
}

export async function bootstrap() {
  const b = await get("/bootstrap");
  S.me = b.me;
  setUsers(b.users);
  S.settings = b.settings;
  S.C = b.constants;
  S.seq = b.seq;
  S.lastSync = b.lastSync;
  S.today = todayTash();
  S.deals = new Map(b.deals.map((d) => [d.id, enrich(d)]));
  if (!S.settings.pipelines.some((p) => p.id === S.ui.pipeline)) S.ui.pipeline = S.settings.pipelines[0]?.id || "sales";
  S.loaded = true;
  emit("all");
}

export function dealsIn(pipeline = S.ui.pipeline) {
  const out = [];
  for (const d of S.deals.values()) if (!pipeline || d.pipeline === pipeline) out.push(d);
  return out;
}
export function allDeals() {
  return [...S.deals.values()];
}

// ---------- сохранение правок ----------
const chains = new Map();
const pendingCount = { n: 0 };
export const isSaving = () => pendingCount.n > 0;

function queue(id, job) {
  const prev = chains.get(id) || Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  chains.set(id, next);
  pendingCount.n++;
  next.finally(() => {
    pendingCount.n--;
    if (chains.get(id) === next) chains.delete(id);
  });
  return next;
}

/**
 * Оптимистично меняет поля сделки и отправляет на сервер.
 * Возвращает промис с серверной версией; при конфликте — бросает ApiError с полями.
 */
export function updateDeal(id, changes, { silent = false } = {}) {
  const d = S.deals.get(id);
  if (!d) return Promise.reject(new Error("no deal"));
  const before = {};
  for (const k of Object.keys(changes)) before[k] = d[k];
  Object.assign(d, changes);
  enrich(d);
  if (!silent) emit("deal", [id]);
  return queue(id, async () => {
    const cur = S.deals.get(id) || d;
    try {
      const r = await apiPatch(`/deals/${id}`, { patch: changes, baseSeq: cur.seq });
      mergeDeal(r.deal);
      emit("deal", [id]);
      return r.deal;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.extra?.deal) {
        mergeDeal(e.extra.deal);
        emit("deal", [id]);
      } else {
        const x = S.deals.get(id);
        if (x) {
          for (const [k, v] of Object.entries(before)) if (JSON.stringify(x[k]) === JSON.stringify(changes[k])) x[k] = v;
          enrich(x);
          emit("deal", [id]);
        }
      }
      throw e;
    }
  });
}

export function mergeDeal(server) {
  if (!server) return;
  if (server.seq > S.seq) S.seq = Math.max(S.seq, server.seq);
  S.deals.set(server.id, enrich(server));
}

export async function createDeal(data) {
  const r = await post("/deals", { deal: data });
  mergeDeal(r.deal);
  emit("deal", [r.deal.id]);
  return r.deal;
}

export async function bulkUpdate(ids, changes) {
  const r = await post("/deals/bulk", { ids, patch: changes });
  for (const d of r.deals) mergeDeal(d);
  emit("deals", r.deals.map((d) => d.id));
  return r.deals;
}

export function removeLocal(id) {
  S.deals.delete(id);
  emit("deals", [id]);
}

// ---------- опрос изменений ----------
let timer = null;
let polling = false;
export async function poll() {
  if (polling || !S.loaded || isSaving()) return;
  polling = true;
  try {
    const t = todayTash();
    if (t !== S.today) {
      S.today = t;
      for (const d of S.deals.values()) enrich(d);
    }
    const r = await get(`/changes?since=${S.seq}`);
    let changed = [];
    if (r.deals?.length || r.deleted?.length) {
      for (const d of r.deals) mergeDeal(d);
      for (const id of r.deleted || []) S.deals.delete(id);
      changed = [...r.deals.map((d) => d.id), ...(r.deleted || [])];
    }
    if (r.settings) S.settings = r.settings;
    if (r.users) setUsers(r.users);
    if (r.lastSync) S.lastSync = r.lastSync;
    S.seq = Math.max(S.seq, r.seq);
    if (changed.length || r.settings) emit("remote", changed);
    else emit("tick");
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) console.warn("poll", e.message);
  } finally {
    polling = false;
  }
}
export function startPolling() {
  stopPolling();
  timer = setInterval(() => {
    if (document.visibilityState === "visible") poll();
  }, 40000);
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onVis);
}
function onVis() {
  if (document.visibilityState === "visible") poll();
}
export function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVis);
  window.removeEventListener("focus", onVis);
}
