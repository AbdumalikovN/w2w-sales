/* «Сделки»: реестр с фильтрами, сортировкой, массовыми действиями и выгрузкой CSV. */
import { h, icon, clear, ddmm, dLong, store, meetingLabel, money } from "../core.js";
import { S, can, statusOf, pipelineOf, userName, updateDeal, bulkUpdate } from "../state.js";
import { statusChip, avatar, idlePill, pick, toast, errToast } from "../ui.js";
import { matchQuery } from "../logic.js";

const FILTERS = [
  ["active", "В работе", (d) => d._.g === "active"],
  ["waiting", "Ждут ответа", (d) => d._.waiting],
  ["new", "Потенциальные", (d) => d.status === "potential"],
  ["paused", "Пауза", (d) => d._.g === "paused"],
  ["won", "Договоры", (d) => d._.g === "won"],
  ["lost", "Отказ и архив", (d) => d._.g === "lost"],
  ["all", "Все", () => true],
];
const SORTS = [
  ["prio", "Сначала срочные"],
  ["idle", "Дольше всех без движения"],
  ["recent", "Недавно изменённые"],
  ["first", "По первому касанию"],
  ["name", "По названию"],
];
let ctx = null;
let st = { f: store.get("w2w-deals-f") || "active", s: store.get("w2w-deals-s") || "prio", q: "", pipe: store.get("w2w-deals-p") || "current", limit: 150 };
const sel = new Set();

async function openDeal(id) {
  const m = await import("../main.js");
  m.go("deals", { d: id });
}

export function mount(c) {
  ctx = c;
  if (c.params.get("f") && FILTERS.some((x) => x[0] === c.params.get("f"))) st.f = c.params.get("f");
  if (c.params.get("s") && SORTS.some((x) => x[0] === c.params.get("s"))) st.s = c.params.get("s");
  sel.clear();
  drawTop();
  draw();
  return () => (ctx = null);
}
export function update() {
  if (!ctx) return;
  const a = document.activeElement;
  if (a && ctx.top.contains(a) && a.tagName === "INPUT") return draw();
  drawTop();
  draw();
}

function base() {
  const pipe = st.pipe === "current" ? S.ui.pipeline : st.pipe;
  return [...S.deals.values()].filter((d) => pipe === "all" || d.pipeline === pipe);
}
function rows() {
  const f = FILTERS.find((x) => x[0] === st.f)[2];
  const q = st.q.trim();
  const list = base().filter(f).filter((d) => !q || matchQuery(d, q));
  const cmp = {
    prio: (a, b) => b._.waiting - a._.waiting || b._.rank - a._.rank || (b._.idle ?? 0) - (a._.idle ?? 0),
    idle: (a, b) => (b._.g === "active") - (a._.g === "active") || (b._.idle ?? -1) - (a._.idle ?? -1),
    recent: (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    first: (a, b) => (b.firstTouch || "").localeCompare(a.firstTouch || ""),
    name: (a, b) => a.name.localeCompare(b.name, "ru"),
  }[st.s];
  return list.sort(cmp);
}

function drawTop() {
  const { top } = ctx;
  const all = base();
  const q = h("input", { type: "search", placeholder: "Компания, контакт, телефон…", value: st.q, "aria-label": "Поиск" });
  let t;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      st.q = q.value;
      st.limit = 150;
      draw();
    }, 150);
  });
  const chips = h("div", { class: "seg", role: "group", "aria-label": "Фильтр" });
  for (const [k, label, f] of FILTERS) {
    chips.append(
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(k === st.f),
          onclick: () => {
            st.f = k;
            st.limit = 150;
            store.set("w2w-deals-f", k);
            drawTop();
            draw();
          },
        },
        label,
        h("span", { class: "c" }, String(all.filter(f).length)),
      ),
    );
  }
  const pipeOpts = [{ value: "current", label: `Текущая: ${pipelineOf(S.ui.pipeline).label}` }, { value: "all", label: "Все воронки" }, "sep", ...S.settings.pipelines.map((p) => ({ value: p.id, label: p.label }))];
  const pipeBtn = h("button", { class: "fbtn", type: "button" }, icon("filter"), st.pipe === "current" ? pipelineOf(S.ui.pipeline).label : st.pipe === "all" ? "Все воронки" : pipelineOf(st.pipe).label, icon("chevron"));
  pipeBtn.addEventListener("click", () =>
    pick(pipeBtn, pipeOpts, st.pipe, (v) => {
      st.pipe = v;
      store.set("w2w-deals-p", v);
      drawTop();
      draw();
    }),
  );
  const sortBtn = h("button", { class: "fbtn", type: "button" }, SORTS.find((s) => s[0] === st.s)[1], icon("chevron"));
  sortBtn.addEventListener("click", () =>
    pick(sortBtn, SORTS.map(([value, label]) => ({ value, label })), st.s, (v) => {
      st.s = v;
      store.set("w2w-deals-s", v);
      drawTop();
      draw();
    }),
  );
  clear(top).append(
    h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "Реестр"), h("h1", { class: "h1" }, "Все сделки")),
    h("div", { class: "acts" }, h("button", { class: "btn glass-btn", type: "button", onclick: exportCsv }, icon("download"), "CSV"), can("write") ? h("button", { class: "btn brand desk-only", type: "button", onclick: async () => (await import("../newdeal.js")).newDealModal() }, icon("plus"), "Сделка") : null),
    h("div", { class: "toolbar", style: { width: "100%" } }, chips),
    h("div", { class: "toolbar", style: { width: "100%" } }, h("label", { class: "search" }, icon("search"), q), pipeBtn, sortBtn),
  );
  if (st.q) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
}

function draw() {
  const { page } = ctx;
  const list = rows();
  const glass = h("div", { class: "glass", style: { padding: "6px" } });
  const table = h("table", { class: "ledger" });
  const allChk = h("input", { type: "checkbox", class: "cb", "aria-label": "Выбрать все", checked: list.length && list.every((d) => sel.has(d.id)) });
  allChk.addEventListener("change", () => {
    if (allChk.checked) list.forEach((d) => sel.add(d.id));
    else sel.clear();
    draw();
  });
  table.append(
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        can("write") ? h("th", { class: "chk" }, allChk) : null,
        h("th", null, "Компания"),
        h("th", null, "Статус"),
        h("th", null, "Контакт"),
        h("th", null, "Отрасль · регион"),
        h("th", { class: "num" }, "Первое касание"),
        h("th", { class: "r" }, "Без движения"),
        h("th", null, st.f === "lost" ? "Причина" : "Следующий шаг"),
        h("th", null, ""),
      ),
    ),
  );
  const tb = h("tbody");
  if (!list.length) tb.append(h("tr", null, h("td", { colspan: "9", class: "muted", style: { padding: "28px", textAlign: "center" } }, "Ничего не найдено. Сбросьте поиск или выберите другой фильтр.")));
  for (const d of list.slice(0, st.limit)) {
    const cb = can("write") ? h("input", { type: "checkbox", class: "cb", checked: sel.has(d.id), "aria-label": "Выбрать " + d.name }) : null;
    cb?.addEventListener("click", (e) => e.stopPropagation());
    cb?.addEventListener("change", () => {
      if (cb.checked) sel.add(d.id);
      else sel.delete(d.id);
      drawBulk();
      cb.closest("tr").classList.toggle("sel", cb.checked);
    });
    const name = h("td", null, h("span", { class: "co" }, d.name));
    if (d._.waiting) name.append(" ", h("span", { class: "flag" }, "ждёт ответа"));
    if (d._.meetingDate && d._.meetingDate >= S.today && !d.meetingHeld) name.append(h("span", { class: "sub" }, "встреча " + meetingLabel(d.meetingAt)));
    else if (d.amount) name.append(h("span", { class: "sub" }, money(d.amount)));
    const chipBtn = h("button", { type: "button", class: `chip st-${d.status}`, style: { cursor: can("write") ? "pointer" : "default" } }, statusOf(d.status).label);
    chipBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!can("write")) return openDeal(d.id);
      pick(chipBtn, S.C.statuses.map((s) => ({ value: s.id, label: s.label, dot: s.id })), d.status, (v) =>
        updateDeal(d.id, { status: v, ...(v === "contract" && !d.devStage ? { devStage: "brief" } : {}) })
          .then(() => toast(`«${d.name}» → ${statusOf(v).label}`))
          .catch(errToast),
      );
    });
    const tr = h(
      "tr",
      { class: "click" + (sel.has(d.id) ? " sel" : ""), onclick: () => openDeal(d.id) },
      cb ? h("td", { class: "chk" }, cb) : null,
      name,
      h("td", null, chipBtn),
      h("td", null, d.contactName || h("span", { class: "muted" }, "—"), d.phone ? h("span", { class: "sub" }, d.phone) : null),
      h("td", null, d.sector || (d.region ? null : h("span", { class: "muted" }, "—")), d.region ? h("span", { class: d.sector ? "sub" : "" }, d.region) : null),
      h("td", { class: "num" }, ddmm(d.firstTouch)),
      h("td", { class: "r" }, d._.g === "active" || d._.g === "new" ? idlePill(d) : h("span", { class: "idle na" }, "—")),
      h("td", { class: "next", title: (d._.g === "lost" ? d.reason : d.nextStep) || "" }, h("span", null, d._.g === "lost" ? d.reason || "—" : d.nextStep || "—")),
      h("td", null, avatar(d.owner, "sm")),
    );
    tb.append(tr);
  }
  table.append(tb);
  glass.append(h("div", { class: "tw" }, table));
  clear(page).append(glass);
  if (list.length > st.limit) page.append(h("button", { class: "btn glass-btn", type: "button", style: { justifySelf: "center" }, onclick: () => ((st.limit += 200), draw()) }, `Показать ещё (${list.length - st.limit})`));
  page.append(h("p", { class: "foot" }, `Показано ${Math.min(list.length, st.limit)} из ${list.length}. Дни без движения считаются от последнего сообщения в переписке: зелёный — до 3 дней, жёлтый — 4–7, красный — больше недели.`));
  drawBulk();
}

function drawBulk() {
  ctx.page.querySelector(".bulk")?.remove();
  if (!sel.size || !can("write")) return;
  const ids = [...sel].filter((id) => S.deals.has(id));
  const bar = h("div", { class: "bulk glass glass-thick" }, h("b", null, `Выбрано: ${ids.length}`));
  const stBtn = h("button", { class: "btn sm", type: "button" }, icon("flow"), "Статус");
  stBtn.addEventListener("click", () => pick(stBtn, S.C.statuses.map((s) => ({ value: s.id, label: s.label, dot: s.id })), null, (v) => run({ status: v })));
  const ownBtn = h("button", { class: "btn sm", type: "button" }, icon("person"), "Ответственный");
  ownBtn.addEventListener("click", () => pick(ownBtn, S.users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name, avatar: u.id })), null, (v) => run({ owner: v })));
  const pipeBtn = h("button", { class: "btn sm", type: "button" }, icon("swap"), "Воронка");
  pipeBtn.addEventListener("click", () => pick(pipeBtn, S.settings.pipelines.map((p) => ({ value: p.id, label: p.label })), null, (v) => run({ pipeline: v })));
  bar.append(stBtn, ownBtn, pipeBtn, h("button", { class: "btn sm", type: "button", onclick: () => (sel.clear(), draw()) }, "Снять выбор"));
  ctx.page.append(bar);
  async function run(patch) {
    try {
      const r = await bulkUpdate(ids, patch);
      toast(`Изменено карточек: ${r.length}`);
      sel.clear();
      draw();
    } catch (e) {
      errToast(e);
    }
  }
}

function exportCsv() {
  const list = rows();
  const cols = [
    ["Компания", (d) => d.name],
    ["Воронка", (d) => pipelineOf(d.pipeline).label],
    ["Статус", (d) => statusOf(d.status).label],
    ["Контакт", (d) => d.contactName],
    ["Должность", (d) => d.contactRole],
    ["Телефон", (d) => d.phone],
    ["Телеграм", (d) => d.telegram],
    ["Источник", (d) => d.source],
    ["Отрасль", (d) => d.sector],
    ["Регион", (d) => d.region],
    ["Первое касание", (d) => d.firstTouch],
    ["Последнее касание", (d) => d.lastTouch],
    ["Встреча", (d) => meetingLabel(d.meetingAt)],
    ["Ждёт ответа", (d) => (d.waiting ? "да" : "")],
    ["Следующий шаг", (d) => d.nextStep],
    ["Причина отказа", (d) => d.reason],
    ["Сумма договора", (d) => d.amount ?? ""],
    ["Ответственный", (d) => userName(d.owner)],
  ];
  const esc = (v) => {
    const s = String(v ?? "");
    return /[";\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = "﻿" + [cols.map((c) => c[0]).join(";"), ...list.map((d) => cols.map((c) => esc(c[1](d))).join(";"))].join("\n");
  const a = h("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `w2w-сделки-${S.today}.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
  toast(`Выгружено строк: ${list.length}`);
}
