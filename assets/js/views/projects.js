/* «Проекты в работе»: клиенты с договором, по этапам разработки. */
import { h, icon, clear, money, dShort, dFull, diffDays, plural, store } from "../core.js";
import { S, can, updateDeal, stageOf } from "../state.js";
import { avatar, toast, errToast, seg } from "../ui.js";

let ctx = null;
let showDone = store.get("w2w-proj-done") === "1";
let mode = store.get("w2w-proj-mode") || "board";

async function openDeal(id) {
  const m = await import("../main.js");
  m.go("projects", { d: id });
}

export function mount(c) {
  ctx = c;
  draw();
  return () => (ctx = null);
}
export function update() {
  if (ctx) draw();
}

function projects() {
  // «Архив 2025» — замороженная история старой CRM: в рабочие проекты не попадает.
  return [...S.deals.values()].filter((d) => d.pipeline !== "archive" && (d.status === "contract" || (showDone && d.status === "won")));
}

function deadlineInfo(d) {
  if (!d.deadline) return null;
  const left = diffDays(d.deadline, S.today);
  if (["done", "support"].includes(d.devStage)) return { cls: "ok", text: "сдан · " + dShort(d.deadline) };
  if (left < 0) return { cls: "bad", text: `просрочен на ${-left} ${plural(-left, "день", "дня", "дней")}` };
  if (left <= 7) return { cls: "warn", text: left === 0 ? "дедлайн сегодня" : `осталось ${left} ${plural(left, "день", "дня", "дней")}` };
  return { cls: "ok", text: "до " + dShort(d.deadline) };
}

function draw() {
  const { top, page } = ctx;
  const list = projects();
  const sum = list.reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const overdue = list.filter((d) => deadlineInfo(d)?.cls === "bad").length;
  const soon = list.filter((d) => deadlineInfo(d)?.cls === "warn").length;
  const noDeadline = list.filter((d) => !d.deadline && !["done", "support"].includes(d.devStage)).length;
  clear(top).append(
    h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "После договора"), h("h1", { class: "h1" }, "Проекты в работе")),
    h(
      "div",
      { class: "acts" },
      seg([{ value: "board", label: "Этапы" }, { value: "list", label: "Список" }], mode, (v) => {
        mode = v;
        store.set("w2w-proj-mode", v);
        draw();
      }),
      h(
        "button",
        {
          class: "fbtn" + (showDone ? " on" : ""),
          type: "button",
          onclick: () => {
            showDone = !showDone;
            store.set("w2w-proj-done", showDone ? "1" : "0");
            draw();
          },
        },
        icon("trophy"),
        "Показать успешные",
      ),
    ),
  );
  clear(page);
  page.append(
    h(
      "div",
      { class: "kpis" },
      h("div", { class: "kpi is-brand" }, h("b", null, String(list.length)), h("span", null, plural(list.length, "проект в работе", "проекта в работе", "проектов в работе"))),
      h("div", { class: "kpi is-ink" }, h("b", null, sum ? money(sum) : "—"), h("span", null, "сумма договоров")),
      h("div", { class: "kpi" + (overdue ? " is-hot" : "") }, h("b", null, String(overdue)), h("span", null, "просрочен дедлайн" + (soon ? ` · ещё ${soon} — в течение недели` : ""))),
      h("div", { class: "kpi" }, h("b", null, String(noDeadline)), h("span", null, "без дедлайна — назначьте сроки")),
    ),
  );
  if (!list.length) {
    page.append(
      h(
        "div",
        { class: "glass pad" },
        h("div", { class: "empty-big" }, h("span", { class: "app-icon lg ic-2" }, icon("gears")), h("b", { class: "h3" }, "Пока нет проектов в работе"), h("p", { class: "muted" }, "Когда в воронке ставите статус «Договор · в разработке», карточка появляется здесь — со всей историей переговоров, контактами и документами.")),
      ),
    );
    return;
  }
  if (mode === "list") return drawList(list);
  const board = h("div", { class: "board" });
  for (const s of S.C.devStages) {
    const items = list.filter((d) => (d.devStage || "brief") === s.id).sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"));
    const col = h("section", { class: "col", "data-st": s.id }, h("div", { class: "col-h" }, h("b", null, s.label), h("span", { class: "n" }, String(items.length))));
    const body = h("div", { class: "col-b" });
    for (const d of items) body.append(card(d));
    if (!items.length) body.append(h("p", { class: "small", style: { padding: "8px 6px", textAlign: "center" } }, "—"));
    col.append(body);
    if (can("write")) {
      col.addEventListener("dragover", (e) => (e.preventDefault(), col.classList.add("is-over")));
      col.addEventListener("dragleave", () => col.classList.remove("is-over"));
      col.addEventListener("drop", (e) => {
        e.preventDefault();
        col.classList.remove("is-over");
        const id = e.dataTransfer.getData("text/plain");
        const d = S.deals.get(id);
        if (d && d.devStage !== s.id) updateDeal(id, { devStage: s.id }).then(() => toast(`«${d.name}» → ${s.label}`)).catch(errToast);
      });
    }
    board.append(col);
  }
  page.append(h("div", { class: "board-wrap" }, board), h("p", { class: "foot" }, "Перетащите карточку на следующий этап (на компьютере) или смените этап в карточке. Сроки, сумма и ответственный — в карточке, вкладка «Детали» → «Проект»."));
}

function card(d) {
  const st = S.C.devStages.findIndex((s) => s.id === (d.devStage || "brief"));
  const dl = deadlineInfo(d);
  const el = h(
    "button",
    { class: "dcard", type: "button", draggable: can("write") ? "true" : "false", onclick: () => openDeal(d.id) },
    h("div", { class: "t" }, h("b", null, d.name)),
    d.contactName ? h("div", { class: "who" }, d.contactName) : null,
    h("div", { class: "stagebar", title: stageOf(d.devStage)?.label || "Старт и бриф" }, S.C.devStages.map((_, i) => h("i", { class: i <= st ? "on" : "" }))),
    d.nextStep ? h("div", { class: "nx" }, h("span", null, d.nextStep)) : null,
    h("div", { class: "ft" }, dl ? h("span", { class: "dl " + dl.cls }, icon("clock"), dl.text) : h("span", { class: "dl ok" }, icon("clock"), "без дедлайна"), d.amount ? h("span", { class: "amt" }, money(d.amount)) : null, avatar(d.owner, "sm")),
  );
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", d.id);
    e.dataTransfer.effectAllowed = "move";
    el.classList.add("is-drag");
  });
  el.addEventListener("dragend", () => el.classList.remove("is-drag"));
  return el;
}

function drawList(list) {
  const t = h("table");
  t.append(h("thead", null, h("tr", null, h("th", null, "Проект"), h("th", null, "Этап"), h("th", null, "Старт"), h("th", null, "Дедлайн"), h("th", { class: "r" }, "Сумма"), h("th", null, "Следующий шаг"), h("th", null, ""))));
  const tb = h("tbody");
  for (const d of list.sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999"))) {
    const dl = deadlineInfo(d);
    tb.append(
      h(
        "tr",
        { class: "click", onclick: () => openDeal(d.id) },
        h("td", null, h("span", { class: "co" }, d.name), d.contactName ? h("span", { class: "sub" }, d.contactName) : null),
        h("td", null, stageOf(d.devStage)?.label || "Старт и бриф"),
        h("td", { class: "num" }, d.startDate ? dFull(d.startDate) : "—"),
        h("td", null, d.deadline ? h("span", { class: "dl " + (dl?.cls || "ok") }, dFull(d.deadline)) : h("span", { class: "muted" }, "—"), dl && d.deadline ? h("span", { class: "sub" }, dl.text) : null),
        h("td", { class: "r num" }, d.amount ? money(d.amount) : "—"),
        h("td", { class: "next", title: d.nextStep || "" }, h("span", null, d.nextStep || "—")),
        h("td", null, avatar(d.owner, "sm")),
      ),
    );
  }
  t.append(tb);
  ctx.page.append(h("div", { class: "glass", style: { padding: "6px" } }, h("div", { class: "tw" }, t)));
}
