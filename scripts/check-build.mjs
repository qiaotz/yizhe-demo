import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = path.resolve('dist/web')
const files = []
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(file)
    else files.push(file)
  }
}
await walk(root)
const html = await readFile(path.join(root, 'index.html'), 'utf8')
assert.match(html, /connect-src 'none'/, 'Static demo must reject all API connections')
assert.match(html, /media-src 'none'/, 'Static demo must reject remote media')
if (!process.env.DEMO_BASE || process.env.DEMO_BASE === './') {
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/, 'Built entry assets must be relative')
}
const forbidden = [
  /https?:\/\/[^\s'"<>]*tcloudbase\.com/i,
  /cloud:\/\/[^\s'"<>]+/i,
  /AKID[A-Za-z0-9]{20,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /C:[/\\]Users[/\\]Administrator/i,
]
for (const file of files.filter(file => /\.(?:js|css|html|json)$/.test(file))) {
  const content = await readFile(file, 'utf8')
  for (const pattern of forbidden) assert.doesNotMatch(content, pattern, `Forbidden private configuration in ${path.relative(root, file)}`)
}
const bytes = (await Promise.all(files.map(file => stat(file)))).reduce((sum, info) => sum + info.size, 0)
console.log(`Static demo verified: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB; API and media denied.`)
