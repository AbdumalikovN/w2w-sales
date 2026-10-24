/* Точка входа: вход, каркас приложения, маршрутизация. */
import { h, icon, clear, $, store, followLight, initials, timeAgo, svgMark } from "./core.js";
import { get, post, setUnauthorizedHandler, ApiError } from "./api.js";
import { S, bootstrap, subscribe, startPolling, stopPolling, can, dealsIn, allDeals } from "./state.js";
import { toast, popover, modal, busy, errToast, closePop } from "./ui.js";
import { openDeal, closeDeal, currentDealId } from "./deal.js";
import { openPalette } from "./palette.js";
import { newDealModal } from "./newdeal.js";
import { passwordModal } from "./views/settings.js";

const VIEWS = {
  today: { title: "Сегодня", icon: "sparkle", tone: "ic-5", load: () => import("./views/today.js") },
  board: { title: "Воронка", icon: "kanban", tone: "ic-1", load: () => import("./views/board.js") },
  deals: { title: "Сделки", icon: "table", tone: "ic-4", load: () => import("./views/deals.js") },
  projects: { title: "Проекты", icon: "gears", tone: "ic-2", load: () => import("./views/projects.js") },
  analytics: { title: "Аналитика", icon: "chart", tone: "ic-8", load: () => import("./views/analytics.js") },
  base: { title: "База курса", icon: "people", tone: "ic-7", load: () => import("./views/base.js") },
  settings: { title: "Настройки", icon: "shield", tone: "ic-6", load: () => import("./views/settings.js"), admin: true },
};
const PIPE_COLORS = ["#0abcf3", "#ff9f43", "#07e7b7", "#9a9aa2", "#7a6cff", "#ff6b9a"];
export const pipeColor = (id) => PIPE_COLORS[Math.max(0, S.settings?.pipelines.findIndex((p) => p.id === id) ?? 0) % PIPE_COLORS.length];

const root = $("#root");
let current = { name: null, view: null, unmount: null };

// ---------- тема ----------
export function setTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set("w2w-theme", t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#08090b" : "#f2f3f5");
}
export const toggleTheme = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ---------- маршрут ----------
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs] = raw.split("?");
  const name = VIEWS[path] ? path : "today";
  return { name, params: new URLSearchParams(qs || "") };
}
export function go(name, params = {}) {
  const p = new URLSearchParams(params);
  const s = p.toString();
  location.hash = "#/" + name + (s ? "?" + s : "");
}
/** Меняет параметры текущего маршрута без перезагрузки вида */
export function setParam(key, value) {
  const { name, params } = parseHash();
  if (value == null || value === "") params.delete(key);
  else params.set(key, value);
  const s = params.toString();
  history.replaceState(null, "", "#/" + name + (s ? "?" + s : ""));
}

// ---------- вход ----------
function renderLogin(msg) {
  stopPolling();
  closeDeal(true);
  document.body.classList.remove("app");
  clear(root);
  const login = h("input", { class: "input", id: "lg", name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true });
  const pass = h("input", { class: "input", id: "pw", name: "password", type: "password", autocomplete: "current-password", required: true });
  const remember = { v: true };
  const err = h("p", { class: "gate-err", role: "alert" }, msg || "");
  const btn = h("button", { class: "btn brand", type: "submit" }, "Войти");
  const rem = h("button", { type: "button", class: "toggle", role: "switch", "aria-checked": "true" }, h("span", { class: "switch" }), h("span", null, "Запомнить на 30 дней"));
  rem.addEventListener("click", () => {
    remember.v = !remember.v;
    rem.setAttribute("aria-checked", String(remember.v));
  });
  const form = h(
    "form",
    { class: "gate-card", autocomplete: "on" },
    h("div", { class: "brandline" }, svgMark(), "Win to Win", h("span", { class: "tag" }, "CRM")),
    h("div", { style: { display: "grid", gap: "10px" } }, h("span", { class: "eyebrow" }, "Отдел продаж W2W"), h("h1", null, "Клиенты, сделки и проекты — ", h("span", { class: "hl" }, "в одном месте")), h("p", null, "Войдите под своим логином. Если доступа нет — попросите администратора добавить вас.")),
    h("div", { class: "field" }, h("label", { for: "lg" }, "Логин"), login),
    h("div", { class: "field" }, h("label", { for: "pw" }, "Пароль"), pass),
    rem,
    btn,
    err,
    h("p", { class: "gate-foot" }, "Конфиденциально · только для сотрудников Win to Win"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    busy(btn, true);
    try {
      await post("/auth/login", { login: login.value.trim(), password: pass.value, remember: remember.v });
      await startApp();
    } catch (ex) {
      err.textContent = ex.message;
      busy(btn, false);
      pass.select();
    }
  });
  root.append(h("div", { class: "gate" }, h("i", { class: "aura n1" }), h("i", { class: "aura n2" }), h("i", { class: "aura n3" }), h("div", { class: "lens" }, svgMark()), form));
  setTimeout(() => login.focus(), 50);
}


// ---------- каркас ----------
let shell = null;
function renderShell() {
  document.body.classList.add("app");
  clear(root);
  const side = h("aside", { class: "side", "aria-label": "Меню" });
  const sideIn = h("div", { class: "side-in" });
  side.append(sideIn);
  followLight(sideIn);
  const main = h("main", { class: "main", id: "main" });
  const mtop = h("div", { class: "mobile-top" });
  const top = h("header", { class: "top" });
  const page = h("div", { class: "page" });
  const tabbar = h("nav", { class: "tabbar", "aria-label": "Разделы" });
  main.append(mtop, top, page);
  root.append(h("div", { class: "shell" }, side, main), tabbar);
  shell = { side: sideIn, mtop, top, page, tabbar };
  const onScroll = () => top.classList.toggle("is-stuck", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  drawChrome();
}

function navCounts() {
  const all = allDeals();
  const waiting = all.filter((d) => d._.waiting).length;
  return {
    today: waiting,
    board: dealsIn().filter((d) => d._.g === "active" || d._.g === "new").length,
    deals: all.length,
    projects: all.filter((d) => d.status === "contract" && d.pipeline !== "archive").length,
  };
}

export function drawChrome() {
  if (!shell) return;
  const { name } = parseHash();
  const c = navCounts();
  const sb = shell.side;
  clear(sb);
  sb.append(
    h("a", { class: "logo", href: "#/today", "aria-label": "W2W CRM — на главную" }, svgMark(), "Win to Win", h("span", { class: "tag" }, "CRM")),
    h("button", { class: "side-search", type: "button", onclick: () => openPalette() }, icon("search"), "Поиск клиента", h("span", { class: "kbd" }, navigator.platform?.includes("Mac") ? "⌘K" : "Ctrl K")),
  );
  const nav = h("nav", { class: "nav" });
  for (const [k, v] of Object.entries(VIEWS)) {
    if (v.admin && !can("admin")) continue;
    const cnt = k === "today" ? c.today : k === "projects" ? c.projects : null;
    nav.append(
      h(
        "a",
        { class: "nav-a", href: "#/" + k, "aria-current": k === name ? "page" : null },
        h("span", { class: `app-icon sm ${v.tone}` }, icon(v.icon)),
        v.title,
        cnt ? h("span", { class: "cnt" + (k === "today" ? " hot" : ""), title: k === "today" ? "Ждут нашего ответа" : "Проекты в работе" }, String(cnt)) : null,
      ),
    );
  }
  sb.append(nav, h("div", { class: "side-sec" }, "Воронки"));
  const pipes = h("div", { class: "pipes" });
  const counts = {};
  for (const d of S.deals.values()) counts[d.pipeline] = (counts[d.pipeline] || 0) + 1;
  for (const p of S.settings.pipelines) {
    pipes.append(
      h(
        "button",
        {
          type: "button",
          class: "pipe-a",
          "aria-pressed": String(S.ui.pipeline === p.id),
          onclick: () => {
            S.ui.pipeline = p.id;
            store.set("w2w-pipeline", p.id);
            if (!["board", "deals"].includes(parseHash().name)) go("board");
            else route(true);
            drawChrome();
          },
        },
        h("i", { style: { "--c": pipeColor(p.id) } }),
        p.label,
        h("span", { class: "n" }, String(counts[p.id] || 0)),
      ),
    );
  }
  sb.append(pipes);
  const foot = h("div", { class: "side-foot" });
  foot.append(syncLine());
  const me = h("button", { class: "me", type: "button", "aria-haspopup": "menu" }, h("span", { class: "avatar lg", style: { "--c": S.me.color } }, initials(S.me.name)), h("span", { class: "who" }, h("b", null, S.me.name), h("span", null, { admin: "Администратор", manager: "Менеджер", viewer: "Наблюдатель" }[S.me.role])), icon("dots"));
  me.addEventListener("click", () => userMenu(me));
  foot.append(me);
  sb.append(foot);

  // мобильная шапка и таббар
  clear(shell.mtop).append(
    h("a", { class: "logo", href: "#/today" }, svgMark(), "W2W", h("span", { class: "tag" }, "CRM")),
    h("button", { class: "btn icon glass-btn", type: "button", "aria-label": "Поиск", onclick: () => openPalette() }, icon("search")),
    can("write") ? h("button", { class: "btn icon brand", type: "button", "aria-label": "Новая сделка", onclick: () => newDealModal(["board", "deals"].includes(parseHash().name) ? { pipeline: S.ui.pipeline } : {}) }, icon("plus")) : null,
    (() => {
      const b = h("button", { class: "me", type: "button", style: { width: "auto", padding: "2px" }, "aria-label": "Профиль" }, h("span", { class: "avatar", style: { "--c": S.me.color } }, initials(S.me.name)));
      b.addEventListener("click", () => userMenu(b));
      return b;
    })(),
  );
  const tb = clear(shell.tabbar);
  for (const k of ["today", "board", "deals", "projects"]) {
    const v = VIEWS[k];
    tb.append(h("a", { href: "#/" + k, "aria-current": k === name ? "page" : null }, icon(v.icon), v.title, k === "today" && c.today ? h("span", { class: "cnt" }, String(c.today)) : null));
  }
  const more = h("button", { type: "button", "aria-current": ["analytics", "base", "settings"].includes(name) ? "page" : null }, icon("dots"), "Ещё");
  more.addEventListener("click", () =>
    popover(more, (pop, close) => {
      for (const k of ["analytics", "base", "settings"]) {
        if (VIEWS[k].admin && !can("admin")) continue;
        pop.append(h("button", { class: "opt", type: "button", onclick: () => (close(), go(k)) }, h("span", { class: `app-icon sm ${VIEWS[k].tone}` }, icon(VIEWS[k].icon)), VIEWS[k].title));
      }
    }, { align: "end" }),
  );
  tb.append(more);
}

function syncLine() {
  const ls = S.lastSync;
  let cls = "warn", title = "Синхронизация", sub = "ещё не запускалась";
  if (ls?.at) {
    const hours = (Date.now() - Date.parse(ls.at)) / 36e5;
    if (ls.ok === false) (cls = "bad"), (sub = "ошибка · " + timeAgo(ls.at));
    else (cls = hours > 30 ? "warn" : ""), (title = "Telegram → CRM"), (sub = timeAgo(ls.at));
  }
  const b = h("button", { class: "sync-line", type: "button", title: "Отчёт последней синхронизации" }, h("i", { class: "dot-live " + cls }), h("span", null, h("b", null, title), h("br"), sub));
  b.addEventListener("click", () => {
    modal({
      title: "Синхронизация Telegram → CRM",
      body: h(
        "div",
        { style: { display: "grid", gap: "12px" } },
        h("p", { class: "lead" }, "Каждый день в 18:57 по Ташкенту Claude читает переписку аккаунта @ceo_w2w и обновляет карточки: новые лиды, статусы, историю, следующий шаг и отметку «Ждёт нашего ответа». Клиентам ничего не отправляется."),
        ls?.at ? h("p", { class: "small" }, "Последний запуск: " + timeAgo(ls.at)) : h("p", { class: "small" }, "Отчётов ещё не было."),
        ls?.text ? h("div", { class: "secret", style: { whiteSpace: "pre-wrap", fontFamily: "inherit", userSelect: "text" } }, ls.text) : null,
      ),
      wide: true,
    });
  });
  return b;
}

function userMenu(anchor) {
  popover(
    anchor,
    (pop, close) => {
      pop.append(
        h("div", { class: "hd" }, S.me.name + " · " + S.me.login),
        h("button", { class: "opt", type: "button", onclick: () => (close(), passwordModal()) }, icon("key"), "Сменить пароль"),
        h("button", { class: "opt", type: "button", onclick: () => (close(), toggleTheme()) }, icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon"), document.documentElement.dataset.theme === "dark" ? "Светлая тема" : "Тёмная тема"),
        h("div", { class: "sep" }),
        h("button", { class: "opt danger", type: "button", onclick: () => (close(), logout()) }, icon("logout"), "Выйти"),
      );
    },
    { align: "end", width: 230 },
  );
}

async function logout() {
  try {
    await post("/auth/logout");
  } catch {}
  S.loaded = false;
  renderLogin();
}

// ---------- виды ----------
async function route(force = false) {
  if (!shell) return;
  const { name, params } = parseHash();
  const v = VIEWS[name];
  if (v.admin && !can("admin")) return go("today");
  if (force || current.name !== name) {
    closePop();
    current.unmount?.();
    current = { name, view: null, unmount: null };
    clear(shell.top);
    clear(shell.page);
    shell.page.append(h("div", { class: "loading" }, h("div", { class: "spinner" })));
    const mod = await v.load();
    if (current.name !== name) return;
    clear(shell.page);
    document.title = `${v.title} · W2W CRM`;
    current.view = mod;
    current.unmount = mod.mount({ top: shell.top, page: shell.page, params }) || null;
    window.scrollTo({ top: 0 });
    drawChrome();
  }
  const did = params.get("d");
  if (did && did !== currentDealId()) openDeal(did);
  else if (!did && currentDealId()) closeDeal();
}

window.addEventListener("hashchange", () => route());

// ---------- горячие клавиши ----------
document.addEventListener("keydown", (e) => {
  if (!S.loaded) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openPalette();
  } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === "n" && can("write") && !document.querySelector(".modal-wrap")) {
    e.preventDefault();
    newDealModal();
  } else if (!typing && e.key === "/" && !document.querySelector(".modal-wrap")) {
    e.preventDefault();
    openPalette();
  }
});

// ---------- запуск ----------
async function startApp() {
  root.append(h("div", { class: "loading", style: { position: "fixed", inset: "0", background: "var(--bg)", zIndex: 5 } }, h("div", { class: "spinner" })));
  await bootstrap();
  renderShell();
  await route(true);
  startPolling();
  if (S.me.mustChange) setTimeout(() => passwordModal({ forced: true }), 400);
}

let lastChrome = 0;
subscribe((what) => {
  if (!shell) return;
  // перерисовываем меню не чаще раза в 300 мс — там счётчики
  const t = Date.now();
  if (t - lastChrome > 300) {
    lastChrome = t;
    drawChrome();
  } else setTimeout(drawChrome, 320);
  current.view?.update?.(what);
});

setUnauthorizedHandler(() => {
  if (S.loaded) {
    S.loaded = false;
    shell = null;
    renderLogin("Сессия закончилась — войдите снова.");
  }
});

(async function init() {
  if (document.documentElement.dataset.redirect) return;
  try {
    await get("/auth/me");
    await startApp();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) renderLogin();
    else {
      clear(root).append(
        h("div", { class: "gate" }, h("i", { class: "aura n1" }), h("i", { class: "aura n2" }), h("div", { class: "gate-card" }, h("h1", null, "Не удалось открыть CRM"), h("p", null, e.message || "Ошибка соединения"), h("button", { class: "btn brand", type: "button", onclick: () => location.reload() }, "Повторить"))),
      );
    }
  }
})();

export { route, VIEWS };
