/* Общие утилиты: DOM, форматирование дат и чисел, мелкие помощники. */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const NS = "http://www.w3.org/2000/svg";

/** h("div", {class, onclick, ...}, ...children) — безопасно: текст всегда через textContent. */
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k === "style" && typeof v === "object") {
        // Object.assign не умеет CSS-переменные (--c, --n) — их ставим через setProperty.
        for (const [p, val] of Object.entries(v)) {
          if (val == null) continue;
          if (p.startsWith("--")) e.style.setProperty(p, String(val));
          else e.style[p] = val;
        }
      }
      else if (k === "dataset") Object.assign(e.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked") e.checked = !!v;
      else e.setAttribute(k, v === true ? "" : v);
    }
  }
  append(e, kids);
  return e;
}
export function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
export function icon(id, cls) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("class", "ico" + (cls ? " " + cls : ""));
  s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(NS, "use");
  u.setAttribute("href", "#i-" + id);
  s.append(u);
  return s;
}
/** Знак W2W (две «ступени» из логотипа сайта). */
export function svgMark() {
  const s = document.createElementNS(NS, "svg");
  // У <symbol> свой viewBox; внешний задаёт только пропорции знака (445×555).
  s.setAttribute("viewBox", "0 0 445 555");
  s.setAttribute("aria-hidden", "true");
  const u = document.createElementNS(NS, "use");
  u.setAttribute("href", "#i-mark");
  s.append(u);
  return s;
}
/** Высота textarea по содержимому (rows — минимум, max — потолок, дальше прокрутка). */
export function fitTextarea(ta, max = 460) {
  if (!ta?.isConnected) return;
  ta.style.height = "auto";
  const want = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight);
  ta.style.height = Math.min(want, max) + "px";
  ta.style.overflowY = want > max ? "auto" : "hidden";
}
export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Текст с безопасными ссылками: [текст](url), **жирный**, голые http(s)://, t.me/… */
export function richText(str) {
  const frag = document.createDocumentFragment();
  if (!str) return frag;
  const re = /\[([^\]]{1,300})\]\((https?:\/\/[^)\s]{1,800})\)|\*\*([^*]{1,300})\*\*|(https?:\/\/[^\s<>()«»"]{2,800})/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    if (m.index > last) frag.append(document.createTextNode(str.slice(last, m.index)));
    if (m[1]) frag.append(h("a", { href: m[2], target: "_blank", rel: "noopener noreferrer" }, m[1]));
    else if (m[3]) frag.append(h("b", null, m[3]));
    else {
      const url = m[4].replace(/[.,;:!?]+$/, "");
      frag.append(h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, shortUrl(url)));
      if (url.length < m[4].length) frag.append(document.createTextNode(m[4].slice(url.length)));
    }
    last = re.lastIndex;
  }
  if (last < str.length) frag.append(document.createTextNode(str.slice(last)));
  return frag;
}
export function shortUrl(u) {
  try {
    const x = new URL(u);
    let s = x.hostname.replace(/^www\./, "") + (x.pathname !== "/" ? x.pathname : "");
    if (s.length > 48) s = s.slice(0, 46) + "…";
    return s;
  } catch {
    return u;
  }
}

/* ---------- даты (часовой пояс Ташкента) ---------- */
export const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
export const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export function todayTash() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
}
export function addDays(iso, n) {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function diffDays(a, b) {
  return Math.round((Date.parse(a.slice(0, 10) + "T00:00:00Z") - Date.parse(b.slice(0, 10) + "T00:00:00Z")) / 864e5);
}
export function monday(iso) {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}
export const ddmm = (iso) => (iso ? iso.slice(8, 10) + "." + iso.slice(5, 7) : "—");
export const dLong = (iso) => (iso ? +iso.slice(8, 10) + " " + MONTHS[+iso.slice(5, 7) - 1] : "—");
export const dShort = (iso) => (iso ? +iso.slice(8, 10) + " " + MON_SHORT[+iso.slice(5, 7) - 1] : "—");
export function dFull(iso) {
  if (!iso) return "—";
  const y = iso.slice(0, 4), cur = todayTash().slice(0, 4);
  return dLong(iso) + (y !== cur ? " " + y : "");
}
/** Дата+время в часовом поясе Ташкента для значений вида 2026-10-19T14:00Z */
export function tashParts(v) {
  if (!v) return null;
  if (v.length <= 10) return { date: v, time: "" };
  const d = new Date(v);
  if (Number.isNaN(+d)) return { date: v.slice(0, 10), time: "" };
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t) => f.find((p) => p.type === t)?.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}
export function meetingLabel(v) {
  const p = tashParts(v);
  if (!p) return "";
  return dShort(p.date) + (p.time ? ", " + p.time : "");
}
/** значение для <input type=datetime-local> из UTC-строки и обратно (Ташкент = UTC+5) */
export function toLocalInput(v) {
  const p = tashParts(v);
  if (!p) return "";
  return p.date + "T" + (p.time || "10:00");
}
export function fromLocalInput(s) {
  if (!s) return "";
  const d = new Date(s + ":00+05:00");
  return Number.isNaN(+d) ? "" : d.toISOString().slice(0, 16) + "Z";
}
export function timeAgo(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "только что";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${plural(m, "минуту", "минуты", "минут")} назад`;
  const today = todayTash();
  const p = tashParts(iso);
  if (p.date === today) return "сегодня в " + p.time;
  if (p.date === addDays(today, -1)) return "вчера в " + p.time;
  return dFull(p.date) + (p.time ? ", " + p.time : "");
}
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
export function money(n) {
  if (n == null || n === "") return "";
  return "$" + Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 0 }).replace(/ /g, " ");
}
export function initials(name) {
  const p = String(name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase();
}
export function debounce(fn, ms) {
  let t, last = null, pending = false;
  const d = (...a) => {
    last = a;
    pending = true;
    clearTimeout(t);
    t = setTimeout(() => {
      pending = false;
      fn(...last);
    }, ms);
  };
  /** Выполнить сразу: с новыми аргументами или с последними отложенными */
  d.flush = (...a) => {
    clearTimeout(t);
    if (a.length) {
      pending = false;
      fn(...a);
    } else if (pending) {
      pending = false;
      fn(...last);
    }
  };
  d.cancel = () => {
    clearTimeout(t);
    pending = false;
  };
  return d;
}
export const lc = (s) => String(s || "").toLowerCase();
export function tgUsername(url) {
  const m = /t\.me\/([A-Za-z0-9_]{3,})\/?$/i.exec(String(url || "").trim());
  return m && !m[1].startsWith("+") && m[1].toLowerCase() !== "c" ? m[1] : "";
}
export const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
  json(k, fallback) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  setJson(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};
/** Блик стекла следует за курсором (как на сайте w2w.uz) */
export function followLight(el) {
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
    el.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
  });
}
