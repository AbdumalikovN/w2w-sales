// Интеграционные тесты API на хранилище в памяти: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";

process.env.CRM_SECRET = "test-secret-0123456789abcdefghijklmnopqrstuvwxyz";
process.env.SETUP_KEY = "setup-key-0123456789abcdefghij";

const { setKV, memoryKV } = await import("../netlify/lib/store.mts");
const mem = memoryKV();
setKV(mem);
const { handle } = await import("../netlify/lib/routes.mts");

type Opts = { method?: string; body?: unknown; cookie?: string; token?: string; headers?: Record<string, string>; noCsrf?: boolean };
async function call(path: string, o: Opts = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(o.headers || {}) };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.token) headers.authorization = "Bearer " + o.token;
  if (!o.noCsrf && (o.method || "GET") !== "GET") headers["x-w2w"] = "1";
  const res = await handle(new Request("https://crm.test/api" + path, { method: o.method || "GET", headers, body: o.body ? JSON.stringify(o.body) : undefined }), "1.2.3.4");
  const buf = Buffer.from(await res.arrayBuffer());
  const text = res.headers.get("content-encoding") === "gzip" ? gunzipSync(buf).toString() : buf.toString();
  const data = text ? JSON.parse(text) : null;
  const sc = res.headers.get("set-cookie");
  return { status: res.status, data, cookie: sc ? sc.split(";")[0] : null };
}

let admin = "";
let manager = "";
let viewer = "";
let syncToken = "";
let dealId = "";

test("health и настройка администратора", async () => {
  assert.equal((await call("/health")).status, 200);
  assert.equal((await call("/bootstrap")).status, 401);
  const bad = await call("/auth/setup", { method: "POST", headers: { "x-setup-key": "wrong" }, body: { login: "admin", name: "Admin", password: "password123" } });
  assert.equal(bad.status, 403);
  const ok = await call("/auth/setup", { method: "POST", headers: { "x-setup-key": process.env.SETUP_KEY! }, body: { login: "nuriddin", name: "Nuriddin Abdumalikov", password: "Correct-horse-1" } });
  assert.equal(ok.status, 201);
  const again = await call("/auth/setup", { method: "POST", headers: { "x-setup-key": process.env.SETUP_KEY! }, body: { login: "x", name: "X", password: "password1234" } });
  assert.equal(again.status, 403);
});

test("вход, выход, CSRF и ограничение попыток", async () => {
  const wrong = await call("/auth/login", { method: "POST", body: { login: "nuriddin", password: "nope" } });
  assert.equal(wrong.status, 401);
  const noCsrf = await call("/auth/login", { method: "POST", body: { login: "nuriddin", password: "Correct-horse-1" }, noCsrf: true });
  assert.equal(noCsrf.status, 403);
  const ok = await call("/auth/login", { method: "POST", body: { login: "NURIDDIN", password: "Correct-horse-1" } });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie?.startsWith("w2w_s="));
  admin = ok.cookie!;
  const me = await call("/auth/me", { cookie: admin });
  assert.equal(me.data.user.role, "admin");
  const csrf = await call("/deals", { method: "POST", cookie: admin, body: { name: "X" }, noCsrf: true });
  assert.equal(csrf.status, 403);
  const forged = await call("/auth/me", { cookie: "w2w_s=" + admin.slice(6, -3) + "abc" });
  assert.equal(forged.status, 401);
  for (let i = 0; i < 8; i++) await call("/auth/login", { method: "POST", body: { login: "ghost", password: "bad" } });
  const blocked = await call("/auth/login", { method: "POST", body: { login: "ghost", password: "bad" } });
  assert.equal(blocked.status, 429);
});

test("пользователи и роли", async () => {
  const m = await call("/users", { method: "POST", cookie: admin, body: { login: "javokhir", name: "Javokhir Kamiljonov", role: "manager" } });
  assert.equal(m.status, 201);
  assert.ok(m.data.password.length >= 10);
  const lm = await call("/auth/login", { method: "POST", body: { login: "javokhir", password: m.data.password } });
  assert.equal(lm.status, 200);
  manager = lm.cookie!;
  assert.equal((await call("/auth/me", { cookie: manager })).data.user.mustChange, true);
  const v = await call("/users", { method: "POST", cookie: admin, body: { login: "ceo", name: "CEO", role: "viewer", password: "viewer-pass-1" } });
  viewer = (await call("/auth/login", { method: "POST", body: { login: "ceo", password: "viewer-pass-1" } })).cookie!;
  assert.equal(v.status, 201);
  assert.equal((await call("/users", { cookie: manager })).status, 403);
  assert.equal((await call("/deals", { method: "POST", cookie: viewer, body: { name: "x" } })).status, 403);
  const dup = await call("/users", { method: "POST", cookie: admin, body: { login: "javokhir", name: "Dup" } });
  assert.equal(dup.status, 400);
  const self = await call(`/users/${(await call("/auth/me", { cookie: admin })).data.user.id}`, { method: "PATCH", cookie: admin, body: { active: false } });
  assert.equal(self.status, 400);
});

test("сделки: создание, правка, история, конфликт", async () => {
  const c = await call("/deals", { method: "POST", cookie: manager, body: { name: "Sweet Bakery", status: "research", phone: "+998 90 000 00 00", telegram: "@sweet_bakery_demo", requests: ["CRM и процессы"], amount: "$4 500" } });
  assert.equal(c.status, 201);
  const d = c.data.deal;
  dealId = d.id;
  assert.equal(d.telegram, "https://t.me/sweet_bakery_demo");
  assert.equal(d.amount, 4500);
  assert.equal(d.status, "research");
  const u = await call(`/deals/${dealId}`, { method: "PATCH", cookie: manager, body: { patch: { status: "meeting", nextStep: "Созвон в пятницу", bogus: 1 }, baseSeq: d.seq } });
  assert.equal(u.status, 200);
  assert.deepEqual(u.data.changed.sort(), ["nextStep", "status"]);
  // админ меняет следующий шаг, менеджер со старой версией пытается тоже — конфликт
  const a = await call(`/deals/${dealId}`, { method: "PATCH", cookie: admin, body: { patch: { nextStep: "Отправить КП" }, baseSeq: u.data.deal.seq } });
  assert.equal(a.status, 200);
  const conflict = await call(`/deals/${dealId}`, { method: "PATCH", cookie: manager, body: { patch: { nextStep: "Другое" }, baseSeq: u.data.deal.seq } });
  assert.equal(conflict.status, 409);
  assert.deepEqual(conflict.data.error.fields, ["nextStep"]);
  // другое поле со старой версией — без конфликта
  const ok2 = await call(`/deals/${dealId}`, { method: "PATCH", cookie: manager, body: { patch: { region: "Ташкент" }, baseSeq: u.data.deal.seq } });
  assert.equal(ok2.status, 200);
  const h = await call(`/deals/${dealId}/history`, { cookie: admin });
  const texts = h.data.items.map((x: any) => x.text);
  assert.ok(texts.includes("Карточка создана"));
  assert.ok(texts.some((t: string) => t.startsWith("Статус: Изучение → Назначили встречу")));
  const note = await call(`/deals/${dealId}/history`, { method: "POST", cookie: manager, body: { text: "Позвонил, договорились на пятницу", kind: "call", answered: true } });
  assert.equal(note.status, 201);
  assert.equal((await call(`/deals/${dealId}/history/${note.data.item.id}`, { method: "PATCH", cookie: viewer, body: { text: "x" } })).status, 403);
  const boot = await call("/bootstrap", { cookie: viewer });
  assert.equal(boot.status, 200);
  const bd = boot.data.deals.find((x: any) => x.id === dealId);
  assert.ok(bd.lastTouch, "звонок обновляет последнее касание");
  const ch = await call(`/changes?since=${boot.data.seq}`, { cookie: viewer });
  assert.equal(ch.data.deals.length, 0);
  await call(`/deals/${dealId}`, { method: "PATCH", cookie: manager, body: { patch: { waiting: true } } });
  const ch2 = await call(`/changes?since=${boot.data.seq}`, { cookie: viewer });
  assert.equal(ch2.data.deals.length, 1);
});

test("удаление доступно только админу и восстанавливается", async () => {
  assert.equal((await call(`/deals/${dealId}`, { method: "DELETE", cookie: manager })).status, 403);
  assert.equal((await call(`/deals/${dealId}`, { method: "DELETE", cookie: admin })).status, 200);
  const boot = await call("/bootstrap", { cookie: admin });
  assert.ok(!boot.data.deals.some((x: any) => x.id === dealId));
  assert.equal((await call("/trash", { cookie: admin })).data.deals.length, 1);
  assert.equal((await call(`/deals/${dealId}/restore`, { method: "POST", cookie: admin })).status, 200);
});

test("синхронизация Telegram: правила статусов, Telegram ID, история без дублей", async () => {
  const t = await call("/tokens", { method: "POST", cookie: admin, body: { name: "Telegram → CRM", scopes: ["sync"] } });
  assert.equal(t.status, 201);
  syncToken = t.data.secret;
  assert.equal((await call("/bootstrap", { token: syncToken })).status, 200);
  assert.equal((await call("/deals", { method: "POST", token: syncToken, body: { name: "x" } })).status, 403);
  const idx = await call("/sync/index", { token: syncToken });
  assert.equal(idx.status, 200);
  assert.ok(idx.data.deals.length >= 1);
  const r = await call("/sync/apply", {
    method: "POST",
    token: syncToken,
    body: {
      items: [
        // существующая сделка по username: статус назад не двигается, Telegram ID добавляется
        { match: { username: "Sweet_Bakery_Demo" }, tgIds: ["700000001"], fields: { status: "Изучение", lastTouch: "2026-10-20", nextStep: "Ответить: цена" }, history: [{ date: "2026-10-20", text: "Клиент спросил цену" }] },
        // новая сделка
        { create: true, tgIds: ["111222333"], fields: { name: "Новый лид", status: "Потенциальные", firstTouch: "2026-10-21", contactName: "Али", telegram: "https://t.me/ali_biz" }, history: [{ date: "2026-10-21", label: "21.10", text: "Отправили оффер" }] },
        // нет такой — без create
        { match: { tgId: "999" }, fields: { status: "research" } },
      ],
    },
  });
  assert.equal(r.status, 200);
  const [a, b, c] = r.data.results;
  assert.equal(a.action, "updated");
  assert.deepEqual(a.skipped, ["status"]);
  assert.equal(b.action, "created");
  assert.equal(c.action, "not_found");
  // повтор: история не дублируется, «последнее касание» назад не уходит
  const r2 = await call("/sync/apply", { method: "POST", token: syncToken, body: { items: [{ match: { tgId: "700000001" }, fields: { lastTouch: "2026-10-01" }, history: [{ date: "2026-10-20", text: "Клиент спросил цену." }] }] } });
  assert.equal(r2.data.results[0].action, "unchanged");
  const h = await call(`/deals/${dealId}/history`, { cookie: admin });
  assert.equal(h.data.items.filter((x: any) => x.kind === "telegram").length, 1);
  const boot = await call("/bootstrap", { cookie: admin });
  const d = boot.data.deals.find((x: any) => x.id === dealId);
  assert.ok(d.lastTouch >= "2026-10-20", "последнее касание не уходит назад");
  assert.ok(d.tgIds.includes("700000001"));
  assert.equal(d.status, "meeting");
  // ручной статус не трогаем
  await call(`/deals/${dealId}`, { method: "PATCH", cookie: admin, body: { patch: { status: "kp" } } });
  const r3 = await call("/sync/apply", { method: "POST", token: syncToken, body: { items: [{ id: dealId, fields: { status: "lost", reason: "Не сейчас" } }] } });
  assert.deepEqual(r3.data.results[0].skipped, ["status"]);
  const rep = await call("/sync/report", { method: "POST", token: syncToken, body: { text: "Прочитано 12 чатов", stats: { chats: 12 } } });
  assert.equal(rep.status, 200);
  assert.equal((await call("/bootstrap", { cookie: admin })).data.lastSync.stats.chats, 12);
  const dry = await call("/sync/apply", { method: "POST", token: syncToken, body: { dryRun: true, items: [{ create: true, fields: { name: "Пробный" } }] } });
  assert.equal(dry.data.results[0].action, "created");
  assert.ok(!(await call("/bootstrap", { cookie: admin })).data.deals.some((x: any) => x.name === "Пробный"));
  // «Архив 2025»: нет в индексе синхронизации и не находится по названию; время без пояса — ташкентское
  const arch = await call("/deals", { method: "POST", cookie: admin, body: { name: "Старый клиент", pipeline: "archive", status: "lost" } });
  assert.equal(arch.status, 201);
  const idx2 = await call("/sync/index", { token: syncToken });
  assert.ok(!idx2.data.deals.some((x: any) => x.pipeline === "archive"));
  const r4 = await call("/sync/apply", { method: "POST", token: syncToken, body: { items: [{ match: { name: "Старый клиент" }, fields: { status: "research" } }] } });
  assert.equal(r4.data.results[0].action, "not_found");
  const r5 = await call("/sync/apply", { method: "POST", token: syncToken, body: { items: [{ id: dealId, fields: { meetingAt: "2026-10-27T15:00" } }] } });
  assert.equal(r5.status, 200);
  const d5 = (await call("/bootstrap", { cookie: admin })).data.deals.find((x: any) => x.id === dealId);
  assert.equal(d5.meetingAt, "2026-10-27T10:00Z");
});

test("импорт, база анкет и конвертация анкеты в сделку", async () => {
  const imp = await call("/import", {
    method: "POST",
    cookie: admin,
    body: {
      deals: [{ id: "dnotion1", name: "Импорт 1", status: "potential", pipeline: "catering", priority: "high", notion: { id: "abc", url: "https://notion.so/abc" } }],
      history: { dnotion1: [{ at: "2026-09-01T12:00:00.000Z", kind: "telegram", text: "Первое сообщение", label: "01.09" }] },
      base: { asOf: "2026-09-30", leads: [{ n: 8, company: "—", name: "Test Lead", region: "Андижан", tg: "test_lead_demo", tgId: "700000002", lpr: false }] },
    },
  });
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.data.imported, { deals: 1, history: 1, base: 1 });
  const base = await call("/base", { cookie: manager });
  assert.equal(base.data.leads.length, 1);
  const conv = await call("/base/8/convert", { method: "POST", cookie: manager });
  assert.equal(conv.status, 201);
  assert.equal(conv.data.deal.source, "Анкета курса 24-dastur");
  assert.equal((await call("/base/8/convert", { method: "POST", cookie: manager })).status, 400);
  const exp = await call("/export", { cookie: admin });
  assert.equal(exp.status, 200);
  assert.ok(exp.data.history.dnotion1.length === 1);
});

test("настройки и смена пароля", async () => {
  const s = await call("/settings", { method: "PUT", cookie: admin, body: { settings: { sources: ["Входящий", "Входящий", "Новый канал"] } } });
  assert.equal(s.status, 200);
  assert.deepEqual(s.data.settings.sources, ["Входящий", "Новый канал"]);
  const del = await call("/settings", { method: "PUT", cookie: admin, body: { settings: { pipelines: [{ id: "sales", label: "Продажи" }] } } });
  assert.equal(del.status, 400, "нельзя удалить воронку со сделками");
  const pw = await call("/auth/password", { method: "POST", cookie: manager, body: { current: "wrong", next: "new-password-1" } });
  assert.equal(pw.status, 400);
  const users = await call("/users", { cookie: admin });
  const jav = users.data.users.find((u: any) => u.login === "javokhir");
  const reset = await call(`/users/${jav.id}`, { method: "PATCH", cookie: admin, body: { resetPassword: true } });
  assert.ok(reset.data.password);
  assert.equal((await call("/auth/me", { cookie: manager })).status, 401, "после сброса старая сессия недействительна");
  const relog = await call("/auth/login", { method: "POST", body: { login: "javokhir", password: reset.data.password } });
  const pw2 = await call("/auth/password", { method: "POST", cookie: relog.cookie!, body: { current: reset.data.password, next: "new-password-1" } });
  assert.equal(pw2.status, 200);
  assert.equal(pw2.data.user.mustChange, false);
});

test("резервная копия создаётся при первой записи дня", async () => {
  const keys = await (await import("../netlify/lib/store.mts")).kv().then((s) => s.list("backup/"));
  assert.ok(keys.length >= 1);
});

test("ключ подписи из хранилища и хеш ключа установки", async () => {
  const auth = await import("../netlify/lib/auth.mts");
  const { sha256 } = auth;
  const saved = { secret: process.env.CRM_SECRET, setup: process.env.SETUP_KEY };
  try {
    delete process.env.CRM_SECRET;
    auth.resetSecretCache();
    assert.equal(await auth.loadSecret(), "store");
    const first = auth.secret();
    assert.ok(first.length >= 32);
    auth.resetSecretCache(); // как новый экземпляр функции
    assert.equal(await auth.loadSecret(), "store");
    assert.equal(auth.secret(), first);
    const tok = auth.signSession({ u: "x", v: 1, e: Math.floor(Date.now() / 1000) + 60 });
    assert.equal(auth.readSession(tok)?.u, "x");
    delete process.env.SETUP_KEY;
    const key = "k".repeat(30);
    process.env.SETUP_KEY_SHA256 = sha256(key);
    assert.equal(auth.setupKeyMatches(key), true);
    assert.equal(auth.setupKeyMatches("k".repeat(29) + "x"), false);
    assert.equal(auth.setupKeyMatches(null), false);
  } finally {
    process.env.CRM_SECRET = saved.secret;
    process.env.SETUP_KEY = saved.setup;
    delete process.env.SETUP_KEY_SHA256;
    auth.resetSecretCache();
    await auth.loadSecret();
  }
});
