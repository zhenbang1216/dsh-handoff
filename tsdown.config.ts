import { defineConfig } from 'tsdown'

/**
 * Two builds:
 *
 * - `index` — the Host half, a plain ESM Cordis plugin. Every `@deepseek-ai/*`
 *   import stays external; the Harness runtime provides those modules.
 * - `client` — the browser half, emitted in the web app's module-loader form:
 *   a CommonJS body wrapped in `window.__ModuleLoader__.load({ id, factory })`,
 *   with `react` and the primitives resolved from the Host's shared module
 *   table at runtime.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: true,
    clean: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    deps: { neverBundle: [/^@deepseek-ai\//] },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.js' }),
    deps: { neverBundle: [/^react($|\/)/, /^react-dom($|\/)/, /^@deepseek-ai\//] },
    banner: 'window.__ModuleLoader__.load({ id: "dsh-handoff", factory: (require) => {\nvar module = { exports: {} };\nvar exports = module.exports;\n',
    footer: '\nreturn module.exports;\n}\n});\n',
  },
])
