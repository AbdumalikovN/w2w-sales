/* Быстрый поиск по клиентам (Ctrl/⌘ K). */
import { h, icon, clear, lc } from "./core.js";
import { S, can, pipelineOf } from "./state.js";
import { modal, statusChip } from "./ui.js";
import { matchQuery } from "./logic.js";

export function openPalette() {
  if (document.querySelector(".palette")) return;
  const input = h("input", { placeholder: "Компания, контакт, телефон или @username", "aria-label": "Поиск", autocomplete: "off", spellcheck: "false" });
  const results = h("div", { class: "pr", role: "listbox" });
  let items = [], sel = 0;
  const m = modal({ body: h("div", null, h("div", { class: "ps" }, icon("search"), input, h("span", { class: "kbd" }, "Esc")), results), className: "palette" });
  m.box.classList.add("palette");
  const go = async (it) => {
    m.close();
    const main = await import("./main.js");
    if (it.deal) main.go(main.parseHash().name, { d: it.deal.id });
    else it.run(main);
  };
  const draw = () => {
    const q = input.value.trim();
    clear(results);
    const actions = [
      can("write") && { title: "Новая сделка", sub: "Клавиша N", ic: "plus", run: async () => (await import("./newdeal.js")).newDealModal() },
      { title: "Сегодня", sub: "Кто ждёт ответа, встречи, сигналы", ic: "sparkle", run: (m2) => m2.go("today") },
      { title: "Воронка", sub: "Канбан по статусам", ic: "kanban", run: (m2) => m2.go("board") },
      { title: "Проекты в работе", sub: "Этапы разработки", ic: "gears", run: (m2) => m2.go("projects") },
      { title: "Аналитика", sub: "Конверсия, отрасли, регионы, причины отказов", ic: "chart", run: (m2) => m2.go("analytics") },
    ].filter(Boolean);
    let deals = [];
    if (q) {
      deals = [...S.deals.values()].filter((d) => matchQuery(d, q));
      const ql = lc(q);
      deals.sort((a, b) => (lc(b.name).startsWith(ql) - lc(a.name).startsWith(ql)) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      deals = deals.slice(0, 30);
    } else {
      deals = [...S.deals.values()].filter((d) => d._.waiting).slice(0, 6);
    }
    items = [...deals.map((d) => ({ deal: d })), ...(q ? actions.filter((a) => lc(a.title).includes(lc(q))) : actions)];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    if (!q && deals.length) results.append(h("div", { class: "small", style: { padding: "6px 12px" } }, "Ждут нашего ответа"));
    if (q && !deals.length) results.append(h("div", { class: "small", style: { padding: "10px 12px" } }, "Ничего не нашлось. Попробуйте часть названия или номер телефона."));
    items.forEach((it, i) => {
      const b = h(
        "button",
        { type: "button", class: "pi" + (i === sel ? " kb" : ""), role: "option", "aria-selected": String(i === sel), onclick: () => go(it), onmousemove: () => { if (sel !== i) { sel = i; mark(); } } },
        it.deal ? h("span", { class: "dot-st " + it.deal.status }) : h("span", { class: "app-icon sm ic-5" }, icon(it.ic)),
        h("span", { class: "tx" }, h("b", null, it.deal ? it.deal.name : it.title), h("span", null, it.deal ? [it.deal.contactName, it.deal.phone, pipelineOf(it.deal.pipeline).label].filter(Boolean).join(" · ") || "—" : it.sub)),
        it.deal ? statusChip(it.deal.status) : null,
      );
      results.append(b);
    });
  };
  const mark = () => [...results.querySelectorAll(".pi")].forEach((b, i) => b.classList.toggle("kb", i === sel));
  input.addEventListener("input", () => ((sel = 0), draw()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") (sel = Math.min(items.length - 1, sel + 1)), mark(), e.preventDefault(), results.querySelectorAll(".pi")[sel]?.scrollIntoView({ block: "nearest" });
    else if (e.key === "ArrowUp") (sel = Math.max(0, sel - 1)), mark(), e.preventDefault(), results.querySelectorAll(".pi")[sel]?.scrollIntoView({ block: "nearest" });
    else if (e.key === "Enter" && items[sel]) (e.preventDefault(), go(items[sel]));
  });
  draw();
  setTimeout(() => input.focus(), 20);
}
