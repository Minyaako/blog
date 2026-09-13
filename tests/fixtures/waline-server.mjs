import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const WALINE_TEST_USERS = Object.freeze({
  author: Object.freeze({
    token: 'test-token-author', objectId: 'test-author', display_name: '测试作者', type: 'guest',
  }),
  admin: Object.freeze({
    token: 'test-token-admin', objectId: 'test-admin', display_name: '测试管理员', type: 'administrator',
  }),
})

const HOST = '127.0.0.1'

function json(response, status, body) {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(payload)
}

function loginPage() {
  const users = JSON.stringify(Object.fromEntries(Object.entries(WALINE_TEST_USERS).map(([role, user]) => [role, {
    token: user.token, objectId: user.objectId, display_name: user.display_name, type: user.type,
  }])))
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Waline 测试登录</title>
<style>
  :root { color-scheme: light dark; font: 16px system-ui, sans-serif; }
  body { max-width: 32rem; margin: 3rem auto; padding: 0 1.25rem; }
  button { display: block; width: 100%; margin: .75rem 0; padding: .8rem 1rem; font: inherit; cursor: pointer; }
</style>
<h1>选择测试身份</h1>
<p>此页面只用于隔离的 Playwright 验收，不连接真实 Waline。</p>
<button type="button" data-role="author">以测试作者登录</button>
<button type="button" data-role="admin">以测试管理员登录</button>
<p id="status" role="status"></p>
<script>
  const users = ${users};
  const status = document.querySelector('#status');
  for (const button of document.querySelectorAll('[data-role]')) {
    button.addEventListener('click', () => {
      const user = users[button.dataset.role];
      if (!user || !window.opener) { status.textContent = '请从测试页面打开此窗口。'; return; }
      // The opener is the blog origin, while event.origin is this Waline origin.
      // The blog validates both event.origin and event.source before accepting it.
      window.opener.postMessage({ type: 'userInfo', data: { ...user, remember: true } }, '*');
      status.textContent = '登录成功，可以关闭此窗口。';
    });
  }
</script>`
}

function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('WALINE_TEST_PORT must be an integer from 0 to 65535')
  return port
}

export function createWalineTestServer({ host = HOST, port = parsePort(process.env.WALINE_TEST_PORT || '4336') } = {}) {
  return createServer((request, response) => {
    let url
    try { url = new URL(request.url || '/', `http://${host}`) } catch {
      json(response, 400, { errno: 1, data: {} })
      return
    }
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    if (request.method === 'GET' && pathname === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('ok')
      return
    }
    if (request.method === 'GET' && pathname === '/api/token') {
      const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(request.headers.authorization || '')
      const user = match && Object.values(WALINE_TEST_USERS).find(candidate => candidate.token === match[1])
      json(response, 200, { errno: 0, data: user ? {
        objectId: user.objectId, display_name: user.display_name, type: user.type,
      } : {} })
      return
    }
    if (request.method === 'GET' && pathname === '/ui/login') {
      const body = loginPage()
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(body)
      return
    }
    json(response, 404, { errno: 1, data: {} })
  }).listen(port, host)
}

function cliPort() {
  const index = process.argv.indexOf('--port')
  return parsePort(index >= 0 ? process.argv[index + 1] : process.env.WALINE_TEST_PORT || '4336')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createWalineTestServer({ port: cliPort() })
  const stop = () => server.close(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
