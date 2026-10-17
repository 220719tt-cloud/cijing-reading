// Run after build. Serve only dist over ordinary HTTP at / and /cijing-reading/.
// No Vite server, uploads, browser storage or external network requests are used.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
async function files(dir) {
  const list = await Promise.all((await readdir(dir, { withFileTypes: true })).map(item => item.isDirectory() ? files(path.join(dir, item.name)) : path.join(dir, item.name)))
  return list.flat()
}
const paths = (await files(root)).map(file => path.relative(root, file).split(path.sep).join('/'))
const html = await readFile(path.join(root, 'index.html'), 'utf8')
assert.match(html, /Content-Security-Policy/)
assert.match(html.replaceAll('&#39;', "'"), /connect-src 'self'/)
assert.match(html.replaceAll('&#39;', "'"), /script-src 'self'/)
const entryRefs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => match[1])
assert.ok(entryRefs.some(ref => ref.endsWith('.js')))
for (const ref of entryRefs) {
  assert.ok(ref.startsWith('./'), 'Entry assets must be relative to the deployment directory')
  assert.ok(paths.includes(ref.slice(2)), 'Referenced entry asset must exist')
}
for (const file of paths) {
  assert.ok(!/(?:^|\/)(?:\.env[^/]*|node_modules|tests|evidence)(?:\/|$)|\.(?:epub|txt\.local|map)$/i.test(file), 'Unexpected private or development file in dist')
  if (!/\.(?:js|css|html)$/.test(file)) continue
  const content = await readFile(path.join(root, file), 'utf8')
  assert.ok(!/\/Users\/|file:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?|\/src\/main\.tsx/.test(content), 'Build contains a local runtime dependency')
  assert.ok(!/(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content), 'Build contains a possible secret')
}
for (const required of ['licenses/NOTICE.txt', 'licenses/APPLICATION-LICENSES.txt', 'licenses/EPUB-NOTICE.txt', 'licenses/PHRASE-NOTICE.txt']) assert.ok(paths.includes(required))
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' }
const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405).end(); return }
    let name = decodeURIComponent(new URL(request.url, 'http://static.test').pathname)
    if (name.startsWith('/cijing-reading/')) name = name.slice('/cijing-reading'.length)
    const target = path.resolve(root, `.${name.endsWith('/') ? `${name}index.html` : name}`)
    if (!target.startsWith(`${root}${path.sep}`) || !(await stat(target)).isFile()) { response.writeHead(404).end(); return }
    response.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream')
    response.end(await readFile(target))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const origin = `http://127.0.0.1:${server.address().port}`
  for (const base of ['/', '/cijing-reading/']) {
    for (const file of paths) {
      const result = await fetch(`${origin}${base}${file}`)
      assert.equal(result.status, 200, `Static request failed under ${base}`)
      assert.equal((await result.arrayBuffer()).byteLength, (await stat(path.join(root, file))).size)
    }
    const route = await fetch(`${origin}${base}#/read/moon`)
    assert.equal(await route.text(), html, 'Hash reader routes must use the same static entry')
  }
  console.log(`Static checks passed: ${paths.length} files at both / and /cijing-reading/; relative assets, CSP, license and local-path/secret checks passed.`)
} finally { await new Promise(resolve => server.close(resolve)) }
