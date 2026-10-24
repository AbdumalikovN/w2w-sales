/* Клиент API: JSON, защита от CSRF, понятные ошибки. */

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-w2w": "1", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: "no-store",
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "Нет связи с сервером. Проверьте интернет и повторите.");
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = data?.error || {};
    if (res.status === 401 && !path.startsWith("/auth/login")) onUnauthorized();
    const { code, message, ...extra } = err;
    throw new ApiError(res.status, code || "http_" + res.status, message || `Ошибка сервера (${res.status})`, extra);
  }
  return data;
}

export const get = (p, o) => api(p, o);
export const post = (p, body) => api(p, { method: "POST", body: body ?? {} });
export const patch = (p, body) => api(p, { method: "PATCH", body });
export const put = (p, body) => api(p, { method: "PUT", body });
export const del = (p) => api(p, { method: "DELETE" });
