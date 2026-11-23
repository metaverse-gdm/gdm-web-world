// Uploads dist/ over FTPS, sending only files whose content changed since the last upload.
// State lives on the server (.deploy-manifest.json: path -> sha1), so any machine can deploy.
// Adapted from tc-game/scripts/ftps-upload.mjs for GDM World (built with base '/worlds/' — set VITE_BASE_PATH to match FTPS_REMOTE_DIR's public URL path).
// Entry files (*.html) go last so an old page never points at missing assets/ chunks.
// The password is kept out of the repo: DPAPI-encrypted for the current Windows user in %APPDATA%/tc-linkai/ftps.cred,
// shared with tc-linkai because both deploy to the same account (override with FTPS_CRED_FILE).
// `--login` stores it, moving a plaintext FTPS_PASSWORD out of .env if present. FTPS_PASSWORD in the environment still wins.
// --build runs `npm run build` first.
// Usage: node scripts/ftps-upload.mjs [--login] [--build] [--dry] [--verify] [--full] [--prune] [--verbose]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, relative, sep } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { Client } from 'basic-ftp'

const args = new Set(process.argv.slice(2))
const build = args.has('--build'), dry = args.has('--dry'), verify = args.has('--verify'), full = args.has('--full'), prune = args.has('--prune'), verbose = args.has('--verbose')
const dotenvPassword = existsSync('.env') && /^[ \t]*FTPS_PASSWORD[ \t]*=/m.test(readFileSync('.env', 'utf8'))
if (existsSync('.env')) process.loadEnvFile('.env')
const env = process.env
const credFile = env.FTPS_CRED_FILE || join(env.APPDATA || '', 'tc-linkai', 'ftps.cred')
const ps = (script, input, interactive = false) => spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '[Console]::InputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + script],
  { env: { ...env, TC_CRED: credFile }, input, encoding: 'utf8', stdio: [interactive ? 'inherit' : 'pipe', 'pipe', 'inherit'] })
const SAVE = "$d = Split-Path $env:TC_CRED; New-Item -ItemType Directory -Force $d | Out-Null; $s | ConvertFrom-SecureString | Set-Content -Encoding ascii $env:TC_CRED"

if (args.has('--login')) {
  if (process.platform !== 'win32') { console.error('--login needs Windows (DPAPI); set FTPS_PASSWORD in the environment instead'); process.exit(1) }
  const r = dotenvPassword && env.FTPS_PASSWORD
    ? ps(`$s = ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; ${SAVE}`, env.FTPS_PASSWORD)
    : ps(`$s = Read-Host -AsSecureString 'FTPS password'; ${SAVE}`, undefined, true)
  if (r.status !== 0) process.exit(1)
  if (dotenvPassword) writeFileSync('.env', readFileSync('.env', 'utf8').replace(/^[ \t]*FTPS_PASSWORD[ \t]*=.*(\r?\n|$)/gm, ''))
  console.log(`saved to ${credFile}${dotenvPassword ? ' (FTPS_PASSWORD removed from .env)' : ''}`)
  process.exit(0)
}

const need = k => env[k] || (console.error(`missing ${k} (set it in .env, see .env.example)`), process.exit(1))
const password = () => {
  if (env.FTPS_PASSWORD) {
    if (dotenvPassword) console.warn('FTPS_PASSWORD is plaintext in .env; run `just ftps-login` to move it out')
    return env.FTPS_PASSWORD
  }
  if (process.platform !== 'win32' || !existsSync(credFile)) { console.error('no FTPS password; run `just ftps-login`'); process.exit(1) }
  const r = ps('[Net.NetworkCredential]::new("", ((Get-Content -Raw $env:TC_CRED).Trim() | ConvertTo-SecureString)).Password')
  if (r.status !== 0 || !r.stdout.trim()) { console.error(`could not decrypt ${credFile}; run \`just ftps-login\` again`); process.exit(1) }
  return r.stdout.replace(/\r?\n$/, '')
}
const conn = {
  host: need('FTPS_HOST'),
  port: Number(env.FTPS_PORT || (env.FTPS_SECURE === 'implicit' ? 990 : 21)),
  user: need('FTPS_USER'),
  password: password(),
  secure: env.FTPS_SECURE === 'implicit' ? 'implicit' : env.FTPS_SECURE === 'false' ? false : true,
  secureOptions: { rejectUnauthorized: env.FTPS_ALLOW_SELF_SIGNED !== 'true' },
}
const root = posix.join('/', env.FTPS_REMOTE_DIR || '/')
const localDir = env.FTPS_LOCAL_DIR || 'dist'
if (build && spawnSync('npm run build', { stdio: 'inherit', shell: true }).status !== 0) process.exit(1)
const concurrency = Math.max(1, Number(env.FTPS_CONCURRENCY || 1))
const MANIFEST = '.deploy-manifest.json'
const isEntry = p => /\.html$/.test(p)

if (!existsSync(join(localDir, 'index.html'))) { console.error(`${localDir}/index.html not found; run the build first`); process.exit(1) }

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [])
const local = {}
for (const f of walk(localDir)) local[relative(localDir, f).split(sep).join('/')] = createHash('sha1').update(readFileSync(f)).digest('hex')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const connect = async () => {
  for (let attempt = 0; ; attempt++) {
    const c = new Client(60_000)
    c.ftp.verbose = verbose
    try { await c.access(conn); return c } catch (e) {
      c.close()
      if (attempt >= 4 || e.code === 530) throw e
      await sleep(3000 * (attempt + 1))
    }
  }
}
const remote = p => posix.join(root, p)

async function readManifest(c) {
  const chunks = []
  try {
    await c.downloadTo(new Writable({ write(b, _, cb) { chunks.push(b); cb() } }), remote(MANIFEST))
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (e) {
    if (e.code === 550 || /550|not found|no such/i.test(String(e.message))) return null
    throw e
  }
}

// First run without a manifest: treat remote files of the same size as already uploaded.
async function sizesFromListing(c, dir = '', out = {}) {
  let list
  try { list = await c.list(remote(dir)) } catch { return out }
  for (const f of list) {
    const p = dir ? `${dir}/${f.name}` : f.name
    if (f.isDirectory) await sizesFromListing(c, p, out)
    else if (f.isFile) out[p] = f.size
  }
  return out
}

const t0 = Date.now()
const main = await connect()
let old = await readManifest(main)
let toUpload
if (full) {
  toUpload = Object.keys(local)
} else if (old) {
  // --verify also re-sends files missing or resized on the server (e.g. after edits made outside this script).
  const sizes = verify ? await sizesFromListing(main) : null
  toUpload = Object.keys(local).filter(p => old.files?.[p] !== local[p] || (sizes && sizes[p] !== statSync(join(localDir, p)).size))
} else {
  console.log(`no ${MANIFEST} on server; comparing by file size (first run)`)
  const sizes = await sizesFromListing(main)
  toUpload = Object.keys(local).filter(p => isEntry(p) || sizes[p] !== statSync(join(localDir, p)).size)
  const skip = new Set(Object.keys(local).filter(p => !toUpload.includes(p)))
  old = { files: Object.fromEntries([...skip].map(p => [p, local[p]])) }
}
old ??= { files: {} }
const stale = Object.keys(old.files ?? {}).filter(p => !(p in local))
const bytes = toUpload.reduce((n, p) => n + statSync(join(localDir, p)).size, 0)
const mb = n => (n / 1048576).toFixed(1)
console.log(`${Object.keys(local).length} files, ${toUpload.length} changed (${mb(bytes)} MB), ${stale.length} stale${prune ? ' (pruning)' : ''} -> ${conn.host}${root}`)
if (dry) {
  for (const p of toUpload) console.log(`  + ${p}`)
  if (prune) for (const p of stale) console.log(`  - ${p}`)
  main.close()
  process.exit(0)
}
main.close()

const done = { ...old.files }
let n = 0
// Some shared hosts reset data sockets on rapid transfers; basic-ftp can surface that as a stray socket error.
const pause = Number(env.FTPS_PAUSE_MS ?? 300)
process.on('uncaughtException', e => { if (e.code !== 'ECONNRESET') throw e; if (verbose) console.error('  (stray socket reset)') })
const landed = (c, p, size) => c.size(remote(p)).then(s => s === size, () => false)

async function uploadAll(paths, width = concurrency) {
  const queue = [...paths], failed = []
  const worker = async (c) => {
    const made = new Set()
    for (let p; (p = queue.shift()) !== undefined;) {
      const dir = posix.dirname(remote(p))
      for (let attempt = 0; ; attempt++) {
        const ok = async () => { done[p] = local[p]; console.log(`  [${++n}/${toUpload.length}] ${p}`); await sleep(pause) }
        try {
          if (!made.has(dir)) { await c.ensureDir(dir); made.add(dir) }
          await c.uploadFrom(join(localDir, p), remote(p))
          await ok()
          break
        } catch (e) {
          // The host often resets the connection after the file has fully arrived: check its size before retrying.
          try { c.close(); c = await connect(); made.clear() } catch {}
          if (await landed(c, p, statSync(join(localDir, p)).size)) { await ok(); break }
          if (attempt >= 4) { failed.push(p); console.error(`  ! ${p}: ${e.message}`); break }
          if (verbose) console.error(`  ~ ${p}: ${e.message}, retrying`)
          await sleep(3000 * 2 ** attempt)
        }
      }
    }
    c.close()
  }
  const clients = await Promise.all(Array.from({ length: Math.min(width, paths.length) }, connect))
  await Promise.all(clients.map(worker))
  return failed
}

async function uploadPhase(paths) {
  const failed = await uploadAll(paths)
  if (!failed.length || concurrency === 1) return failed
  console.log(`retrying ${failed.length} on one connection`)
  await sleep(5000)
  return uploadAll(failed, 1)
}

const failed = await uploadPhase(toUpload.filter(p => !isEntry(p)))
if (!failed.length) failed.push(...await uploadPhase(toUpload.filter(isEntry)))
else console.error('skipping entry files because some assets failed')

let fin = await connect()
if (prune && !failed.length) for (const p of stale) {
  try { await fin.remove(remote(p), true); delete done[p]; console.log(`  - ${p}`) } catch (e) { console.error(`  ! remove ${p}: ${e.message}`) }
}
const body = Buffer.from(JSON.stringify({ updated: new Date().toISOString(), files: done }))
for (let attempt = 0; ; attempt++) {
  try { await fin.uploadFrom(Readable.from([body]), remote(MANIFEST)); break } catch (e) {
    fin.close(); fin = await connect()
    if (await landed(fin, MANIFEST, body.length)) break
    if (attempt >= 4) { console.error(`  ! ${MANIFEST}: ${e.message}`); failed.push(MANIFEST); break }
    await sleep(3000 * 2 ** attempt)
  }
}
fin.close()
console.log(`${failed.length ? `${failed.length} failed` : 'done'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
process.exit(failed.length ? 1 : 0)
