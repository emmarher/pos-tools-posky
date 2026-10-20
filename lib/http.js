/**
 * lib/http.js — Cliente HTTP mínimo para el chequeo contra un server.
 *
 * Solo se usa por `posky qa --server`. Node 18+ trae `fetch` global,
 * así que no hay dependencias externas.
 */

async function request(url, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 10000),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { status: res.status, ok: res.ok, data };
}

module.exports = { request };
