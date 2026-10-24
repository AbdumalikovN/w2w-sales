// Модель данных CRM: статусы, этапы, справочники и нормализация карточки сделки.

export const STATUSES = [
  { id: "potential", label: "Потенциальные", group: "new", rank: 0 },
  { id: "research", label: "Изучение", group: "active", rank: 1 },
  { id: "meeting", label: "Назначили встречу", group: "active", rank: 2 },
  { id: "tz", label: "ТЗ", group: "active", rank: 3 },
  { id: "kp", label: "КП", group: "active", rank: 4 },
  { id: "sale", label: "Продажа", group: "active", rank: 5 },
  { id: "waiting", label: "В ожидании", group: "paused", rank: 1 },
  { id: "nurture", label: "Поддержание связи", group: "paused", rank: 1 },
  { id: "contract", label: "Договор · в разработке", group: "won", rank: 6 },
  { id: "won", label: "Успешные", group: "won", rank: 7 },
  { id: "lost", label: "Отменённые", group: "lost", rank: -1 },
  { id: "archive", label: "Архив", group: "lost", rank: -2 },
] as const;
export type StatusId = (typeof STATUSES)[number]["id"];
export const STATUS_IDS = STATUSES.map((s) => s.id) as string[];
export const statusById = (id: string) => STATUSES.find((s) => s.id === id);

// Названия статусов в Notion → id
export const NOTION_STATUS: Record<string, StatusId> = {
  "Потенциальные": "potential",
  "Изучение": "research",
  "Назначили Встречу": "meeting",
  "ТЗ": "tz",
  "КП": "kp",
  "Продажа": "sale",
  "В ожидании": "waiting",
  "Поддержание связи": "nurture",
  "Заключили договор |Процесс разработки": "contract",
  "Успешные": "won",
  "Отмененные": "lost",
  "Архив": "archive",
};

// Статусы, которые синхронизация с Telegram не меняет: их ставит человек.
export const MANUAL_STATUSES = new Set(["tz", "kp", "sale", "waiting", "contract", "won", "archive"]);
// Цепочка, по которой синхронизация двигает карточку только вперёд.
export const AUTO_CHAIN = ["potential", "research", "meeting"];

export const DEV_STAGES = [
  { id: "brief", label: "Старт и бриф" },
  { id: "analysis", label: "Аналитика и ТЗ" },
  { id: "design", label: "Дизайн" },
  { id: "dev", label: "Разработка" },
  { id: "qa", label: "Тестирование" },
  { id: "acceptance", label: "Приёмка клиентом" },
  { id: "done", label: "Сдан" },
  { id: "support", label: "Поддержка" },
];
export const NOTION_DEV_STAGE: Record<string, string> = Object.fromEntries(DEV_STAGES.map((s) => [s.label, s.id]));

export const DEAL_STEPS = [
  "Первый контакт",
  "Выявили потребность",
  "Назначили встречу",
  "Провели встречу / презентовали решение",
  "Составили ТЗ",
  "Согласовали ТЗ с клиентом",
  "Отправили КП",
  "Согласовали КП",
  "Подписали договор",
  "Получили предоплату",
  "Стартовали разработку",
];
export const DOC_STEPS = ["ТЗ загружено", "КП загружено", "Договор подписан и загружен"];

export const PRIORITIES = [
  { id: "high", label: "Высокий" },
  { id: "medium", label: "Средний" },
  { id: "low", label: "Низкий" },
];

export const DEFAULT_SETTINGS = {
  pipelines: [
    { id: "sales", label: "Продажи AI" },
    { id: "logistics", label: "Логистика" },
    { id: "catering", label: "Кейтеринг" },
    { id: "archive", label: "Архив 2025" },
  ],
  sources: [
    "Анкета курса 24-dastur",
    "Участник группы курса",
    "Входящий",
    "Рекомендация",
    "Таргет",
    "LinkedIn",
    "Instagram",
    "Партнёр",
    "Нетворкинг",
    "Другое",
  ],
  sectors: [
    "Еда и общепит",
    "Розничная торговля",
    "Опт и дистрибуция",
    "Производство",
    "Строительство",
    "Медицина и здоровье",
    "IT и маркетинг",
    "Логистика и техника",
    "Образование",
    "Туризм и услуги",
  ],
  regions: [
    "Ташкент",
    "Андижан",
    "Самарканд",
    "Бухара",
    "Коканд",
    "Наманган",
    "Фергана",
    "Хорезм",
    "Сурхандарья",
    "Каракалпакстан",
    "Кашкадарья",
    "Навои",
    "Зарубежье",
  ],
  formats: [
    "Приветствие + голосовое",
    "Знакомство по курсу",
    "Текстовый оффер",
    "Консультация для курсдошей",
    "Тёплый контакт",
    "Входящий",
    "Другое",
  ],
  roles: ["Владелец или директор", "Наёмный сотрудник", "Не указана"],
  reasons: [
    "Сделали сами или с другим подрядчиком",
    "Сначала наведут порядок в процессах",
    "Не сейчас",
    "Нет бюджета или работы",
    "AI не нужен",
    "Не наш клиент",
    "Не AI-запрос или партнёрство",
    "Процессы уже выстроены",
  ],
  requests: [
    "Польза AI для бизнеса",
    "CRM и процессы",
    "Маркетинг и контент",
    "Приём заказов и интеграции",
    "Звонки и колл-центр",
    "Контроль персонала",
    "Рост продаж",
  ],
};
export type Settings = typeof DEFAULT_SETTINGS;
const DICT_KEYS = ["sources", "sectors", "regions", "formats", "roles", "reasons", "requests"] as const;

// ---------- схема полей карточки ----------
type FieldType = "str" | "text" | "url" | "date" | "datetime" | "bool" | "num" | "list" | "enum";
type Field = { t: FieldType; max?: number; values?: string[] };

export const FIELDS: Record<string, Field> = {
  pipeline: { t: "str", max: 40 },
  name: { t: "str", max: 200 },
  status: { t: "enum", values: STATUS_IDS },
  devStage: { t: "enum", values: ["", ...DEV_STAGES.map((s) => s.id)] },
  owner: { t: "str", max: 40 },
  contactName: { t: "str", max: 200 },
  contactRole: { t: "str", max: 80 },
  phone: { t: "str", max: 80 },
  telegram: { t: "url", max: 300 },
  tgIds: { t: "list", max: 40 },
  group: { t: "url", max: 400 },
  driveUrl: { t: "url", max: 600 },
  website: { t: "url", max: 400 },
  instagram: { t: "url", max: 400 },
  tgChannel: { t: "url", max: 400 },
  followers: { t: "str", max: 120 },
  usp: { t: "text", max: 4000 },
  b2b: { t: "bool" },
  priority: { t: "enum", values: ["", "high", "medium", "low"] },
  source: { t: "str", max: 80 },
  sector: { t: "str", max: 80 },
  region: { t: "str", max: 80 },
  format: { t: "str", max: 80 },
  requests: { t: "list", max: 20 },
  reason: { t: "str", max: 120 },
  firstTouch: { t: "date" },
  lastTouch: { t: "date" },
  meetingAt: { t: "datetime" },
  meetingHeld: { t: "bool" },
  waiting: { t: "bool" },
  nextStep: { t: "text", max: 2000 },
  nextStepDue: { t: "date" },
  amount: { t: "num" },
  startDate: { t: "date" },
  deadline: { t: "date" },
  notes: { t: "text", max: 20000 },
};
const OBJECT_FIELDS = ["context", "contacts", "steps", "docs", "links", "agreements", "risks", "meetings"];
export const EDITABLE = new Set([...Object.keys(FIELDS), ...OBJECT_FIELDS]);

const str = (v: unknown, max = 500) => (v == null ? "" : String(v).replace(/\u0000/g, "").trim().slice(0, max));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
const isDateTime = (s: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s));

function safeUrl(v: unknown, max: number) {
  let s = str(v, max);
  if (!s) return "";
  if (/^@?[A-Za-z0-9_]{4,}$/.test(s) && !s.includes(".")) s = "https://t.me/" + s.replace(/^@/, "");
  if (/^t\.me\//i.test(s)) s = "https://" + s;
  if (!/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = "https://" + s;
  return /^https?:\/\//i.test(s) ? s : "";
}

export function cleanField(key: string, v: unknown): unknown {
  const f = FIELDS[key];
  if (!f) return undefined;
  switch (f.t) {
    case "str":
    case "text":
      return str(v, f.max);
    case "url":
      return safeUrl(v, f.max || 500);
    case "date": {
      const s = str(v, 40).slice(0, 10);
      return isDate(s) ? s : "";
    }
    case "datetime": {
      let s = str(v, 40);
      if (isDate(s)) return s;
      // время без часового пояса считаем ташкентским (UTC+5), храним в UTC
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += "+05:00";
      return isDateTime(s) ? new Date(s).toISOString().slice(0, 16) + "Z" : "";
    }
    case "bool":
      return v === true || v === "true" || v === 1 || v === "1" || v === "__YES__";
    case "num": {
      if (v === "" || v == null) return null;
      const n = Number(String(v).replace(/[\s$,]/g, ""));
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    }
    case "list": {
      const arr = Array.isArray(v) ? v : str(v, 2000).split(/[,;\n]/);
      const out: string[] = [];
      for (const x of arr) {
        const s = str(x, 200);
        if (s && !out.includes(s)) out.push(s);
      }
      return out.slice(0, f.max || 50);
    }
    case "enum": {
      const s = str(v, 40);
      return f.values!.includes(s) ? s : f.values!.includes("") ? "" : f.values![0];
    }
  }
}

function cleanObject(key: string, v: any): unknown {
  switch (key) {
    case "context": {
      const o = v && typeof v === "object" ? v : {};
      return {
        business: str(o.business, 2000),
        needs: str(o.needs, 4000),
        howFound: str(o.howFound, 2000),
        budget: str(o.budget, 1000),
      };
    }
    case "contacts":
    case "risks":
      return (Array.isArray(v) ? v : [])
        .map((x) => str(x, 1000))
        .filter(Boolean)
        .slice(0, 50);
    case "steps":
      return DEAL_STEPS.map((_, i) => !!(Array.isArray(v) && v[i]));
    case "docs":
      return DOC_STEPS.map((_, i) => !!(Array.isArray(v) && v[i]));
    case "links":
      return (Array.isArray(v) ? v : [])
        .map((x: any) => ({ label: str(x?.label, 120), url: safeUrl(x?.url, 800) }))
        .filter((x: any) => x.url)
        .slice(0, 30);
    case "agreements": {
      const o = v && typeof v === "object" ? v : {};
      return {
        meeting: str(o.meeting, 1000),
        clientResponsible: str(o.clientResponsible, 500),
        terms: str(o.terms, 1000),
        cadence: str(o.cadence, 500),
      };
    }
    case "meetings":
      return (Array.isArray(v) ? v : [])
        .map((m: any) => ({
          date: cleanField("firstTouch", m?.date) as string,
          discussed: str(m?.discussed, 4000),
          decided: str(m?.decided, 4000),
          next: str(m?.next, 2000),
        }))
        .filter((m: any) => m.date || m.discussed || m.decided || m.next)
        .slice(0, 50);
  }
  return undefined;
}

export function emptyDeal(): Record<string, any> {
  const d: Record<string, any> = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    d[k] = f.t === "bool" ? false : f.t === "num" ? null : f.t === "list" ? [] : "";
  }
  d.pipeline = "sales";
  d.status = "potential";
  for (const k of OBJECT_FIELDS) d[k] = cleanObject(k, undefined);
  return d;
}

/** Применяет изменения к карточке. Возвращает список реально изменённых полей. */
export function applyPatch(deal: Record<string, any>, patch: Record<string, any>, settings: Settings): string[] {
  const changed: string[] = [];
  for (const [k, raw] of Object.entries(patch || {})) {
    if (!EDITABLE.has(k)) continue;
    let v = FIELDS[k] ? cleanField(k, raw) : cleanObject(k, raw);
    if (v === undefined) continue;
    if (k === "pipeline" && !settings.pipelines.some((p) => p.id === v)) continue;
    if (k === "name" && !v) v = "Без названия";
    if (JSON.stringify(deal[k]) !== JSON.stringify(v)) {
      deal[k] = v;
      changed.push(k);
    }
  }
  return changed;
}

export function cleanSettings(input: any, prev: Settings): Settings {
  const out: any = { ...prev };
  if (input && Array.isArray(input.pipelines)) {
    const seen = new Set<string>();
    const ps = input.pipelines
      .map((p: any) => ({ id: str(p?.id, 30).toLowerCase().replace(/[^a-z0-9_-]/g, ""), label: str(p?.label, 60) }))
      .filter((p: any) => p.id && p.label && !seen.has(p.id) && seen.add(p.id));
    if (ps.length) out.pipelines = ps;
  }
  for (const k of DICT_KEYS) {
    if (input && Array.isArray(input[k])) {
      const vals: string[] = [];
      for (const x of input[k]) {
        const s = str(x, 80);
        if (s && !vals.includes(s)) vals.push(s);
      }
      out[k] = vals.slice(0, 100);
    }
  }
  return out;
}

export const LABELS: Record<string, string> = {
  pipeline: "Воронка",
  name: "Название",
  status: "Статус",
  devStage: "Этап разработки",
  owner: "Ответственный",
  contactName: "Контакт",
  contactRole: "Должность",
  phone: "Телефон",
  telegram: "Телеграм",
  tgIds: "Telegram ID",
  group: "Группа с клиентом",
  driveUrl: "Папка Google Drive",
  website: "Сайт",
  instagram: "Instagram",
  tgChannel: "Telegram-канал",
  followers: "Подписчики",
  usp: "УТП",
  b2b: "B2B",
  priority: "Приоритет",
  source: "Источник",
  sector: "Отрасль",
  region: "Регион",
  format: "Формат касания",
  requests: "Запросы",
  reason: "Причина отказа",
  firstTouch: "Первое касание",
  lastTouch: "Последнее касание",
  meetingAt: "Встреча",
  meetingHeld: "Встреча проведена",
  waiting: "Ждёт нашего ответа",
  nextStep: "Следующий шаг",
  nextStepDue: "Срок шага",
  amount: "Сумма договора",
  startDate: "Дата старта",
  deadline: "Дедлайн",
  notes: "Заметки",
  context: "Контекст",
  contacts: "Контакты",
  steps: "Этапы сделки",
  docs: "Документы",
  links: "Ссылки",
  agreements: "Договорённости",
  risks: "Риски",
  meetings: "Заметки со встреч",
};
