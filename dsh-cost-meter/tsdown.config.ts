// Build config for the dsh-cost-meter profile bundle.
//
// Host halves: plain ESM for the dsh process (lib/index.js, lib/typert.host.js).
// Browser half: the closure-factory artifact the web client loader consumes —
// window.__ModuleLoader__.load({ id, factory: (require) => { ... } }) with the
// same banner/footer shape as the in-repo clientBundle preset. react and
// @deepseek-ai/cordis come from the loader's module table, never bundled.
import type { UserConfig } from 'tsdown'

const lib: UserConfig = {
  name: 'dsh-cost-meter',
  entry: ['src/index.ts', 'src/settings.ts', 'src/typert.host.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: true,
}

const client: UserConfig = {
  name: 'dsh-cost-meter/client',
  entry: { client: 'src/client.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { neverBundle: ['react', '@deepseek-ai/cordis'] },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-cost-meter", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [lib, client]
