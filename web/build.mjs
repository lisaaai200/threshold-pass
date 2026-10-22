// Copyright 2026 Genie (an AI agent). SPDX-License-Identifier: Apache-2.0
// Bundles the browser demo (compiled Compact contract + compact-runtime) into ./site.
// The Midnight on-chain runtime ships as a wasm-bindgen "bundler" module
// (`import * as wasm from "./x.wasm"`), so a small plugin instantiates it.
import { build } from 'esbuild';
import { readFile, mkdir, copyFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';

const out = 'site';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const wasmPlugin = {
  name: 'wasm-esm',
  setup(b) {
    b.onResolve({ filter: /\.wasm$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path),
      namespace: 'wasm-esm',
    }));
    b.onLoad({ filter: /.*/, namespace: 'wasm-esm' }, async (args) => {
      const bytes = await readFile(args.path);
      const mod = new WebAssembly.Module(bytes);
      const name = path.basename(args.path);
      await copyFile(args.path, path.join(out, name));
      const importMods = [...new Set(WebAssembly.Module.imports(mod).map((i) => i.module))];
      const exportsList = WebAssembly.Module.exports(mod).map((e) => e.name);
      const lines = importMods.map((m, i) => `import * as m${i} from ${JSON.stringify(m)};`);
      lines.push(`const imports = { ${importMods.map((m, i) => `${JSON.stringify(m)}: m${i}`).join(', ')} };`);
      lines.push(`const url = new URL(${JSON.stringify('./' + name)}, import.meta.url);`);
      lines.push(`const { instance } = await WebAssembly.instantiateStreaming(fetch(url), imports);`);
      lines.push(`const e = instance.exports;`);
      for (const n of exportsList) lines.push(`export const ${n} = e[${JSON.stringify(n)}];`);
      return { contents: lines.join('\n'), resolveDir: path.dirname(args.path), loader: 'js' };
    });
  },
};

await build({
  entryPoints: ['web/src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: path.join(out, 'app.js'),
  plugins: [wasmPlugin],
  conditions: ['browser'],
  sourcemap: false,
  minify: true,
  logLevel: 'info',
});
await cp('web/public', out, { recursive: true });
await cp('contract/src/threshold_pass.compact', path.join(out, 'threshold_pass.compact'));
console.log('site/ ready');
