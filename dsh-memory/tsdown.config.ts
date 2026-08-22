// Build config for the dsh-memory preset plugin.
//
// Host halves: plain ESM for the dsh process (lib/index.js, lib/settings.js).
// Browser half: the closure-factory artifact the web client loader consumes.
import type { UserConfig } from 'tsdown'

const lib: UserConfig = {
  name: 'dsh-memory',
  entry: ['src/index.ts', 'src/settings.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [/^@deepseek-ai\/(?!schemastery)/],
  },
}

const client: UserConfig = {
  name: 'dsh-memory/client',
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
    banner: 'window.__ModuleLoader__.load({ id: "dsh-memory", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [lib, client]
