// Сборка интерфейса CRM.
//   node scripts/stamp.mjs              → index.html в корне (для локальной разработки)
//   node scripts/stamp.mjs --out _site  → готовая папка для GitHub Pages
// Версия (ASSET_VERSION или текущее время) добавляется ко всем ссылкам на CSS/JS, включая import внутри
// модулей: после публикации браузер не смешает старые и новые файлы из кеша.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v = (process.env.ASSET_VERSION || Date.now().toString(36)).replace(/[^a-zA-Z0-9._-]/g, "");
const outArg = process.argv.indexOf("--out");
const html = fs.readFileSync(path.join(root, "index.tpl.html"), "utf8").replaceAll("__V__", v);

if (outArg < 0) {
  fs.writeFileSync(path.join(root, "index.html"), html);
  console.log("index.html, версия ресурсов:", v);
} else {
  const out = path.resolve(root, process.argv[outArg + 1] || "_site");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "index.html"), html);
  fs.copyFileSync(path.join(root, "manifest.webmanifest"), path.join(out, "manifest.webmanifest"));
  fs.writeFileSync(path.join(out, ".nojekyll"), "");
  const IMPORT = /((?:from|import)\s*\(?\s*)"(\.{1,2}\/[^"?]+\.js)"/g;
  let files = 0;
  const copy = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "__pycache__") continue;
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) copy(s, d);
      else if (e.name.endsWith(".js")) {
        fs.writeFileSync(d, fs.readFileSync(s, "utf8").replace(IMPORT, (_, pre, spec) => `${pre}"${spec}?v=${v}"`));
        files++;
      } else {
        fs.copyFileSync(s, d);
        files++;
      }
    }
  };
  copy(path.join(root, "assets"), path.join(out, "assets"));
  console.log(`${path.relative(root, out)}/: index.html + ${files} файлов, версия ресурсов: ${v}`);
}
