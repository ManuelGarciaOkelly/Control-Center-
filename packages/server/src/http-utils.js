// Tiny request/response helpers so route handlers stay readable.

export function send(res, status, body, headers = {}) {
  const payload = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    ...headers,
  });
  res.end(payload);
}

export function sendError(res, status, message) {
  send(res, status, { error: message });
}

export async function readJson(req, { maxBytes = 1_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('payload too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid json: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

// Match path + extract numeric id. Returns id or null.
export function matchId(path, prefix) {
  if (!path.startsWith(prefix + '/')) return null;
  const rest = path.slice(prefix.length + 1);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}
