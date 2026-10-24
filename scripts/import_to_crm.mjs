// Загрузка пакета переноса из Notion в CRM: node scripts/import_to_crm.mjs <файл.json> <адрес CRM>
// Переменные: CRM_LOGIN, CRM_PASSWORD (админ), OWNER_MAP='{"notion:<id>":"<login>"}'
import fs from "node:fs";

const [file, base] = process.argv.slice(2);
if (!file || !base) throw new Error("usage: import_to_crm.mjs <file> <baseUrl>");
const pack = JSON.parse(fs.readFileSync(file, "utf8"));
let cookie = "";
async function call(path, method = "GET", body) {
  const r = await fetch(base.replace(/\/$/, "") + "/api" + path, {
    method,
    headers: { "content-type": "application/json", "x-w2w": "1", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0];
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
await call("/auth/login", "POST", { login: process.env.CRM_LOGIN, password: process.env.CRM_PASSWORD, remember: false });
const users = (await call("/users")).users;
const map = JSON.parse(process.env.OWNER_MAP || "{}");
const byLogin = Object.fromEntries(users.map((u) => [u.login, u.id]));
for (const d of pack.deals) {
  if (String(d.owner || "").startsWith("notion:")) d.owner = byLogin[map[d.owner]] || byLogin[map["*"]] || "";
  for (const k of ["createdBy", "updatedBy"]) if (d[k] === "import") d[k] = "import";
}
for (const items of Object.values(pack.history || {})) for (const it of items) it.by ||= "import";
const r1 = await call("/import", "POST", { deals: pack.deals, mode: process.env.MODE || "merge" });
console.log("сделки:", r1.imported);
const entries = Object.entries(pack.history || {});
let n = 0;
for (let i = 0; i < entries.length; i += 40) {
  const r = await call("/import", "POST", { history: Object.fromEntries(entries.slice(i, i + 40)), historyMode: "replace" });
  n += r.imported.history || 0;
}
console.log("история:", n);
if (pack.base) console.log("база:", (await call("/import", "POST", { base: pack.base })).imported);
const boot = await call("/bootstrap");
console.log("в CRM сделок:", boot.deals.length);
