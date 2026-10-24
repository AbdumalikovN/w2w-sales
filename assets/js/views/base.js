/* «База курса»: анкеты группы ISAEV Dastur 24 — кому ещё не писали. */
import { h, icon, clear, dFull, plural, pct, followLight } from "../core.js";
import { get, post, patch } from "../api.js";
import { S, can, mergeDeal, emit } from "../state.js";
import { toast, errToast, seg } from "../ui.js";
import { uncontacted, leadInCrm, bestRegion, groupBy } from "../logic.js";

let ctx = null;
let base = null;
let tab = "todo";
let region = "";

export function mount(c) {
  ctx = c;
  load();
  return () => (ctx = null);
}
export function update() {
  if (ctx && base) draw();
}

async function load() {
  try {
    base = await get("/base");
    if (ctx) draw();
  } catch (e) {
    errToast(e, "Не удалось загрузить базу анкет");
  }
}

function draw() {
  const { top, page } = ctx;
  const deals = [...S.deals.values()];
  const leads = base.leads || [];
  const todo = uncontacted(base, deals);
  const inCrm = leads.filter((l) => leadInCrm(l, deals));
  const skipped = leads.filter((l) => l.status === "skipped" && !leadInCrm(l, deals));
  clear(top).append(
    h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "База курса «ISAEV Dastur 24»"), h("h1", { class: "h1" }, "Кому ещё не писали")),
    h(
      "div",
      { class: "acts" },
      seg(
        [
          { value: "todo", label: "Без касания", count: todo.length },
          { value: "crm", label: "Уже в CRM", count: inCrm.length },
          { value: "skipped", label: "Пропущены", count: skipped.length },
        ],
        tab,
        (v) => ((tab = v), draw()),
      ),
    ),
  );
  clear(page);
  const lpr = todo.filter((l) => l.lpr).length;
  page.append(
    h(
      "div",
      { class: "kpis" },
      h("div", { class: "kpi is-brand" }, h("b", null, String(todo.length)), h("span", null, "анкет без касания — им ещё не писали")),
      h("div", { class: "kpi" }, h("b", null, String(lpr)), h("span", null, "из них владельцы и директора — начинайте с них")),
      h("div", { class: "kpi" }, h("b", null, `${pct(inCrm.length, leads.length)}%`), h("span", null, `базы уже в CRM (${inCrm.length} из ${leads.length})`)),
      h("div", { class: "kpi is-ink" }, h("b", null, base.asOf ? dFull(base.asOf) : "—"), h("span", null, "дата выгрузки анкет")),
    ),
  );
  const list = tab === "todo" ? todo : tab === "crm" ? inCrm : skipped;
  const grid = h("div", { class: "grid" });
  // регионы
  const regCard = h("article", { class: "glass pad c4" }, h("div", { class: "card-h" }, h("span", { class: "app-icon ic-7" }, icon("globe")), h("h3", { class: "h3" }, "По регионам"), h("span", { class: "small" }, `${list.length}`)));
  const g = [...groupBy(list, (l) => l.region || "Регион не указан")].sort((a, b) => b[1].length - a[1].length);
  const max = Math.max(1, ...g.map(([, v]) => v.length));
  const bars = h("div", { class: "bars" });
  bars.append(
    h(
      "button",
      { class: "row2", type: "button", style: { fontWeight: region ? 500 : 800, textAlign: "left" }, onclick: () => ((region = ""), draw()) },
      h("span", null, "Все регионы"),
      h("span", { class: "bar-tr" }, h("i", { style: { width: "100%" } })),
      h("span", { class: "v" }, String(list.length)),
    ),
  );
  for (const [k, v] of g) {
    bars.append(
      h(
        "button",
        { class: "row2", type: "button", style: { fontWeight: region === k ? 800 : 500, textAlign: "left" }, onclick: () => ((region = region === k ? "" : k), draw()) },
        h("span", null, k),
        h("span", { class: "bar-tr" }, h("i", { style: { width: (v.length / max) * 100 + "%" } })),
        h("span", { class: "v" }, String(v.length)),
      ),
    );
  }
  const best = bestRegion(deals);
  regCard.append(bars, best ? h("p", { class: "foot" }, `Лучше всего отвечают в регионе «${best}» — эти анкеты стоят выше в списке.`) : null);
  grid.append(regCard);
  // список
  const shown = list.filter((l) => !region || (l.region || "Регион не указан") === region);
  const lc = h("article", { class: "glass pad c8" }, h("div", { class: "card-h" }, h("span", { class: "app-icon ic-1" }, icon("target")), h("h3", { class: "h3" }, tab === "todo" ? "С кого начать" : tab === "crm" ? "Уже в CRM" : "Пропущенные"), h("span", { class: "small" }, region ? region : "")));
  if (!shown.length) lc.append(h("p", { class: "empty" }, icon("check"), tab === "todo" ? "Всем анкетам из списка уже написали." : "Пусто."));
  const rows = h("div", { class: "rows" });
  for (const l of shown) rows.append(leadRow(l, tab));
  lc.append(rows);
  grid.append(lc);
  page.append(grid, h("p", { class: "foot" }, "Как только по анкете появляется карточка в CRM (вручную, кнопкой «Создать карточку» или после вечерней синхронизации Telegram), анкета уходит из списка «Без касания»."));
  page.querySelectorAll(".glass").forEach(followLight);
}

function leadRow(l, mode) {
  const name = l.company && l.company !== "—" ? l.company : l.name;
  const acts = h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" } });
  if (l.tg) acts.append(h("a", { class: "btn xs", href: "https://t.me/" + l.tg, target: "_blank", rel: "noopener", style: { color: "var(--brand-ink)", background: "rgba(var(--brand-rgb),.12)" } }, icon("telegram"), "@" + l.tg));
  if (l.link) acts.append(h("a", { class: "btn xs", href: l.link, target: "_blank", rel: "noopener", title: "Анкета в группе курса" }, icon("external"), "Анкета"));
  if (can("write") && mode === "todo") {
    acts.append(
      h("button", { class: "btn xs ink", type: "button", onclick: (e) => convert(l, e.currentTarget) }, icon("plus"), "Создать карточку"),
      h("button", { class: "btn xs", type: "button", title: "Не писать этому человеку", onclick: () => setStatus(l, "skipped") }, "Пропустить"),
    );
  }
  if (can("write") && mode === "skipped") acts.append(h("button", { class: "btn xs", type: "button", onclick: () => setStatus(l, "new") }, "Вернуть в список"));
  if (mode === "crm") {
    const d = l.dealId ? S.deals.get(l.dealId) : [...S.deals.values()].find((x) => (l.tgId && (x.tgIds || []).includes(String(l.tgId))) || (l.tg && (x.telegram || "").toLowerCase().endsWith("/" + l.tg.toLowerCase())));
    if (d) acts.append(h("button", { class: "btn xs", type: "button", onclick: async () => (await import("../main.js")).go("base", { d: d.id }) }, icon("external"), "Карточка"));
  }
  return h(
    "div",
    { class: "row", style: { cursor: "default", gridTemplateColumns: "minmax(0,1fr) auto" } },
    h("span", { class: "nm" }, name, l.lpr ? h("span", { class: "idle ok", style: { marginLeft: "8px" } }, "владелец") : null),
    acts,
    h("span", { class: "meta" }, [l.company && l.company !== "—" ? l.name : null, l.role, l.region, l.activity].filter(Boolean).join(" · ")),
  );
}

async function convert(l, btn) {
  btn.classList.add("is-busy");
  try {
    const r = await post(`/base/${l.n}/convert`);
    l.dealId = r.deal.id;
    l.status = "converted";
    mergeDeal(r.deal);
    emit("deal", [r.deal.id]);
    toast(`Карточка «${r.deal.name}» создана`);
    (await import("../main.js")).go("base", { d: r.deal.id });
  } catch (e) {
    errToast(e);
    btn.classList.remove("is-busy");
  }
}
async function setStatus(l, status) {
  try {
    const r = await patch(`/base/${l.n}`, { status });
    Object.assign(l, r.lead);
    draw();
    toast(status === "skipped" ? "Анкета пропущена" : "Анкета возвращена в список");
  } catch (e) {
    errToast(e);
  }
}
