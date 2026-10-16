// Bundles an app entry point into one ESM file. Everything is bundled except
// packages that load sibling assets at runtime (PGlite's WASM/data files) or
// optional native modules; those are direct dependencies of each app.
import { build } from 'esbuild';

const [entry, outfile] = process.argv.slice(2);
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'linked',
  logLevel: 'warning',
  external: ['@electric-sql/pglite', '@electric-sql/pglite/*', 'pg-native'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
