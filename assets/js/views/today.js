/* «Сегодня»: кто ждёт ответа, ближайшие встречи и сигналы по сделкам. */
import { h, icon, clear, svgMark, dShort, dLong, ddmm, plural, money, meetingLabel, WEEKDAYS, followLight, addDays, timeAgo } from "../core.js";
import { get, ApiError } from "../api.js";
import { S, can, updateDeal, statusOf, userName } from "../state.js";
import { statusChip, avatar, idlePill, waitPill, toast, errToast, copyText, sectionCard } from "../ui.js";
import { signals, uncontacted } from "../logic.js";

let ctx = null;
let base = null;

const dealsActive = () => [...S.deals.values()].filter((d) => d.pipeline !== "archive");

async function openDeal(id) {
  const m = await import("../main.js");
  m.go("today", { d: id });
}

export function mount(c) {
  ctx = c;
  draw();
  if (!base) {
    get("/base")
      .then((b) => {
        base = b;
        if (ctx) draw();
      })
      .catch(() => {});
  }
  return () => (ctx = null);
}
export function update() {
  if (ctx) draw();
}

function greeting() {
  const hr = +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", hour12: false }).format(new Date());
  return hr < 5 ? "Доброй ночи" : hr < 12 ? "Доброе утро" : hr < 18 ? "Добрый день" : "Добрый вечер";
}

function draw() {
  const { top, page } = ctx;
  const all = dealsActive();
  const sg = signals(all);
  const wd = WEEKDAYS[new Date(S.today + "T12:00:00Z").getUTCDay()];
  clear(top).append(
    h("div", { class: "ttl" }, h("span", { class: "eyebrow" }, `Сегодня · ${wd}, ${dLong(S.today)}`), h("h1", { class: "h1" }, "Что сделать в первую очередь")),
    h("div", { class: "acts" }, can("write") ? h("button", { class: "btn brand desk-only", type: "button", onclick: async () => (await import("../newdeal.js")).newDealModal() }, icon("plus"), "Новая сделка") : null),
  );
  clear(page);

  // ночная сцена
  const active = all.filter((d) => d._.g === "active");
  const stuck = active.filter((d) => (d._.idle ?? 0) > 7);
  const week = all.filter((d) => d._.meetingDate && d._.meetingDate >= S.today && d._.meetingDate <= addDays(S.today, 7) && !d.meetingHeld);
  const todayMeet = week.filter((d) => d._.meetingDate === S.today);
  const contracts = all.filter((d) => d.status === "contract");
  const contractSum = contracts.reduce((a, d) => a + (Number(d.amount) || 0), 0);
  const w = sg.waiting.length;
  const first = S.me.name.split(" ")[0];
  const title = h("h2", { class: "hello-t" }, `${greeting()}, ${first}. `);
  if (w) title.append(h("span", { class: "hl" }, `${w} ${plural(w, "клиент ждёт", "клиента ждут", "клиентов ждут")} ответа`));
  else title.append(h("span", { class: "hl" }, "Все клиенты получили ответ"));
  const pill = (label, n, cls, onclick) => h(onclick ? "button" : "span", { class: "pill " + (n ? cls : ""), type: onclick ? "button" : null, onclick }, label, h("b", null, String(n)));
  const hello = h(
    "section",
    { class: "night hello" },
    h("i", { class: "aura n1" }),
    h("i", { class: "aura n2" }),
    h("i", { class: "aura n3" }),
    h("div", { class: "lens" }, svgMark()),
    h("div", { style: { display: "grid", gap: "12px" } }, title, h("p", { class: "lead" }, todayMeet.length ? `Сегодня ${todayMeet.length} ${plural(todayMeet.length, "встреча", "встречи", "встреч")}: ${todayMeet.map((d) => d.name + (meetingLabel(d.meetingAt).includes(",") ? " в " + meetingLabel(d.meetingAt).split(", ")[1] : "")).join(", ")}.` : `В работе ${active.length} ${plural(active.length, "сделка", "сделки", "сделок")}, на этой неделе ${week.length} ${plural(week.length, "встреча", "встречи", "встреч")}.`)),
    h(
      "div",
      { class: "pills" },
      pill("Ждут ответа: ", w, "alert", () => document.getElementById("reply")?.scrollIntoView({ behavior: "smooth", block: "start" })),
      pill("В работе: ", active.length, "", () => go("deals", { f: "active" })),
      pill("Без движения больше недели: ", stuck.length, "bad", () => go("deals", { f: "active", s: "idle" })),
      pill("Встречи на 7 дней: ", week.length, "good"),
      pill("Просрочены шаги: ", sg.due.length, "bad"),
      pill("Проекты в работе: ", contracts.length, "good", () => go("projects")),
      contractSum ? h("span", { class: "pill good" }, "Сумма договоров: ", h("b", null, money(contractSum))) : null,
    ),
  );
  page.append(hello);

  // ждут ответа
  page.append(replyCard(sg.waiting));

  // сигналы
  const grid = h("div", { class: "grid sig" });
  grid.append(
    sigCard({ ic: "sparkle", tone: "ic-4", title: "Новые лиды", sub: "Первое касание за последние 3 дня.", items: sg.fresh, empty: "За 3 дня новых лидов не было.", meta: (d) => [statusOf(d.status).label, d.sector, d.region].filter(Boolean).join(" · "), right: (d) => h("span", { class: "idle na" }, dShort(d.firstTouch)) }),
    sigCard({ ic: "trophy", tone: "ic-2", title: "Довести до договора", sub: "Статусы «ТЗ», «КП» и «Продажа».", items: sg.finish, empty: "Сделок на этапе ТЗ или КП нет.", meta: (d) => `${statusOf(d.status).label} · ${d.nextStep || "следующий шаг не записан"}` }),
    sigCard({
      ic: "calendar",
      tone: "ic-8",
      title: "Встречи",
      sub: "Ближайшие по дате, затем те, где время не подтверждено.",
      items: [...sg.upcoming, ...sg.undated],
      empty: "Встреч не запланировано.",
      meta: (d) => (d._.meetingDate && d._.meetingDate >= S.today ? d.nextStep || "" : "Уточнить дату и время встречи"),
      right: (d) => h("span", { class: "idle " + (d._.meetingDate && d._.meetingDate >= S.today ? (d._.meetingDate === S.today ? "new" : "ok") : "warn") }, d._.meetingDate && d._.meetingDate >= S.today ? meetingLabel(d.meetingAt) : "без даты"),
    }),
    sigCard({ ic: "clock", tone: "ic-3", title: "Зависли после встречи", sub: "Встреча прошла, а движения нет больше недели.", items: sg.stuck, empty: "После встреч всё движется." }),
    sigCard({ ic: "phone", tone: "ic-9", title: "Позвонить", sub: "Не ответили на первое касание 3 дня и дольше. Владельцы сверху.", items: sg.call, empty: "Все ответили или написали недавно.", meta: (d) => [d.sector, d.region, d.contactRole].filter(Boolean).join(" · ") || d.nextStep }),
    sigCard({ ic: "warn", tone: "ic-10", title: "Просроченные шаги", sub: "Срок следующего шага уже прошёл.", items: sg.due, empty: "Просроченных шагов нет.", right: (d) => h("span", { class: "idle bad" }, dShort(d.nextStepDue)) }),
  );
  const unc = uncontacted(base, [...S.deals.values()]);
  grid.append(
    sigCard({
      ic: "send",
      tone: "ic-5",
      title: "Ещё не писали",
      sub: "Анкеты из группы курса без карточки в CRM.",
      items: unc,
      empty: base ? "Всем анкетам уже написали." : "Загружаю базу анкет…",
      row: (l) =>
        h(
          "button",
          { class: "row", type: "button", onclick: () => go("base") },
          h("span", { class: "nm" }, l.company && l.company !== "—" ? l.company : l.name),
          h("span", { class: "idle " + (l.lpr ? "ok" : "na") }, l.lpr ? "владелец" : "—"),
          h("span", { class: "meta" }, [l.name, l.region, l.activity].filter(Boolean).join(" · ")),
        ),
      more: () => go("base"),
    }),
  );
  page.append(grid);
  page.append(syncCard());
  page.querySelectorAll(".glass").forEach(followLight);
}

function replyCard(list) {
  const card = sectionCard({ ic: "bubble", tone: "ic-1", title: "Ждут нашего ответа", count: list.length, hot: true, sub: "Клиент написал последним или мы обещали вернуться — а ответа пока нет. Синхронизация сверяет переписку каждый день в 19:00; ответили раньше — нажмите «Ответили»." });
  card.id = "reply";
  if (!list.length) {
    card.append(h("p", { class: "empty" }, icon("check"), "Все клиенты получили ответ. Новые вопросы появятся здесь после вечерней сверки с Telegram."));
    return card;
  }
  const old = list.filter((d) => (d._.idle ?? 0) > 3).length, mid = list.filter((d) => d._.idle >= 1 && d._.idle <= 3).length, today = list.filter((d) => d._.idle === 0).length;
  card.append(
    h(
      "div",
      { class: "reply-bar" },
      h("span", { class: "p" + (old ? " bad" : "") }, "Больше 3 дней: ", h("b", null, String(old))),
      h("span", { class: "p" + (mid ? " warn" : "") }, "1–3 дня: ", h("b", null, String(mid))),
      h("span", { class: "p" }, "С сегодня: ", h("b", null, String(today))),
      h("span", { class: "sp" }),
      h("button", { class: "btn sm", type: "button", onclick: () => copyText(replyText(list), "Список скопирован — можно отправить в рабочую группу") }, icon("copy"), "Скопировать список"),
    ),
  );
  const rows = h("div", { class: "rows reply-list" });
  for (const d of list) {
    const chat = d.telegram || (/^https?:\/\/t\.me\//.test(d.group || "") ? d.group : "");
    const row = h(
      "div",
      { class: "row", role: "button", tabindex: "0", onclick: (e) => !e.target.closest("a,button") && openDeal(d.id), onkeydown: (e) => e.key === "Enter" && openDeal(d.id) },
      h("div", { class: "who" }, h("span", { class: "nm" }, d.name), statusChip(d.status), h("span", { class: "sub" }, [d.lastTouch ? "последнее сообщение " + dShort(d.lastTouch) : null, d.sector, d.region].filter(Boolean).join(" · "))),
      h("p", { class: "what" }, d.nextStep || "Что ответить, не записано — откройте чат."),
      waitPill(d),
      h(
        "div",
        { class: "act", style: { display: "flex", gap: "6px" } },
        chat ? h("a", { class: "btn xs", href: chat, target: "_blank", rel: "noopener", style: { color: "var(--brand-ink)", background: "rgba(var(--brand-rgb),.12)" } }, icon("telegram"), "Чат") : null,
        can("write")
          ? h(
              "button",
              {
                class: "btn xs",
                type: "button",
                title: "Снять отметку «ждёт ответа»",
                onclick: () =>
                  updateDeal(d.id, { waiting: false })
                    .then(() => toast(`«${d.name}» — отмечено как отвеченное`, { action: () => updateDeal(d.id, { waiting: true }), actionText: "Вернуть" }))
                    .catch(errToast),
              },
              icon("check"),
              "Ответили",
            )
          : null,
      ),
    );
    rows.append(row);
  }
  card.append(rows);
  return card;
}

function replyText(list) {
  const lines = list.map((d, i) => {
    const n = d._.idle ?? 0;
    const w = n === 0 ? "с сегодня" : n === 1 ? "со вчера" : `${n} ${plural(n, "день", "дня", "дней")}`;
    const url = d.telegram || d.group || "";
    return `${i + 1}. ${d.name} — ждёт ${w} — ${d.nextStep || "уточнить, что ответить"}${url ? " — " + url : ""}`;
  });
  return [`Ждут нашего ответа · ${ddmm(S.today)} · ${list.length}`, ...lines].join("\n");
}

function sigCard({ ic, tone, title, sub, items, empty, meta, right, row, limit = 5, more }) {
  const card = sectionCard({ ic, tone, title, count: items.length, sub });
  card.classList.add("c4");
  card.style.display = "flex";
  card.style.flexDirection = "column";
  if (!items.length) {
    card.append(h("p", { class: "empty" }, icon("check"), empty));
    return card;
  }
  const ul = h("div", { class: "rows" });
  const mk =
    row ||
    ((d) =>
      h(
        "button",
        { class: "row", type: "button", onclick: () => openDeal(d.id) },
        h("span", { class: "nm" }, d.name),
        right ? right(d) : idlePill(d),
        h("span", { class: "meta" }, (meta ? meta(d) : d.nextStep) || "Следующий шаг не записан"),
      ));
  let open = false;
  const drawRows = () => {
    clear(ul);
    items.slice(0, open ? items.length : limit).forEach((it) => ul.append(mk(it)));
  };
  drawRows();
  card.append(ul);
  if (items.length > limit) {
    const b = h("button", { class: "btn link more", type: "button" }, `Показать все (${items.length})`);
    b.addEventListener("click", () => {
      if (more) return more();
      open = !open;
      drawRows();
      b.textContent = open ? "Свернуть" : `Показать все (${items.length})`;
    });
    card.append(h("div", { style: { marginTop: "auto" } }, b));
  }
  return card;
}

function syncCard() {
  const ls = S.lastSync;
  const card = sectionCard({ ic: "telegram", tone: "ic-8", title: "Синхронизация Telegram → CRM", sub: "Каждый день в 18:57 Claude читает переписку @ceo_w2w и обновляет карточки. Клиентам ничего не отправляется." });
  if (!ls?.at) {
    card.append(h("p", { class: "empty" }, icon("clock"), "Отчётов о синхронизации пока нет — первый появится после ближайшего вечернего запуска."));
    return card;
  }
  card.append(h("p", { class: "small" }, "Последний запуск: " + timeAgo(ls.at)));
  if (ls.text) {
    const pre = h("div", { class: "secret", style: { whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: "13.5px", userSelect: "text", maxHeight: "260px", overflow: "auto", marginTop: "10px" } }, ls.text);
    card.append(pre);
  }
  return card;
}

async function go(name, params) {
  const m = await import("../main.js");
  m.go(name, params);
}


