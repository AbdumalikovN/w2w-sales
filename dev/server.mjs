// Локальный сервер разработки: статика из корня репозитория + API на файловом хранилище.
//   CRM_SECRET=... SETUP_KEY=... node dev/server.mjs [порт]   (DATA_DIR — папка данных, STATIC_DIR — папка статики)
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// STATIC_DIR=_site — проверить собранную для GitHub Pages версию (node scripts/stamp.mjs --out _site)
const STATIC = path.resolve(ROOT, process.env.STATIC_DIR || ".");
process.env.CRM_SECRET ||= "dev-secret-dev-secret-dev-secret-dev-secret";
process.env.SETUP_KEY ||= "dev-setup-key-dev-setup-key-0001";

const { setKV, fileKV } = await import("../netlify/lib/store.mts");
setKV(await fileKV(process.env.DATA_DIR || path.join(ROOT, "dev", ".data")));
const { handle } = await import("../netlify/lib/routes.mts");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const port = Number(process.argv[2] || process.env.PORT || 8787);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      // локально кука Secure не поставится на http — снимаем флаг
      const r = await handle(new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), "127.0.0.1");
      const out = {};
      r.headers.forEach((v, k) => (out[k] = k === "set-cookie" ? v.replace("; Secure", "") : v));
      res.writeHead(r.status, out);
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(STATIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!file.startsWith(STATIC) || /[/\\](netlify|dev|tests|scripts|node_modules)[/\\]/.test(file.slice(STATIC.length))) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      const data = await fs.readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(port, () => console.log(`W2W CRM dev: http://localhost:${port}`));
