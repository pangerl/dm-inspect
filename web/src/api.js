const BASE = '/api'

async function request(path, options) {
  const res = await fetch(BASE + path, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || '请求失败')
  }
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('json')) return res.json()
  return res.text()
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) }),
  del: (path) => request(path, { method: 'DELETE' }),
}
