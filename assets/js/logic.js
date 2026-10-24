/* Расчёты воронки, сигналов и аналитики (логика прежнего дашборда «Продажи W2W»). */
import { S } from "./state.js";
import { addDays, pct, plural, lc, tgUsername } from "./core.js";

export const FINISH = new Set(["tz", "kp", "sale"]);
export const isWaiting = (d) => d._.waiting;

export function stats(list) {
  const n = list.length;
  let rep = 0, int = 0, ms = 0, mh = 0, pr = 0, won = 0;
  for (const d of list) {
    if (d._.replied) rep++;
    if (d._.interest) int++;
    if (d._.meetingSet) ms++;
    if (d.meetingHeld) mh++;
    if (d._.proposal) pr++;
    if (d._.won) won++;
  }
  return { n, rep, int, ms, mh, pr, won };
}

export function inPeriod(d, period) {
  if (!d._.tracked) return false;
  if (period === "all") return true;
  return d.firstTouch >= addDays(S.today, -(+period - 1));
}

export function groupBy(list, key) {
  const m = new Map();
  for (const d of list) {
    const k = (typeof key === "function" ? key(d) : d[key]) || null;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d);
  }
  return m;
}

export const byIdle = (a, b) => (b._.idle ?? 0) - (a._.idle ?? 0);

/** Списки «на сегодня» */
export function signals(all) {
  const today = S.today;
  const fresh = all.filter((d) => d.firstTouch && d.firstTouch >= addDays(today, -2)).sort((a, b) => b.firstTouch.localeCompare(a.firstTouch));
  const finish = all.filter((d) => FINISH.has(d.status)).sort(byIdle);
  const stuck = all.filter((d) => d.meetingHeld && d._.g === "active" && !FINISH.has(d.status) && (d._.idle ?? 0) > 7).sort(byIdle);
  const upcoming = all.filter((d) => d._.meetingDate && d._.meetingDate >= today && !d.meetingHeld && d._.g !== "lost").sort((a, b) => a.meetingAt.localeCompare(b.meetingAt));
  const undated = all.filter((d) => d.status === "meeting" && !d.meetingHeld && (!d._.meetingDate || d._.meetingDate < today)).sort(byIdle);
  const call = all.filter((d) => d.status === "potential" && (d._.idle ?? 0) >= 3).sort((a, b) => b._.owner - a._.owner || byIdle(a, b));
  const due = all.filter((d) => d._.due).sort((a, b) => a.nextStepDue.localeCompare(b.nextStepDue));
  const waiting = all.filter(isWaiting).sort((a, b) => (b._.idle ?? -1) - (a._.idle ?? -1) || a.name.localeCompare(b.name, "ru"));
  return { fresh, finish, stuck, upcoming, undated, call, due, waiting };
}

/** Анкеты курса без карточки в CRM */
export function uncontacted(base, deals) {
  if (!base?.leads?.length) return [];
  const ids = new Set(), users = new Set();
  for (const d of deals) {
    (d.tgIds || []).forEach((x) => ids.add(String(x)));
    const u = tgUsername(d.telegram);
    if (u) users.add(u.toLowerCase());
  }
  const best = bestRegion(deals);
  return base.leads
    .filter((l) => !l.dealId && l.status !== "skipped" && !(l.tgId && ids.has(String(l.tgId))) && !(l.tg && users.has(lc(l.tg))))
    .sort((a, b) => (b.lpr === true) - (a.lpr === true) || (b.region === best) - (a.region === best) || a.n - b.n);
}
export function leadInCrm(l, deals) {
  if (l.dealId) return true;
  for (const d of deals) {
    if (l.tgId && (d.tgIds || []).includes(String(l.tgId))) return true;
    if (l.tg && lc(tgUsername(d.telegram)) === lc(l.tg)) return true;
  }
  return false;
}
export function bestRegion(deals) {
  const tr = deals.filter((d) => d._.tracked);
  const g = [...groupBy(tr, "region")].filter(([k, v]) => k && v.length >= 5).map(([k, v]) => ({ k, r: stats(v).rep / v.length })).sort((a, b) => b.r - a.r);
  return g.length ? g[0].k : null;
}

/** Выводы по данным — текстом, как в прежнем дашборде */
export function insights(rows, allWaiting) {
  const out = [], s = stats(rows);
  const pick = (map, minN) => [...map].filter(([k, v]) => k && v.length >= minN).map(([k, v]) => ({ k, s: stats(v) }));
  const COLD = new Set(["Тёплый контакт", "Входящий", "Другое"]);
  const fm = pick(groupBy(rows.filter((d) => !COLD.has(d.format)), "format"), 8).sort((a, b) => pct(b.s.rep, b.s.n) - pct(a.s.rep, a.s.n));
  if (fm.length >= 2 && pct(fm[0].s.rep, fm[0].s.n) - pct(fm.at(-1).s.rep, fm.at(-1).s.n) >= 15)
    out.push([`«${fm[0].k}» даёт `, ["b", pct(fm[0].s.rep, fm[0].s.n) + "% ответов"], ` (${fm[0].s.rep} из ${fm[0].s.n}), «${fm.at(-1).k}» — ${pct(fm.at(-1).s.rep, fm.at(-1).s.n)}% (${fm.at(-1).s.rep} из ${fm.at(-1).s.n}).`]);
  const own = stats(rows.filter((d) => d._.owner)), hir = stats(rows.filter((d) => d._.hired));
  if (own.n >= 5 && hir.n >= 3 && pct(own.rep, own.n) > pct(hir.rep, hir.n))
    out.push(["Владельцы и директора отвечают в ", ["b", pct(own.rep, own.n) + "%"], ` случаев, наёмные сотрудники — в ${pct(hir.rep, hir.n)}% (${hir.rep} из ${hir.n}). Пишите первому лицу.`]);
  const rg = pick(groupBy(rows, "region"), 5).sort((a, b) => pct(b.s.rep, b.s.n) - pct(a.s.rep, a.s.n));
  if (rg.length >= 2) {
    const lo = rg.at(-1);
    out.push(["Лучше всего отвечает ", ["b", `${rg[0].k}: ${pct(rg[0].s.rep, rg[0].s.n)}%`], ` (${rg[0].s.rep} из ${rg[0].s.n}). ${lo.k}: ${lo.s.rep} из ${lo.s.n}` + (lo.s.rep === 0 ? " — туда лучше звонить." : ".")]);
  }
  const sc = pick(groupBy(rows, "sector"), 4).filter((x) => x.s.ms >= 2).sort((a, b) => b.s.ms / b.s.n - a.s.ms / a.s.n);
  if (sc.length) out.push(["Чаще всего до встречи доходит ", ["b", sc[0].k.toLowerCase()], `: ${sc[0].s.ms} ${plural(sc[0].s.ms, "встреча", "встречи", "встреч")} на ${sc[0].s.n} ${plural(sc[0].s.n, "компанию", "компании", "компаний")}.`]);
  if (s.mh >= 3 && s.pr / s.mh < 0.5) out.push(["Узкое место — шаг после встречи: из ", ["b", `${s.mh} проведённых встреч`], ` до ТЗ или КП дошли ${s.pr}. Отправляйте КП в течение 48 часов после встречи.`]);
  if (allWaiting) out.push([["b", `${allWaiting} ${plural(allWaiting, "клиент ждёт", "клиента ждут", "клиентов ждут")} нашего ответа`], " — это самые тёплые сделки, начните день с них."]);
  return out;
}

/** Заполненность карточки (замена формулы «Заполненность» из Notion) */
export function completeness(d) {
  const checks = [
    ["Контакт", !!d.contactName],
    ["Телефон", !!d.phone],
    ["Телеграм", !!d.telegram || (d.tgIds || []).length > 0],
    ["Отрасль", !!d.sector],
    ["Регион", !!d.region],
    ["Источник", !!d.source],
    ["Следующий шаг", !!d.nextStep || d._.g === "lost"],
    ["Чем занимается", !!d.context?.business],
  ];
  if (["tz", "kp", "sale", "contract", "won"].includes(d.status)) {
    checks.push(["Папка Google Drive", !!d.driveUrl]);
    checks.push(["Группа с клиентом", !!d.group]);
  }
  if (d.status === "contract") {
    checks.push(["Сумма договора", d.amount != null]);
    checks.push(["Дедлайн", !!d.deadline]);
  }
  const ok = checks.filter((c) => c[1]).length;
  return { pct: Math.round((ok * 100) / checks.length), missing: checks.filter((c) => !c[1]).map((c) => c[0]) };
}

export function matchQuery(d, q) {
  if (!q) return true;
  const hay = [d.name, d.contactName, d.phone, d.telegram, (d.tgIds || []).join(" "), d.nextStep, d.sector, d.region, d.context?.business].join(" ").toLowerCase();
  const digits = q.replace(/\D/g, "");
  if (digits.length >= 5 && (d.phone || "").replace(/\D/g, "").includes(digits)) return true;
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w.replace(/^@/, "")));
}
