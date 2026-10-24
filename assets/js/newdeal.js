/* Новая сделка: короткая форма, остальное — уже в карточке. */
import { h, icon, todayTash, tgUsername, lc } from "./core.js";
import { S, createDeal } from "./state.js";
import { modal, busy, errToast, toast } from "./ui.js";

export function newDealModal(preset = {}) {
  const pipeline = preset.pipeline || S.ui.pipeline || "sales";
  const f = (label, el, cls = "") => h("div", { class: "field " + cls }, h("label", null, label), el);
  const name = h("input", { class: "input", placeholder: "Компания или бренд", required: true });
  const contact = h("input", { class: "input", placeholder: "Имя Фамилия" });
  const phone = h("input", { class: "input", type: "tel", inputmode: "tel", placeholder: "+998 …" });
  const tg = h("input", { class: "input", placeholder: "@username или ссылка t.me" });
  const sel = (opts, cur) => {
    const s = h("select", { class: "select" }, h("option", { value: "" }, "—"));
    for (const o of opts) s.append(h("option", { value: o.value ?? o }, o.label ?? o));
    s.value = cur || "";
    return s;
  };
  const pipe = sel(S.settings.pipelines.map((p) => ({ value: p.id, label: p.label })), pipeline);
  const status = sel(S.C.statuses.filter((s) => s.group !== "lost").map((s) => ({ value: s.id, label: s.label })), preset.status || "potential");
  const source = sel(S.settings.sources, preset.source || "");
  const sector = sel(S.settings.sectors, "");
  const region = sel(S.settings.regions, "");
  const next = h("textarea", { class: "textarea", rows: 2, placeholder: "Что сделать первым делом" });
  const dup = h("p", { class: "small", style: { color: "var(--warn-ink)" } });
  const checkDup = () => {
    const n = lc(name.value.trim()), u = lc(tgUsername(tg.value) || tg.value.replace(/^@/, "")), p = phone.value.replace(/\D/g, "");
    const hit = [...S.deals.values()].find((d) => (n && lc(d.name) === n) || (u && lc(tgUsername(d.telegram)) === u) || (p.length >= 7 && (d.phone || "").replace(/\D/g, "").endsWith(p.slice(-9))));
    dup.textContent = hit ? `Похоже, такой клиент уже есть: «${hit.name}». Проверьте, чтобы не завести дубль.` : "";
  };
  [name, tg, phone].forEach((x) => x.addEventListener("input", checkDup));
  const btn = h("button", { class: "btn brand", type: "submit" }, icon("plus"), "Создать");
  const form = h(
    "form",
    { style: { display: "grid", gap: "14px" } },
    h(
      "div",
      { class: "fgrid" },
      f("Название компании", name, "full"),
      f("Контакт", contact),
      f("Телефон", phone),
      f("Телеграм", tg),
      f("Источник", source),
      f("Воронка", pipe),
      f("Статус", status),
      f("Отрасль", sector),
      f("Регион", region),
      f("Следующий шаг", next, "full"),
    ),
    dup,
    h("div", { class: "modal-f" }, h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Отмена"), btn),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!name.value.trim()) return name.focus();
    busy(btn, true);
    try {
      const d = await createDeal({
        name: name.value.trim(),
        contactName: contact.value.trim(),
        phone: phone.value.trim(),
        telegram: tg.value.trim(),
        pipeline: pipe.value || pipeline,
        status: status.value || "potential",
        source: source.value,
        sector: sector.value,
        region: region.value,
        nextStep: next.value.trim(),
        firstTouch: status.value && status.value !== "potential" ? todayTash() : "",
        steps: [true],
      });
      m.close();
      toast("Сделка создана");
      const main = await import("./main.js");
      main.go(main.parseHash().name, { d: d.id });
    } catch (ex) {
      errToast(ex);
      busy(btn, false);
    }
  });
  const m = modal({ title: "Новая сделка", body: form, wide: true });
}
