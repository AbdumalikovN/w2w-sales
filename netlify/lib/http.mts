// HTTP-утилиты: ответы, ошибки, сжатие, разбор тела.
import { gzipSync } from "node:zlib";

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const bad = (msg: string, code = "bad_request") => new HttpError(400, code, msg);
export const forbidden = (msg = "Недостаточно прав") => new HttpError(403, "forbidden", msg);
export const notFound = (msg = "Не найдено") => new HttpError(404, "not_found", msg);

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
};

export function json(req: Request | null, data: unknown, status = 200, headers: Record<string, string> = {}) {
  const body = JSON.stringify(data);
  const h: Record<string, string> = { ...BASE_HEADERS, "content-type": "application/json; charset=utf-8", ...headers };
  const ae = req?.headers.get("accept-encoding") || "";
  if (body.length > 4096 && /\bgzip\b/.test(ae)) {
    h["content-encoding"] = "gzip";
    h["vary"] = "accept-encoding";
    return new Response(gzipSync(body), { status, headers: h });
  }
  return new Response(body, { status, headers: h });
}

export function errorResponse(req: Request | null, e: unknown) {
  if (e instanceof HttpError) {
    return json(req, { error: { code: e.code, message: e.message, ...(e.extra || {}) } }, e.status);
  }
  console.error("API error", e);
  return json(req, { error: { code: "server_error", message: "Внутренняя ошибка сервера. Попробуйте ещё раз." } }, 500);
}

export async function readBody(req: Request, max = 4_000_000): Promise<any> {
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "too_large", "Слишком большой запрос");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw bad("Некорректный JSON");
  }
}

export const now = () => new Date().toISOString();

export function todayTashkent(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(d);
}

export function rid(prefix = "") {
  const a = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = "";
  for (const b of bytes) s += a[b % a.length];
  return prefix + s;
}
