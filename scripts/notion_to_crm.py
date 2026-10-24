#!/usr/bin/env python3
"""Перенос CRM из Notion: выгрузка → пакет импорта для W2W CRM (POST /api/import).

Вход (файлы с данными клиентов в репозиторий не кладём):
  --crm        выгрузка основной базы (scripts/notion_export.py: props + body)
  --archive    выгрузка «CRM (Архив)» в том же формате или строками представления Notion
  --catering   строки «CRM (Catering)» (формат представления Notion: ключи как в SQL)
  --logistics  строки «CRM (Logistics)»
  --base       база анкет курса
Выход: JSON {deals, history, base} — owner указывается как notion:<user-id>, его заменяет загрузчик.
"""
import argparse, json, re, sys
from datetime import date

STATUS = {
    "Потенциальные": "potential", "Изучение": "research", "Назначили Встречу": "meeting", "ТЗ": "tz", "КП": "kp",
    "Продажа": "sale", "В ожидании": "waiting", "Поддержание связи": "nurture",
    "Заключили договор |Процесс разработки": "contract", "Успешные": "won", "Отмененные": "lost", "Архив": "archive",
}
DEV = {"Старт и бриф": "brief", "Аналитика и ТЗ": "analysis", "Дизайн": "design", "Разработка": "dev", "Тестирование": "qa",
       "Приёмка клиентом": "acceptance", "Сдан": "done", "Поддержка": "support"}
STEPS = ["Первый контакт", "Выявили потребность", "Назначили встречу", "Провели встречу / презентовали решение", "Составили ТЗ",
         "Согласовали ТЗ с клиентом", "Отправили КП", "Согласовали КП", "Подписали договор", "Получили предоплату", "Стартовали разработку"]
DOCS = ["ТЗ загружено", "КП загружено", "Договор подписан и загружен"]
PRIORITY = {"Высокий": "high", "Высокая": "high", "Тёплый": "medium", "Средняя": "medium", "Холодный": "low", "Низкая": "low"}
CHANNEL = {"Target": "Таргет", "Linkedin": "LinkedIn", "Partner": "Партнёр", "Network": "Нетворкинг", "Instagram": "Instagram"}
EXPORT_DAY = date.today().isoformat()


def did(notion_id):
    return "n" + notion_id.replace("-", "")[-16:]


def clean_html(s):
    if not s:
        return ""
    s = re.sub(r"<br\s*/?>", " · ", str(s))
    s = re.sub(r"</?(p|b|i|strong|em|span)[^>]*>", " ", s)
    s = re.sub(r"(\s*·\s*)+", " · ", s)
    return re.sub(r"\s+", " ", s).strip(" ·")


def unlink(s):
    s = clean_html(s or "")
    m = re.match(r"^\[(.*?)\]\(.*\)$", s)
    return (m.group(1) if m else s).replace("\\_", "_").strip()


def ymd(v):
    if not v:
        return ""
    if isinstance(v, dict):
        v = v.get("start")
    return str(v)[:10] if v else ""


def meeting_dt(v):
    if not v:
        return ""
    if isinstance(v, dict):
        v = v.get("start")
    v = str(v)
    if len(v) > 10 and "T" in v:
        # нормализуем в UTC «YYYY-MM-DDTHH:MMZ»
        from datetime import datetime, timezone
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
        except ValueError:
            return v[:10]
    return v[:10]


def owner_of(v):
    if not v:
        return ""
    if isinstance(v, list) and v:
        x = v[0]
        return "notion:" + (x.get("id") if isinstance(x, dict) else str(x).replace("user://", ""))
    if isinstance(v, str):
        try:
            arr = json.loads(v)
            if arr:
                return "notion:" + str(arr[0]).replace("user://", "")
        except ValueError:
            pass
    return ""


def yes(v):
    return v is True or v == "__YES__"


def year_for(dd, mm, ref_year):
    try:
        d = date(ref_year, int(mm), int(dd)).isoformat()
    except ValueError:
        return None
    if d > EXPORT_DAY:
        try:
            d = date(ref_year - 1, int(mm), int(dd)).isoformat()
        except ValueError:
            return None
    return d


LABEL_RE = re.compile(r"^\*\*(.+?):\*\*\s*(.*)$")
HIST_RE = re.compile(r"^(\d{1,2})(?:\s*[–-]\s*\d{1,2})?\.(\d{1,2})(?:\.(\d{2,4}))?(\s*\([^)]*\)|\s+[а-яА-ЯёЁ]{3,12})?\s*[—–-]\s*(.*)$")


def parse_body(body, ref_year, created):
    """Разбирает тело карточки по шаблону CRM на структурные поля. Всё нераспознанное — в notes."""
    out = {"context": {}, "contacts": [], "steps": [False] * len(STEPS), "docs": [False] * len(DOCS), "agreements": {},
           "risks": [], "meetings": [], "history": [], "notes": []}
    sections, cur = [], None
    for line in body.split("\n"):
        if line.startswith("## "):
            cur = [line[3:].strip(), []]
            sections.append(cur)
        elif cur is None:
            if line.strip():
                out["notes"].append(line)
        else:
            cur[1].append(line)
    ctx_map = {"Чем занимается": "business", "Что им нужно": "needs", "Как вышли на нас": "howFound", "Бюджетные ожидания": "budget"}
    agr_map = {"Встреча": "meeting", "Кто отвечает со стороны клиента": "clientResponsible", "Сроки": "terms", "Периодичность связи": "cadence"}
    for title, lines in sections:
        lines = [l for l in lines if l.strip() and l.strip() != "---"]
        if title.startswith("Контекст клиента"):
            key = None
            for l in lines:
                m = LABEL_RE.match(l.strip())
                if m and m.group(1) in ctx_map:
                    key = ctx_map[m.group(1)]
                    out["context"][key] = m.group(2).strip()
                elif key:
                    out["context"][key] = (out["context"][key] + "\n" + l.strip()).strip()
                else:
                    out["notes"].append(l)
        elif title.startswith("Контакты"):
            out["contacts"] += [re.sub(r"^\s*-\s*", "", l).strip() for l in lines if re.sub(r"^\s*-\s*", "", l).strip()]
        elif title.startswith("Этапы сделки"):
            for l in lines:
                m = re.match(r"^\s*-\s*\[(x| )\]\s*(.*)$", l)
                if m and m.group(2).strip() in STEPS:
                    out["steps"][STEPS.index(m.group(2).strip())] = m.group(1) == "x"
                elif m and m.group(2).strip():
                    out["notes"].append(l)
        elif title.startswith("Документы"):
            for l in lines:
                m = re.match(r"^\s*-\s*\[(x| )\]\s*(.*)$", l)
                if m and m.group(2).strip() in DOCS:
                    out["docs"][DOCS.index(m.group(2).strip())] = m.group(1) == "x"
                elif m and m.group(2).strip():
                    out["notes"].append(l)
                elif "Все файлы" not in l:
                    out["notes"].append(l)
        elif title.startswith("История переписки"):
            last = created[:10]
            for l in lines:
                t = re.sub(r"^\s*-\s*", "", l).strip()
                if not t:
                    continue
                m = HIST_RE.match(t)
                if m:
                    y = int(m.group(3)) if m.group(3) else ref_year
                    if y < 100:
                        y += 2000
                    d = year_for(m.group(1), m.group(2), y) or last
                    label = t[: t.find(m.group(5))].strip(" —–-") if m.group(5) else ""
                    out["history"].append({"at": d + "T12:00:00.000Z", "label": label[:20], "kind": "telegram", "text": m.group(5).strip() or t})
                    last = d
                else:
                    out["history"].append({"at": last + "T12:00:00.000Z", "label": "", "kind": "telegram", "text": t})
        elif title.startswith("Договорённости"):
            key = None
            for l in lines:
                m = LABEL_RE.match(l.strip())
                if m and m.group(1) in agr_map:
                    key = agr_map[m.group(1)]
                    out["agreements"][key] = m.group(2).strip()
                elif m and m.group(1) == "Следующий шаг":
                    key = None
                    out["agreements"]["nextStepNote"] = m.group(2).strip()
                elif key:
                    out["agreements"][key] = (out["agreements"][key] + "\n" + l.strip()).strip()
                elif l.strip() not in ("**Сроки:**",):
                    out["notes"].append(l)
        elif title.startswith("Риски"):
            out["risks"] += [re.sub(r"^\s*-\s*", "", l).strip() for l in lines if re.sub(r"^\s*-\s*", "", l).strip()]
        elif title.startswith("Заметки со встреч"):
            m = {"date": "", "discussed": "", "decided": "", "next": ""}
            for l in lines:
                s = l.strip()
                if s.startswith("**Дата"):
                    m["date"] = re.sub(r"^\*\*Дата\s*—?\*\*\s*", "", s)
                elif s.startswith("Что обсудили:"):
                    m["discussed"] = s.split(":", 1)[1].strip()
                elif s.startswith("Что решили:"):
                    m["decided"] = s.split(":", 1)[1].strip()
                elif s.startswith("Следующий шаг и когда:"):
                    m["next"] = s.split(":", 1)[1].strip()
                else:
                    m["discussed"] = (m["discussed"] + "\n" + s).strip()
            if any(m[k] for k in ("discussed", "decided", "next")) or (m["date"] and m["date"] not in ("", "—")):
                dm = re.match(r"(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?", m["date"])
                m["date"] = (year_for(dm.group(1), dm.group(2), int(dm.group(3) or ref_year)) or "") if dm else ""
                out["meetings"].append(m)
        else:
            out["notes"].append("## " + title)
            out["notes"] += lines
    nxt = out["agreements"].pop("nextStepNote", "")
    out["notes"] = "\n".join(out["notes"]).strip()
    out["_agreementNext"] = nxt
    return out


def from_crm_page(p, db="crm"):
    pr = p["props"]
    name = unlink(pr.get("Название компании")) or "Без названия"
    created = p.get("created") or ""
    ref_year = int((ymd(pr.get("Первое касание")) or created or EXPORT_DAY)[:4])
    body = parse_body(p.get("body") or "", ref_year, created)
    deal = {
        "id": did(p["id"]), "pipeline": "sales" if db == "crm" else db, "name": name,
        "status": STATUS.get(pr.get("Статус") or "", "potential"), "devStage": DEV.get(pr.get("Этап разработки") or "", ""),
        "owner": owner_of(pr.get("Ответственный")), "contactName": unlink(pr.get("ФИО контакта")),
        "contactRole": pr.get("Должность контакта") or "", "phone": pr.get("Телефон") or "", "telegram": pr.get("Телеграм") or "",
        "tgIds": [x for x in re.split(r"[,\s]+", str(pr.get("Telegram ID") or "")) if x.strip()],
        "group": pr.get("Группа с клиентом") or "", "driveUrl": pr.get("Папка Google Drive") or "",
        "source": pr.get("Источник") or "", "sector": pr.get("Отрасль") or "", "region": pr.get("Регион") or "",
        "format": pr.get("Формат касания") or "", "requests": pr.get("Запросы") or [], "reason": pr.get("Причина отказа") or "",
        "firstTouch": ymd(pr.get("Первое касание")), "lastTouch": ymd(pr.get("Последнее касание")),
        "meetingAt": meeting_dt(pr.get("Встреча")), "meetingHeld": yes(pr.get("Встреча проведена")),
        "waiting": yes(pr.get("Ждёт нашего ответа")), "nextStep": pr.get("Следующий шаг") or body["_agreementNext"] or "",
        "amount": pr.get("Сумма договора"), "startDate": ymd(pr.get("Дата старта")), "deadline": ymd(pr.get("Дедлайн")),
        "context": body["context"], "contacts": body["contacts"], "steps": body["steps"], "docs": body["docs"],
        "agreements": body["agreements"], "risks": body["risks"], "meetings": body["meetings"], "notes": body["notes"],
        "createdAt": created, "updatedAt": p.get("edited") or created, "createdBy": "import", "updatedBy": "import",
        "notion": {"id": p["id"], "url": p.get("url") or "", "db": db},
    }
    return deal, body["history"]


MD_LINK = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")


def notion_text(s):
    """Notion-flavored Markdown (как его отдаёт Notion MCP) → простой текст для поля «Заметки»."""
    if not s:
        return ""
    s = s.replace("\\_", "_").replace("\\*", "*").replace("\\#", "#")

    def link(m):
        label, url = m.group(1).strip(), m.group(2)
        return url if not label or label.rstrip("/") == url.rstrip("/") else f"{label} — {url}"

    s = MD_LINK.sub(link, s)
    s = re.sub(r"<br\s*/?>", "\n", s)
    s = re.sub(r"<p\s*/>", "\n", s)
    s = re.sub(r"</?p(\s[^>]*)?>", "\n", s)
    s = re.sub(r"</?(b|strong|i|em|u|s|span|mark)(\s[^>]*)?>", "", s)
    s = re.sub(r"^#{1,6}\s*", "", s, flags=re.M)
    s = "\n".join(line.rstrip() for line in s.split("\n"))
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return "" if re.fullmatch(r"[\W_]*", s) else s


def notion_links(body):
    """Ссылки из тела карточки с понятной подписью: КП/ТЗ по заголовку раздела, иначе по сайту."""
    out, heading = [], ""
    for line in (body or "").split("\n"):
        if line.startswith("#"):
            heading = re.sub(r"<[^>]+>", "", line).strip("# ").lower()
        for m in MD_LINK.finditer(line):
            url = m.group(2)
            host = re.sub(r"^www\.", "", url.split("/")[2])
            if "коммерческ" in heading:
                label = "КП"
            elif "техническ" in heading or heading.startswith("тз"):
                label = "ТЗ"
            elif "figma.com" in host:
                label = "Figma"
            elif host == "docs.google.com":
                label = "Google Docs"
            elif host == "drive.google.com":
                label = "Google Drive"
            else:
                label = host
            if url not in [x["url"] for x in out]:
                out.append({"label": label, "url": url})
    return out


def view_val(r, key):
    return r.get(key) if r.get(key) not in (None, "") else None


def from_archive_row(r):
    """Строка «CRM (Архив)»: свойства в формате представления или выгрузки + body."""
    props = r.get("props") or r
    nid = r.get("id") or (props.get("url") or "").rstrip("/").split("/")[-1].split("?")[0]
    body = r.get("body") or ""
    created = r.get("created") or ""
    deal = {
        "id": did(nid), "pipeline": "archive", "name": unlink(props.get("Название компании")) or "Без названия",
        "status": STATUS.get(props.get("Статус") or "", "archive"), "owner": owner_of(props.get("Ответственный")),
        "contactName": unlink(props.get("ФИО контакта")), "phone": props.get("Телефон") or "",
        "telegram": props.get("Телеграм") or "", "group": props.get("Группа с клиентом") or "",
        "driveUrl": props.get("Папка Google Drive") or "",
        "deadline": ymd(props.get("Deadline")) or (props.get("date:Deadline:start") or "")[:10],
        "notes": notion_text(body), "createdAt": created, "updatedAt": r.get("edited") or created,
        "createdBy": "import", "updatedBy": "import",
        "notion": {"id": nid, "url": props.get("url") or r.get("url") or "", "db": "archive"},
    }
    links = notion_links(body)
    if links:
        deal["links"] = links
    return deal


def from_catering_row(r):
    props = r.get("props") or r
    url = props.get("url") or r.get("url") or ""
    nid = r.get("id") or url.rstrip("/").split("/")[-1].split("?")[0]
    deal = {
        "id": did(nid), "pipeline": "catering", "name": unlink(props.get("Название проекта ")) or "Без названия",
        "status": STATUS.get(props.get("Статус") or "", "potential"), "owner": owner_of(props.get("Владелец")),
        "priority": PRIORITY.get(props.get("приоритет") or "", ""), "b2b": yes(props.get("B2B")),
        "phone": props.get("Телефон номер") or "", "telegram": props.get("Телеграмм") or "",
        "tgChannel": props.get("Телеграмм канал") or "", "instagram": props.get("Интаграм") or "",
        "website": props.get("Сайт") or "", "followers": clean_html(props.get("Количество подписчиков")),
        "usp": clean_html(props.get("УТП ( уникальное торговое предложение)")), "sector": "Еда и общепит",
        "notes": (r.get("body") or "").strip(), "createdAt": r.get("created") or "", "updatedAt": r.get("edited") or r.get("created") or "",
        "createdBy": "import", "updatedBy": "import", "notion": {"id": nid, "url": url, "db": "catering"},
    }
    return deal


def from_logistics_row(r):
    props = r.get("props") or r
    url = props.get("url") or r.get("url") or ""
    nid = r.get("id") or url.rstrip("/").split("/")[-1].split("?")[0]
    links = [{"label": lbl, "url": props.get(k)} for k, lbl in (("Коммерческое предложение ", "КП"), ("Техническое задание", "ТЗ"), ("Figma KP ", "Figma КП")) if props.get(k)]
    return {
        "id": did(nid), "pipeline": "logistics", "name": unlink(props.get("Название проекта")) or "Без названия",
        "status": STATUS.get(props.get("Статус") or "", "potential"), "owner": owner_of(props.get("Владелец ")),
        "contactName": props.get("Имя") or "", "phone": props.get("Телефон ") or "",
        "source": CHANNEL.get(props.get("Канал") or "", ""), "priority": PRIORITY.get(props.get("Приоритет ") or "", ""),
        "amount": props.get("Цена "), "deadline": (props.get("date:Дэдлайн :start") or ymd(props.get("Дэдлайн ")) or "")[:10],
        "links": links, "notes": (r.get("body") or "").strip(), "createdBy": "import", "updatedBy": "import",
        "notion": {"id": nid, "url": url, "db": "logistics"},
    }


def load_rows(path):
    d = json.load(open(path, encoding="utf-8"))
    if isinstance(d, dict) and "databases" in d:
        return d
    if isinstance(d, dict) and "results" in d:
        return d["results"]
    return d


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--crm", required=True)
    ap.add_argument("--archive", nargs="*", default=[])
    ap.add_argument("--catering", nargs="*", default=[])
    ap.add_argument("--logistics", nargs="*", default=[])
    ap.add_argument("--base")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    exp = load_rows(a.crm)
    deals, history = [], {}
    dbs = exp["databases"] if isinstance(exp, dict) and "databases" in exp else {"crm": exp}
    for p in dbs.get("crm", []):
        d, h = from_crm_page(p)
        deals.append(d)
        if h:
            history[d["id"]] = h
    skipped = 0
    for path in a.archive:
        for r in (dbs.get("archive") if path == a.crm else load_rows(path)) or []:
            d = from_archive_row(r)
            # пустые карточки Notion (ни названия, ни контакта, ни текста) не переносим
            if d["name"] == "Без названия" and not (d["contactName"] or d["phone"] or d["notes"] or d.get("links")):
                skipped += 1
                continue
            deals.append(d)
    for path in a.catering:
        for r in load_rows(path):
            deals.append(from_catering_row(r))
    for path in a.logistics:
        for r in load_rows(path):
            deals.append(from_logistics_row(r))
    ids = [d["id"] for d in deals]
    dup = {x for x in ids if ids.count(x) > 1}
    if dup:
        sys.exit(f"Повторяющиеся id: {dup}")
    out = {"deals": deals, "history": history}
    if a.base:
        b = json.load(open(a.base, encoding="utf-8"))
        out["base"] = {"asOf": b.get("asOf", ""), "leads": b.get("leads", [])}
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
    by = {}
    for d in deals:
        by[d["pipeline"]] = by.get(d["pipeline"], 0) + 1
    print(f"сделок: {len(deals)} {by}; записей истории: {sum(len(v) for v in history.values())}; анкет: {len(out.get('base', {}).get('leads', []))}"
          + (f"; пустых карточек архива пропущено: {skipped}" if skipped else ""))


if __name__ == "__main__":
    main()
