#!/usr/bin/env python3
"""One-off export of the Notion CRM (properties + page bodies) for the move to the W2W CRM platform.

The result is encrypted with an RSA public key (AES-256-GCM payload, RSA-OAEP key wrap),
so the public repository and workflow logs never contain client data in clear text.
"""
import base64, gzip, json, os, sys, time, urllib.error, urllib.request

TOKEN = os.environ["NOTION_TOKEN"]
VERSION = "2022-06-28"
DATABASES = {
    "crm": "3c61f39881f3809ea842e694b9f5acc1",
    "archive": "3c61f39881f3807ab9c8c7ee511edc01",
    "logistics": "ee71f39881f38244a9180159fde7f3db",
    "catering": "8bb1f39881f382c2b65301112c4717e0",
}


def call(method, path, body=None, tries=6):
    url = "https://api.notion.com/v1" + path
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {TOKEN}", "Notion-Version": VERSION, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(float(e.headers.get("Retry-After") or (1.5 * (i + 1))))
                continue
            raise RuntimeError(f"{e.code} {e.read().decode(errors='replace')[:300]}")
        except urllib.error.URLError:
            if i < tries - 1:
                time.sleep(2 * (i + 1))
                continue
            raise


def rich(rt):
    out = []
    for t in rt or []:
        s = t.get("plain_text", "")
        if not s:
            continue
        a = t.get("annotations") or {}
        href = t.get("href")
        if a.get("code"):
            s = f"`{s}`"
        if a.get("bold"):
            s = f"**{s}**"
        if a.get("italic"):
            s = f"*{s}*"
        if a.get("strikethrough"):
            s = f"~~{s}~~"
        if href:
            s = f"[{s}]({href})"
        out.append(s)
    return "".join(out)


def children(block_id):
    res, cursor = [], None
    while True:
        q = f"/blocks/{block_id}/children?page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
        r = call("GET", q)
        res += r.get("results", [])
        if not r.get("has_more"):
            return res
        cursor = r.get("next_cursor")


def to_md(blocks, depth=0):
    lines, pad, n = [], "  " * depth, 0
    for b in blocks:
        t = b.get("type")
        v = b.get(t) or {}
        txt = rich(v.get("rich_text"))
        if t != "numbered_list_item":
            n = 0
        if t == "paragraph":
            lines.append(pad + txt)
        elif t in ("heading_1", "heading_2", "heading_3"):
            lines.append("#" * int(t[-1]) + " " + txt)
        elif t == "bulleted_list_item":
            lines.append(pad + "- " + txt)
        elif t == "numbered_list_item":
            n += 1
            lines.append(pad + f"{n}. " + txt)
        elif t == "to_do":
            lines.append(pad + ("- [x] " if v.get("checked") else "- [ ] ") + txt)
        elif t == "quote":
            lines.append(pad + "> " + txt)
        elif t == "callout":
            lines.append(pad + "> " + txt)
        elif t == "toggle":
            lines.append(pad + "▸ " + txt)
        elif t == "code":
            lines.append(pad + "```\n" + txt + "\n```")
        elif t == "divider":
            lines.append("---")
        elif t == "bookmark" or t == "embed" or t == "link_preview":
            lines.append(pad + (v.get("url") or ""))
        elif t in ("image", "file", "pdf", "video"):
            f = v.get("file") or v.get("external") or {}
            lines.append(pad + f"[{t}: {rich(v.get('caption')) or 'файл'}]({f.get('url', '')})")
        elif t == "child_page":
            lines.append(pad + f"[страница: {v.get('title', '')}]")
        elif t == "child_database":
            lines.append(pad + f"[база: {v.get('title', '')}]")
        elif t == "table":
            pass
        elif t == "table_row":
            lines.append(pad + "| " + " | ".join(rich(c) for c in v.get("cells", [])) + " |")
        else:
            if txt:
                lines.append(pad + txt)
        if b.get("has_children") and t not in ("child_page", "child_database"):
            try:
                lines += to_md(children(b["id"]), depth + (0 if t == "table" else 1))
            except Exception as e:  # noqa: BLE001
                lines.append(pad + f"[не удалось прочитать вложенные блоки: {e}]")
    return lines


def prop_value(p):
    t = p.get("type")
    v = p.get(t)
    if t in ("title", "rich_text"):
        return rich(v)
    if t in ("select", "status"):
        return v.get("name") if v else None
    if t == "multi_select":
        return [o["name"] for o in v or []]
    if t == "date":
        return {"start": v.get("start"), "end": v.get("end")} if v else None
    if t == "people":
        return [{"id": x.get("id"), "name": x.get("name")} for x in v or []]
    if t == "formula":
        return v.get(v.get("type")) if v else None
    if t in ("created_time", "last_edited_time", "checkbox", "number", "url", "phone_number", "email"):
        return v
    if t in ("created_by", "last_edited_by"):
        return {"id": (v or {}).get("id"), "name": (v or {}).get("name")}
    return None


def export_db(key, db_id):
    pages, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        r = call("POST", f"/databases/{db_id}/query", body)
        pages += r.get("results", [])
        if not r.get("has_more"):
            break
        cursor = r.get("next_cursor")
    out = []
    for i, pg in enumerate(pages):
        if pg.get("archived") or pg.get("in_trash"):
            continue
        item = {
            "id": pg["id"], "url": pg.get("url"), "created": pg.get("created_time"),
            "edited": pg.get("last_edited_time"),
            "createdBy": (pg.get("created_by") or {}).get("id"),
            "props": {name: prop_value(p) for name, p in (pg.get("properties") or {}).items()},
        }
        try:
            item["body"] = "\n".join(to_md(children(pg["id"])))
        except Exception as e:  # noqa: BLE001
            item["body"] = ""
            item["bodyError"] = str(e)
        out.append(item)
        if i % 25 == 0:
            print(f"· {key}: {i + 1}/{len(pages)}", flush=True)
    print(f"· {key}: готово, страниц {len(out)}", flush=True)
    return out


def users():
    res, cursor = [], None
    try:
        while True:
            r = call("GET", "/users?page_size=100" + (f"&start_cursor={cursor}" if cursor else ""))
            res += [{"id": u.get("id"), "name": u.get("name"), "type": u.get("type"),
                     "email": (u.get("person") or {}).get("email")} for u in r.get("results", [])]
            if not r.get("has_more"):
                return res
            cursor = r.get("next_cursor")
    except Exception as e:  # noqa: BLE001
        print("· пользователи недоступны:", e)
        return res


def encrypt(obj, pub_path):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = gzip.compress(json.dumps(obj, ensure_ascii=False).encode())
    key, iv = AESGCM.generate_key(256), os.urandom(12)
    ct = AESGCM(key).encrypt(iv, raw, None)
    pub = serialization.load_pem_public_key(open(pub_path, "rb").read())
    wrapped = pub.encrypt(key, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    b = lambda x: base64.b64encode(x).decode()
    return {"v": 1, "alg": "RSA-OAEP-256+A256GCM+gzip", "key": b(wrapped), "iv": b(iv), "ct": b(ct)}


def main():
    result = {"exportedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "databases": {}, "errors": {}}
    for key, db_id in DATABASES.items():
        try:
            result["databases"][key] = export_db(key, db_id)
        except Exception as e:  # noqa: BLE001
            result["errors"][key] = str(e)[:300]
            print(f"· {key}: нет доступа — {str(e)[:120]}", flush=True)
    result["users"] = users()
    env = encrypt(result, os.path.join(os.path.dirname(__file__), "export_pub.pem"))
    os.makedirs("out", exist_ok=True)
    with open("out/notion-export.enc.json", "w") as f:
        json.dump(env, f)
    counts = {k: len(v) for k, v in result["databases"].items()}
    print("· итог:", json.dumps(counts), "ошибки:", list(result["errors"].keys()), "пользователей:", len(result["users"]))


if __name__ == "__main__":
    sys.exit(main())
