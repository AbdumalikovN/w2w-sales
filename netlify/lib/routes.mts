// Маршруты API CRM. Один обработчик на всё /api/*.
import {
  DEFAULT_SETTINGS,
  DEV_STAGES,
  DEAL_STEPS,
  DOC_STEPS,
  EDITABLE,
  LABELS,
  PRIORITIES,
  STATUSES,
  applyPatch,
  cleanSettings,
  emptyDeal,
} from "./model.mts";
import {
  SKIP,
  mutateBase,
  mutateDb,
  mutateHistory,
  mutateUsers,
  rateLimit,
  readBase,
  readDb,
  readHistory,
  readUsers,
  sortHistory,
  type ApiToken,
  type Db,
  type Deal,
  type HistoryItem,
  type User,
} from "./db.mts";
import { HttpError, bad, errorResponse, forbidden, json, notFound, now, readBody, rid, todayTashkent } from "./http.mts";
import { cookieHeader, hashPassword, loadSecret, newPassword, newToken, readCookie, readSession, setupConfigured, setupKeyMatches, sha256, signSession, verifyPassword } from "./auth.mts";
import { SYNC_USER, applySyncItem, mergeHistory, statusId } from "./sync.mts";
import { kv } from "./store.mts";

type Auth = { user: User | null; token: ApiToken | null; via: "cookie" | "token" | null };
type Ctx = { req: Request; url: URL; path: string; method: string; auth: Auth; ip: string };

const SESSION_DAYS = 30;
const COLORS = ["#0abcf3", "#07e7b7", "#7a8cff", "#ff9f43", "#ff6b9a", "#2de8c6", "#ffc75a", "#9b7bff"];
const TRACKED = new Set(["status", "owner", "pipeline", "devStage", "amount", "meetingAt", "meetingHeld", "deadline", "startDate"]);

const publicUser = (u: User) => ({ id: u.id, name: u.name, role: u.role, color: u.color, active: u.active, tg: u.tg || "" });
const meUser = (u: User) => ({ ...publicUser(u), login: u.login, mustChange: !!u.mustChange });
const adminUser = (u: User) => ({ ...meUser(u), createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null });

function actorId(a: Auth) {
  return a.user ? a.user.id : a.token ? SYNC_USER : "";
}

function need(ctx: Ctx, level: "read" | "write" | "admin" | "sync") {
  const { user, token } = ctx.auth;
  if (!user && !token) throw new HttpError(401, "unauthorized", "Войдите в CRM");
  if (token) {
    const ok = level === "sync" ? token.scopes.includes("sync") : level === "read" ? token.scopes.includes("read") || token.scopes.includes("sync") : false;
    if (!ok) throw forbidden("У токена нет доступа к этому действию");
    return;
  }
  const role = user!.role;
  if (level === "admin" || level === "sync") {
    if (role !== "admin") throw forbidden("Действие доступно только администратору");
  } else if (level === "write") {
    if (role === "viewer") throw forbidden("Роль «Наблюдатель» не может менять данные");
  }
}

async function authenticate(req: Request): Promise<Auth> {
  const authz = req.headers.get("authorization") || "";
  if (/^Bearer\s+w2wk_/i.test(authz)) {
    const raw = authz.replace(/^Bearer\s+/i, "").trim();
    const h = sha256(raw);
    const users = await readUsers();
    const token = users.tokens.find((t) => t.hash === h) || null;
    if (!token) throw new HttpError(401, "bad_token", "Токен интеграции не найден или отозван");
    const today = todayTashkent();
    if (!token.lastUsedAt || token.lastUsedAt.slice(0, 10) !== today) {
      await mutateUsers((u) => {
        const t = u.tokens.find((x) => x.id === token.id);
        if (!t) return SKIP;
        t.lastUsedAt = now();
      }).catch(() => {});
    }
    return { user: null, token, via: "token" };
  }
  const sess = readSession(readCookie(req, "w2w_s"));
  if (!sess) return { user: null, token: null, via: null };
  const users = await readUsers();
  const user = users.users.find((u) => u.id === sess.u) || null;
  if (!user || !user.active || user.tv !== sess.v) return { user: null, token: null, via: null };
  return { user, token: null, via: "cookie" };
}

function csrf(ctx: Ctx) {
  if (ctx.method === "GET") return;
  if (ctx.auth.via !== "cookie" && !ctx.path.startsWith("/auth/")) return;
  if (ctx.req.headers.get("x-w2w") !== "1") throw forbidden("Запрос отклонён (CSRF)");
  const site = ctx.req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden("Запрос с чужого сайта отклонён");
}

function sessionCookie(user: User, remember: boolean) {
  const e = Math.floor(Date.now() / 1000) + (remember ? SESSION_DAYS : 1) * 86400;
  return cookieHeader(signSession({ u: user.id, v: user.tv, e }), remember ? SESSION_DAYS * 86400 : null);
}

// ---------- сделки ----------
function stamp(deal: Deal, changed: string[], db: Db, actor: string) {
  if (!changed.length) return;
  db.seq += 1;
  deal.rev = (deal.rev || 0) + 1;
  deal.seq = db.seq;
  deal.updatedAt = now();
  deal.updatedBy = actor;
  deal.fseq ||= {};
  for (const k of changed) deal.fseq[k] = db.seq;
}

function describeChanges(before: Record<string, any>, deal: Deal, changed: string[], userNames: Map<string, string>, settings: Db["settings"]) {
  const out: string[] = [];
  const st = (id: string) => STATUSES.find((s) => s.id === id)?.label || id || "—";
  const dv = (id: string) => DEV_STAGES.find((s) => s.id === id)?.label || "—";
  const pl = (id: string) => settings.pipelines.find((p) => p.id === id)?.label || id;
  for (const k of changed) {
    if (!TRACKED.has(k)) continue;
    const a = before[k], b = deal[k];
    if (k === "status") out.push(`Статус: ${st(a)} → ${st(b)}`);
    else if (k === "owner") out.push(`Ответственный: ${userNames.get(a) || "—"} → ${userNames.get(b) || "—"}`);
    else if (k === "pipeline") out.push(`Воронка: ${pl(a)} → ${pl(b)}`);
    else if (k === "devStage") out.push(`Этап разработки: ${dv(a)} → ${dv(b)}`);
    else if (k === "meetingHeld") out.push(b ? "Встреча отмечена как проведённая" : "Снята отметка «встреча проведена»");
    else if (k === "amount") out.push(`Сумма договора: ${a ?? "—"} → ${b ?? "—"}`);
    else out.push(`${LABELS[k]}: ${a || "—"} → ${b || "—"}`);
  }
  const other = changed.filter((k) => !TRACKED.has(k) && !["fseq"].includes(k)).map((k) => LABELS[k] || k);
  if (other.length) out.push("Изменено: " + other.join(", "));
  return out;
}

function visibleDeals(db: Db) {
  return Object.values(db.deals).filter((d) => !d.deleted);
}

async function addHistory(dealId: string, items: HistoryItem[]): Promise<number> {
  if (!items.length) return 0;
  const n = await mutateHistory(dealId, (h) => {
    const added = mergeHistory(h.items, items);
    if (!added) return SKIP;
    sortHistory(h.items);
    if (h.items.length > 800) h.items.splice(0, h.items.length - 800);
    return added;
  });
  return n || 0;
}

async function defaultOwner() {
  const u = await readUsers();
  const admin = u.users.find((x) => x.active && x.role === "admin");
  return admin ? admin.id : "";
}

// ---------- маршрутизация ----------
type Handler = (ctx: Ctx, params: Record<string, string>) => Promise<Response>;
const routes: [string, RegExp, Handler][] = [];
function route(method: string, pattern: string, h: Handler) {
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "/?$");
  routes.push([method, re, h]);
}

route("GET", "/health", async (ctx) => {
  // Только признаки «задано / не задано» — сами значения наружу не уходят.
  return json(ctx.req, { ok: true, time: now(), configured: { secret: await loadSecret(), setupKey: setupConfigured() } });
});

route("POST", "/auth/setup", async (ctx) => {
  if (!setupKeyMatches(ctx.req.headers.get("x-setup-key"))) throw forbidden("Неверный ключ установки");
  const b = await readBody(ctx.req);
  if ((await readUsers()).users.length) throw forbidden("Администратор уже создан");
  const login = String(b.login || "").trim().toLowerCase();
  const name = String(b.name || "").trim().slice(0, 80);
  const password = String(b.password || "");
  if (!/^[a-z0-9._@-]{3,40}$/.test(login) || !name || password.length < 10) throw bad("Нужны логин, имя и пароль от 10 символов");
  const { salt, hash } = await hashPassword(password);
  const user = await mutateUsers((u) => {
    if (u.users.length) throw forbidden("Администратор уже создан");
    const nu: User = { id: rid("u"), login, name, role: "admin", active: true, color: COLORS[0], salt, hash, tv: 1, createdAt: now(), tg: String(b.tg || "") };
    u.users.push(nu);
    return nu;
  });
  return json(ctx.req, { user: meUser(user) }, 201);
});

route("POST", "/auth/login", async (ctx) => {
  const b = await readBody(ctx.req, 10_000);
  const login = String(b.login || "").trim().toLowerCase().slice(0, 60);
  const password = String(b.password || "").slice(0, 200);
  if (!login || !password) throw bad("Введите логин и пароль");
  const rl = await rateLimit(sha256("login|" + login), 8, 15 * 60_000);
  const rlIp = await rateLimit(sha256("ip|" + ctx.ip), 40, 15 * 60_000);
  if (rl.blocked || rlIp.blocked) throw new HttpError(429, "too_many", `Слишком много попыток. Попробуйте через ${Math.max(rl.retryInMin, 1)} мин.`);
  const users = await readUsers();
  const user = users.users.find((u) => u.login === login);
  const ok = user && user.active ? await verifyPassword(password, user.salt, user.hash) : false;
  if (!ok || !user) {
    await rl.hit();
    await rlIp.hit();
    throw new HttpError(401, "bad_credentials", "Неверный логин или пароль");
  }
  await rl.reset();
  await mutateUsers((u) => {
    const x = u.users.find((y) => y.id === user.id);
    if (!x) return SKIP;
    x.lastLoginAt = now();
  });
  return json(ctx.req, { user: meUser(user) }, 200, { "set-cookie": sessionCookie(user, b.remember !== false) });
});

route("POST", "/auth/logout", async (ctx) => json(ctx.req, { ok: true }, 200, { "set-cookie": cookieHeader("", 0) }));

route("GET", "/auth/me", async (ctx) => {
  if (!ctx.auth.user) throw new HttpError(401, "unauthorized", "Войдите в CRM");
  return json(ctx.req, { user: meUser(ctx.auth.user) });
});

route("POST", "/auth/password", async (ctx) => {
  const me = ctx.auth.user;
  if (!me) throw new HttpError(401, "unauthorized", "Войдите в CRM");
  const b = await readBody(ctx.req, 10_000);
  const next = String(b.next || "");
  if (next.length < 8) throw bad("Новый пароль — минимум 8 символов");
  if (!(await verifyPassword(String(b.current || ""), me.salt, me.hash))) throw bad("Текущий пароль указан неверно", "bad_password");
  const { salt, hash } = await hashPassword(next);
  const user = await mutateUsers((u) => {
    const x = u.users.find((y) => y.id === me.id);
    if (!x) throw notFound();
    x.salt = salt;
    x.hash = hash;
    x.tv += 1;
    x.mustChange = false;
    return x;
  });
  return json(ctx.req, { user: meUser(user) }, 200, { "set-cookie": sessionCookie(user, true) });
});

route("GET", "/bootstrap", async (ctx) => {
  need(ctx, "read");
  const [db, users] = await Promise.all([readDb(), readUsers()]);
  return json(ctx.req, {
    me: ctx.auth.user ? meUser(ctx.auth.user) : null,
    users: users.users.map(publicUser),
    settings: db.settings,
    constants: { statuses: STATUSES, devStages: DEV_STAGES, steps: DEAL_STEPS, docs: DOC_STEPS, priorities: PRIORITIES },
    deals: visibleDeals(db),
    seq: db.seq,
    lastSync: db.meta.lastSync || null,
    serverTime: now(),
  });
});

route("GET", "/changes", async (ctx) => {
  need(ctx, "read");
  const since = Number(ctx.url.searchParams.get("since") || 0);
  const db = await readDb();
  if (db.seq === since) return json(ctx.req, { seq: db.seq, deals: [], deleted: [] });
  const ch = Object.values(db.deals).filter((d) => d.seq > since);
  const users = await readUsers();
  return json(ctx.req, {
    seq: db.seq,
    deals: ch.filter((d) => !d.deleted),
    deleted: ch.filter((d) => d.deleted).map((d) => d.id),
    settings: db.settingsSeq > since ? db.settings : undefined,
    users: users.users.map(publicUser),
    lastSync: db.meta.lastSync || null,
  });
});

route("POST", "/deals", async (ctx) => {
  need(ctx, "write");
  const b = await readBody(ctx.req, 200_000);
  const actor = actorId(ctx.auth);
  const deal = await mutateDb((db) => {
    const d = emptyDeal() as Deal;
    d.id = rid("d");
    d.rev = 0;
    d.createdAt = now();
    d.createdBy = actor;
    d.owner = actor;
    applyPatch(d, b.deal || b, db.settings);
    if (!d.name) d.name = "Новая сделка";
    d.statusAt = now();
    db.seq += 1;
    d.seq = db.seq;
    d.rev = 1;
    d.updatedAt = d.createdAt;
    d.updatedBy = actor;
    d.fseq = {};
    db.deals[d.id] = d;
    return d;
  });
  await addHistory(deal.id, [{ id: rid("h"), at: now(), kind: "system", text: "Карточка создана", by: actor }]);
  return json(ctx.req, { deal }, 201);
});

route("PATCH", "/deals/:id", async (ctx, p) => {
  need(ctx, "write");
  const b = await readBody(ctx.req, 200_000);
  const patch = b.patch || {};
  const baseSeq = Number(b.baseSeq ?? -1);
  const actor = actorId(ctx.auth);
  const users = await readUsers();
  const names = new Map(users.users.map((u) => [u.id, u.name] as [string, string]));
  names.set(SYNC_USER, "Синхронизация");
  let notes: string[] = [];
  const result = await mutateDb((db) => {
    const deal = db.deals[p.id];
    if (!deal || deal.deleted) throw notFound("Карточка не найдена — возможно, её удалили");
    // конфликт: поле изменил кто-то другой после того, как мы его загрузили
    if (baseSeq >= 0) {
      const conflicts = Object.keys(patch).filter(
        (k) => EDITABLE.has(k) && (deal.fseq?.[k] || 0) > baseSeq && deal.updatedBy !== actor && JSON.stringify(deal[k]) !== JSON.stringify(patch[k]),
      );
      if (conflicts.length) throw new HttpError(409, "conflict", "Эти поля только что изменил другой пользователь", { fields: conflicts, deal });
    }
    const before = structuredClone(deal);
    const changed = applyPatch(deal, patch, db.settings);
    if (!changed.length) return { deal, changed };
    if (changed.includes("status")) deal.statusAt = now();
    stamp(deal, changed, db, actor);
    notes = describeChanges(before, deal, changed, names, db.settings);
    return { deal, changed };
  });
  if (notes.length) await addHistory(p.id, notes.map((t) => ({ id: rid("h"), at: now(), kind: t.startsWith("Статус") ? "status" : "change", text: t, by: actor })));
  return json(ctx.req, result);
});

route("POST", "/deals/bulk", async (ctx) => {
  need(ctx, "write");
  const b = await readBody(ctx.req, 200_000);
  const ids: string[] = Array.isArray(b.ids) ? b.ids.slice(0, 500) : [];
  const patch = b.patch || {};
  const allowed = ["status", "owner", "pipeline", "devStage", "waiting", "priority", "source", "sector", "region"];
  for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw bad(`Поле «${k}» нельзя менять массово`);
  const actor = actorId(ctx.auth);
  const users = await readUsers();
  const names = new Map(users.users.map((u) => [u.id, u.name] as [string, string]));
  const notes: Record<string, string[]> = {};
  const deals = await mutateDb((db) => {
    const out: Deal[] = [];
    for (const id of ids) {
      const deal = db.deals[id];
      if (!deal || deal.deleted) continue;
      const before = structuredClone(deal);
      const changed = applyPatch(deal, patch, db.settings);
      if (!changed.length) continue;
      if (changed.includes("status")) deal.statusAt = now();
      stamp(deal, changed, db, actor);
      notes[id] = describeChanges(before, deal, changed, names, db.settings);
      out.push(deal);
    }
    return out;
  });
  await Promise.all(Object.entries(notes).map(([id, n]) => addHistory(id, n.map((t) => ({ id: rid("h"), at: now(), kind: "change", text: t, by: actor })))));
  return json(ctx.req, { deals });
});

route("DELETE", "/deals/:id", async (ctx, p) => {
  need(ctx, "admin");
  const actor = actorId(ctx.auth);
  await mutateDb((db) => {
    const deal = db.deals[p.id];
    if (!deal || deal.deleted) throw notFound();
    db.seq += 1;
    deal.deleted = true;
    deal.deletedAt = now();
    deal.deletedBy = actor;
    deal.seq = db.seq;
  });
  return json(ctx.req, { ok: true });
});

route("POST", "/deals/:id/restore", async (ctx, p) => {
  need(ctx, "admin");
  const deal = await mutateDb((db) => {
    const d = db.deals[p.id];
    if (!d || !d.deleted) throw notFound();
    db.seq += 1;
    delete d.deleted;
    delete d.deletedAt;
    delete d.deletedBy;
    d.seq = db.seq;
    return d;
  });
  return json(ctx.req, { deal });
});

route("GET", "/trash", async (ctx) => {
  need(ctx, "admin");
  const db = await readDb();
  return json(ctx.req, { deals: Object.values(db.deals).filter((d) => d.deleted) });
});

route("GET", "/deals/:id/history", async (ctx, p) => {
  need(ctx, "read");
  const h = await readHistory(p.id);
  return json(ctx.req, { items: h.items });
});

route("POST", "/deals/:id/history", async (ctx, p) => {
  need(ctx, "write");
  const b = await readBody(ctx.req, 50_000);
  const text = String(b.text || "").trim().slice(0, 4000);
  if (!text) throw bad("Пустая запись");
  const kind = ["note", "call", "meeting", "telegram", "email"].includes(b.kind) ? b.kind : "note";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? b.date : "";
  const db = await readDb();
  const deal = db.deals[p.id];
  if (!deal || deal.deleted) throw notFound("Карточка не найдена");
  const item: HistoryItem = { id: rid("h"), at: date ? date + "T12:00:00.000Z" : now(), kind, text, by: actorId(ctx.auth) };
  await mutateHistory(p.id, (h) => {
    h.items.push(item);
    sortHistory(h.items);
  });
  // запись в историю — тоже касание: двигаем «последнее касание» и снимаем «ждёт ответа», если менеджер ответил
  if (["call", "meeting", "telegram", "email"].includes(kind) || b.touch) {
    const d = item.at.slice(0, 10);
    await mutateDb((db2) => {
      const x = db2.deals[p.id];
      if (!x) return SKIP;
      const patch: Record<string, unknown> = {};
      if (!x.lastTouch || x.lastTouch < d) patch.lastTouch = d;
      if (b.answered && x.waiting) patch.waiting = false;
      const changed = applyPatch(x, patch, db2.settings);
      if (!changed.length) return SKIP;
      stamp(x, changed, db2, actorId(ctx.auth));
    });
  }
  return json(ctx.req, { item }, 201);
});

route("PATCH", "/deals/:id/history/:hid", async (ctx, p) => {
  need(ctx, "write");
  const b = await readBody(ctx.req, 50_000);
  const text = String(b.text || "").trim().slice(0, 4000);
  if (!text) throw bad("Пустая запись");
  const me = ctx.auth.user!;
  const item = await mutateHistory(p.id, (h) => {
    const x = h.items.find((i) => i.id === p.hid);
    if (!x) throw notFound("Запись не найдена");
    if (x.by !== me.id && me.role !== "admin") throw forbidden("Изменить можно только свою запись");
    if (x.kind === "status" || x.kind === "change" || x.kind === "system") throw forbidden("Служебные записи не редактируются");
    x.text = text;
    x.editedAt = now();
    return x;
  });
  return json(ctx.req, { item });
});

route("DELETE", "/deals/:id/history/:hid", async (ctx, p) => {
  need(ctx, "write");
  const me = ctx.auth.user!;
  await mutateHistory(p.id, (h) => {
    const i = h.items.findIndex((x) => x.id === p.hid);
    if (i < 0) throw notFound("Запись не найдена");
    const x = h.items[i];
    if (x.by !== me.id && me.role !== "admin") throw forbidden("Удалить можно только свою запись");
    if ((x.kind === "status" || x.kind === "change" || x.kind === "system") && me.role !== "admin") throw forbidden("Служебные записи удаляет только администратор");
    h.items.splice(i, 1);
  });
  return json(ctx.req, { ok: true });
});

// ---------- база анкет курса ----------
route("GET", "/base", async (ctx) => {
  need(ctx, "read");
  return json(ctx.req, await readBase());
});

route("PATCH", "/base/:n", async (ctx, p) => {
  need(ctx, "write");
  const b = await readBody(ctx.req, 10_000);
  const status = ["new", "skipped"].includes(b.status) ? b.status : "new";
  const lead = await mutateBase((base) => {
    const l = base.leads.find((x) => String(x.n) === p.n);
    if (!l) throw notFound("Анкета не найдена");
    l.status = status;
    l.statusBy = actorId(ctx.auth);
    l.statusAt = now();
    return l;
  });
  return json(ctx.req, { lead });
});

route("POST", "/base/:n/convert", async (ctx, p) => {
  need(ctx, "write");
  const actor = actorId(ctx.auth);
  const base = await readBase();
  const l = base.leads.find((x) => String(x.n) === p.n);
  if (!l) throw notFound("Анкета не найдена");
  if (l.dealId) throw bad("По этой анкете уже есть карточка");
  const deal = await mutateDb((db) => {
    const d = emptyDeal() as Deal;
    d.id = rid("d");
    applyPatch(
      d,
      {
        pipeline: "sales",
        name: l.company && l.company !== "—" ? l.company : `${l.name} (сфера уточнить)`,
        status: "potential",
        contactName: l.name,
        contactRole: l.lpr ? "Владелец или директор" : "Не указана",
        telegram: l.tg ? "https://t.me/" + l.tg : "",
        tgIds: l.tgId ? [String(l.tgId)] : [],
        region: l.region || "",
        source: "Анкета курса 24-dastur",
        context: { business: l.activity || "", howFound: `Анкета в группе курса «ISAEV Dastur 24» (№${l.n})`, needs: "", budget: "" },
        contacts: [`${l.name}${l.role ? " · " + l.role : ""}${l.tg ? " · Telegram @" + l.tg : ""}${l.link ? " · анкета: " + l.link : ""}`],
        nextStep: "Написать первое сообщение",
      },
      db.settings,
    );
    d.owner = actor;
    d.createdAt = now();
    d.createdBy = actor;
    d.statusAt = now();
    d.rev = 1;
    db.seq += 1;
    d.seq = db.seq;
    d.updatedAt = d.createdAt;
    d.updatedBy = actor;
    d.fseq = {};
    db.deals[d.id] = d;
    return d;
  });
  await mutateBase((b) => {
    const x = b.leads.find((y) => String(y.n) === p.n);
    if (!x) return SKIP;
    x.dealId = deal.id;
    x.status = "converted";
    x.statusBy = actor;
    x.statusAt = now();
  });
  await addHistory(deal.id, [{ id: rid("h"), at: now(), kind: "system", text: `Карточка создана из анкеты курса №${l.n}`, by: actor }]);
  return json(ctx.req, { deal }, 201);
});

// ---------- настройки и пользователи ----------
route("PUT", "/settings", async (ctx) => {
  need(ctx, "admin");
  const b = await readBody(ctx.req, 100_000);
  const settings = await mutateDb((db) => {
    const next = cleanSettings(b.settings || b, db.settings);
    // воронку, в которой есть сделки, удалить нельзя
    for (const p of db.settings.pipelines) {
      if (!next.pipelines.some((x) => x.id === p.id) && visibleDeals(db).some((d) => d.pipeline === p.id)) {
        throw bad(`В воронке «${p.label}» есть сделки — сначала перенесите их`);
      }
    }
    db.settings = next;
    db.seq += 1;
    db.settingsSeq = db.seq;
    return next;
  });
  return json(ctx.req, { settings });
});

route("GET", "/users", async (ctx) => {
  need(ctx, "admin");
  const u = await readUsers();
  return json(ctx.req, { users: u.users.map(adminUser) });
});

route("POST", "/users", async (ctx) => {
  need(ctx, "admin");
  const b = await readBody(ctx.req, 10_000);
  const login = String(b.login || "").trim().toLowerCase();
  const name = String(b.name || "").trim().slice(0, 80);
  const role = ["admin", "manager", "viewer"].includes(b.role) ? b.role : "manager";
  if (!/^[a-z0-9._@-]{3,40}$/.test(login)) throw bad("Логин: 3–40 символов, латиница, цифры, точка, дефис");
  if (!name) throw bad("Укажите имя");
  const password = String(b.password || "") || newPassword();
  if (password.length < 8) throw bad("Пароль — минимум 8 символов");
  const { salt, hash } = await hashPassword(password);
  const user = await mutateUsers((u) => {
    if (u.users.some((x) => x.login === login)) throw bad("Такой логин уже есть");
    const nu: User = {
      id: rid("u"),
      login,
      name,
      role,
      active: true,
      color: COLORS[u.users.length % COLORS.length],
      tg: String(b.tg || "").slice(0, 60),
      salt,
      hash,
      tv: 1,
      createdAt: now(),
      mustChange: b.mustChange !== false,
    };
    u.users.push(nu);
    return nu;
  });
  return json(ctx.req, { user: adminUser(user), password }, 201);
});

route("PATCH", "/users/:id", async (ctx, p) => {
  need(ctx, "admin");
  const b = await readBody(ctx.req, 10_000);
  let password: string | undefined;
  let pwHash: { salt: string; hash: string } | null = null;
  if (b.resetPassword) {
    password = newPassword();
    pwHash = await hashPassword(password);
  }
  const me = ctx.auth.user!;
  const user = await mutateUsers((u) => {
    const x = u.users.find((y) => y.id === p.id);
    if (!x) throw notFound("Пользователь не найден");
    if (typeof b.name === "string" && b.name.trim()) x.name = b.name.trim().slice(0, 80);
    if (typeof b.tg === "string") x.tg = b.tg.trim().slice(0, 60);
    if (typeof b.color === "string" && /^#[0-9a-f]{6}$/i.test(b.color)) x.color = b.color;
    if (b.role && ["admin", "manager", "viewer"].includes(b.role) && b.role !== x.role) {
      if (x.id === me.id) throw bad("Нельзя изменить свою роль");
      x.role = b.role;
      x.tv += 1;
    }
    if (typeof b.active === "boolean" && b.active !== x.active) {
      if (x.id === me.id) throw bad("Нельзя отключить самого себя");
      x.active = b.active;
      x.tv += 1;
    }
    if (pwHash) {
      x.salt = pwHash.salt;
      x.hash = pwHash.hash;
      x.tv += 1;
      x.mustChange = true;
    }
    if (u.users.filter((y) => y.active && y.role === "admin").length === 0) throw bad("Должен остаться хотя бы один активный администратор");
    return x;
  });
  return json(ctx.req, { user: adminUser(user), password });
});

route("GET", "/tokens", async (ctx) => {
  need(ctx, "admin");
  const u = await readUsers();
  return json(ctx.req, { tokens: u.tokens.map(({ hash, ...t }) => t) });
});

route("POST", "/tokens", async (ctx) => {
  need(ctx, "admin");
  const b = await readBody(ctx.req, 10_000);
  const name = String(b.name || "").trim().slice(0, 80) || "Интеграция";
  const scopes = (Array.isArray(b.scopes) ? b.scopes : ["sync"]).filter((s: string) => ["sync", "read"].includes(s));
  if (!scopes.length) throw bad("Выберите права токена");
  const t = newToken();
  const token = await mutateUsers((u) => {
    const nt: ApiToken = { id: rid("t"), name, hash: t.hash, hint: t.hint, scopes, createdAt: now(), createdBy: ctx.auth.user!.id };
    u.tokens.push(nt);
    return nt;
  });
  const { hash, ...pub } = token;
  return json(ctx.req, { token: pub, secret: t.raw }, 201);
});

route("DELETE", "/tokens/:id", async (ctx, p) => {
  need(ctx, "admin");
  await mutateUsers((u) => {
    const i = u.tokens.findIndex((t) => t.id === p.id);
    if (i < 0) throw notFound("Токен не найден");
    u.tokens.splice(i, 1);
  });
  return json(ctx.req, { ok: true });
});

// ---------- экспорт / импорт ----------
route("GET", "/export", async (ctx) => {
  need(ctx, "admin");
  const [db, base, users] = await Promise.all([readDb(), readBase(), readUsers()]);
  const s = await kv();
  const keys = await s.list("h/");
  const history: Record<string, HistoryItem[]> = {};
  for (let i = 0; i < keys.length; i += 25) {
    const part = await Promise.all(keys.slice(i, i + 25).map((k) => s.get<{ items: HistoryItem[] }>(k)));
    part.forEach((g, j) => {
      if (g) history[keys[i + j].slice(2)] = g.data.items;
    });
  }
  return json(ctx.req, { exportedAt: now(), db, base, users: users.users.map(adminUser), history }, 200, {
    "content-disposition": `attachment; filename="w2w-crm-${todayTashkent()}.json"`,
  });
});

route("POST", "/import", async (ctx) => {
  need(ctx, "admin");
  const b = await readBody(ctx.req, 5_500_000);
  const actor = actorId(ctx.auth);
  const out: Record<string, number> = {};
  if (Array.isArray(b.deals)) {
    out.deals = await mutateDb((db) => {
      if (b.mode === "replace") db.deals = {};
      let n = 0;
      for (const raw of b.deals) {
        const id = String(raw.id || rid("d")).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
        const d = (db.deals[id] && b.mode !== "replace" ? db.deals[id] : emptyDeal()) as Deal;
        d.id = id;
        applyPatch(d, raw, db.settings);
        d.createdAt = String(raw.createdAt || d.createdAt || now());
        d.createdBy = String(raw.createdBy || d.createdBy || actor);
        d.updatedAt = String(raw.updatedAt || now());
        d.updatedBy = String(raw.updatedBy || actor);
        d.statusAt = String(raw.statusAt || d.statusAt || d.updatedAt);
        if (raw.owner) d.owner = String(raw.owner);
        if (raw.notion) d.notion = { id: String(raw.notion.id || ""), url: String(raw.notion.url || ""), db: String(raw.notion.db || "") };
        db.seq += 1;
        d.seq = db.seq;
        d.rev = (d.rev || 0) + 1;
        d.fseq ||= {};
        db.deals[id] = d;
        n++;
      }
      db.meta.importedAt = now();
      return n;
    });
  }
  if (b.history && typeof b.history === "object") {
    const entries = Object.entries(b.history as Record<string, any[]>);
    const s = await kv();
    let n = 0;
    for (let i = 0; i < entries.length; i += 20) {
      await Promise.all(
        entries.slice(i, i + 20).map(async ([id, items]) => {
          const clean: HistoryItem[] = (Array.isArray(items) ? items : []).map((x) => ({
            id: String(x.id || rid("h")),
            at: String(x.at || now()),
            label: x.label ? String(x.label).slice(0, 20) : undefined,
            kind: String(x.kind || "note"),
            text: String(x.text || "").slice(0, 4000),
            by: x.by ? String(x.by) : undefined,
          }));
          if (b.historyMode === "replace") {
            await s.set(`h/${id}`, { items: sortHistory(clean) });
          } else {
            await mutateHistory(id, (h) => {
              mergeHistory(h.items, clean);
              sortHistory(h.items);
            });
          }
          n += clean.length;
        }),
      );
    }
    out.history = n;
  }
  if (b.base && Array.isArray(b.base.leads)) {
    await mutateBase((base) => {
      const prev = new Map(base.leads.map((l) => [String(l.n), l]));
      base.asOf = String(b.base.asOf || base.asOf || "");
      base.leads = b.base.leads.map((l: any) => ({ ...l, ...(prev.get(String(l.n)) ? { status: prev.get(String(l.n)).status, dealId: prev.get(String(l.n)).dealId } : {}) }));
    });
    out.base = b.base.leads.length;
  }
  return json(ctx.req, { ok: true, imported: out });
});

// ---------- синхронизация Telegram ----------
route("GET", "/sync/index", async (ctx) => {
  need(ctx, "sync");
  const db = await readDb();
  return json(ctx.req, {
    today: todayTashkent(),
    statuses: STATUSES.map((s) => ({ id: s.id, label: s.label })),
    dictionaries: { sources: db.settings.sources, sectors: db.settings.sectors, regions: db.settings.regions, formats: db.settings.formats, roles: db.settings.roles, reasons: db.settings.reasons, requests: db.settings.requests },
    deals: visibleDeals(db).filter((d) => d.pipeline !== "archive").map((d) => ({
      id: d.id,
      pipeline: d.pipeline,
      name: d.name,
      status: d.status,
      tgIds: d.tgIds,
      telegram: d.telegram,
      group: d.group,
      firstTouch: d.firstTouch,
      lastTouch: d.lastTouch,
      meetingAt: d.meetingAt,
      meetingHeld: d.meetingHeld,
      waiting: d.waiting,
      nextStep: d.nextStep,
    })),
  });
});

route("POST", "/sync/apply", async (ctx) => {
  need(ctx, "sync");
  const b = await readBody(ctx.req, 2_000_000);
  const items: any[] = Array.isArray(b.items) ? b.items.slice(0, 200) : [];
  if (!items.length) throw bad("Нет записей для синхронизации");
  const owner = await defaultOwner();
  const hist: Record<string, HistoryItem[]> = {};
  if (b.dryRun) {
    const db = structuredClone(await readDb());
    db.seq += 1;
    const ctxS = { now: now(), seq: db.seq, defaultOwner: owner };
    return json(ctx.req, { dry: true, results: items.map((item, i) => applySyncItem(db, db.settings, item, i, ctxS).result) });
  }
  const results = await mutateDb((db) => {
    db.seq += 1;
    const ctxS = { now: now(), seq: db.seq, defaultOwner: owner };
    const res = items.map((item, i) => {
      try {
        const r = applySyncItem(db, db.settings, item, i, ctxS);
        if (r.dealId && r.history.length) (hist[r.dealId] ||= []).push(...r.history);
        return r.result;
      } catch (e) {
        return { i, action: "error", error: String((e as Error).message || e).slice(0, 200) };
      }
    });
    return { results: res };
  });
  const added: Record<string, number> = {};
  await Promise.all(Object.entries(hist).map(async ([id, h]) => (added[id] = await addHistory(id, h))));
  for (const r of results.results as any[]) {
    if (!r.id) continue;
    r.historyAdded = added[r.id] || 0;
    if (r.action === "unchanged" && r.historyAdded) r.action = "updated";
  }
  return json(ctx.req, results);
});

route("POST", "/sync/report", async (ctx) => {
  need(ctx, "sync");
  const b = await readBody(ctx.req, 100_000);
  const report = { at: now(), text: String(b.text || "").slice(0, 20000), stats: typeof b.stats === "object" ? b.stats : {}, ok: b.ok !== false };
  await mutateDb((db) => {
    db.meta.lastSync = report;
    db.seq += 1;
  });
  return json(ctx.req, { ok: true });
});

route("GET", "/sync/history/:id", async (ctx, p) => {
  need(ctx, "sync");
  const h = await readHistory(p.id);
  return json(ctx.req, { items: h.items.filter((x) => x.kind === "telegram").slice(-60) });
});

// ---------- вход ----------
export async function handle(req: Request, ip = ""): Promise<Response> {
  const url = new URL(req.url);
  let path = url.pathname.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "") || "/";
  const method = req.method.toUpperCase();
  try {
    const candidates = routes.filter(([, re]) => re.test(path));
    if (!candidates.length) throw notFound("Неизвестный адрес API");
    const hit = candidates.find(([m]) => m === method);
    if (!hit) throw new HttpError(405, "method", "Метод не поддерживается");
    await loadSecret(); // ключ подписи сессий: из окружения или из хранилища (кешируется в экземпляре функции)
    const auth = path.startsWith("/auth/login") || path.startsWith("/auth/setup") || path === "/health" ? { user: null, token: null, via: null } as Auth : await authenticate(req);
    const ctx: Ctx = { req, url, path, method, auth, ip };
    csrf(ctx);
    const params = (path.match(hit[1])?.groups || {}) as Record<string, string>;
    return await hit[2](ctx, params);
  } catch (e) {
    return errorResponse(req, e);
  }
}

export { DEFAULT_SETTINGS, statusId };
