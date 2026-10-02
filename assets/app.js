/* Продажи W2W — расшифровка данных и расчёт аналитики в браузере. */
"use strict";

/* ---------- утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const NS = "http://www.w3.org/2000/svg";
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "style") e.setAttribute("style", v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function icon(id, cls) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("class", "ico" + (cls ? " " + cls : "")); s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(NS, "use"); u.setAttribute("href", "#i-" + id); s.append(u); return s;
}
const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const ddmm = iso => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) : "—");
const dLong = iso => (iso ? +iso.slice(8, 10) + " " + MONTHS[+iso.slice(5, 7) - 1] : "—");
const dShort = iso => (iso ? +iso.slice(8, 10) + " " + MON_SHORT[+iso.slice(5, 7) - 1] : "—");
function todayTash() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date()); }
function addDays(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function diffDays(a, b) { return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5); }
function monday(iso) { const d = new Date(iso + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); }
function plural(n, one, few, many) { const a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many; }
const store = {
  get(k, s) { try { return (s ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
  set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} },
};

/* ---------- статусы CRM ---------- */
const ST = {
  "Потенциальные": { c: "pot", g: "new", r: 0 },
  "Изучение": { c: "izu", g: "active", r: 1 },
  "Назначили Встречу": { c: "vst", g: "active", r: 2 },
  "ТЗ": { c: "fin", g: "active", r: 3 },
  "КП": { c: "fin", g: "active", r: 4 },
  "Продажа": { c: "fin", g: "active", r: 5 },
  "В ожидании": { c: "pod", g: "paused", r: 1 },
  "Поддержание связи": { c: "pod", g: "paused", r: 1 },
  "Заключили договор |Процесс разработки": { c: "won", g: "won", r: 6, label: "Заключили договор" },
  "Успешные": { c: "won", g: "won", r: 7 },
  "Отмененные": { c: "otm", g: "lost", r: -1 },
  "Архив": { c: "arc", g: "lost", r: -2 },
};
const ORDER = Object.keys(ST);
const FINISH = new Set(["ТЗ", "КП", "Продажа"]);
const stInfo = s => ST[s] || { c: "pot", g: "other", r: 0 };
const chip = s => h("span", { class: "chip st-" + stInfo(s).c }, stInfo(s).label || s);

/* ---------- расшифровка ---------- */
async function decrypt(env, password) {
  const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: b(env.salt), iterations: env.iter, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b(env.iv) }, key, b(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function getJSON(path) {
  const r = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}

/* ---------- состояние ---------- */
const S = { data: null, base: null, today: todayTash(), period: "all", filter: "active", sort: "prio", q: "" };
try { const f = store.get("w2w-filter"); if (f) S.filter = f; const p = store.get("w2w-period"); if (p) S.period = p; } catch (e) {}

function enrich(deals, today) {
  for (const d of deals) {
    const i = stInfo(d.status);
    d.g = i.g; d.rank = i.r;
    d.tracked = !!d.first;
    d.replied = d.status !== "Потенциальные";
    d.meetingSet = !!d.meeting || !!d.held || d.status === "Назначили Встречу" || d.g === "won";
    d.interest = d.g === "active" || d.g === "won" || d.meetingSet;
    d.proposal = FINISH.has(d.status) || d.g === "won";
    d.won = d.g === "won";
    const ref = d.last || d.edited || d.created;
    d.idle = ref ? Math.max(0, diffDays(today, ref)) : null;
    d.owner = d.role === "Владелец или директор";
    d.hired = d.role === "Наёмный сотрудник";
  }
  return deals;
}
function inPeriod(d) {
  if (!d.tracked) return false;
  if (S.period === "all") return true;
  return d.first >= addDays(S.today, -(+S.period - 1));
}
function stats(list) {
  const n = list.length, c = f => list.filter(f).length;
  return { n, rep: c(d => d.replied), int: c(d => d.interest), ms: c(d => d.meetingSet), mh: c(d => d.held), pr: c(d => d.proposal), won: c(d => d.won) };
}

/* ---------- обложка: воронка ---------- */
function renderHero() {
  const all = S.data.deals, rows = all.filter(inPeriod), s = stats(rows);
  const per = { all: "за всё время", "30": "за 30 дней", "7": "за 7 дней" }[S.period];
  const title = $("#heroTitle"); title.textContent = "";
  if (!s.n) {
    title.append("За выбранный период первых касаний не было");
    $("#heroLead").textContent = "Переключите период в верхней панели или дождитесь новых лидов из Telegram.";
  } else {
    title.append(`Написали ${s.n} ${plural(s.n, "компании", "компаниям", "компаниям")}${S.period === "all" ? "" : " " + per}: `, h("span", { class: "hl" }, `${s.ms} ${plural(s.ms, "дошла", "дошли", "дошли")} до встречи`));
    const won = s.won ? `, ${s.won} ${plural(s.won, "договор", "договора", "договоров")}` : ", договоров пока нет";
    $("#heroLead").textContent = `Ответили ${pct(s.rep, s.n)}% тех, кому написали. Встреч проведено: ${s.mh}, до ТЗ или КП дошли ${s.pr}${won}.`;
  }
  $("#heroEyebrow").textContent = "Воронка продаж · " + per;
  const steps = [["Написали", s.n, null], ["Ответили", s.rep, s.n], ["Проявили интерес", s.int, s.rep], ["Встреча назначена", s.ms, s.int], ["Встреча проведена", s.mh, s.ms], ["ТЗ или КП", s.pr, s.mh], ["Договор", s.won, s.pr]];
  const ol = $("#funnelList"); ol.textContent = "";
  steps.forEach(([k, v, prev], i) => {
    const cv = prev == null ? h("span", { class: "cv" }, "компаний") : h("span", { class: "cv" }, h("strong", null, pct(v, prev) + "%"), " от предыдущего");
    ol.append(h("li", { class: "fig" + (i === 0 ? " is-brand" : "") + (i === 6 && v ? " win" : "") + (v === 0 && i ? " zero" : "") },
      h("span", { class: "k" }, k), h("b", null, String(v)), cv, h("span", { class: "bar-t" }, h("i", { style: `width:${s.n ? (v / s.n) * 100 : 0}%` }))));
  });
  // «сейчас» — без фильтра периода
  const active = all.filter(d => d.g === "active"), waiting = all.filter(d => d.waiting && d.g !== "lost" && d.g !== "won");
  const stuck = active.filter(d => d.idle != null && d.idle > 7), soon = all.filter(d => d.meeting && d.meeting >= S.today && d.meeting <= addDays(S.today, 7) && !d.held);
  const money = all.filter(d => d.won && d.amount).reduce((a, d) => a + d.amount, 0);
  const now = $("#nowPills"); now.textContent = "";
  now.append(
    h("span", { class: "pill" }, "В работе сейчас: ", h("b", null, String(active.length))),
    h("span", { class: "pill" + (waiting.length ? " alert" : "") }, "Ждут нашего ответа: ", h("b", null, String(waiting.length))),
    h("span", { class: "pill" + (stuck.length ? " bad" : "") }, "Без движения больше недели: ", h("b", null, String(stuck.length))),
    h("span", { class: "pill good" }, "Встречи на 7 дней: ", h("b", null, String(soon.length))),
    ...(money ? [h("span", { class: "pill good" }, "Сумма договоров: ", h("b", null, "$" + money.toLocaleString("ru-RU")))] : []));
  const untracked = all.filter(d => !d.tracked).length;
  $("#heroNote").textContent = "Конверсия под числом — от предыдущего шага. " + (untracked ? `${untracked} ${plural(untracked, "карточка", "карточки", "карточек")} без даты первого касания в воронку не входят.` : "");
}

/* ---------- сигналы на сегодня ---------- */
function sigCard({ icon: ic, tone, title, sub, items, empty, row, limit = 5 }) {
  const card = h("article", { class: "glass pad sig c4" });
  card.append(h("div", { class: "card-h" }, h("span", { class: "app-icon " + tone }, icon(ic)), h("h3", { class: "h3" }, title), h("span", { class: "count" }, String(items.length))));
  if (sub) card.append(h("p", { class: "card-sub" }, sub));
  if (!items.length) { card.append(h("p", { class: "empty" }, icon("check"), empty)); return card; }
  const ul = h("ul", { class: "rows" });
  const draw = n => { ul.textContent = ""; items.slice(0, n).forEach(it => ul.append(row(it))); };
  draw(limit); card.append(ul);
  if (items.length > limit) {
    let open = false;
    const b = h("button", { class: "btn link more", type: "button" }, `Показать все (${items.length})`);
    b.addEventListener("click", () => { open = !open; draw(open ? items.length : limit); b.textContent = open ? "Свернуть" : `Показать все (${items.length})`; });
    card.append(b);
  }
  return card;
}
function idlePill(d) {
  if (d.idle == null) return h("span", { class: "idle na" }, "—");
  return h("span", { class: "idle " + (d.idle <= 3 ? "ok" : d.idle <= 7 ? "warn" : "bad") }, d.idle + " дн.");
}
const dealLink = d => h("a", { class: "nm", href: d.url, target: "_blank", rel: "noopener" }, d.name);
const dealRow = (d, meta, right) => h("li", null, dealLink(d), right || idlePill(d), h("span", { class: "meta" }, meta || d.next || "Следующий шаг не записан"));

function renderSignals() {
  const all = S.data.deals, box = $("#signals"); box.textContent = "";
  const byIdle = (a, b) => (b.idle ?? 0) - (a.idle ?? 0);
  const waiting = all.filter(d => d.waiting && d.g !== "lost" && d.g !== "won").sort(byIdle);
  const finish = all.filter(d => FINISH.has(d.status)).sort(byIdle);
  const stuck = all.filter(d => d.held && d.g === "active" && !FINISH.has(d.status) && (d.idle ?? 0) > 7).sort(byIdle);
  const upcoming = all.filter(d => d.meeting && d.meeting >= S.today && !d.held && d.g !== "lost").sort((a, b) => a.meeting.localeCompare(b.meeting));
  const undated = all.filter(d => d.status === "Назначили Встречу" && !d.held && (!d.meeting || d.meeting < S.today)).sort(byIdle);
  const call = all.filter(d => d.status === "Потенциальные" && (d.idle ?? 0) >= 3).sort((a, b) => (b.owner - a.owner) || byIdle(a, b));
  const unc = uncontacted();

  box.append(
    sigCard({ icon: "bubble", tone: "ic-1", title: "Ждут нашего ответа", sub: "Клиент задал вопрос или ждёт материалы.", items: waiting, empty: "Никто не ждёт ответа.", row: d => dealRow(d) }),
    sigCard({ icon: "trophy", tone: "ic-2", title: "Довести до договора", sub: "Статусы «ТЗ», «КП» и «Продажа».", items: finish, empty: "Сделок на этапе ТЗ или КП нет.", row: d => dealRow(d, `${d.status} · ${d.next || "следующий шаг не записан"}`) }),
    sigCard({ icon: "clock", tone: "ic-3", title: "Зависли после встречи", sub: "Встреча прошла, а движения нет больше недели.", items: stuck, empty: "После встреч всё движется.", row: d => dealRow(d) }),
    sigCard({ icon: "people", tone: "ic-7", title: "Встречи", sub: "Ближайшие по дате, затем те, где время не подтверждено.", items: [...upcoming, ...undated], empty: "Встреч не запланировано.",
      row: d => dealRow(d, d.meeting && d.meeting >= S.today ? (d.next || "") : "Уточнить дату и время встречи", h("span", { class: "idle " + (d.meeting && d.meeting >= S.today ? "ok" : "warn") }, d.meeting && d.meeting >= S.today ? dShort(d.meeting) : "без даты")) }),
    sigCard({ icon: "phone", tone: "ic-8", title: "Позвонить", sub: "Не ответили на первое касание 3 дня и дольше. Владельцы сверху.", items: call, empty: "Все ответили или написали недавно.",
      row: d => dealRow(d, [d.sector, d.region, d.role].filter(Boolean).join(" · ")) }),
    sigCard({ icon: "send", tone: "ic-5", title: "Ещё не писали", sub: "Анкеты из группы курса без карточки в CRM.", items: unc, empty: S.base ? "Всем анкетам уже написали." : "База анкет недоступна.",
      row: l => h("li", null, l.tg ? h("a", { class: "nm", href: "https://t.me/" + l.tg, target: "_blank", rel: "noopener" }, l.company) : h("span", { class: "nm" }, l.company),
        h("span", { class: "idle " + (l.lpr ? "ok" : "na") }, l.lpr ? "владелец" : "—"), h("span", { class: "meta" }, [l.name, l.region, l.activity].filter(Boolean).join(" · "))) })
  );
}

/* ---------- что работает ---------- */
function groupBy(list, key) {
  const m = new Map();
  for (const d of list) { const k = (typeof key === "function" ? key(d) : d[key]) || null; if (!m.has(k)) m.set(k, []); m.get(k).push(d); }
  return m;
}
function cmpRows(el, groups, minN = 1) {
  el.textContent = "";
  const rows = [...groups].filter(([k, v]) => k && v.length >= minN).map(([k, v]) => ({ k, s: stats(v) })).sort((a, b) => pct(b.s.rep, b.s.n) - pct(a.s.rep, a.s.n) || b.s.n - a.s.n);
  if (!rows.length) { el.append(h("p", { class: "small" }, "Пока нет данных за выбранный период.")); return; }
  const best = rows[0];
  rows.forEach(r => el.append(h("div", { class: "cmp-row" + (r === best && rows.length > 1 && r.s.n >= 3 ? " top" : "") },
    h("span", { class: "lbl" }, r.k), h("span", { class: "tr" }, h("i", { style: `width:${pct(r.s.rep, r.s.n)}%` })),
    h("span", { class: "v" }, pct(r.s.rep, r.s.n) + "%", h("small", null, `${r.s.rep} из ${r.s.n}, встреч: ${r.s.ms}`)))));
}
function insightsList(rows) {
  const out = [], s = stats(rows);
  const pick = (map, minN) => [...map].filter(([k, v]) => k && v.length >= minN).map(([k, v]) => ({ k, s: stats(v) }));
  const COLD = new Set(["Тёплый контакт", "Входящий", "Другое"]);
  const fm = pick(groupBy(rows.filter(d => !COLD.has(d.format)), "format"), 8).sort((a, b) => pct(b.s.rep, b.s.n) - pct(a.s.rep, a.s.n));
  if (fm.length >= 2 && pct(fm[0].s.rep, fm[0].s.n) - pct(fm.at(-1).s.rep, fm.at(-1).s.n) >= 15)
    out.push([`«${fm[0].k}» даёт `, h("b", null, pct(fm[0].s.rep, fm[0].s.n) + "% ответов"), ` (${fm[0].s.rep} из ${fm[0].s.n}), «${fm.at(-1).k}» — ${pct(fm.at(-1).s.rep, fm.at(-1).s.n)}% (${fm.at(-1).s.rep} из ${fm.at(-1).s.n}).`]);
  const own = stats(rows.filter(d => d.owner)), hir = stats(rows.filter(d => d.hired));
  if (own.n >= 5 && hir.n >= 3 && pct(own.rep, own.n) > pct(hir.rep, hir.n))
    out.push(["Владельцы и директора отвечают в ", h("b", null, pct(own.rep, own.n) + "%"), ` случаев, наёмные сотрудники — в ${pct(hir.rep, hir.n)}% (${hir.rep} из ${hir.n}). Пишите первому лицу.`]);
  const rg = pick(groupBy(rows, "region"), 5).sort((a, b) => pct(b.s.rep, b.s.n) - pct(a.s.rep, a.s.n));
  if (rg.length >= 2) {
    const lo = rg.at(-1);
    out.push(["Лучше всего отвечает ", h("b", null, `${rg[0].k}: ${pct(rg[0].s.rep, rg[0].s.n)}%`), ` (${rg[0].s.rep} из ${rg[0].s.n}). ${lo.k}: ${lo.s.rep} из ${lo.s.n}` + (lo.s.rep === 0 ? " — туда лучше звонить." : ".")]);
  }
  const sc = pick(groupBy(rows, "sector"), 4).filter(x => x.s.ms >= 2).sort((a, b) => b.s.ms / b.s.n - a.s.ms / a.s.n);
  if (sc.length) out.push(["Чаще всего до встречи доходит ", h("b", null, sc[0].k.toLowerCase()), `: ${sc[0].s.ms} ${plural(sc[0].s.ms, "встреча", "встречи", "встреч")} на ${sc[0].s.n} ${plural(sc[0].s.n, "компанию", "компании", "компаний")}.`]);
  if (s.mh >= 3 && s.pr / s.mh < 0.5)
    out.push(["Узкое место — шаг после встречи: из ", h("b", null, `${s.mh} проведённых встреч`), ` до ТЗ или КП дошли ${s.pr}. Отправляйте КП в течение 48 часов после встречи.`]);
  const waiting = S.data.deals.filter(d => d.waiting && d.g !== "lost" && d.g !== "won").length;
  if (waiting) out.push([h("b", null, `${waiting} ${plural(waiting, "клиент ждёт", "клиента ждут", "клиентов ждут")} нашего ответа`), " — это самые тёплые сделки, начните день с них."]);
  return out;
}
function renderWorks() {
  const rows = S.data.deals.filter(inPeriod);
  const ins = $("#insights"); ins.textContent = "";
  const list = insightsList(rows);
  if (!list.length) ins.append(h("li", null, icon("sparkle", "i"), h("span", null, "Данных за период пока мало для выводов: нужно хотя бы 5 компаний в сравниваемых группах.")));
  list.slice(0, 5).forEach(parts => ins.append(h("li", null, icon("check", "i"), h("span", null, ...parts))));
  $("#worksLead").textContent = `Сравнение по ${rows.length} ${plural(rows.length, "компании", "компаниям", "компаниям")} из воронки за выбранный период. Чем больше компаний в группе, тем надёжнее вывод.`;

  cmpRows($("#fmt"), groupBy(rows, "format"));
  cmpRows($("#role"), groupBy(rows, d => (!d.role || d.role === "Не указана") ? "Должность не указана" : d.role));

  // по дням (последние 14 дней, без фильтра периода)
  const days = Array.from({ length: 14 }, (_, i) => addDays(S.today, i - 13));
  const tr = S.data.deals.filter(d => d.tracked);
  const per = days.map(dt => { const ds = tr.filter(d => d.first === dt); return { dt, n: ds.length, r: ds.filter(d => d.replied).length, m: ds.filter(d => d.meetingSet).length }; });
  const peak = Math.max(4, ...per.map(p => p.n)); const step = peak <= 8 ? 2 : peak <= 20 ? 5 : 10; const max = Math.ceil(peak / step) * step;
  const plot = $("#plot"), yax = $("#yax"), xax = $("#xax");
  plot.textContent = ""; yax.textContent = ""; xax.textContent = "";
  plot.style.setProperty("--n", days.length); xax.style.setProperty("--n", days.length);
  for (let t = 0; t <= max; t += step) { yax.append(h("span", { style: `bottom:${(t / max) * 100}%` }, String(t))); if (t) plot.append(h("span", { class: "gl", style: `bottom:${(t / max) * 100}%` })); }
  per.forEach(p => {
    const tot = h("div", { class: "tot", style: `height:${(p.n / max) * 100}%`, title: `${ddmm(p.dt)}: написали ${p.n}, ответили ${p.r}, встреч ${p.m}` }, h("div", { class: "rep", style: `height:${p.n ? (p.r / p.n) * 100 : 0}%` }));
    const md = h("span", { class: "md" }); for (let i = 0; i < Math.min(p.m, 4); i++) md.append(h("i")); tot.append(md);
    plot.append(h("div", { class: "day" }, tot, p.n ? h("span", { class: "lab", style: `bottom:calc(${(p.n / max) * 100}% + 4px)` }, p.r + "/" + p.n) : null));
    const wd = new Date(p.dt + "T00:00:00Z").getUTCDay();
    xax.append(h("span", { class: wd === 0 || wd === 6 ? "we" : "" }, ddmm(p.dt)));
  });

  // недели
  const tb = $("#weeks tbody"); tb.textContent = "";
  const weeks = [...groupBy(rows, d => monday(d.first))].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10);
  if (!weeks.length) tb.append(h("tr", null, h("td", { colspan: "7", class: "muted" }, "За выбранный период первых касаний не было.")));
  weeks.forEach(([wk, ds]) => {
    const s = stats(ds);
    tb.append(h("tr", null, h("td", null, `${ddmm(wk)}–${ddmm(addDays(wk, 6))}`, wk === monday(S.today) ? h("span", { class: "sub-cell" }, "текущая неделя") : null),
      h("td", { class: "r num" }, String(s.n)),
      h("td", null, h("div", { class: "pct" }, h("span", null, pct(s.rep, s.n) + "%"), h("span", { class: "tr" }, h("i", { style: `width:${pct(s.rep, s.n)}%` })))),
      h("td", { class: "r num" }, String(s.int)), h("td", { class: "r num" }, `${s.ms} · ${pct(s.ms, s.n)}%`), h("td", { class: "r num" }, String(s.mh)), h("td", { class: "r num" }, String(s.pr))));
  });
}

/* ---------- сегменты ---------- */
function segTable(sel, key, withInterest, emptyLabel) {
  const rows = S.data.deals.filter(inPeriod);
  const g = [...groupBy(rows, d => d[key] || emptyLabel)].sort((a, b) => (a[0] === emptyLabel) - (b[0] === emptyLabel) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const tb = $(sel + " tbody"); tb.textContent = "";
  if (!g.length) { tb.append(h("tr", null, h("td", { colspan: "5", class: "muted" }, "Нет данных за период."))); return; }
  g.forEach(([k, ds]) => {
    const s = stats(ds);
    const tr = h("tr", { class: s.ms >= 2 && s.ms / s.n >= 0.25 ? "hl" : s.rep === 0 && s.n >= 3 ? "lo" : "" }, h("td", null, k), h("td", { class: "r num" }, String(s.n)),
      h("td", null, h("div", { class: "pct" }, h("span", null, pct(s.rep, s.n) + "%"), h("span", { class: "tr" }, h("i", { style: `width:${pct(s.rep, s.n)}%` })))));
    if (withInterest) tr.append(h("td", { class: "r num" }, String(s.int)));
    tr.append(h("td", { class: "r num" }, String(s.ms)));
    tb.append(tr);
  });
}

/* ---------- причины и запросы ---------- */
function hbars(el, entries, color, note) {
  el.textContent = "";
  if (!entries.length) { el.append(h("p", { class: "small" }, "Нет данных за выбранный период.")); return; }
  const max = Math.max(...entries.map(e => e.v));
  entries.forEach(e => el.append(h("div", { class: "hb-row" }, h("div", { class: "t" }, h("span", null, e.k), h("span", null, String(e.v))),
    h("div", { class: "tr" }, h("i", { style: `width:${(e.v / max) * 100}%;background:${e.color || color}` })), h("p", null, e.who))));
}
function renderReasons() {
  const rows = S.data.deals.filter(inPeriod);
  const lostish = rows.filter(d => d.g === "lost" || d.g === "paused");
  const hard = new Set(["Сделали сами или с другим подрядчиком", "AI не нужен", "Не наш клиент"]);
  const lg = [...groupBy(lostish, d => d.reason || "Причина не записана")].map(([k, v]) => ({ k, v: v.length, who: v.map(d => d.name).join(", "), color: hard.has(k) ? "var(--danger)" : "var(--warn)" })).sort((a, b) => b.v - a.v);
  hbars($("#loss"), lg, "var(--warn)");
  $("#lossN").textContent = `${lostish.length} ${plural(lostish.length, "компания", "компании", "компаний")}`;
  const req = new Map();
  rows.forEach(d => (d.requests || []).forEach(r => { if (!req.has(r)) req.set(r, []); req.get(r).push(d.name); }));
  const rq = [...req].map(([k, v]) => ({ k, v: v.length, who: v.join(", ") })).sort((a, b) => b.v - a.v);
  hbars($("#req"), rq, "linear-gradient(90deg,#4fd8ff,#0abcf3)");
  $("#reqN").textContent = "одна компания может быть в двух темах";
}

/* ---------- реестр ---------- */
const FILTERS = [
  ["active", "В работе", d => d.g === "active"], ["waiting", "Ждут ответа", d => d.waiting && d.g !== "lost" && d.g !== "won"],
  ["new", "Потенциальные", d => d.status === "Потенциальные"], ["paused", "Пауза", d => d.g === "paused"],
  ["won", "Договоры", d => d.g === "won"], ["lost", "Отказ и архив", d => d.g === "lost"], ["all", "Все", () => true]];
function renderChips() {
  const box = $("#chips"); box.textContent = "";
  if (!FILTERS.some(f => f[0] === S.filter)) S.filter = "active";
  FILTERS.forEach(([k, label, f]) => {
    const b = h("button", { type: "button", class: "tchip", "aria-pressed": String(k === S.filter) }, label, h("span", { class: "c" }, String(S.data.deals.filter(f).length)));
    b.addEventListener("click", () => { S.filter = k; store.set("w2w-filter", k); renderChips(); renderLedger(); });
    box.append(b);
  });
}
function renderLedger() {
  const f = FILTERS.find(x => x[0] === S.filter)[2], q = S.q.trim().toLowerCase();
  const ds = S.data.deals.filter(f).filter(d => !q || d.name.toLowerCase().includes(q));
  const cmp = {
    prio: (a, b) => (b.waiting - a.waiting) || (b.rank - a.rank) || ((b.idle ?? 0) - (a.idle ?? 0)),
    idle: (a, b) => ((b.g === "active") - (a.g === "active")) || ((b.idle ?? -1) - (a.idle ?? -1)),
    first: (a, b) => (b.first || "").localeCompare(a.first || ""),
    name: (a, b) => a.name.localeCompare(b.name, "ru"),
  }[S.sort];
  ds.sort(cmp);
  const tb = $("#ledger tbody"); tb.textContent = "";
  if (!ds.length) { tb.append(h("tr", null, h("td", { colspan: "6", class: "muted" }, "Ничего не найдено. Сбросьте поиск или выберите другой фильтр."))); return; }
  ds.forEach(d => {
    const name = h("td", null, h("a", { class: "co", href: d.url, target: "_blank", rel: "noopener" }, d.name, icon("external")));
    if (d.waiting && d.g !== "lost" && d.g !== "won") name.append(h("span", { class: "flag" }, "ждёт ответа"));
    if (d.meeting && d.meeting >= S.today && !d.held) name.append(h("span", { class: "sub-cell" }, "встреча " + dLong(d.meeting)));
    const active = d.g === "active";
    const next = h("td", { class: "next" }, d.g === "lost" ? (d.reason || "—") : (d.next || "—"));
    tb.append(h("tr", null, name, h("td", null, chip(d.status)),
      h("td", null, d.sector || "Отрасль не указана", h("span", { class: "sub-cell" }, d.region || "Регион не указан")),
      h("td", { class: "num" }, ddmm(d.first)),
      h("td", { class: "r" }, active ? idlePill(d) : h("span", { class: "idle na" }, "—")), next));
  });
}

/* ---------- база курса ---------- */
function uncontacted() {
  if (!S.base) return [];
  const ids = new Set(), users = new Set();
  for (const d of S.data.deals) {
    (d.tg || []).forEach(x => ids.add(String(x)));
    const m = /t\.me\/([A-Za-z0-9_]+)/.exec(d.tgUrl || ""); if (m) users.add(m[1].toLowerCase());
  }
  const best = bestRegion();
  return S.base.leads.filter(l => !(l.tgId && ids.has(String(l.tgId))) && !(l.tg && users.has(l.tg.toLowerCase())))
    .sort((a, b) => (b.lpr === true) - (a.lpr === true) || (b.region === best) - (a.region === best) || a.n - b.n);
}
function bestRegion() {
  const tr = S.data.deals.filter(d => d.tracked);
  const g = [...groupBy(tr, "region")].filter(([k, v]) => k && v.length >= 5).map(([k, v]) => ({ k, r: stats(v).rep / v.length })).sort((a, b) => b.r - a.r);
  return g.length ? g[0].k : null;
}
function renderBase() {
  const k = $("#baseKpis"), reg = $("#baseRegions"), list = $("#baseList");
  k.textContent = ""; reg.textContent = ""; list.textContent = "";
  if (!S.base) { k.append(h("p", { class: "small" }, "База анкет не расшифровалась этим паролем. Если пароль меняли, попросите Claude перешифровать файл data/base.json.")); return; }
  const unc = uncontacted(), owners = unc.filter(l => l.lpr === true).length;
  k.append(h("div", { class: "kpi is-brand" }, h("b", null, String(unc.length)), h("span", null, `анкет из ${S.base.anketas} без касания, из них ${owners} — владельцы и директора`)),
    h("div", { class: "kpi" }, h("b", null, String(S.base.membersNoForm)), h("span", null, "участников группы не оставили анкету")),
    h("div", { class: "kpi" }, h("b", null, String(S.base.reviewUnparsed)), h("span", null, "анкет не разобраны автоматически — проверить вручную")));
  const g = [...groupBy(unc, "region")].map(([r, v]) => [r || "Не указан", v.length]).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...g.map(x => x[1]));
  g.forEach(([r, v]) => reg.append(h("div", { class: "row" }, h("span", null, r), h("span", { class: "tr" }, h("i", { style: `width:${(v / max) * 100}%` })), h("span", { class: "v" }, String(v)))));
  $("#baseTotal").textContent = `всего ${unc.length}`;
  const best = bestRegion();
  $("#baseHint").textContent = "Сначала владельцы и директора" + (best ? `, затем регион с лучшим откликом — ${best}.` : ".") + " Начинайте с приветствия, суть — голосовым.";
  unc.slice(0, 8).forEach(l => list.append(h("li", null, h("span", { class: "nm" }, l.company),
    l.tg ? h("a", { class: "tg", href: "https://t.me/" + l.tg, target: "_blank", rel: "noopener" }, icon("telegram"), "@" + l.tg) : h("span", { class: "small" }, "нет username"),
    h("span", { class: "meta" }, [l.name, l.role, l.region].filter(Boolean).join(" · ")))));
  if (unc.length > 8) list.append(h("li", null, h("span", { class: "meta" }, `Ещё ${unc.length - 8} — в карточке «Ещё не писали» выше.`)));
}

/* ---------- свежесть данных ---------- */
function renderFresh() {
  const at = S.data.generatedAt ? new Date(S.data.generatedAt) : null;
  const el = $("#fresh"), t = $("#freshText");
  if (!at) { t.textContent = "Снимок данных"; return; }
  const local = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(at);
  const hours = (Date.now() - at.getTime()) / 36e5;
  el.classList.toggle("stale", hours > 30);
  t.textContent = hours > 30 ? `Данные от ${local} — обновление не пришло` : `Обновлено ${local}`;
  $("#footFresh").textContent = `Данные из Notion CRM · обновлено ${local}`;
  $("#chainWhen").textContent = `последнее обновление: ${local}`;
}

function renderAll() {
  renderFresh(); renderHero(); renderSignals(); renderWorks();
  segTable("#sectors", "sector", true, "Отрасль не указана"); segTable("#regions", "region", false, "Регион не указан");
  renderReasons(); renderChips(); renderLedger(); renderBase();
}

/* ---------- запуск ---------- */
async function unlock(password, remember) {
  const env = await getJSON("data/crm.json");
  const data = await decrypt(env, password); // бросит ошибку при неверном пароле
  let base = null;
  try { base = await decrypt(await getJSON("data/base.json"), password); } catch (e) { base = null; }
  S.today = todayTash();
  data.deals = enrich(data.deals || [], S.today);
  S.data = data; S.base = base;
  if (remember) store.set("w2w-pw", password); else store.set("w2w-pw", password, true);
  $("#gate").hidden = true; $("#app").hidden = false;
  document.querySelectorAll("#period button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.p === S.period)));
  renderAll();
  document.querySelectorAll(".glass, .paper").forEach((el, i) => { el.classList.add("rise"); el.style.animationDelay = Math.min(i * 30, 300) + "ms"; });
}

$("#gateForm").addEventListener("submit", async e => {
  e.preventDefault();
  const pw = $("#pw").value, btn = $("#gateBtn"), err = $("#gateErr");
  if (!pw) return;
  btn.disabled = true; btn.textContent = "Открываю…"; err.textContent = "";
  try { await unlock(pw, $("#remember").checked); }
  catch (x) {
    err.textContent = x && x.message && x.message.startsWith("http")
      ? "Не удалось загрузить данные. Проверьте интернет и обновите страницу."
      : "Пароль не подошёл. Проверьте раскладку и Caps Lock и попробуйте ещё раз.";
    $("#pw").select();
  } finally { btn.disabled = false; btn.textContent = "Открыть дашборд"; }
});
$("#logout").addEventListener("click", () => { store.del("w2w-pw"); location.reload(); });
$("#theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; store.set("w2w-theme", next); setThemeIcon();
});
function setThemeIcon() {
  const dark = (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  $("#theme use").setAttribute("href", dark ? "#i-sun" : "#i-moon");
}
setThemeIcon();
$("#period").addEventListener("click", e => {
  const b = e.target.closest("button[data-p]"); if (!b || !S.data) return;
  S.period = b.dataset.p; store.set("w2w-period", S.period);
  document.querySelectorAll("#period button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderHero(); renderWorks(); segTable("#sectors", "sector", true, "Отрасль не указана"); segTable("#regions", "region", false, "Регион не указан"); renderReasons();
});
$("#sort").addEventListener("change", e => { S.sort = e.target.value; renderLedger(); });
$("#q").addEventListener("input", e => { S.q = e.target.value; renderLedger(); });

(async function boot() {
  const saved = store.get("w2w-pw") || store.get("w2w-pw", true);
  if (!saved) { $("#pw").focus(); return; }
  try { await unlock(saved, !!store.get("w2w-pw")); } catch (e) { store.del("w2w-pw"); $("#pw").focus(); }
})();
