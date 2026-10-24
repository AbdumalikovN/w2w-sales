/* «Воронка»: канбан по статусам с перетаскиванием карточек. */
import { h, icon, clear, money, meetingLabel, dShort, dFull, store, lc } from "../core.js";
import { S, can, updateDeal, statusOf, pipelineOf, userName } from "../state.js";
import { avatar, idlePill, toast, errToast, pick, seg } from "../ui.js";
import { matchQuery } from "../logic.js";

const MAIN = ["potential", "research", "meeting", "tz", "kp", "sale", "waiting", "nurture"];
const TAIL = ["contract", "won", "lost", "archive"];
let ctx = null;
let F = store.json("w2w-board-f", { q: "", owner: "", source: "", sector: "", region: "", waiting: false });
let drag = null;

const collapsedKey = () => "w2w-board-collapsed-" + S.ui.pipeline;
const getCollapsed = () => new Set(store.json(collapsedKey(), S.ui.pipeline === "archive" ? [] : TAIL));

async function openDeal(id) {
  const m = await import("../main.js");
  m.go("board", { d: id });
}

export function mount(c) {
  ctx = c;
  drawTop();
  drawBoard();
  return () => {
    ctx = null;
    endDrag(true);
  };
}
export function update(what) {
  if (!ctx || drag) return;
  drawTop(true);
  drawBoard();
}

function saveF() {
  store.setJson("w2w-board-f", F);
}

function filtered() {
  const q = F.q.trim();
  return [...S.deals.values()].filter(
    (d) =>
      d.pipeline === S.ui.pipeline &&
      (!q || matchQuery(d, q)) &&
      (!F.owner || (F.owner === "me" ? d.owner === S.me.id : d.owner === F.owner)) &&
      (!F.source || d.source === F.source) &&
      (!F.sector || d.sector === F.sector) &&
      (!F.region || d.region === F.region) &&
      (!F.waiting || d._.waiting),
  );
}

function filterBtn(label, key, options) {
  const cur = F[key];
  const curLabel = cur ? (options.find((o) => o.value === cur)?.label || cur) : label;
  const b = h("button", { class: "fbtn" + (cur ? " on" : ""), type: "button", "aria-haspopup": "menu" }, curLabel, icon("chevron"));
  b.addEventListener("click", () =>
    pick(b, [{ value: "", label: "Все" }, "sep", ...options], cur, (v) => {
      F[key] = v;
      saveF();
      drawTop(true);
      drawBoard();
    }),
  );
  return b;
}

let searchEl = null;
function drawTop(keepSearch) {
  const { top } = ctx;
  const p = pipelineOf(S.ui.pipeline);
  if (keepSearch && searchEl && document.activeElement === searchEl) {
    // не трогаем шапку, пока человек печатает
    return;
  }
  const n = filtered().length;
  searchEl = h("input", { type: "search", placeholder: "Поиск по воронке", value: F.q, "aria-label": "Поиск по воронке" });
  let t;
  searchEl.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      F.q = searchEl.value;
      saveF();
      drawBoard();
    }, 160);
  });
  const owners = [{ value: "me", label: "Мои сделки" }, ...S.users.filter((u) => u.active).map((u) => ({ value: u.id, label: u.name }))];
  const opts = (arr) => arr.map((x) => ({ value: x, label: x }));
  const anyF = F.owner || F.source || F.sector || F.region || F.waiting || F.q;
  clear(top).append(
    h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, `Воронка · ${n} ${n === 1 ? "сделка" : "сделок"}`), h("h1", { class: "h1" }, p.label)),
    h(
      "div",
      { class: "acts" },
      seg(
        S.settings.pipelines.map((x) => ({ value: x.id, label: x.label })),
        S.ui.pipeline,
        async (v) => {
          S.ui.pipeline = v;
          store.set("w2w-pipeline", v);
          drawTop();
          drawBoard();
          (await import("../main.js")).drawChrome();
        },
        "Воронка",
      ),
      can("write") ? h("button", { class: "btn brand desk-only", type: "button", onclick: async () => (await import("../newdeal.js")).newDealModal({ pipeline: S.ui.pipeline }) }, icon("plus"), "Сделка") : null,
    ),
    h(
      "div",
      { class: "toolbar", style: { width: "100%" } },
      h("label", { class: "search" }, icon("search"), searchEl),
      filterBtn("Ответственный", "owner", owners),
      filterBtn("Источник", "source", opts(S.settings.sources)),
      filterBtn("Отрасль", "sector", opts(S.settings.sectors)),
      filterBtn("Регион", "region", opts(S.settings.regions)),
      h(
        "button",
        {
          class: "fbtn" + (F.waiting ? " on" : ""),
          type: "button",
          onclick: () => {
            F.waiting = !F.waiting;
            saveF();
            drawTop();
            drawBoard();
          },
        },
        icon("bubble"),
        "Ждут ответа",
      ),
      anyF
        ? h(
            "button",
            {
              class: "btn link",
              type: "button",
              onclick: () => {
                F = { q: "", owner: "", source: "", sector: "", region: "", waiting: false };
                saveF();
                drawTop();
                drawBoard();
              },
            },
            "Сбросить фильтры",
          )
        : null,
    ),
  );
}

function sortCol(a, b) {
  return b._.waiting - a._.waiting || (b.lastTouch || b.updatedAt || "").localeCompare(a.lastTouch || a.updatedAt || "");
}

function drawBoard() {
  if (!ctx) return;
  const { page } = ctx;
  const wrapOld = page.querySelector(".board-wrap");
  const scrollX = wrapOld ? wrapOld.scrollLeft : 0;
  const colScroll = {};
  wrapOld?.querySelectorAll(".col").forEach((c) => (colScroll[c.dataset.st] = c.querySelector(".col-b")?.scrollTop || 0));
  const list = filtered();
  const by = {};
  for (const d of list) (by[d.status] ||= []).push(d);
  const collapsed = getCollapsed();
  const board = h("div", { class: "board" });
  for (const st of [...MAIN, ...TAIL]) {
    const s = statusOf(st);
    const items = (by[st] || []).sort(sortCol);
    const sum = items.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const mini = collapsed.has(st);
    const col = h("section", { class: "col" + (mini ? " mini" : ""), "data-st": st, "aria-label": s.label });
    const toggle = () => {
      const c = getCollapsed();
      if (c.has(st)) c.delete(st);
      else c.add(st);
      store.setJson(collapsedKey(), [...c]);
      drawBoard();
    };
    const head = h(
      "div",
      { class: "col-h", title: mini ? "Развернуть колонку" : "" },
      h("span", { class: "dot-st " + st }),
      h("b", null, s.label),
      h("span", { class: "n" }, String(items.length)),
      !mini && sum ? h("span", { class: "sum" }, money(sum)) : null,
      !mini
        ? h("button", { class: "add", type: "button", "aria-label": TAIL.includes(st) ? "Свернуть колонку" : "Добавить сделку в этот статус", onclick: TAIL.includes(st) ? toggle : async () => (await import("../newdeal.js")).newDealModal({ pipeline: S.ui.pipeline, status: st }) }, icon(TAIL.includes(st) ? "minus" : "plus"))
        : null,
    );
    if (mini) col.addEventListener("click", toggle);
    const body = h("div", { class: "col-b" });
    if (!mini) {
      for (const d of items) body.append(card(d));
      if (!items.length) body.append(h("p", { class: "small", style: { padding: "8px 6px", textAlign: "center" } }, F.q || F.owner || F.source || F.sector || F.region || F.waiting ? "Нет сделок по фильтру" : "Пусто"));
    }
    col.append(head, body);
    board.append(col);
  }
  const wrap = h("div", { class: "board-wrap" }, board);
  clear(page).append(wrap);
  wrap.scrollLeft = scrollX;
  wrap.querySelectorAll(".col").forEach((c) => {
    const b = c.querySelector(".col-b");
    if (b && colScroll[c.dataset.st]) b.scrollTop = colScroll[c.dataset.st];
  });
  page.append(
    h(
      "p",
      { class: "foot" },
      S.ui.pipeline === "archive"
        ? "«Архив 2025» — карточки старой CRM из Notion, сохранены как история. Счётчики «без движения» и напоминания здесь выключены, в «Сегодня» и «Проекты в работе» архив не попадает. Чтобы вернуть клиента в работу, откройте карточку → «⋯» → «Перенести в воронку»."
        : "Перетащите карточку в другую колонку, чтобы сменить статус. На телефоне — удерживайте карточку полсекунды. Договоры уходят в «Проекты в работе». Цвет полоски дней: зелёный — до 3 дней без движения, жёлтый — 4–7, красный — больше недели.",
    ),
  );
}

/** Карточки «Архива 2025» без счётчика дней: показываем дедлайн или наличие заметок. */
function frozenTag(d) {
  if (d.deadline) return h("span", { class: "tag", title: "Дедлайн" }, icon("clock"), dFull(d.deadline));
  if (d.notes) return h("span", { class: "tag", title: "Есть заметки из Notion" }, icon("note"), "заметки");
  return h("span", { class: "idle na" }, "архив");
}

function card(d) {
  const meetSoon = d._.meetingDate && d._.meetingDate >= S.today && !d.meetingHeld;
  const el = h(
    "button",
    { class: "dcard" + (d._.waiting ? " is-waiting" : ""), type: "button", "data-id": d.id, "aria-label": d.name },
    h("div", { class: "t" }, d.priority ? h("span", { class: "prio " + d.priority, title: "Приоритет" }) : null, h("b", null, d.name), d._.waiting ? h("span", { class: "flag" }, "ждёт") : null),
    d.contactName || d.region || d.sector ? h("div", { class: "who" }, [d.contactName, d.sector, d.region].filter(Boolean).join(" · ")) : null,
    d.nextStep ? h("div", { class: "nx" + (d._.due ? " due" : "") }, h("span", null, d.nextStep)) : null,
    h(
      "div",
      { class: "ft" },
      d._.frozen ? frozenTag(d) : idlePill(d),
      meetSoon ? h("span", { class: "tag", title: "Встреча" }, icon("calendar"), meetingLabel(d.meetingAt)) : null,
      d.amount ? h("span", { class: "amt" }, money(d.amount)) : null,
      d._.due ? h("span", { class: "tag", style: { color: "var(--danger-ink)" } }, icon("clock"), dShort(d.nextStepDue)) : null,
      avatar(d.owner, "sm"),
    ),
  );
  el.addEventListener("pointerdown", (e) => startPress(e, d, el));
  el.addEventListener("click", (e) => {
    if (el.dataset.dragged) {
      delete el.dataset.dragged;
      e.preventDefault();
      return;
    }
    openDeal(d.id);
  });
  el.addEventListener("keydown", (e) => {
    if (!can("write")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // смена статуса с клавиатуры
      e.preventDefault();
      const order = [...MAIN, ...TAIL];
      const i = order.indexOf(d.status);
      const next = order[i + (e.key === "ArrowRight" ? 1 : -1)];
      if (next) moveTo(d, next);
    }
  });
  return el;
}

// ---------- перетаскивание ----------
function startPress(e, d, el) {
  if (!can("write") || e.button > 0) return;
  const touch = e.pointerType === "touch";
  const p = { d, el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false, id: e.pointerId, touch, timer: null };
  drag = p;
  if (touch) {
    p.timer = setTimeout(() => {
      if (drag === p && Math.hypot(p.x - p.x0, p.y - p.y0) < 10) begin(p);
    }, 380);
  }
  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
function begin(p) {
  p.active = true;
  const r = p.el.getBoundingClientRect();
  p.dx = p.x0 - r.left;
  p.dy = p.y0 - r.top;
  p.ghost = p.el.cloneNode(true);
  p.ghost.classList.add("ghost");
  p.ghost.style.width = r.width + "px";
  document.body.append(p.ghost);
  p.el.classList.add("is-drag");
  document.body.style.userSelect = "none";
  if (navigator.vibrate && p.touch) navigator.vibrate(12);
  place(p);
}
function place(p) {
  if (!p.ghost) return;
  p.ghost.style.left = p.x - p.dx + "px";
  p.ghost.style.top = p.y - p.dy + "px";
  const under = document.elementFromPoint(p.x, p.y);
  const col = under?.closest?.(".col");
  ctx?.page.querySelectorAll(".col.is-over").forEach((c) => c !== col && c.classList.remove("is-over"));
  if (col && col.dataset.st !== p.d.status) col.classList.add("is-over");
  p.over = col?.dataset.st || null;
  // автопрокрутка доски и колонки
  const wrap = ctx?.page.querySelector(".board-wrap");
  if (wrap) {
    const wr = wrap.getBoundingClientRect();
    cancelAnimationFrame(p.raf);
    const edge = 70;
    const vx = p.x < wr.left + edge ? -14 : p.x > wr.right - edge ? 14 : 0;
    const body = col?.querySelector(".col-b");
    let vy = 0;
    if (body) {
      const br = body.getBoundingClientRect();
      vy = p.y < br.top + 40 ? -10 : p.y > br.bottom - 40 ? 10 : 0;
    }
    if (vx || vy) {
      const step = () => {
        if (!drag?.active) return;
        if (vx) wrap.scrollLeft += vx;
        if (vy && body) body.scrollTop += vy;
        p.raf = requestAnimationFrame(step);
      };
      p.raf = requestAnimationFrame(step);
    }
  }
}
function onMove(e) {
  const p = drag;
  if (!p || e.pointerId !== p.id) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (!p.active) {
    const dist = Math.hypot(p.x - p.x0, p.y - p.y0);
    if (p.touch) {
      if (dist > 10) cleanupListeners(), clearTimeout(p.timer), (drag = null);
      return;
    }
    if (dist > 5) begin(p);
    else return;
  }
  e.preventDefault();
  place(p);
}
function onUp(e) {
  const p = drag;
  if (!p || e.pointerId !== p.id) return;
  const target = p.over;
  const was = p.active;
  endDrag();
  if (was) {
    p.el.dataset.dragged = "1";
    setTimeout(() => delete p.el.dataset.dragged, 50);
    if (target && target !== p.d.status) moveTo(p.d, target);
  }
}
function onCancel() {
  endDrag();
}
function cleanupListeners() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onCancel);
}
function endDrag(silent) {
  const p = drag;
  drag = null;
  cleanupListeners();
  if (!p) return;
  clearTimeout(p.timer);
  cancelAnimationFrame(p.raf);
  p.ghost?.remove();
  p.el.classList.remove("is-drag");
  document.body.style.userSelect = "";
  if (!silent) ctx?.page.querySelectorAll(".col.is-over").forEach((c) => c.classList.remove("is-over"));
}

function moveTo(d, st) {
  const from = statusOf(d.status).label, to = statusOf(st).label;
  const changes = { status: st };
  if (st === "contract" && !d.devStage) changes.devStage = "brief";
  updateDeal(d.id, changes)
    .then(() =>
      toast(st === "contract" ? `«${d.name}» → «Проекты в работе»` : `«${d.name}»: ${from} → ${to}`, {
        action: () => updateDeal(d.id, { status: Object.keys(S.C.statuses).length ? statusFromLabel(from) : d.status }),
        actionText: "Отменить",
      }),
    )
    .catch(errToast);
  if (["lost", "nurture"].includes(st) && !d.reason) setTimeout(() => openDeal(d.id), 250);
}
function statusFromLabel(label) {
  return S.C.statuses.find((s) => s.label === label)?.id;
}
