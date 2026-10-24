// Пароли (scrypt), сессии (подписанная кука) и токены интеграций.
import { createHash, createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number) =>
  new Promise<Buffer>((res, rej) => _scrypt(pw, salt, len, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

export const b64url = (b: Buffer) => b.toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 32);
  return { salt: b64url(salt), hash: b64url(key) };
}

export async function verifyPassword(pw: string, salt: string, hash: string) {
  if (!salt || !hash) return false;
  const key = await scrypt(pw, Buffer.from(salt, "base64url"), 32);
  const want = Buffer.from(hash, "base64url");
  return want.length === key.length && timingSafeEqual(want, key);
}

export const envVar = (k: string) => String(((globalThis as any).Netlify?.env?.get?.(k) as string | undefined) || process.env[k] || "");

// Ключ подписи сессий. Если CRM_SECRET не задан в окружении, сервер сам создаёт случайный ключ
// и хранит его в Blobs (документ config) — он никогда не покидает сервер и не виден в настройках Netlify.
let cached: { value: string; source: "env" | "store" } | null = null;

export async function loadSecret(): Promise<"env" | "store"> {
  const env = envVar("CRM_SECRET");
  if (env.length >= 32) {
    cached = { value: env, source: "env" };
    return "env";
  }
  if (cached?.source === "store") return "store";
  const { kv } = await import("./store.mts");
  const s = await kv();
  for (let i = 0; i < 3; i++) {
    const got = await s.get<{ secret?: string }>("config");
    if (got?.data?.secret && got.data.secret.length >= 32) {
      cached = { value: got.data.secret, source: "store" };
      return "store";
    }
    const value = b64url(randomBytes(48));
    const r = got ? await s.set("config", { ...got.data, secret: value }, { onlyIfMatch: got.etag }) : await s.set("config", { secret: value }, { onlyIfNew: true });
    if (r.modified) {
      cached = { value, source: "store" };
      return "store";
    }
  }
  throw new Error("Не удалось подготовить ключ подписи сессий");
}

/** Для тестов: забыть закешированный ключ. */
export function resetSecretCache() {
  cached = null;
}

export function secret(): string {
  if (!cached) throw new Error("Ключ подписи сессий не загружен (loadSecret)");
  return cached.value;
}

/** Ключ первичной установки: SETUP_KEY открытым текстом или SETUP_KEY_SHA256 (hex-хеш ключа). */
export function setupKeyMatches(provided: string | null) {
  if (!provided || provided.length < 24) return false;
  const plain = envVar("SETUP_KEY");
  const hashed = envVar("SETUP_KEY_SHA256").toLowerCase();
  const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  if (plain.length >= 24 && eq(provided, plain)) return true;
  if (/^[0-9a-f]{64}$/.test(hashed) && eq(sha256(provided), hashed)) return true;
  return false;
}

export const setupConfigured = () => envVar("SETUP_KEY").length >= 24 || /^[0-9a-f]{64}$/i.test(envVar("SETUP_KEY_SHA256"));

export function signSession(payload: { u: string; v: number; e: number }) {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret()).update(body).digest());
  return body + "." + sig;
}

export function readSession(token: string | undefined | null): { u: string; v: number; e: number } | null {
  if (!token || token.length > 600 || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const want = createHmac("sha256", secret()).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p || typeof p.u !== "string" || typeof p.e !== "number" || p.e * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function newToken() {
  const raw = "w2wk_" + b64url(randomBytes(30));
  return { raw, hash: sha256(raw), hint: raw.slice(0, 9) + "…" + raw.slice(-4) };
}

export function newPassword() {
  // Читаемый пароль: слово-слово-число (узбекские слова из лексики продаж).
  const words = ["bozor", "sotuv", "mijoz", "savdo", "foyda", "yutuq", "reja", "qadam", "baraka", "zafar", "ishonch", "kelishuv"];
  const pick = () => words[randomBytes(1)[0] % words.length];
  const w1 = pick();
  let w2 = pick();
  while (w2 === w1) w2 = pick();
  const num = 1000 + (randomBytes(2).readUInt16BE(0) % 9000);
  return `${w1[0].toUpperCase()}${w1.slice(1)}-${w2}-${num}`;
}

export function cookieHeader(value: string, maxAge: number | null) {
  const parts = [`w2w_s=${value}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

export function readCookie(req: Request, name: string) {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}
