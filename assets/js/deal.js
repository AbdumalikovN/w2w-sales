/* Карточка сделки: шторка справа со всеми полями, чек-листами и историей. */
import { h, icon, clear, fitTextarea, richText, dFull, dShort, ddmm, timeAgo, debounce, toLocalInput, fromLocalInput, meetingLabel, money, tgUsername, plural, todayTash } from "./core.js";
import { get, post, patch, del, ApiError } from "./api.js";
import { S, statusOf, stageOf, userName, pipelineOf, can, updateDeal, subscribe, removeLocal, enrich } from "./state.js";
import { statusChip, avatar, toast, errToast, pick, confirmBox, switchEl, copyText, closePop, popover } from "./ui.js";
import { completeness } from "./logic.js";

let D = null; // { id, el, scrim, tab, history, unsub, pendingRender }

export const currentDealId = () => D?.id || null;

async function setHashDeal(id) {
  const m = await import("./main.js");
  m.setParam("d", id);
}

export function openDeal(id) {
  const deal = S.deals.get(id);
  if (!deal) {
    toast("Карточка не найдена — возможно, её удалили", { error: true });
    setHashDeal(null);
    return;
  }
  if (!D) {
    const scrim = h("div", { class: "scrim" });
    const el = h("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Карточка клиента" });
    scrim.addEventListener("click", () => closeDeal());
    el.addEventListener("input", (e) => e.target.matches?.("textarea.textarea") && fitTextarea(e.target));
    document.body.append(scrim, el);
    requestAnimationFrame(() => {
      scrim.classList.add("on");
      el.classList.add("on");
    });
    D = { id, el, scrim, tab: "overview", history: null, unsub: null, pendingRender: false, prevFocus: document.activeElement };
    D.unsub = subscribe((what, ids) => {
      if (!D) return;
      if (!S.deals.get(D.id)) {
        closeDeal();
        return;
      }
      if (what === "all" || what === "remote" || ((what === "deal" || what === "deals") && (!ids || ids.includes(D.id)))) scheduleRender(what === "remote");
    });
    document.addEventListener("keydown", onKey);
  } else {
    D.id = id;
    D.tab = "overview";
    D.history = null;
  }
  setHashDeal(id);
  render();
  loadHistory();
}

export function closeDeal(silent) {
  if (!D) return;
  flushAll();
  const { el, scrim, unsub, prevFocus } = D;
  D = null;
  unsub?.();
  document.removeEventListener("keydown", onKey);
  el.classList.remove("on");
  scrim.classList.remove("on");
  setTimeout(() => {
    el.remove();
    scrim.remove();
  }, 420);
  if (!silent) setHashDeal(null);
  prevFocus?.focus?.({ preventScroll: true });
}

function onKey(e) {
  if (e.key === "Escape" && !document.querySelector(".pop, .modal-wrap")) {
    const a = document.activeElement;
    if (a && D?.el.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName)) {
      a.blur();
      return;
    }
    closeDeal();
  }
}

function typingInside() {
  const a = document.activeElement;
  return D && a && D.el.contains(a) && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
}
function scheduleRender(remote) {
  if (!D) return;
  if (typingInside()) {
    D.pendingRender = true;
    return;
  }
  render();
  if (remote) loadHistory(true);
}

// ---------- сохранение ----------
const savers = new Map();
let saveState = null;
function setSave(state, text) {
  saveState = state;
  const el = D?.el.querySelector(".saving");
  if (!el) return;
  el.className = "saving " + (state || "");
  el.textContent = text || "";
}
function save(changes) {
  if (!D || !can("write")) return Promise.resolve();
  const id = D.id;
  setSave("", "Сохраняю…");
  return updateDeal(id, changes, { silent: true })
    .then(() => {
      if (D?.id === id) setSave("ok", "Сохранено");
      setTimeout(() => saveState === "ok" && setSave("", ""), 2200);
    })
    .catch((e) => {
      if (e instanceof ApiError && e.status === 409) {
        const names = (e.extra.fields || []).map((f) => LBL[f] || f).join(", ");
        toast(`Поле «${names}» только что изменил другой пользователь — показана новая версия`, { error: true, ms: 6000 });
        setSave("err", "Конфликт правок");
      } else {
        errToast(e);
        setSave("err", "Не сохранено");
      }
    });
}
function saveText(key, ms = 900) {
  const k = D.id + ":" + key;
  if (!savers.has(k)) savers.set(k, debounce((v) => save({ [key]: v }), ms));
  return savers.get(k);
}
function flushAll() {
  for (const s of savers.values()) s.flush();
  savers.clear();
}

const LBL = {
  name: "Название", nextStep: "Следующий шаг", contactName: "Контакт", phone: "Телефон", telegram: "Телеграм", status: "Статус", context: "Контекст",
  notes: "Заметки", waiting: "Ждёт ответа", meetingAt: "Встреча", owner: "Ответственный", group: "Группа", driveUrl: "Папка Google Drive",
};

// ---------- поля ----------
function deal() {
  return S.deals.get(D.id);
}
const ro = () => !can("write");

function fText(label, key, opts = {}) {
  const d = deal();
  const val = opts.get ? opts.get(d) : d[key] ?? "";
  const input = h(opts.multiline ? "textarea" : "input", {
    class: opts.multiline ? "textarea" : "input",
    placeholder: opts.placeholder || "",
    type: opts.multiline ? null : opts.type || "text",
    inputmode: opts.inputmode,
    readonly: ro(),
    rows: opts.rows,
    "aria-label": label,
  });
  input.value = val;
  if (!ro()) {
    if (!opts.manual) {
      const s = saveText(key);
      input.addEventListener("input", () => s(input.value));
      input.addEventListener("change", () => s.flush(input.value));
    }
    input.addEventListener("blur", () => {
      if (D?.pendingRender) setTimeout(() => !typingInside() && render(), 60);
    });
    if (!opts.multiline) input.addEventListener("keydown", (e) => e.key === "Enter" && input.blur());
  }
  return h("div", { class: "field" + (opts.full ? " full" : "") }, h("label", null, label, opts.extra || null), input, opts.hint ? h("span", { class: "hint" }, opts.hint) : null);
}

function fSelect(label, key, options, opts = {}) {
  const d = deal();
  const sel = h("select", { class: "select", disabled: ro(), "aria-label": label });
  if (opts.empty !== false) sel.append(h("option", { value: "" }, opts.empty || "—"));
  const cur = d[key] ?? "";
  const vals = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  if (cur && !vals.some((o) => o.value === cur)) vals.push({ value: cur, label: cur + " (нет в справочнике)" });
  for (const o of vals) sel.append(h("option", { value: o.value }, o.label));
  sel.value = cur;
  sel.addEventListener("change", () => save({ [key]: sel.value }));
  return h("div", { class: "field" + (opts.full ? " full" : "") }, h("label", null, label), sel);
}

function fDate(label, key, opts = {}) {
  const d = deal();
  const inp = h("input", { class: "input", type: "date", value: (d[key] || "").slice(0, 10), readonly: ro(), "aria-label": label });
  inp.addEventListener("change", () => save({ [key]: inp.value }));
  return h("div", { class: "field" + (opts.full ? " full" : "") }, h("label", null, label), inp);
}

function fMulti(label, key, options) {
  const d = deal();
  const cur = new Set(d[key] || []);
  const box = h("div", { class: "multi" });
  const all = [...new Set([...options, ...cur])];
  for (const o of all) {
    const b = h("button", { type: "button", "aria-pressed": String(cur.has(o)), disabled: ro() }, o);
    b.addEventListener("click", () => {
      if (cur.has(o)) cur.delete(o);
      else cur.add(o);
      b.setAttribute("aria-pressed", String(cur.has(o)));
      save({ [key]: [...cur] });
    });
    box.append(b);
  }
  return h("div", { class: "field full" }, h("span", { class: "lbl" }, label), box);
}

function sec(title, ...kids) {
  const opts = typeof kids[0] === "object" && kids[0] && !kids[0].nodeType && !Array.isArray(kids[0]) ? kids.shift() : {};
  return h("section", { class: "sec", id: opts.id }, h("div", { class: "sec-h" }, opts.icon ? h("span", { class: "app-icon sm " + (opts.tone || "ic-1") }, icon(opts.icon)) : null, h("h3", null, title), opts.right || null), ...kids);
}

/** Список строк (контакты, риски): показ со ссылками + добавление/удаление */
function linesEditor(key, placeholder) {
  const d = deal();
  const items = [...(d[key] || [])];
  const list = h("div", { class: "lines" });
  const draw = () => {
    clear(list);
    if (!items.length) list.append(h("p", { class: "small" }, "Пока пусто"));
    items.forEach((t, i) => {
      list.append(
        h(
          "div",
          { class: "line-it" },
          h("span", null, richText(t)),
          ro()
            ? null
            : h(
                "button",
                {
                  class: "x",
                  type: "button",
                  "aria-label": "Удалить",
                  onclick: () => {
                    items.splice(i, 1);
                    draw();
                    save({ [key]: [...items] });
                  },
                },
                icon("close"),
              ),
        ),
      );
    });
  };
  draw();
  if (ro()) return list;
  const inp = h("input", { class: "input", placeholder });
  const add = () => {
    const v = inp.value.trim();
    if (!v) return;
    items.push(v);
    inp.value = "";
    draw();
    save({ [key]: [...items] });
  };
  inp.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), add()));
  return h("div", { style: { display: "grid", gap: "8px" } }, list, h("div", { class: "addline" }, inp, h("button", { class: "btn sm", type: "button", onclick: add }, icon("plus"), "Добавить")));
}

function checklist(key, labels) {
  const d = deal();
  const vals = [...(d[key] || labels.map(() => false))];
  const done = vals.filter(Boolean).length;
  const bar = h("i", { style: { width: Math.round((done / labels.length) * 100) + "%" } });
  const cnt = h("span", { class: "small" }, `${done} из ${labels.length}`);
  const box = h("div", { class: "checks" });
  labels.forEach((l, i) => {
    const cb = h("input", { type: "checkbox", checked: !!vals[i], disabled: ro() });
    cb.addEventListener("change", () => {
      vals[i] = cb.checked;
      const n = vals.filter(Boolean).length;
      bar.style.width = Math.round((n / labels.length) * 100) + "%";
      cnt.textContent = `${n} из ${labels.length}`;
      save({ [key]: [...vals] });
    });
    box.append(h("label", { class: "check" }, cb, h("span", { class: "box" }, icon("check")), h("span", null, l)));
  });
  return { box, bar: h("div", { class: "progress" }, bar), cnt };
}

// ---------- шапка ----------
function header(d) {
  const st = statusOf(d.status);
  const name = h("h2", { class: "dr-name", contenteditable: can("write") ? "plaintext-only" : "false", spellcheck: "false", "aria-label": "Название компании" }, d.name);
  if (can("write")) {
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        name.blur();
      }
    });
    name.addEventListener("blur", () => {
      const v = name.textContent.trim();
      if (v && v !== deal().name) save({ name: v });
      else name.textContent = deal().name;
      if (D?.pendingRender) {
        D.pendingRender = false;
        render();
      }
    });
  }
  const stBtn = h("button", { type: "button", class: `chip st-${st.id}`, style: { height: "32px", padding: "0 13px", fontSize: "13px", cursor: can("write") ? "pointer" : "default" }, "aria-haspopup": "menu", title: "Статус" }, st.label, can("write") ? icon("chevron", "rot") : null);
  if (can("write")) {
    stBtn.addEventListener("click", () => {
      const groups = [
        { head: "Воронка" },
        ...S.C.statuses.filter((s) => ["new", "active"].includes(s.group)).map((s) => ({ value: s.id, label: s.label, dot: s.id })),
        { head: "Пауза" },
        ...S.C.statuses.filter((s) => s.group === "paused").map((s) => ({ value: s.id, label: s.label, dot: s.id })),
        { head: "Итог" },
        ...S.C.statuses.filter((s) => ["won", "lost"].includes(s.group)).map((s) => ({ value: s.id, label: s.label, dot: s.id })),
      ];
      pick(stBtn, groups, d.status, (v) => changeStatus(v));
    });
  }
  const ownerBtn = h("button", { type: "button", class: "qa", title: "Ответственный", disabled: !can("write") }, avatar(d.owner, "sm"), userName(d.owner) || "Без ответственного");
  ownerBtn.addEventListener("click", () => {
    if (!can("write")) return;
    pick(ownerBtn, [...S.users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name, avatar: u.id })), "sep", { value: "", label: "Без ответственного" }], d.owner, (v) => save({ owner: v }));
  });
  const links = h("div", { class: "dr-links" });
  const tgu = tgUsername(d.telegram);
  if (d.telegram) links.append(h("a", { class: "qa tg", href: d.telegram, target: "_blank", rel: "noopener" }, icon("telegram"), tgu ? "@" + tgu : "Telegram"));
  if (d.group) links.append(h("a", { class: "qa tg", href: d.group, target: "_blank", rel: "noopener" }, icon("people"), "Группа"));
  if (d.phone) links.append(h("a", { class: "qa", href: "tel:" + d.phone.replace(/[^\d+]/g, "") }, icon("phone"), d.phone));
  if (d.driveUrl) links.append(h("a", { class: "qa", href: d.driveUrl, target: "_blank", rel: "noopener" }, icon("folder"), "Google Drive"));
  if (d.website) links.append(h("a", { class: "qa", href: d.website, target: "_blank", rel: "noopener" }, icon("globe"), "Сайт"));
  if (d.instagram) links.append(h("a", { class: "qa", href: d.instagram, target: "_blank", rel: "noopener" }, icon("instagram"), "Instagram"));
  const more = h("button", { class: "btn icon sm", type: "button", "aria-label": "Ещё действия" }, icon("dots"));
  more.addEventListener("click", () =>
    popover(
      more,
      (pop, close) => {
        pop.append(
          h("button", { class: "opt", type: "button", onclick: () => (close(), copyText(location.origin + location.pathname + "#/deals?d=" + d.id, "Ссылка на карточку скопирована")) }, icon("link"), "Скопировать ссылку"),
          h("button", { class: "opt", type: "button", onclick: () => (close(), copyText(dealSummary(deal()), "Сводка скопирована")) }, icon("copy"), "Скопировать сводку"),
        );
        if (d.notion?.url) pop.append(h("a", { class: "opt", href: d.notion.url, target: "_blank", rel: "noopener", onclick: close }, icon("external"), "Открыть в Notion (архив)"));
        if (can("write")) {
          pop.append(h("div", { class: "sep" }), h("div", { class: "hd" }, "Перенести в воронку"));
          for (const p of S.settings.pipelines) if (p.id !== d.pipeline) pop.append(h("button", { class: "opt", type: "button", onclick: () => (close(), save({ pipeline: p.id }).then(() => toast(`Перенесено в «${p.label}»`))) }, icon("swap"), p.label));
        }
        if (can("admin")) pop.append(h("div", { class: "sep" }), h("button", { class: "opt danger", type: "button", onclick: () => (close(), removeDeal()) }, icon("trash"), "Удалить карточку"));
      },
      { align: "end", width: 250 },
    ),
  );
  const comp = completeness(d);
  const sub = h(
    "div",
    { class: "dr-sub" },
    h("span", null, pipelineOf(d.pipeline).label),
    d._.statusDays != null && !d._.frozen ? h("span", null, `в статусе ${d._.statusDays} ${plural(d._.statusDays, "день", "дня", "дней")}`) : null,
    d.updatedAt ? h("span", null, `изменено ${timeAgo(d.updatedAt)}${d.updatedBy ? " · " + (userName(d.updatedBy) || "") : ""}`) : null,
    h("span", { title: comp.missing.length ? "Не заполнено: " + comp.missing.join(", ") : "Все ключевые поля заполнены" }, `заполнено ${comp.pct}%`),
  );
  const tabs = h("div", { class: "dr-tabs", role: "tablist" });
  const hcount = D.history ? D.history.length : null;
  for (const [k, t] of [["overview", "Обзор"], ["details", "Детали"], ["history", "История"]]) {
    tabs.append(
      h(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-selected": String(D.tab === k),
          onclick: () => {
            D.tab = k;
            render();
            D.el.querySelector(".dr-body").scrollTop = 0;
          },
        },
        t,
        k === "history" && hcount != null ? h("span", { class: "c" }, String(hcount)) : null,
      ),
    );
  }
  return h(
    "div",
    { class: "dr-head" },
    h("div", { class: "dr-top" }, h("div", { class: "t" }, name, sub), more, h("button", { class: "btn icon sm", type: "button", "aria-label": "Закрыть", onclick: () => closeDeal() }, icon("close"))),
    h("div", { class: "dr-bar" }, stBtn, ownerBtn, d._.waiting ? h("span", { class: "flag" }, "ждёт ответа") : null, h("span", { class: "sp" }), h("span", { class: "saving" })),
    links.childNodes.length ? links : null,
    tabs,
  );
}

async function changeStatus(v) {
  const d = deal();
  if (v === d.status) return;
  const changes = { status: v };
  if (v === "contract" && !d.devStage) changes.devStage = "brief";
  if (v === "meeting") {
    const s = [...(d.steps || [])];
    s[2] = true;
    changes.steps = s;
  }
  await save(changes);
  if (v === "contract") toast("Карточка перешла в «Проекты в работе»");
  if ((v === "lost" || v === "nurture") && !deal().reason) {
    D.tab = "details";
    render();
    setTimeout(() => D?.el.querySelector("#sec-class select[aria-label='Причина отказа']")?.focus(), 80);
    toast("Укажите причину отказа — она попадёт в аналитику");
  }
}

async function removeDeal() {
  const d = deal();
  if (!(await confirmBox(`Удалить карточку «${d.name}»? Её можно будет восстановить в настройках → «Корзина».`, { danger: true, okText: "Удалить" }))) return;
  try {
    await del(`/deals/${d.id}`);
    removeLocal(d.id);
    closeDeal();
    toast("Карточка удалена");
  } catch (e) {
    errToast(e);
  }
}

function dealSummary(d) {
  const L = [`${d.name} — ${statusOf(d.status).label}`];
  if (d.contactName) L.push(`Контакт: ${d.contactName}${d.contactRole && d.contactRole !== "Не указана" ? " (" + d.contactRole + ")" : ""}`);
  if (d.phone) L.push(`Телефон: ${d.phone}`);
  if (d.telegram) L.push(`Telegram: ${d.telegram}`);
  if (d.context?.business) L.push(`Чем занимается: ${d.context.business}`);
  if (d.context?.needs) L.push(`Что нужно: ${d.context.needs}`);
  if (d.meetingAt) L.push(`Встреча: ${meetingLabel(d.meetingAt)}${d.meetingHeld ? " (проведена)" : ""}`);
  if (d.nextStep) L.push(`Следующий шаг: ${d.nextStep}`);
  return L.join("\n");
}

// ---------- вкладки ----------
function overview(d) {
  const wrap = [];
  // следующий шаг
  const next = sec(
    "Следующий шаг",
    { icon: "target", tone: "ic-5", right: d._.due ? h("span", { class: "flag" }, "срок прошёл") : null },
    h(
      "div",
      { class: "fgrid" },
      fText("Что сделать", "nextStep", { multiline: true, rows: 3, full: true, placeholder: "Например: отправить КП до пятницы" }),
      fDate("Срок", "nextStepDue"),
      h(
        "div",
        { class: "field" },
        h("span", { class: "lbl" }, "Ждёт нашего ответа"),
        switchEl(d.waiting ? "Да — клиент ждёт" : "Нет", d.waiting, (v) => {
          save({ waiting: v });
        }, "warn"),
      ),
    ),
  );
  if (ro()) next.querySelectorAll("button.toggle").forEach((b) => (b.disabled = true));
  wrap.push(next);

  // встреча
  const meetInp = h("input", { class: "input", type: "datetime-local", value: toLocalInput(d.meetingAt), readonly: ro(), "aria-label": "Дата и время встречи" });
  meetInp.addEventListener("change", () => save({ meetingAt: fromLocalInput(meetInp.value) }));
  const meetingSec = sec(
    "Встреча",
    { icon: "calendar", tone: "ic-8", right: d.meetingAt ? h("span", { class: "small" }, meetingLabel(d.meetingAt)) : null },
    h(
      "div",
      { class: "fgrid" },
      h("div", { class: "field" }, h("label", null, "Дата и время (Ташкент)"), meetInp),
      h("div", { class: "field" }, h("span", { class: "lbl" }, "Встреча проведена"), switchEl(d.meetingHeld ? "Да" : "Нет", d.meetingHeld, (v) => save({ meetingHeld: v, ...(v ? { steps: (deal().steps || []).map((x, i) => x || i === 3) } : {}) }))),
      fText("Договорённость о встрече", "agreements", { full: true, manual: true, get: (x) => x.agreements?.meeting || "", placeholder: "Где, с кем, формат" }),
    ),
  );
  // поле договорённости о встрече — сохраняем объект целиком
  const agrInput = meetingSec.querySelectorAll(".field")[2]?.querySelector("input");
  if (agrInput) {
    agrInput.addEventListener("change", () => save({ agreements: { ...(deal().agreements || {}), meeting: agrInput.value } }));
  }
  wrap.push(meetingSec);

  // контакт
  wrap.push(
    sec(
      "Контакт",
      { icon: "person", tone: "ic-7" },
      h(
        "div",
        { class: "fgrid" },
        fText("ФИО контакта", "contactName"),
        fSelect("Должность", "contactRole", S.settings.roles),
        fText("Телефон", "phone", { type: "tel", inputmode: "tel", placeholder: "+998 …" }),
        fText("Телеграм", "telegram", { placeholder: "https://t.me/username или @username" }),
        fText("Группа с клиентом", "group", { placeholder: "Ссылка на группу в Telegram" }),
        fText("Папка Google Drive", "driveUrl", { placeholder: "ТЗ, КП и договор — в одной папке" }),
      ),
    ),
  );

  // контекст
  const ctx = d.context || {};
  const ctxField = (label, k, ph, rows = 2) => {
    const ta = h("textarea", { class: "textarea", rows, placeholder: ph, readonly: ro(), "aria-label": label });
    ta.value = ctx[k] || "";
    const s = debounce(() => save({ context: { ...(deal().context || {}), [k]: ta.value } }), 1000);
    savers.set(D.id + ":context:" + k, s);
    if (!ro()) {
      ta.addEventListener("input", () => s());
      ta.addEventListener("change", () => s.flush());
      ta.addEventListener("blur", () => D?.pendingRender && setTimeout(() => !typingInside() && render(), 60));
    }
    return h("div", { class: "field full" }, h("label", null, label), ta);
  };
  wrap.push(
    sec(
      "Контекст клиента",
      { icon: "bubble", tone: "ic-4" },
      h("div", { class: "fgrid" }, ctxField("Чем занимается", "business", "Сфера, масштаб, город"), ctxField("Что им нужно", "needs", "Задача клиента своими словами", 3), ctxField("Как вышли на нас", "howFound", "Курс, рекомендация, входящий…"), ctxField("Бюджетные ожидания", "budget", "Если обсуждали", 1)),
    ),
  );

  // последние события
  const last = (D.history || []).slice(-4).reverse();
  const recent = sec(
    "Последние события",
    { icon: "history", tone: "ic-3", right: h("button", { class: "btn link", type: "button", onclick: () => ((D.tab = "history"), render()) }, "Вся история →") },
    D.history == null ? h("div", { class: "skel", style: { height: "64px" } }) : last.length ? h("div", { class: "tl" }, last.map(tlItem)) : h("p", { class: "small" }, "Событий пока нет."),
  );
  wrap.push(recent);
  return wrap;
}

function details(d) {
  const out = [];
  const isLost = ["lost", "nurture"].includes(d.status);
  out.push(
    sec(
      "Классификация",
      { id: "sec-class", icon: "grid", tone: "ic-1" },
      h(
        "div",
        { class: "fgrid" },
        fSelect("Источник", "source", S.settings.sources),
        fSelect("Отрасль", "sector", S.settings.sectors),
        fSelect("Регион", "region", S.settings.regions),
        fSelect("Формат касания", "format", S.settings.formats),
        fSelect("Приоритет", "priority", S.C.priorities.map((p) => ({ value: p.id, label: p.label }))),
        fSelect("Причина отказа", "reason", S.settings.reasons, { empty: isLost ? "— выберите причину —" : "—" }),
        fMulti("Запросы клиента", "requests", S.settings.requests),
      ),
    ),
  );
  const tgIds = fText("Telegram ID (через запятую)", "tgIds", {
    get: (x) => (x.tgIds || []).join(", "),
    manual: true,
    hint: "По этим номерам синхронизация находит карточку — не удаляйте без причины",
  });
  const tgInput = tgIds.querySelector("input");
  tgInput?.addEventListener("change", () => save({ tgIds: tgInput.value.split(/[,\s]+/).filter(Boolean) }));
  out.push(sec("Даты и связь", { icon: "clock", tone: "ic-8" }, h("div", { class: "fgrid" }, fDate("Первое касание", "firstTouch"), fDate("Последнее касание", "lastTouch"), h("div", { class: "full" }, tgIds))));

  if (d.pipeline !== "sales" || d.website || d.instagram || d.usp || d.tgChannel || d.followers) {
    const b2b = h("div", { class: "field" }, h("span", { class: "lbl" }, "B2B"), switchEl(d.b2b ? "Да" : "Нет", d.b2b, (v) => save({ b2b: v })));
    out.push(
      sec(
        "Компания в соцсетях",
        { icon: "globe", tone: "ic-4" },
        h("div", { class: "fgrid" }, fText("Сайт", "website"), fText("Instagram", "instagram"), fText("Telegram-канал", "tgChannel"), fText("Подписчики", "followers"), b2b, fText("УТП и с чем заходить", "usp", { multiline: true, rows: 3, full: true })),
      ),
    );
  }
  out.push(sec("Контакты", { icon: "people", tone: "ic-7" }, linesEditor("contacts", "Имя · должность · телефон · Telegram")));
  const steps = checklist("steps", S.C.steps);
  out.push(sec("Этапы сделки", { icon: "flow", tone: "ic-5", right: steps.cnt }, steps.bar, steps.box));
  const docs = checklist("docs", S.C.docs);
  out.push(sec("Документы", { icon: "doc", tone: "ic-9", right: docs.cnt }, h("p", { class: "small" }, "ТЗ, КП и договор храним в одной папке Google Drive — ссылка в блоке «Контакт»."), docs.box, linksEditor()));
  const ag = d.agreements || {};
  const agField = (label, k, ph) => {
    const inp = h("input", { class: "input", value: ag[k] || "", placeholder: ph, readonly: ro(), "aria-label": label });
    inp.addEventListener("change", () => save({ agreements: { ...(deal().agreements || {}), [k]: inp.value } }));
    return h("div", { class: "field" }, h("label", null, label), inp);
  };
  out.push(sec("Договорённости", { icon: "hand", tone: "ic-2" }, h("div", { class: "fgrid" }, agField("Кто отвечает со стороны клиента", "clientResponsible", "Имя, должность"), agField("Сроки", "terms", "Что и к какому числу"), agField("Периодичность связи", "cadence", "Например: раз в 2–3 дня"))));
  out.push(meetingsEditor());
  out.push(sec("Риски и стоп-факторы", { icon: "warn", tone: "ic-10" }, linesEditor("risks", "Что может помешать сделке")));
  if (["contract", "won"].includes(d.status) || d.devStage || d.amount != null || d.deadline) {
    out.push(
      sec(
        "Проект",
        { icon: "gears", tone: "ic-2" },
        h(
          "div",
          { class: "fgrid" },
          fSelect("Этап разработки", "devStage", S.C.devStages.map((s) => ({ value: s.id, label: s.label }))),
          fText("Сумма договора, $", "amount", { inputmode: "decimal", get: (x) => (x.amount ?? "") + "" }),
          fDate("Дата старта", "startDate"),
          fDate("Дедлайн", "deadline"),
        ),
      ),
    );
  } else {
    out.push(sec("Сумма", { icon: "dollar", tone: "ic-2" }, h("div", { class: "fgrid" }, fText("Сумма договора, $", "amount", { inputmode: "decimal", get: (x) => (x.amount ?? "") + "" }), fDate("Дедлайн", "deadline"))));
  }
  out.push(sec("Заметки", { icon: "note", tone: "ic-9" }, fText("Свободные заметки", "notes", { multiline: true, rows: 5, full: true, placeholder: "Всё, что не поместилось в поля выше" })));
  if (d.notion?.url) out.push(h("p", { class: "small", style: { padding: "0 6px" } }, "Перенесено из Notion · ", h("a", { href: d.notion.url, target: "_blank", rel: "noopener" }, "открыть архивную страницу")));
  return out;
}

function linksEditor() {
  const d = deal();
  const items = [...(d.links || [])];
  const list = h("div", { class: "lines" });
  const draw = () => {
    clear(list);
    items.forEach((l, i) =>
      list.append(
        h(
          "div",
          { class: "line-it" },
          icon("link"),
          h("a", { href: l.url, target: "_blank", rel: "noopener" }, l.label || l.url),
          ro() ? null : h("button", { class: "x", type: "button", "aria-label": "Удалить ссылку", onclick: () => (items.splice(i, 1), draw(), save({ links: [...items] })) }, icon("close")),
        ),
      ),
    );
  };
  draw();
  if (ro()) return list;
  const lbl = h("input", { class: "input", placeholder: "Название (КП, ТЗ, Figma…)", style: { maxWidth: "200px" } });
  const url = h("input", { class: "input", placeholder: "https://…" });
  const add = () => {
    if (!/^https?:\/\//i.test(url.value.trim())) return toast("Ссылка должна начинаться с https://", { error: true });
    items.push({ label: lbl.value.trim() || "Документ", url: url.value.trim() });
    lbl.value = url.value = "";
    draw();
    save({ links: [...items] });
  };
  url.addEventListener("keydown", (e) => e.key === "Enter" && add());
  return h("div", { style: { display: "grid", gap: "8px" } }, list, h("div", { class: "addline", style: { flexWrap: "wrap" } }, lbl, url, h("button", { class: "btn sm", type: "button", onclick: add }, icon("plus"), "Ссылка")));
}

function meetingsEditor() {
  const d = deal();
  const items = [...(d.meetings || [])];
  const box = h("div", { style: { display: "grid", gap: "10px" } });
  const draw = () => {
    clear(box);
    if (!items.length) box.append(h("p", { class: "small" }, "Записей со встреч пока нет."));
    items.forEach((m, i) => {
      box.append(
        h(
          "div",
          { class: "line-it", style: { display: "grid", gap: "4px" } },
          h("b", null, m.date ? dFull(m.date) : "Без даты"),
          m.discussed ? h("span", null, h("span", { class: "muted" }, "Обсудили: "), m.discussed) : null,
          m.decided ? h("span", null, h("span", { class: "muted" }, "Решили: "), m.decided) : null,
          m.next ? h("span", null, h("span", { class: "muted" }, "Дальше: "), m.next) : null,
          ro() ? null : h("button", { class: "btn link", type: "button", style: { justifySelf: "start", color: "var(--danger-ink)" }, onclick: () => (items.splice(i, 1), draw(), save({ meetings: [...items] })) }, "Удалить запись"),
        ),
      );
    });
  };
  draw();
  const add = ro()
    ? null
    : h("button", {
        class: "btn sm",
        type: "button",
        onclick: () => {
          const date = h("input", { class: "input", type: "date", value: todayTash() });
          const a = h("textarea", { class: "textarea", rows: 2, placeholder: "Что обсудили" });
          const b = h("textarea", { class: "textarea", rows: 2, placeholder: "Что решили" });
          const c = h("input", { class: "input", placeholder: "Следующий шаг и когда" });
          const form = h(
            "div",
            { class: "composer" },
            h("div", { class: "fgrid" }, h("div", { class: "field" }, h("label", null, "Дата"), date), h("div"), h("div", { class: "field full" }, a), h("div", { class: "field full" }, b), h("div", { class: "field full" }, c)),
            h(
              "div",
              { class: "row3" },
              h("button", {
                class: "btn ink sm",
                type: "button",
                onclick: () => {
                  items.unshift({ date: date.value, discussed: a.value.trim(), decided: b.value.trim(), next: c.value.trim() });
                  form.remove();
                  draw();
                  save({ meetings: [...items], ...(c.value.trim() ? { nextStep: c.value.trim() } : {}) });
                },
              }, "Сохранить"),
              h("button", { class: "btn sm", type: "button", onclick: () => form.remove() }, "Отмена"),
            ),
          );
          box.prepend(form);
          a.focus();
        },
      }, icon("plus"), "Запись");
  return sec("Заметки со встреч", { icon: "calendar", tone: "ic-8", right: add }, box);
}

// ---------- история ----------
const KIND = {
  telegram: { ic: "telegram", label: "Переписка" },
  note: { ic: "note", label: "Заметка" },
  call: { ic: "phone", label: "Звонок" },
  meeting: { ic: "people", label: "Встреча" },
  email: { ic: "mail", label: "Письмо" },
  status: { ic: "flow", label: "Статус" },
  change: { ic: "pencil", label: "Изменение" },
  system: { ic: "sparkle", label: "Система" },
};

function tlItem(it) {
  const k = KIND[it.kind] || KIND.note;
  const sys = ["status", "change", "system"].includes(it.kind);
  const who = it.by === "sync" ? "Синхронизация" : it.by === "import" ? "Перенос из Notion" : userName(it.by);
  const date = it.label || (it.at ? (sys ? timeAgo(it.at) : dFull(it.at.slice(0, 10))) : "");
  const mine = it.by && it.by === S.me.id;
  const actions = h("span", { class: "tl-act" });
  if (!sys && (mine || can("admin"))) {
    actions.append(
      h("button", { class: "btn icon xs", type: "button", "aria-label": "Изменить", onclick: () => editItem(it) }, icon("pencil")),
      h("button", { class: "btn icon xs", type: "button", "aria-label": "Удалить", onclick: () => deleteItem(it) }, icon("trash")),
    );
  }
  return h(
    "div",
    { class: "tl-it" + (sys ? " sys" : "") },
    h("span", { class: "tl-ic " + it.kind }, icon(k.ic)),
    h("div", { class: "tl-b" }, h("div", { class: "tl-m" }, h("b", null, k.label), date ? h("span", null, date) : null, who ? h("span", null, who) : null, it.editedAt ? h("span", null, "изменено") : null, actions), h("div", { class: "tl-t" }, richText(it.text))),
  );
}

async function loadHistory(quiet) {
  if (!D) return;
  const id = D.id;
  try {
    const r = await get(`/deals/${id}/history`);
    if (!D || D.id !== id) return;
    D.history = r.items;
    if (!typingInside()) render();
    else D.pendingRender = true;
  } catch (e) {
    if (!quiet) errToast(e, "Не удалось загрузить историю");
  }
}

function historyTab(d) {
  const out = [];
  if (can("write")) {
    const kind = { v: "note" };
    const ta = h("textarea", { class: "textarea", rows: 3, placeholder: "Что произошло? Например: «Позвонил, договорились о встрече в пятницу в 11:00»" });
    const date = h("input", { class: "input", type: "date", value: todayTash(), style: { width: "auto" } });
    const kinds = h("div", { class: "seg" });
    for (const [k, l] of [["note", "Заметка"], ["call", "Звонок"], ["meeting", "Встреча"], ["telegram", "Переписка"], ["email", "Письмо"]]) {
      kinds.append(h("button", { type: "button", "aria-pressed": String(k === kind.v), onclick: (e) => (kind.v = k, [...kinds.children].forEach((b) => b.setAttribute("aria-pressed", String(b === e.currentTarget)))) }, l));
    }
    const answered = { v: !!d.waiting };
    const ans = d.waiting ? switchEl("Клиент получил ответ — снять «ждёт ответа»", true, (v) => (answered.v = v)) : null;
    const btn = h("button", { class: "btn ink sm", type: "button" }, icon("send"), "Добавить");
    btn.addEventListener("click", async () => {
      const text = ta.value.trim();
      if (!text) return ta.focus();
      btn.classList.add("is-busy");
      try {
        const r = await post(`/deals/${d.id}/history`, { text, kind: kind.v, date: date.value, answered: answered.v, touch: kind.v !== "note" });
        D.history = [...(D.history || []), r.item].sort((a, b) => (a.at < b.at ? -1 : 1));
        ta.value = "";
        if (answered.v && deal().waiting) {
          const x = deal();
          x.waiting = false;
          enrich(x);
        }
        toast("Запись добавлена");
        render();
        const { poll } = await import("./state.js");
        poll();
      } catch (e) {
        errToast(e);
      } finally {
        btn.classList.remove("is-busy");
      }
    });
    ta.addEventListener("keydown", (e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && btn.click());
    out.push(h("div", { class: "composer" }, ta, h("div", { class: "row3" }, kinds, date), h("div", { class: "row3" }, ans, h("span", { style: { flex: 1 } }), btn)));
  }
  if (D.history == null) {
    out.push(h("div", { class: "skel", style: { height: "120px" } }));
    return out;
  }
  const filter = D.hfilter || "all";
  const fl = h("div", { class: "seg" });
  const counts = { all: D.history.length, talk: D.history.filter((x) => !["status", "change", "system"].includes(x.kind)).length, sys: D.history.filter((x) => ["status", "change", "system"].includes(x.kind)).length };
  for (const [k, l] of [["all", "Все"], ["talk", "Общение"], ["sys", "Изменения"]]) fl.append(h("button", { type: "button", "aria-pressed": String(k === filter), onclick: () => ((D.hfilter = k), render()) }, l, h("span", { class: "c" }, String(counts[k]))));
  out.push(fl);
  const items = D.history
    .filter((x) => filter === "all" || (filter === "talk" ? !["status", "change", "system"].includes(x.kind) : ["status", "change", "system"].includes(x.kind)))
    .slice()
    .reverse();
  out.push(items.length ? h("div", { class: "sec" }, h("div", { class: "tl" }, items.map(tlItem))) : h("p", { class: "small" }, "Записей нет."));
  return out;
}

async function editItem(it) {
  const ta = h("textarea", { class: "textarea", rows: 4 });
  ta.value = it.text;
  const { modal } = await import("./ui.js");
  const m = modal({
    title: "Изменить запись",
    body: ta,
    footer: [
      h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Отмена"),
      h("button", {
        class: "btn ink",
        type: "button",
        onclick: async () => {
          try {
            const r = await patch(`/deals/${D.id}/history/${it.id}`, { text: ta.value });
            Object.assign(it, r.item);
            m.close();
            render();
          } catch (e) {
            errToast(e);
          }
        },
      }, "Сохранить"),
    ],
  });
}
async function deleteItem(it) {
  if (!(await confirmBox("Удалить эту запись из истории?", { danger: true, okText: "Удалить" }))) return;
  try {
    await del(`/deals/${D.id}/history/${it.id}`);
    D.history = D.history.filter((x) => x.id !== it.id);
    render();
  } catch (e) {
    errToast(e);
  }
}

// ---------- отрисовка ----------
function render() {
  if (!D) return;
  const d = deal();
  if (!d) return closeDeal();
  closePop();
  const oldBody = D.el.querySelector(".dr-body");
  const scroll = oldBody ? oldBody.scrollTop : 0;
  const body = h("div", { class: "dr-body" });
  const parts = D.tab === "details" ? details(d) : D.tab === "history" ? historyTab(d) : overview(d);
  body.append(...parts.filter(Boolean));
  clear(D.el).append(header(d), body);
  body.querySelectorAll("textarea.textarea").forEach((ta) => fitTextarea(ta));
  body.scrollTop = scroll;
  D.pendingRender = false;
}
