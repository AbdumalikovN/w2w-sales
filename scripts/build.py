#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Сборка сайта «Продажи W2W».

Notion CRM → нормализованный список сделок → шифрование паролем → папка _site/ для GitHub Pages.

Режимы:
  python scripts/build.py                      # NOTION_TOKEN задан → свежие данные из Notion; иначе берётся снимок data/crm.json
  python scripts/build.py --rows export.json   # строки, выгруженные из Notion через Claude (SQL-формат коннектора)
  python scripts/build.py --save-snapshot      # дополнительно перезаписать data/crm.json (для коммита)
  python scripts/build.py --encrypt-base base.json   # зашифровать базу анкет курса в data/base.json

Переменные окружения:
  NOTION_TOKEN          секрет внутренней интеграции Notion с доступом к базе CRM
  DASHBOARD_PASSWORD    пароль страницы; без него данные не публикуются
  NOTION_DATABASE_ID    по умолчанию — база CRM в Win To Win
"""
import argparse, base64, datetime as dt, json, os, re, shutil, sys, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "_site")
DB_ID = os.environ.get("NOTION_DATABASE_ID", "3c61f39881f3809ea842e694b9f5acc1")
DS_ID = os.environ.get("NOTION_DATA_SOURCE_ID", "3b41f398-81f3-8351-86ec-072fa6f1bc23")
ITER = 310_000

# Свойство Notion → ключ в данных дашборда
FIELDS = {
    "Название компании": "name", "Статус": "status", "Telegram ID": "tgIds", "Телеграм": "tgUrl",
    "Источник": "source", "Отрасль": "sector", "Регион": "region",
    "Первое касание": "first", "Последнее касание": "last", "Формат касания": "format",
    "Должность контакта": "role", "Встреча": "meeting", "Встреча проведена": "held",
    "Ждёт нашего ответа": "waiting", "Следующий шаг": "next", "Причина отказа": "reason",
    "Запросы": "requests", "Сумма договора": "amount", "Группа с клиентом": "group",
}


def log(*a):
    print("·", *a, file=sys.stderr)


# ---------- Notion API ----------
def _post(url, body, token, version):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {token}", "Notion-Version": version, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def _value(p):
    t = p.get("type")
    v = p.get(t)
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in v or []) or None
    if t in ("select", "status"):
        return v.get("name") if v else None
    if t == "multi_select":
        return [o["name"] for o in v or []]
    if t == "date":
        return v.get("start") if v else None
    if t in ("checkbox", "number", "url", "phone_number", "email"):
        return v
    if t == "people":
        return [x.get("name") for x in v or []]
    if t == "formula":
        return v.get(v.get("type")) if v else None
    return None


def fetch_notion(token):
    endpoints = [(f"https://api.notion.com/v1/databases/{DB_ID}/query", "2022-06-28"),
                 (f"https://api.notion.com/v1/data_sources/{DS_ID}/query", "2025-09-03")]
    last_err = None
    for url, ver in endpoints:
        pages, cursor = [], None
        try:
            while True:
                body = {"page_size": 100}
                if cursor:
                    body["start_cursor"] = cursor
                res = _post(url, body, token, ver)
                pages += res.get("results", [])
                if not res.get("has_more"):
                    break
                cursor = res.get("next_cursor")
        except urllib.error.HTTPError as e:
            last_err = f"{e.code} {e.read().decode(errors='replace')[:300]}"
            log("Notion ответил ошибкой:", last_err, "— пробую другой адрес API")
            continue
        rows = []
        for pg in pages:
            if pg.get("archived") or pg.get("in_trash"):
                continue
            r = {"id": pg["id"].replace("-", ""), "url": pg.get("url"),
                 "created": pg.get("created_time"), "edited": pg.get("last_edited_time")}
            for name, prop in pg.get("properties", {}).items():
                if name in FIELDS:
                    r[FIELDS[name]] = _value(prop)
            rows.append(r)
        log(f"Из Notion получено карточек: {len(rows)}")
        return [normalize(r) for r in rows]
    raise SystemExit(f"Не удалось прочитать базу CRM в Notion: {last_err}. "
                     "Проверьте, что интеграция подключена к базе (··· → Connections) и токен верный.")


# ---------- выгрузка через Claude (SQL-формат коннектора Notion) ----------
def from_export(path):
    data = json.load(open(path, encoding="utf-8"))
    rows = data.get("results", data) if isinstance(data, dict) else data
    out = []
    for x in rows:
        r = {"id": (x.get("url") or "").rstrip("/").split("/")[-1].split("?")[0].replace("-", ""),
             "url": x.get("url"), "created": x.get("createdTime"), "edited": x.get("lastEditedTime")}
        for name, key in FIELDS.items():
            if f"date:{name}:start" in x:
                r[key] = x.get(f"date:{name}:start")
            elif name in x:
                r[key] = x[name]
        out.append(normalize(r))
    log(f"Из выгрузки прочитано карточек: {len(out)}")
    return out


def normalize(r):
    def yes(v):
        return v is True or v == "__YES__"

    def lst(v):
        if v is None:
            return []
        if isinstance(v, list):
            return v
        try:
            j = json.loads(v)
            return j if isinstance(j, list) else [str(j)]
        except Exception:
            return [s.strip() for s in str(v).split(",") if s.strip()]

    def day(v):
        return str(v)[:10] if v else None

    tg = r.get("tgIds") or ""
    return {
        "id": r.get("id"), "url": f"https://www.notion.so/{r.get('id')}" if r.get("id") else r.get("url"),
        "name": re.sub(r"^\[(.*?)\]\(.*\)$", r"\1", (r.get("name") or "Без названия").strip()),
        "status": r.get("status") or "Без статуса",
        "tg": [s for s in re.split(r"[,\s]+", str(tg)) if s.isdigit()],
        "tgUrl": r.get("tgUrl"), "source": r.get("source"), "sector": r.get("sector"), "region": r.get("region"),
        "first": day(r.get("first")), "last": day(r.get("last")), "format": r.get("format"), "role": r.get("role"),
        "meeting": day(r.get("meeting")), "held": yes(r.get("held")), "waiting": yes(r.get("waiting")),
        "next": r.get("next"), "reason": r.get("reason"), "requests": lst(r.get("requests")),
        "amount": r.get("amount") if isinstance(r.get("amount"), (int, float)) else None,
        "group": r.get("group"), "created": day(r.get("created")), "edited": day(r.get("edited")),
    }


# ---------- шифрование (AES-256-GCM, ключ из пароля через PBKDF2-SHA256) ----------
def encrypt(obj, password):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode())
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b(salt), "iv": b(iv), "ct": b(ct)}


def decrypt(env, password):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    d = lambda x: base64.b64decode(x)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=d(env["salt"]), iterations=env["iter"]).derive(password.encode())
    return json.loads(AESGCM(key).decrypt(d(env["iv"]), d(env["ct"]), None))


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rows", help="JSON-выгрузка строк CRM (формат коннектора Notion)")
    ap.add_argument("--save-snapshot", action="store_true", help="перезаписать data/crm.json")
    ap.add_argument("--encrypt-base", help="зашифровать базу анкет в data/base.json и выйти")
    ap.add_argument("--no-site", action="store_true", help="не собирать _site/")
    a = ap.parse_args()

    password = os.environ.get("DASHBOARD_PASSWORD", "")
    token = os.environ.get("NOTION_TOKEN", "")

    if a.encrypt_base:
        if not password:
            raise SystemExit("Задайте DASHBOARD_PASSWORD.")
        write_json(os.path.join(ROOT, "data", "base.json"), encrypt(json.load(open(a.encrypt_base, encoding="utf-8")), password))
        log("База анкет зашифрована → data/base.json")
        return

    snapshot = os.path.join(ROOT, "data", "crm.json")
    payload = None
    if a.rows or token:
        if not password:
            raise SystemExit("Нет пароля DASHBOARD_PASSWORD: без него данные клиентов не публикуются.")
        deals = from_export(a.rows) if a.rows else fetch_notion(token)
        payload = {"v": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "source": "notion-export" if a.rows else "notion-api", "deals": deals}
        envelope = encrypt(payload, password)
        if a.save_snapshot:
            write_json(snapshot, envelope)
            log("Снимок сохранён → data/crm.json")
    else:
        if not os.path.exists(snapshot):
            raise SystemExit("Нет ни NOTION_TOKEN, ни снимка data/crm.json.")
        envelope = json.load(open(snapshot, encoding="utf-8"))
        log("NOTION_TOKEN не задан — публикую последний снимок data/crm.json")

    if a.no_site:
        return
    if os.path.exists(SITE):
        shutil.rmtree(SITE)
    os.makedirs(SITE)
    for item in ("index.html", "assets"):
        src = os.path.join(ROOT, item)
        (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, os.path.join(SITE, item))
    write_json(os.path.join(SITE, "data", "crm.json"), envelope)
    base = os.path.join(ROOT, "data", "base.json")
    if os.path.exists(base):
        shutil.copy2(base, os.path.join(SITE, "data", "base.json"))
    open(os.path.join(SITE, ".nojekyll"), "w").close()
    n = len(payload["deals"]) if payload else "снимок"
    log(f"Сайт собран → _site/ (сделок: {n})")


if __name__ == "__main__":
    main()
