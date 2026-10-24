/* Общие компоненты интерфейса: чипы, аватары, всплывающие меню, модальные окна, уведомления. */
import { h, icon, clear, initials, plural, $ } from "./core.js";
import { S, statusOf, userName } from "./state.js";

export function statusChip(id, extra = "") {
  const s = statusOf(id);
  return h("span", { class: `chip st-${s.id} ${extra}` }, s.label);
}

export function avatar(uid, cls = "") {
  if (uid === "sync") return h("span", { class: `avatar sync ${cls}`, title: "Синхронизация Telegram" }, icon("telegram"));
  const u = S.usersById.get(uid);
  if (!u) return h("span", { class: `avatar ${cls}`, style: { "--c": "#9a9aa2" }, title: userName(uid) || "Не назначен" }, uid === "import" ? "N" : "—");
  return h("span", { class: `avatar ${cls}`, style: { "--c": u.color }, title: u.name }, initials(u.name));
}

export function idlePill(d) {
  const i = d._?.idle;
  if (i == null) return h("span", { class: "idle na" }, "—");
  return h("span", { class: "idle " + (i <= 3 ? "ok" : i <= 7 ? "warn" : "bad"), title: "Дней без движения" }, i === 0 ? "сегодня" : i + " дн.");
}

export function waitPill(d) {
  const i = d._?.idle;
  if (i == null) return h("span", { class: "idle na" }, "—");
  if (i === 0) return h("span", { class: "idle new" }, "с сегодня");
  if (i === 1) return h("span", { class: "idle warn" }, "со вчера");
  return h("span", { class: "idle " + (i <= 3 ? "warn" : "bad") }, `${i} ${plural(i, "день", "дня", "дней")}`);
}

// ---------- уведомления ----------
export function toast(msg, { error = false, action, actionText, ms = 3800 } = {}) {
  const box = $("#toasts");
  if (!box) return;
  const t = h("div", { class: "toast" + (error ? " err" : ""), role: "status" }, icon(error ? "warn" : "check"), h("span", null, msg));
  if (action) t.append(h("button", { type: "button", onclick: () => (action(), t.remove()) }, actionText || "Повторить"));
  box.append(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s, transform .3s";
    t.style.opacity = "0";
    t.style.transform = "translateY(8px)";
    setTimeout(() => t.remove(), 320);
  }, ms);
}
export function errToast(e, fallback = "Не удалось сохранить") {
  toast(e?.message || fallback, { error: true, ms: 5200 });
}

// ---------- всплывающее меню ----------
let openPop = null;
export function closePop() {
  if (openPop) {
    openPop.cleanup();
    openPop = null;
  }
}
export function popover(anchor, build, { align = "start", width } = {}) {
  closePop();
  const pop = h("div", { class: "pop", role: "menu" });
  if (width) pop.style.minWidth = width + "px";
  build(pop, closePop);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = align === "end" ? r.right - pw : r.left;
  left = Math.max(10, Math.min(left, window.innerWidth - pw - 10));
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 10 && r.top - ph - 6 > 10) top = r.top - ph - 6;
  pop.style.left = left + "px";
  pop.style.top = Math.max(10, top) + "px";
  const onDoc = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) closePop();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closePop();
      anchor.focus?.();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const opts = [...pop.querySelectorAll(".opt")];
      if (!opts.length) return;
      e.preventDefault();
      let i = opts.indexOf(document.activeElement);
      i = e.key === "ArrowDown" ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
      opts[i].focus();
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", closePop, { once: true });
  openPop = {
    cleanup() {
      document.removeEventListener("pointerdown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
      pop.remove();
    },
  };
  pop.querySelector(".opt[aria-selected='true'], .opt, input")?.focus({ preventScroll: true });
  return pop;
}
/** Выпадающий список вариантов. options: [{value,label,dot?,icon?,danger?} | "sep" | {head}] */
export function pick(anchor, options, current, onPick, opts = {}) {
  return popover(
    anchor,
    (pop, close) => {
      for (const o of options) {
        if (o === "sep") {
          pop.append(h("div", { class: "sep" }));
          continue;
        }
        if (o.head) {
          pop.append(h("div", { class: "hd" }, o.head));
          continue;
        }
        pop.append(
          h(
            "button",
            {
              type: "button",
              class: "opt" + (o.danger ? " danger" : ""),
              role: "menuitemradio",
              "aria-selected": String(o.value === current),
              onclick: () => {
                close();
                onPick(o.value);
              },
            },
            o.dot ? h("span", { class: "dot-st " + o.dot }) : null,
            o.icon ? icon(o.icon) : null,
            o.avatar !== undefined ? avatar(o.avatar, "sm") : null,
            h("span", null, o.label),
          ),
        );
      }
    },
    opts,
  );
}

// ---------- модальные окна ----------
export function modal({ title, body, footer, wide = false, onClose, className = "" }) {
  const wrap = h("div", { class: "modal-wrap", role: "dialog", "aria-modal": "true" });
  const box = h("div", { class: `modal ${wide ? "wide" : ""} ${className}` });
  const close = () => {
    wrap.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
    prevFocus?.focus?.();
  };
  const prevFocus = document.activeElement;
  if (title) box.append(h("div", { class: "modal-h" }, h("h2", null, title), h("button", { class: "btn icon sm", type: "button", "aria-label": "Закрыть", onclick: close }, icon("close"))));
  if (body) box.append(body);
  if (footer) box.append(h("div", { class: "modal-f" }, footer));
  wrap.append(box);
  wrap.addEventListener("pointerdown", (e) => {
    if (e.target === wrap) close();
  });
  const onKey = (e) => {
    if (e.key === "Escape" && !document.querySelector(".pop")) close();
  };
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  setTimeout(() => box.querySelector("input:not([type=hidden]), textarea, select, button.btn.brand, button.btn.ink")?.focus(), 30);
  return { close, box, wrap };
}

export function confirmBox(text, { title = "Подтвердите действие", okText = "Да", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      body: h("p", { class: "lead" }, text),
      footer: [
        h("button", { class: "btn", type: "button", onclick: () => ((done = true), m.close(), resolve(false)) }, "Отмена"),
        h("button", { class: "btn " + (danger ? "danger" : "ink"), type: "button", onclick: () => ((done = true), m.close(), resolve(true)) }, okText),
      ],
      onClose: () => !done && resolve(false),
    });
  });
}

export async function copyText(text, okMsg = "Скопировано") {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return true;
  } catch {
    const ta = h("textarea", { class: "textarea", readonly: true, style: { minHeight: "160px" } });
    ta.value = text;
    modal({ title: "Скопируйте текст", body: ta });
    setTimeout(() => ta.select(), 50);
    return false;
  }
}

export function switchEl(label, checked, onChange, cls = "") {
  const b = h("button", { type: "button", class: "toggle " + cls, role: "switch", "aria-checked": String(!!checked) }, h("span", { class: "switch" }), label ? h("span", null, label) : null);
  b.addEventListener("click", () => {
    const v = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(v));
    onChange(v);
  });
  return b;
}

export function seg(items, current, onPick, label) {
  const g = h("div", { class: "seg", role: "group", "aria-label": label || "" });
  for (const it of items) {
    g.append(
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(it.value === current),
          onclick: () => {
            for (const b of g.children) b.setAttribute("aria-pressed", "false");
            g.querySelector(`[data-v="${CSS.escape(String(it.value))}"]`)?.setAttribute("aria-pressed", "true");
            onPick(it.value);
          },
          "data-v": String(it.value),
        },
        it.label,
        it.count != null ? h("span", { class: "c" }, String(it.count)) : null,
      ),
    );
  }
  return g;
}

export function emptyState(ic, title, text, action) {
  return h("div", { class: "empty-big" }, h("span", { class: "app-icon lg ic-5" }, icon(ic)), h("b", { class: "h3" }, title), text ? h("p", { class: "muted" }, text) : null, action || null);
}

export function sectionCard({ ic, tone = "ic-1", title, count, sub, hot, right }) {
  const card = h("article", { class: "glass pad" });
  card.append(
    h(
      "div",
      { class: "card-h" },
      ic ? h("span", { class: "app-icon " + tone }, icon(ic)) : null,
      h("h3", { class: "h3" }, title),
      right || null,
      count != null ? h("span", { class: "count" + (hot && count ? " hot" : "") }, String(count)) : null,
    ),
  );
  if (sub) card.append(h("p", { class: "card-sub" }, sub));
  return card;
}

export function busy(btn, on) {
  if (!btn) return;
  btn.classList.toggle("is-busy", !!on);
  btn.disabled = !!on;
}

export { clear };
