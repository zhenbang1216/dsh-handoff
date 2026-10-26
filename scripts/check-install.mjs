// Preflight: does this machine's profile actually carry the plugin?
//
//   node scripts/check-install.mjs [profile] [dshHome]
//
// Defaults: profile `desktop`, DSH home from $DSH_HOME or ~/.dsh.
// Exits non-zero when a check fails, so it can gate a release smoke test.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PACKAGE = 'dsh-handoff'

const profile = process.argv[2] ?? 'desktop'
const home = process.argv[3] ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
const dir = join(home, 'profiles', profile)

let failed = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failed++
}

console.log(`profile: ${dir}\n`)

const manifestPath = join(dir, 'package.json')
if (!existsSync(manifestPath)) {
  console.error(`no profile at ${dir}`)
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const dependency = manifest.dependencies?.[PACKAGE]
check('profile declares the dependency', typeof dependency === 'string', dependency ?? 'missing')
check('profile lists the bundle', Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(PACKAGE))

const installed = join(dir, 'node_modules', PACKAGE)
check('package is installed in the profile', existsSync(installed), installed)

for (const [label, relative] of [
  ['host entry', 'lib/index.js'],
  ['client bundle', 'lib/client.js'],
  ['bundle patch', 'cordis.patch.yml'],
  ['package manifest', 'package.json'],
]) {
  const path = join(installed, relative)
  check(`${label} exists`, existsSync(path), relative)
}

if (existsSync(join(installed, 'package.json'))) {
  const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  check('package exposes the client half', pkg.exports?.['./client'] !== undefined, pkg.exports?.['./client'])
  check('package declares dsh.client', pkg.dsh?.client?.platform === 'web', JSON.stringify(pkg.dsh?.client))
  const built = pkg.version
  check('package has a version', typeof built === 'string' && built !== '')
  console.log(`\nversion: ${built}`)
  const clientPath = join(installed, 'lib', 'client.js')
  if (existsSync(clientPath)) {
    const head = readFileSync(clientPath, 'utf8').slice(0, 80)
    check('client bundle is in module-loader form', head.includes('__ModuleLoader__.load'), head.replace(/\s+/g, ' '))
    console.log(`client bundle: ${statSync(clientPath).size} bytes`)
  }
}

const patchPath = join(dir, 'cordis.patch.yml')
if (existsSync(patchPath)) {
  const patch = readFileSync(patchPath, 'utf8')
  console.log(`\nuser patch mentions the plugin: ${patch.includes(PACKAGE) ? 'yes' : 'no (defaults apply)'}`)
}

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`)
process.exit(failed === 0 ? 0 : 1)
