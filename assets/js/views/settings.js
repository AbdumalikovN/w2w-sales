/* «Настройки» (администратор): пользователи, интеграции, справочники, данные. Плюс смена пароля для всех. */
import { h, icon, clear, timeAgo, dFull, initials } from "../core.js";
import { get, post, patch, put, del, api } from "../api.js";
import { S, can, setUsers, emit, mergeDeal, pipelineOf, statusOf } from "../state.js";
import { modal, toast, errToast, confirmBox, busy, copyText, seg, switchEl } from "../ui.js";

let ctx = null;
let tab = "users";

export function mount(c) {
  ctx = c;
  if (c.params.get("tab")) tab = c.params.get("tab");
  draw();
  return () => (ctx = null);
}
export function update(what) {
  if (ctx && what === "remote" && tab === "dicts") return;
}

function draw() {
  const { top, page } = ctx;
  clear(top).append(
    h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, "Администрирование"), h("h1", { class: "h1" }, "Настройки")),
    h(
      "div",
      { class: "toolbar", style: { width: "100%" } },
      seg(
        [
          { value: "users", label: "Пользователи" },
          { value: "integrations", label: "Интеграции" },
          { value: "dicts", label: "Справочники" },
          { value: "data", label: "Данные и корзина" },
        ],
        tab,
        (v) => ((tab = v), draw()),
      ),
    ),
  );
  clear(page).append(h("div", { class: "loading" }, h("div", { class: "spinner" })));
  ({ users, integrations, dicts, data }[tab] || users)().catch((e) => {
    clear(page).append(h("p", { class: "empty" }, icon("warn"), e.message));
  });
}

const ROLES = { admin: "Администратор", manager: "Менеджер", viewer: "Наблюдатель" };

async function users() {
  const { page } = ctx;
  const r = await get("/users");
  clear(page);
  const card = h("article", { class: "glass pad" }, h("div", { class: "card-h" }, h("span", { class: "app-icon ic-7" }, icon("people")), h("h3", { class: "h3" }, "Пользователи CRM"), h("button", { class: "btn brand sm", type: "button", onclick: addUser }, icon("user-plus"), "Добавить")));
  card.append(h("p", { class: "card-sub" }, "Администратор управляет пользователями и справочниками. Менеджер ведёт сделки. Наблюдатель только смотрит."));
  const t = h("table", { class: "mid" });
  t.append(h("thead", null, h("tr", null, h("th", null, "Сотрудник"), h("th", null, "Логин"), h("th", null, "Роль"), h("th", null, "Последний вход"), h("th", null, "Доступ"), h("th", null, ""))));
  const tb = h("tbody");
  for (const u of r.users) {
    const roleSel = h("select", { class: "select", style: { width: "auto" }, disabled: u.id === S.me.id }, Object.entries(ROLES).map(([k, v]) => h("option", { value: k }, v)));
    roleSel.value = u.role;
    roleSel.addEventListener("change", () => upd(u, { role: roleSel.value }, "Роль изменена"));
    const act = switchEl(u.active ? "Включён" : "Отключён", u.active, (v) => upd(u, { active: v }, v ? "Доступ включён" : "Доступ отключён"));
    if (u.id === S.me.id) act.disabled = true;
    tb.append(
      h(
        "tr",
        null,
        h("td", null, h("span", { style: { display: "inline-flex", alignItems: "center", gap: "10px" } }, h("span", { class: "avatar", style: { "--c": u.color } }, initials(u.name)), h("span", null, h("b", null, u.name), u.tg ? h("span", { class: "sub" }, u.tg) : null))),
        h("td", null, u.login, u.mustChange ? h("span", { class: "sub" }, "ещё не сменил пароль") : null),
        h("td", null, roleSel),
        h("td", null, u.lastLoginAt ? timeAgo(u.lastLoginAt) : h("span", { class: "muted" }, "не входил")),
        h("td", null, act),
        h("td", null, h("button", { class: "btn xs", type: "button", onclick: () => resetPw(u) }, icon("key"), "Новый пароль")),
      ),
    );
  }
  t.append(tb);
  card.append(h("div", { class: "tw" }, t));
  page.append(card);

  async function upd(u, body, msg) {
    try {
      const x = await patch(`/users/${u.id}`, body);
      Object.assign(u, x.user);
      toast(msg);
      const b = await get("/bootstrap");
      setUsers(b.users);
      emit("users");
    } catch (e) {
      errToast(e);
      draw();
    }
  }
  async function resetPw(u) {
    if (!(await confirmBox(`Выдать ${u.name} новый пароль? Старый перестанет работать, все сессии сотрудника закроются.`, { okText: "Выдать пароль" }))) return;
    try {
      const x = await patch(`/users/${u.id}`, { resetPassword: true });
      showCreds(u.name, u.login, x.password);
      draw();
    } catch (e) {
      errToast(e);
    }
  }
}

function showCreds(name, login, password) {
  const text = `W2W CRM: ${location.origin}\nЛогин: ${login}\nПароль: ${password}\nПри первом входе система попросит задать свой пароль.`;
  modal({
    title: "Доступ для " + name,
    body: h("div", { style: { display: "grid", gap: "12px" } }, h("p", { class: "lead" }, "Пароль показан один раз. Передайте его лично или в Telegram — после первого входа сотрудник задаст свой."), h("div", { class: "secret" }, text)),
    footer: [h("button", { class: "btn ink", type: "button", onclick: () => copyText(text, "Доступ скопирован") }, icon("copy"), "Скопировать")],
  });
}

function addUser() {
  const name = h("input", { class: "input", placeholder: "Имя Фамилия" });
  const login = h("input", { class: "input", placeholder: "латиницей, например javokhir", autocapitalize: "none" });
  const tg = h("input", { class: "input", placeholder: "@username (необязательно)" });
  const role = h("select", { class: "select" }, Object.entries(ROLES).map(([k, v]) => h("option", { value: k }, v)));
  role.value = "manager";
  name.addEventListener("input", () => {
    if (!login.dataset.touched) login.value = translit(name.value.split(" ")[0] || "").toLowerCase();
  });
  login.addEventListener("input", () => (login.dataset.touched = "1"));
  const btn = h("button", { class: "btn brand", type: "button" }, "Создать и показать пароль");
  const m = modal({
    title: "Новый пользователь",
    body: h("div", { class: "fgrid" }, field("Имя", name, true), field("Логин", login), field("Роль", role), field("Telegram", tg, true)),
    footer: [h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Отмена"), btn],
  });
  btn.addEventListener("click", async () => {
    busy(btn, true);
    try {
      const r = await post("/users", { name: name.value, login: login.value, role: role.value, tg: tg.value });
      m.close();
      showCreds(r.user.name, r.user.login, r.password);
      draw();
      const b = await get("/bootstrap");
      setUsers(b.users);
      emit("users");
    } catch (e) {
      errToast(e);
      busy(btn, false);
    }
  });
}

function translit(s) {
  const map = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ы: "y", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h" };
  return s.toLowerCase().replace(/[а-яёўқғҳ]/g, (c) => map[c] ?? "").replace(/[^a-z0-9._-]/g, "");
}
function field(label, el, full) {
  return h("div", { class: "field" + (full ? " full" : "") }, h("label", null, label), el);
}

async function integrations() {
  const { page } = ctx;
  const r = await get("/tokens");
  clear(page);
  const ls = S.lastSync;
  const sync = h(
    "article",
    { class: "glass pad" },
    h("div", { class: "card-h" }, h("span", { class: "app-icon ic-8" }, icon("telegram")), h("h3", { class: "h3" }, "Синхронизация Telegram → CRM")),
    h("p", { class: "card-sub" }, "Запланированная задача Claude каждый день в 18:57 по Ташкенту читает переписку аккаунта @ceo_w2w и через API обновляет карточки: новые лиды, статусы (только вперёд, ручные статусы не трогает), историю, следующий шаг и отметку «Ждёт нашего ответа». Сообщения клиентам не отправляются. Нужен включённый компьютер с приложением Claude."),
    h("p", { class: "small" }, ls?.at ? "Последний отчёт: " + timeAgo(ls.at) : "Отчётов пока не было."),
  );
  if (ls?.text) sync.append(h("div", { class: "secret", style: { whiteSpace: "pre-wrap", fontFamily: "inherit", userSelect: "text", marginTop: "10px", maxHeight: "300px", overflow: "auto" } }, ls.text));
  const tk = h("article", { class: "glass pad" }, h("div", { class: "card-h" }, h("span", { class: "app-icon ic-6" }, icon("key")), h("h3", { class: "h3" }, "Токены интеграций"), h("button", { class: "btn brand sm", type: "button", onclick: addToken }, icon("plus"), "Новый токен")));
  tk.append(h("p", { class: "card-sub" }, "Токен даёт программе доступ к API CRM без логина. «sync» — синхронизация переписки, «read» — только чтение. Отзовите токен, если он мог попасть к посторонним."));
  const t = h("table", { class: "mid" });
  t.append(h("thead", null, h("tr", null, h("th", null, "Название"), h("th", null, "Токен"), h("th", null, "Права"), h("th", null, "Создан"), h("th", null, "Использовался"), h("th", null, ""))));
  const tb = h("tbody");
  if (!r.tokens.length) tb.append(h("tr", null, h("td", { colspan: "6", class: "muted" }, "Токенов нет.")));
  for (const x of r.tokens) {
    tb.append(
      h(
        "tr",
        null,
        h("td", null, h("b", null, x.name)),
        h("td", null, h("code", null, x.hint)),
        h("td", null, x.scopes.join(", ")),
        h("td", null, dFull(x.createdAt.slice(0, 10))),
        h("td", null, x.lastUsedAt ? timeAgo(x.lastUsedAt) : h("span", { class: "muted" }, "не использовался")),
        h(
          "td",
          null,
          h(
            "button",
            {
              class: "btn xs danger",
              type: "button",
              onclick: async () => {
                if (!(await confirmBox(`Отозвать токен «${x.name}»? Программа, которая им пользуется, перестанет работать.`, { danger: true, okText: "Отозвать" }))) return;
                try {
                  await del(`/tokens/${x.id}`);
                  toast("Токен отозван");
                  draw();
                } catch (e) {
                  errToast(e);
                }
              },
            },
            "Отозвать",
          ),
        ),
      ),
    );
  }
  t.append(tb);
  tk.append(h("div", { class: "tw" }, t));
  const apiCard = h(
    "article",
    { class: "glass pad" },
    h("div", { class: "card-h" }, h("span", { class: "app-icon ic-3" }, icon("code")), h("h3", { class: "h3" }, "API для своих интеграций")),
    h("div", { class: "secret", style: { whiteSpace: "pre-wrap", fontSize: "12.5px" } }, `GET  ${location.origin}/api/sync/index        — список сделок для сопоставления\nPOST ${location.origin}/api/sync/apply        — пачка изменений {items:[…]}\nPOST ${location.origin}/api/sync/report       — отчёт о запуске {text, stats}\nЗаголовок: Authorization: Bearer <токен>`),
  );
  clear(page).append(sync, tk, apiCard);
}

function addToken() {
  const name = h("input", { class: "input", value: "Telegram → CRM" });
  const scope = h("select", { class: "select" }, h("option", { value: "sync" }, "sync — синхронизация"), h("option", { value: "read" }, "read — только чтение"));
  const btn = h("button", { class: "btn brand", type: "button" }, "Создать");
  const m = modal({ title: "Новый токен", body: h("div", { class: "fgrid" }, field("Название", name), field("Права", scope)), footer: [h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Отмена"), btn] });
  btn.addEventListener("click", async () => {
    busy(btn, true);
    try {
      const r = await post("/tokens", { name: name.value, scopes: [scope.value] });
      m.close();
      modal({
        title: "Токен создан",
        body: h("div", { style: { display: "grid", gap: "12px" } }, h("p", { class: "lead" }, "Сохраните токен сейчас — потом его можно только отозвать и создать новый."), h("div", { class: "secret" }, r.secret)),
        footer: [h("button", { class: "btn ink", type: "button", onclick: () => copyText(r.secret, "Токен скопирован") }, icon("copy"), "Скопировать")],
      });
      draw();
    } catch (e) {
      errToast(e);
      busy(btn, false);
    }
  });
}

async function dicts() {
  const { page } = ctx;
  clear(page);
  const st = structuredClone(S.settings);
  const groups = [
    ["sources", "Источники лидов", "target"],
    ["sectors", "Отрасли", "building"],
    ["regions", "Регионы", "globe"],
    ["formats", "Форматы первого касания", "send"],
    ["roles", "Должности контакта", "person"],
    ["reasons", "Причины отказа", "cross"],
    ["requests", "Запросы клиентов", "bubble"],
  ];
  const saveBtn = h("button", { class: "btn brand", type: "button" }, icon("check"), "Сохранить справочники");
  const grid = h("div", { class: "grid" });
  // воронки
  const pc = h("article", { class: "glass pad c6" }, h("div", { class: "card-h" }, h("span", { class: "app-icon ic-1" }, icon("kanban")), h("h3", { class: "h3" }, "Воронки")));
  const plist = h("div", { class: "lines" });
  const drawP = () => {
    clear(plist);
    st.pipelines.forEach((p, i) => {
      const inp = h("input", { class: "input", value: p.label });
      inp.addEventListener("input", () => (p.label = inp.value));
      const n = [...S.deals.values()].filter((d) => d.pipeline === p.id).length;
      plist.append(h("div", { class: "addline" }, inp, h("span", { class: "small", style: { alignSelf: "center", minWidth: "70px" } }, `${n} сделок`), h("button", { class: "btn icon sm", type: "button", "aria-label": "Удалить воронку", disabled: n > 0, title: n ? "В воронке есть сделки" : "", onclick: () => (st.pipelines.splice(i, 1), drawP()) }, icon("trash"))));
    });
  };
  drawP();
  const newP = h("input", { class: "input", placeholder: "Новая воронка, например «Партнёры»" });
  pc.append(plist, h("div", { class: "addline", style: { marginTop: "8px" } }, newP, h("button", { class: "btn sm", type: "button", onclick: () => { const v = newP.value.trim(); if (!v) return; st.pipelines.push({ id: "p" + Date.now().toString(36), label: v }); newP.value = ""; drawP(); } }, icon("plus"), "Добавить")));
  grid.append(pc);
  for (const [key, title, ic] of groups) {
    const c = h("article", { class: "glass pad c6" }, h("div", { class: "card-h" }, h("span", { class: "app-icon ic-4" }, icon(ic)), h("h3", { class: "h3" }, title), h("span", { class: "small" }, String(st[key].length))));
    const list = h("div", { class: "multi" });
    const drawL = () => {
      clear(list);
      st[key].forEach((v, i) => list.append(h("button", { type: "button", title: "Убрать", onclick: () => (st[key].splice(i, 1), drawL()) }, v, " ×")));
    };
    drawL();
    const inp = h("input", { class: "input", placeholder: "Добавить значение" });
    const add = () => {
      const v = inp.value.trim();
      if (v && !st[key].includes(v)) st[key].push(v);
      inp.value = "";
      drawL();
    };
    inp.addEventListener("keydown", (e) => e.key === "Enter" && add());
    c.append(list, h("div", { class: "addline", style: { marginTop: "10px" } }, inp, h("button", { class: "btn sm", type: "button", onclick: add }, icon("plus"))));
    grid.append(c);
  }
  saveBtn.addEventListener("click", async () => {
    busy(saveBtn, true);
    try {
      const r = await put("/settings", { settings: st });
      S.settings = r.settings;
      emit("all");
      toast("Справочники сохранены");
    } catch (e) {
      errToast(e);
    } finally {
      busy(saveBtn, false);
    }
  });
  page.append(h("p", { class: "lead" }, "Значения из справочников появляются в выпадающих списках карточки и в фильтрах. Удалённое значение остаётся в старых карточках, пока его не поменяют."), grid, h("div", { style: { position: "sticky", bottom: "16px", display: "flex", justifyContent: "flex-end" } }, saveBtn));
}

async function data() {
  const { page } = ctx;
  const r = await get("/trash");
  clear(page);
  const exp = h(
    "article",
    { class: "glass pad" },
    h("div", { class: "card-h" }, h("span", { class: "app-icon ic-2" }, icon("download")), h("h3", { class: "h3" }, "Выгрузка всей базы")),
    h("p", { class: "card-sub" }, "Полная копия CRM в JSON: сделки, история, база анкет, справочники. Плюс система сама делает ежедневную резервную копию и хранит 45 последних."),
    h(
      "button",
      {
        class: "btn ink",
        type: "button",
        onclick: async (e) => {
          const b = e.currentTarget;
          busy(b, true);
          try {
            const res = await fetch("/api/export", { credentials: "same-origin", headers: { "x-w2w": "1" } });
            if (!res.ok) throw new Error("Не удалось выгрузить");
            const blob = await res.blob();
            const a = h("a", { href: URL.createObjectURL(blob), download: `w2w-crm-${S.today}.json` });
            document.body.append(a);
            a.click();
            setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
          } catch (ex) {
            errToast(ex);
          } finally {
            busy(b, false);
          }
        },
      },
      icon("download"),
      "Скачать JSON",
    ),
  );
  const trash = h("article", { class: "glass pad" }, h("div", { class: "card-h" }, h("span", { class: "app-icon ic-10" }, icon("trash")), h("h3", { class: "h3" }, "Корзина"), h("span", { class: "small" }, String(r.deals.length))));
  if (!r.deals.length) trash.append(h("p", { class: "empty" }, icon("check"), "Удалённых карточек нет."));
  const rows = h("div", { class: "rows" });
  for (const d of r.deals) {
    rows.append(
      h(
        "div",
        { class: "row", style: { cursor: "default" } },
        h("span", { class: "nm" }, d.name),
        h(
          "button",
          {
            class: "btn xs",
            type: "button",
            onclick: async () => {
              try {
                const x = await post(`/deals/${d.id}/restore`);
                mergeDeal(x.deal);
                emit("deal", [d.id]);
                toast("Карточка восстановлена");
                draw();
              } catch (e) {
                errToast(e);
              }
            },
          },
          "Восстановить",
        ),
        h("span", { class: "meta" }, `${pipelineOf(d.pipeline).label} · ${statusOf(d.status).label} · удалена ${d.deletedAt ? timeAgo(d.deletedAt) : ""}`),
      ),
    );
  }
  trash.append(rows);
  page.append(exp, trash);
}

/** Смена пароля — для любого пользователя (forced — при первом входе) */
export function passwordModal({ forced = false } = {}) {
  const cur = h("input", { class: "input", type: "password", autocomplete: "current-password" });
  const nw = h("input", { class: "input", type: "password", autocomplete: "new-password", minlength: 8 });
  const nw2 = h("input", { class: "input", type: "password", autocomplete: "new-password" });
  const err = h("p", { class: "small", style: { color: "var(--danger-ink)", minHeight: "1.2em" } });
  const btn = h("button", { class: "btn brand", type: "button" }, "Сохранить пароль");
  const m = modal({
    title: forced ? "Задайте свой пароль" : "Смена пароля",
    body: h("div", { style: { display: "grid", gap: "12px" } }, forced ? h("p", { class: "lead" }, "Вы вошли по временному паролю. Придумайте свой — не короче 8 символов.") : null, field(forced ? "Временный пароль" : "Текущий пароль", cur), field("Новый пароль", nw), field("Повторите новый пароль", nw2), err),
    footer: [
      forced
        ? h("button", { class: "btn", type: "button", onclick: async () => (m.close(), (await import("../main.js")).logout()) }, "Выйти")
        : h("button", { class: "btn", type: "button", onclick: () => m.close() }, "Отмена"),
      btn,
    ],
    // временный пароль нужно сменить: окно не закрывается крестиком, кликом мимо или Esc
    dismissable: !forced,
  });
  btn.addEventListener("click", async () => {
    err.textContent = "";
    if (nw.value.length < 8) return (err.textContent = "Минимум 8 символов");
    if (nw.value !== nw2.value) return (err.textContent = "Пароли не совпадают");
    busy(btn, true);
    try {
      const r = await post("/auth/password", { current: cur.value, next: nw.value });
      S.me = r.user;
      m.close();
      toast("Пароль сохранён");
    } catch (e) {
      err.textContent = e.message;
      busy(btn, false);
    }
  });
}
