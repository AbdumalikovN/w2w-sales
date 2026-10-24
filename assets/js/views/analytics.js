/* «Аналитика»: воронка, что работает в переписке, отрасли и регионы, отказы и запросы. */
import { h, icon, clear, ddmm, addDays, monday, pct, plural, money, store, followLight } from "../core.js";
import { S, pipelineOf, userName } from "../state.js";
import { seg, avatar } from "../ui.js";
import { stats, inPeriod, groupBy, insights } from "../logic.js";

let ctx = null;
let period = store.get("w2w-an-period") || "all";
let pipe = store.get("w2w-an-pipe") || "sales";

export function mount(c) {
  ctx = c;
  draw();
  return () => (ctx = null);
}
export function update(what) {
  if (ctx && what !== "tick") draw();
}

function deals() {
  return [...S.deals.values()].filter((d) => pipe === "all" || d.pipeline === pipe);
}

function draw() {
  const { top, page } = ctx;
  const per = { all: "за всё время", 30: "за 30 дней", 7: "за 7 дней" }[period];
  clear(top).append(
    h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "Аналитика продаж · " + per), h("h1", { class: "h1" }, "Что работает в продажах")),
    h(
      "div",
      { class: "acts" },
      seg(
        [{ value: "sales", label: pipelineOf("sales").label }, ...S.settings.pipelines.filter((p) => p.id !== "sales").map((p) => ({ value: p.id, label: p.label })), { value: "all", label: "Все" }],
        pipe,
        (v) => ((pipe = v), store.set("w2w-an-pipe", v), draw()),
        "Воронка",
      ),
      seg(
        [
          { value: "all", label: "Всё время" },
          { value: "30", label: "30 дней" },
          { value: "7", label: "7 дней" },
        ],
        period,
        (v) => ((period = v), store.set("w2w-an-period", v), draw()),
        "Период по дате первого касания",
      ),
    ),
  );
  clear(page);
  const all = deals();
  const rows = all.filter((d) => inPeriod(d, period));
  page.append(funnel(all, rows, per));
  page.append(works(all, rows));
  page.append(segments(rows));
  page.append(reasons(rows));
  page.append(team(all, rows));
  page.querySelectorAll(".glass").forEach(followLight);
}

function funnel(all, rows, per) {
  const s = stats(rows);
  const title = h("h2", { class: "hello-t", style: { maxWidth: "26ch" } });
  if (!s.n) title.append("За выбранный период первых касаний не было");
  else title.append(`Написали ${s.n} ${plural(s.n, "компании", "компаниям", "компаниям")}${period === "all" ? "" : " " + per}: `, h("span", { class: "hl" }, `${s.ms} ${plural(s.ms, "дошла", "дошли", "дошли")} до встречи`));
  const won = s.won ? `, ${s.won} ${plural(s.won, "договор", "договора", "договоров")}` : ", договоров пока нет";
  const steps = [
    ["Написали", s.n, null],
    ["Ответили", s.rep, s.n],
    ["Проявили интерес", s.int, s.rep],
    ["Встреча назначена", s.ms, s.int],
    ["Встреча проведена", s.mh, s.ms],
    ["ТЗ или КП", s.pr, s.mh],
    ["Договор", s.won, s.pr],
  ];
  const ol = h("ol", { class: "funnel", style: { listStyle: "none", margin: 0, padding: 0 } });
  steps.forEach(([k, v, prev], i) => {
    ol.append(
      h(
        "li",
        { class: "fig" + (i === 0 ? " is-brand" : "") + (i === 6 && v ? " win" : "") + (v === 0 && i ? " zero" : "") },
        h("span", { class: "k" }, k),
        h("b", null, String(v)),
        prev == null ? h("span", { class: "cv" }, "компаний") : h("span", { class: "cv" }, h("strong", null, pct(v, prev) + "%"), " от предыдущего"),
        h("span", { class: "bar-t" }, h("i", { style: { width: `${s.n ? (v / s.n) * 100 : 0}%` } })),
      ),
    );
  });
  const untracked = all.filter((d) => !d._.tracked).length;
  return h(
    "section",
    { class: "night funnel-hero" },
    h("i", { class: "aura n1" }),
    h("i", { class: "aura n2" }),
    h("i", { class: "aura n3" }),
    h("div", { style: { display: "grid", gap: "12px" } }, h("span", { class: "eyebrow" }, "Воронка · " + per), title, s.n ? h("p", { class: "lead" }, `Ответили ${pct(s.rep, s.n)}% тех, кому написали. Встреч проведено: ${s.mh}, до ТЗ или КП дошли ${s.pr}${won}.`) : null),
    ol,
    h("p", { class: "small", style: { color: "rgba(235,235,245,.5)" } }, "Конверсия под числом — от предыдущего шага. Период фильтрует по дате первого касания. " + (untracked ? `${untracked} ${plural(untracked, "карточка", "карточки", "карточек")} без даты первого касания в воронку не входят.` : "")),
  );
}

function card(cls, ic, tone, title, sub) {
  return h("article", { class: "glass pad " + cls }, h("div", { class: "card-h" }, h("span", { class: "app-icon " + tone }, icon(ic)), h("h3", { class: "h3" }, title), sub ? h("span", { class: "small" }, sub) : null));
}

function cmpRows(groups) {
  const el = h("div", { class: "cmp" });
  const list = [...groups].filter(([k, v]) => k && v.length >= 1).map(([k, v]) => ({ k, s: stats(v) })).sort((a, b) => pct(b.s.rep, b.s.n) - pct(a.s.rep, a.s.n) || b.s.n - a.s.n);
  if (!list.length) return h("p", { class: "small" }, "Пока нет данных за выбранный период.");
  const best = list[0];
  for (const r of list)
    el.append(
      h(
        "div",
        { class: "cmp-row" + (r === best && list.length > 1 && r.s.n >= 3 ? " best" : "") },
        h("span", { class: "lbl" }, r.k),
        h("span", { class: "tr" }, h("i", { style: { width: pct(r.s.rep, r.s.n) + "%" } })),
        h("span", { class: "v" }, pct(r.s.rep, r.s.n) + "%", h("small", null, `${r.s.rep} из ${r.s.n}, встреч: ${r.s.ms}`)),
      ),
    );
  return el;
}

function works(all, rows) {
  const sec = h("section", { style: { display: "grid", gap: "14px" } }, h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "Что работает"), h("h2", { class: "h2" }, "Как писать, чтобы отвечали")));
  const grid = h("div", { class: "grid" });
  const ins = card("c5", "sparkle", "ic-5", "Выводы по данным");
  const ul = h("ul", { class: "insights" });
  const list = insights(rows, all.filter((d) => d._.waiting).length);
  if (!list.length) ul.append(h("li", null, icon("sparkle", "i"), h("span", null, "Данных за период пока мало для выводов: нужно хотя бы 5 компаний в сравниваемых группах.")));
  for (const parts of list.slice(0, 5)) ul.append(h("li", null, icon("check", "i"), h("span", null, parts.map((p) => (Array.isArray(p) ? h("b", null, p[1]) : p)))));
  ins.append(ul);
  grid.append(ins);

  // первые касания за 14 дней
  const ch = card("c7", "chart", "ic-1", "Первые касания за 14 дней", "компаний в день");
  const days = Array.from({ length: 14 }, (_, i) => addDays(S.today, i - 13));
  const tr = all.filter((d) => d._.tracked);
  const per = days.map((dt) => {
    const ds = tr.filter((d) => d.firstTouch === dt);
    return { dt, n: ds.length, r: ds.filter((d) => d._.replied).length, m: ds.filter((d) => d._.meetingSet).length };
  });
  const peak = Math.max(4, ...per.map((p) => p.n));
  const step = peak <= 8 ? 2 : peak <= 20 ? 5 : 10;
  const max = Math.ceil(peak / step) * step;
  const yax = h("div", { class: "yax" }), plot = h("div", { class: "plot", style: { "--n": days.length } }), xax = h("div", { class: "xax", style: { "--n": days.length } });
  for (let t = 0; t <= max; t += step) {
    yax.append(h("span", { style: { bottom: (t / max) * 100 + "%" } }, String(t)));
    if (t) plot.append(h("span", { class: "gl", style: { bottom: (t / max) * 100 + "%" } }));
  }
  for (const p of per) {
    const tot = h("div", { class: "tot", style: { height: (p.n / max) * 100 + "%" }, title: `${ddmm(p.dt)}: написали ${p.n}, ответили ${p.r}, встреч ${p.m}` }, h("div", { class: "rep", style: { height: (p.n ? (p.r / p.n) * 100 : 0) + "%" } }));
    const md = h("span", { class: "md" });
    for (let i = 0; i < Math.min(p.m, 4); i++) md.append(h("i"));
    tot.append(md);
    plot.append(h("div", { class: "day" }, tot, p.n ? h("span", { class: "lab", style: { bottom: `calc(${(p.n / max) * 100}% + 4px)` } }, p.r + "/" + p.n) : null));
    const wd = new Date(p.dt + "T00:00:00Z").getUTCDay();
    xax.append(h("span", { class: wd === 0 || wd === 6 ? "we" : "" }, ddmm(p.dt)));
  }
  ch.append(h("div", { class: "chart" }, yax, plot), xax, h("div", { class: "legend" }, h("span", null, h("i", { style: { background: "rgba(10,188,243,.22)" } }), "написали"), h("span", null, h("i", { style: { background: "#0abcf3" } }), "ответили"), h("span", null, h("i", { style: { background: "var(--green-deep)", borderRadius: "50%" } }), "назначили встречу")));
  grid.append(ch);

  const fmt = card("c6", "send", "ic-8", "Формат первого касания", "доля ответивших");
  fmt.append(cmpRows(groupBy(rows, "format")));
  const role = card("c6", "person", "ic-7", "Кому писали", "доля ответивших");
  role.append(cmpRows(groupBy(rows, (d) => (!d.contactRole || d.contactRole === "Не указана" ? "Должность не указана" : d.contactRole))));
  const src = card("c6", "target", "ic-9", "Источник лида", "доля ответивших");
  src.append(cmpRows(groupBy(rows, (d) => d.source || "Источник не указан")));
  grid.append(fmt, role);

  // недели
  const wk = card("c6", "trend", "ic-4", "Недели по дате первого касания");
  const t = h("table");
  t.append(h("thead", null, h("tr", null, h("th", null, "Неделя"), h("th", { class: "r" }, "Написали"), h("th", null, "Ответили"), h("th", { class: "r" }, "Интерес"), h("th", { class: "r" }, "Встречи"), h("th", { class: "r" }, "Проведены"), h("th", { class: "r" }, "ТЗ/КП"))));
  const tb = h("tbody");
  const weeks = [...groupBy(rows, (d) => monday(d.firstTouch))].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10);
  if (!weeks.length) tb.append(h("tr", null, h("td", { colspan: "7", class: "muted" }, "За выбранный период первых касаний не было.")));
  for (const [w, ds] of weeks) {
    const s = stats(ds);
    tb.append(
      h(
        "tr",
        null,
        h("td", null, `${ddmm(w)}–${ddmm(addDays(w, 6))}`, w === monday(S.today) ? h("span", { class: "sub" }, "текущая") : null),
        h("td", { class: "r num" }, String(s.n)),
        h("td", null, h("div", { class: "pct" }, h("span", null, pct(s.rep, s.n) + "%"), h("span", { class: "tr" }, h("i", { style: { width: pct(s.rep, s.n) + "%" } })))),
        h("td", { class: "r num" }, String(s.int)),
        h("td", { class: "r num" }, `${s.ms}`),
        h("td", { class: "r num" }, String(s.mh)),
        h("td", { class: "r num" }, String(s.pr)),
      ),
    );
  }
  t.append(tb);
  wk.append(h("div", { class: "tw" }, t), h("p", { class: "foot" }, "Свежие недели ещё «дозревают»: ответы и встречи по ним будут добавляться 1–2 недели."));
  grid.append(src, wk);
  sec.append(grid);
  return sec;
}

function segTable(rows, key, withInterest, emptyLabel) {
  const g = [...groupBy(rows, (d) => d[key] || emptyLabel)].sort((a, b) => (a[0] === emptyLabel) - (b[0] === emptyLabel) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const t = h("table");
  t.append(h("thead", null, h("tr", null, h("th", null, key === "sector" ? "Отрасль" : "Регион"), h("th", { class: "r" }, "Компаний"), h("th", null, "Ответили"), withInterest ? h("th", { class: "r" }, "Интерес") : null, h("th", { class: "r" }, "Встречи"))));
  const tb = h("tbody");
  if (!g.length) tb.append(h("tr", null, h("td", { colspan: "5", class: "muted" }, "Нет данных за период.")));
  for (const [k, ds] of g) {
    const s = stats(ds);
    tb.append(
      h(
        "tr",
        { class: s.ms >= 2 && s.ms / s.n >= 0.25 ? "hl" : s.rep === 0 && s.n >= 3 ? "lo" : "" },
        h("td", null, k),
        h("td", { class: "r num" }, String(s.n)),
        h("td", null, h("div", { class: "pct" }, h("span", null, pct(s.rep, s.n) + "%"), h("span", { class: "tr" }, h("i", { style: { width: pct(s.rep, s.n) + "%" } })))),
        withInterest ? h("td", { class: "r num" }, String(s.int)) : null,
        h("td", { class: "r num" }, String(s.ms)),
      ),
    );
  }
  t.append(tb);
  return h("div", { class: "tw" }, t);
}

function segments(rows) {
  const sec = h("section", { style: { display: "grid", gap: "14px" } }, h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "Сегменты"), h("h2", { class: "h2" }, "Где отвечают и доходят до встречи")));
  const a = h("div", { class: "glass pad c7" }, segTable(rows, "sector", true, "Отрасль не указана"), h("p", { class: "foot" }, "Зелёным отмечены сегменты, где встречу назначили хотя бы каждой четвёртой компании."));
  const b = h("div", { class: "glass pad c5" }, segTable(rows, "region", false, "Регион не указан"));
  sec.append(h("div", { class: "grid" }, a, b));
  return sec;
}

function hbars(entries, color) {
  const el = h("div", { class: "hb" });
  if (!entries.length) return h("p", { class: "small" }, "Нет данных за выбранный период.");
  const max = Math.max(...entries.map((e) => e.v));
  for (const e of entries) el.append(h("div", { class: "hb-row" }, h("div", { class: "t" }, h("span", null, e.k), h("span", null, String(e.v))), h("div", { class: "tr" }, h("i", { style: { width: (e.v / max) * 100 + "%", background: e.color || color } })), h("p", null, e.who)));
  return el;
}

function reasons(rows) {
  const sec = h("section", { style: { display: "grid", gap: "14px" } }, h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "Голос клиента"), h("h2", { class: "h2" }, "Почему «не сейчас» и что просят")));
  const lostish = rows.filter((d) => d._.g === "lost" || d._.g === "paused");
  const hard = new Set(["Сделали сами или с другим подрядчиком", "AI не нужен", "Не наш клиент"]);
  const lg = [...groupBy(lostish, (d) => d.reason || "Причина не записана")].map(([k, v]) => ({ k, v: v.length, who: v.map((d) => d.name).join(", "), color: hard.has(k) ? "var(--danger)" : "var(--warn)" })).sort((a, b) => b.v - a.v);
  const req = new Map();
  rows.forEach((d) => (d.requests || []).forEach((r) => (req.has(r) || req.set(r, []), req.get(r).push(d.name))));
  const rq = [...req].map(([k, v]) => ({ k, v: v.length, who: v.join(", ") })).sort((a, b) => b.v - a.v);
  const a = card("c6", "cross", "ic-6", "Причины отказа и паузы", `${lostish.length} ${plural(lostish.length, "компания", "компании", "компаний")}`);
  a.append(hbars(lg, "var(--warn)"));
  const b = card("c6", "bubble", "ic-2", "Что просят клиенты", "одна компания может быть в двух темах");
  b.append(hbars(rq, "linear-gradient(90deg,#4fd8ff,#0abcf3)"));
  sec.append(h("div", { class: "grid" }, a, b));
  return sec;
}

function team(all, rows) {
  const sec = h("section", { style: { display: "grid", gap: "14px" } }, h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "Команда"), h("h2", { class: "h2" }, "Сделки по ответственным")));
  const g = [...groupBy(all, (d) => d.owner || "")].sort((a, b) => b[1].length - a[1].length);
  const t = h("table");
  t.append(h("thead", null, h("tr", null, h("th", null, "Ответственный"), h("th", { class: "r" }, "Всего"), h("th", { class: "r" }, "В работе"), h("th", { class: "r" }, "Ждут ответа"), h("th", { class: "r" }, "Встречи"), h("th", { class: "r" }, "Договоры"), h("th", { class: "r" }, "Сумма"))));
  const tb = h("tbody");
  for (const [uid, ds] of g) {
    tb.append(
      h(
        "tr",
        null,
        h("td", null, h("span", { style: { display: "inline-flex", alignItems: "center", gap: "8px" } }, avatar(uid, "sm"), userName(uid) || "Без ответственного")),
        h("td", { class: "r num" }, String(ds.length)),
        h("td", { class: "r num" }, String(ds.filter((d) => d._.g === "active").length)),
        h("td", { class: "r num" }, String(ds.filter((d) => d._.waiting).length)),
        h("td", { class: "r num" }, String(ds.filter((d) => d._.meetingSet).length)),
        h("td", { class: "r num" }, String(ds.filter((d) => d._.won).length)),
        h("td", { class: "r num" }, money(ds.filter((d) => d._.won).reduce((a, d) => a + (Number(d.amount) || 0), 0)) || "—"),
      ),
    );
  }
  t.append(tb);
  sec.append(h("div", { class: "glass pad" }, h("div", { class: "tw" }, t)));
  return sec;
}
