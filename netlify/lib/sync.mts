// Правила синхронизации переписки Telegram → CRM.
// Синхронизация (запланированная задача Claude) присылает пачку изменений; сервер сам решает,
// что можно менять, чтобы ручные решения менеджеров никогда не перезаписывались.
import { AUTO_CHAIN, MANUAL_STATUSES, NOTION_STATUS, STATUS_IDS, STATUSES, applyPatch, emptyDeal, type Settings } from "./model.mts";
import type { Db, Deal, HistoryItem } from "./db.mts";
import { rid } from "./http.mts";

export const SYNC_USER = "sync";

const lc = (s: unknown) => String(s || "").trim().toLowerCase();
export function tgUsername(url: string) {
  const m = /t\.me\/([A-Za-z0-9_]{3,})\/?$/i.exec(String(url || "").trim());
  return m && !m[1].startsWith("+") && m[1].toLowerCase() !== "c" ? m[1].toLowerCase() : "";
}

export function statusId(v: unknown): string {
  const s = String(v || "").trim();
  if (STATUS_IDS.includes(s)) return s;
  if (NOTION_STATUS[s]) return NOTION_STATUS[s];
  const byLabel = STATUSES.find((x) => lc(x.label) === lc(s));
  return byLabel ? byLabel.id : "";
}

export function findDeal(db: Db, item: any): Deal | null {
  if (item.id && db.deals[item.id] && !db.deals[item.id].deleted) return db.deals[item.id];
  // «Архив 2025» — замороженная история: синхронизация находит его карточки только по явному id
  const deals = Object.values(db.deals).filter((d) => !d.deleted && d.pipeline !== "archive");
  const ids = new Set<string>([...(item.tgIds || []), item.match?.tgId].filter(Boolean).map(String));
  if (ids.size) {
    const d = deals.find((x) => (x.tgIds || []).some((t: string) => ids.has(String(t))));
    if (d) return d;
  }
  const user = lc(item.match?.username).replace(/^@/, "") || tgUsername(item.fields?.telegram);
  if (user) {
    const d = deals.find((x) => tgUsername(x.telegram) === user);
    if (d) return d;
  }
  const group = String(item.match?.group || item.fields?.group || "").trim();
  if (group) {
    const d = deals.find((x) => x.group && x.group === group);
    if (d) return d;
  }
  const name = lc(item.match?.name || "");
  if (name) {
    const d = deals.find((x) => lc(x.name) === name);
    if (d) return d;
  }
  return null;
}

function canSetStatus(cur: string, next: string) {
  if (!next || cur === next) return false;
  if (MANUAL_STATUSES.has(cur) || MANUAL_STATUSES.has(next)) return false;
  const a = AUTO_CHAIN.indexOf(cur), b = AUTO_CHAIN.indexOf(next);
  if (a >= 0 && b >= 0 && b < a) return false; // назад по цепочке не двигаем
  return true;
}

const norm = (s: string) => lc(s).replace(/[«»"'.,:;!?()\-—–]/g, "").replace(/\s+/g, " ").slice(0, 80);

export type SyncResult = { i: number; id?: string; name?: string; action: string; changed?: string[]; skipped?: string[]; error?: string };

/**
 * Применяет одну запись синхронизации к db (в памяти). История возвращается отдельно —
 * её записывает вызывающий код в документы h/<id>.
 */
export function applySyncItem(
  db: Db,
  settings: Settings,
  item: any,
  i: number,
  ctx: { now: string; seq: number; defaultOwner: string },
): { result: SyncResult; history: HistoryItem[]; dealId?: string } {
  const fields = { ...(item.fields || {}) };
  let deal = findDeal(db, item);
  let created = false;
  if (!deal) {
    if (!item.create) return { result: { i, action: "not_found" }, history: [] };
    const d = emptyDeal() as Deal;
    d.id = rid("d");
    d.rev = 0;
    d.seq = ctx.seq;
    d.createdAt = ctx.now;
    d.createdBy = SYNC_USER;
    d.owner = ctx.defaultOwner;
    d.statusAt = ctx.now;
    d.fseq = {};
    db.deals[d.id] = d;
    deal = d;
    created = true;
  }
  const skipped: string[] = [];
  const history: HistoryItem[] = [];

  // статус
  if ("status" in fields) {
    const next = statusId(fields.status);
    delete fields.status;
    if (created) {
      if (next && !MANUAL_STATUSES.has(next)) fields.__status = next;
    } else if (next && next !== deal.status) {
      if (canSetStatus(deal.status, next)) fields.__status = next;
      else skipped.push("status");
    }
  }
  // Telegram ID — только добавляем
  const addIds = [...(item.tgIds || []), ...(Array.isArray(fields.tgIds) ? fields.tgIds : String(fields.tgIds || "").split(/[,\s]+/))]
    .map((x: unknown) => String(x).trim())
    .filter((x: string) => /^-?\d{3,}$/.test(x));
  delete fields.tgIds;
  if (addIds.length) fields.tgIds = [...new Set([...(deal.tgIds || []), ...addIds])];
  // первое касание — только если пусто; последнее — только вперёд
  if (fields.firstTouch && deal.firstTouch) delete fields.firstTouch;
  if (fields.lastTouch && deal.lastTouch && String(fields.lastTouch) <= deal.lastTouch) delete fields.lastTouch;
  // этапы сделки и документы — галочки только ставим
  if (Array.isArray(fields.steps)) fields.steps = (deal.steps || []).map((v: boolean, k: number) => v || !!fields.steps[k]);
  if (Array.isArray(fields.docs)) fields.docs = (deal.docs || []).map((v: boolean, k: number) => v || !!fields.docs[k]);
  // контакты и риски — дописываем новые строки
  for (const k of ["contacts", "risks"]) {
    if (Array.isArray(fields[k])) {
      const have = new Set((deal[k] || []).map(norm));
      fields[k] = [...(deal[k] || []), ...fields[k].filter((x: string) => x && !have.has(norm(x)))];
    }
  }
  // контекст — заполняем только пустые поля, чтобы не стирать то, что вписал человек
  if (fields.context && typeof fields.context === "object") {
    const cur = deal.context || {};
    const merged: Record<string, string> = { ...cur };
    for (const [k, v] of Object.entries(fields.context)) if (v && !cur[k]) merged[k] = String(v);
    fields.context = merged;
  }
  if (fields.agreements && typeof fields.agreements === "object") {
    fields.agreements = { ...(deal.agreements || {}), ...Object.fromEntries(Object.entries(fields.agreements).filter(([, v]) => v)) };
  }
  // ответственный и воронка синхронизацией не меняются
  delete fields.owner;
  if (!created) delete fields.pipeline;
  // пустые строки не стирают заполненные поля (кроме явных false у флагов)
  for (const [k, v] of Object.entries(fields)) {
    if (k === "waiting" || k === "meetingHeld" || k === "__status") continue;
    if (v === "" || v == null) delete fields[k];
  }
  const nextStatus = fields.__status;
  delete fields.__status;
  const before = { status: deal.status, waiting: deal.waiting };
  const changed = applyPatch(deal, fields, settings);
  if (nextStatus && nextStatus !== deal.status) {
    deal.status = nextStatus;
    deal.statusAt = ctx.now;
    changed.push("status");
    if (!created) {
      const from = STATUSES.find((s) => s.id === before.status)?.label || before.status;
      const to = STATUSES.find((s) => s.id === nextStatus)?.label || nextStatus;
      history.push({ id: rid("h"), at: ctx.now, kind: "status", text: `Статус: ${from} → ${to}`, by: SYNC_USER });
    }
  }
  if (created) history.push({ id: rid("h"), at: ctx.now, kind: "system", text: "Карточка создана синхронизацией Telegram", by: SYNC_USER });

  // переписка
  for (const h of Array.isArray(item.history) ? item.history.slice(0, 60) : []) {
    const text = String(h?.text || "").trim().slice(0, 4000);
    if (!text) continue;
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(h?.date || "")) ? String(h.date).slice(0, 10) : ctx.now.slice(0, 10);
    history.push({ id: rid("h"), at: date + "T12:00:00.000Z", label: String(h?.label || "").slice(0, 20) || undefined, kind: "telegram", text, by: SYNC_USER });
  }

  if (changed.length) {
    deal.rev = (deal.rev || 0) + 1;
    deal.seq = ctx.seq;
    deal.updatedAt = ctx.now;
    deal.updatedBy = SYNC_USER;
    deal.fseq ||= {};
    for (const k of changed) deal.fseq[k] = ctx.seq;
  }
  return {
    result: {
      i,
      id: deal.id,
      name: deal.name,
      action: created ? "created" : changed.length ? "updated" : "unchanged",
      changed,
      skipped,
    },
    history,
    dealId: deal.id,
  };
}

/** Добавляет записи истории без дублей (одна дата + похожий текст). */
export function mergeHistory(items: HistoryItem[], add: HistoryItem[]) {
  const seen = new Set(items.map((x) => x.at.slice(0, 10) + "|" + norm(x.text)));
  let n = 0;
  for (const h of add) {
    const key = h.at.slice(0, 10) + "|" + norm(h.text);
    if (h.kind === "telegram" && seen.has(key)) continue;
    seen.add(key);
    items.push(h);
    n++;
  }
  return n;
}
