/**
 * Copyright 2026 Casual Office
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rediRoot = dirname(require.resolve('@wendellhu/redi/package.json'));
const webRoot = dirname(fileURLToPath(import.meta.url));
const webNodeModules = resolve(webRoot, 'node_modules');
const rootNodeModules = resolve(webRoot, '../../node_modules');
const forkPackages = resolve(webRoot, '../../vendor/univer-revamp/packages');
const sharedEntry = resolve(webRoot, '../../vendor/univer-revamp/common/shared/src/index.ts');
const iconsEntry = resolve(webNodeModules, '@univerjs/icons/dist/esm/index.js');
const nanoidEntry = resolve(webNodeModules, 'nanoid/index.browser.js');

function vendorResolutionPlugin(): Plugin {
  return {
    name: 'vendor-resolution-plugin',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === 'nanoid') {
        return nanoidEntry;
      }
      if (id.includes('assets/icon-map') || id.includes('assets\\icon-map')) {
        return '\0virtual:icon-map';
      }
      if (id === '@univerjs-infra/shared') {
        return sharedEntry;
      }
      if (id === '@univerjs/icons') {
        return iconsEntry;
      }
      if (id.startsWith('@univerjs/') && id.endsWith('.css')) {
        const sub = id.slice('@univerjs/'.length);
        const parts = sub.split('/');
        const pkgName = parts[0];
        const rest = parts.slice(1).join('/');
        const pkgDir = resolve(forkPackages, pkgName);
        const cssPath = resolve(pkgDir, rest);
        if (existsSync(cssPath)) {
          return cssPath;
        }
        return '\0virtual:empty.css';
      }
      if (id.startsWith('@univerjs/')) {
        const sub = id.slice('@univerjs/'.length);
        const parts = sub.split('/');
        const pkgName = parts[0];
        const rest = parts.slice(1);
        const pkgDir = resolve(forkPackages, pkgName);
        if (existsSync(pkgDir)) {
          if (rest.length === 0) {
            const entryTs = resolve(pkgDir, 'src/index.ts');
            if (existsSync(entryTs)) return entryTs;
            const entryJs = resolve(pkgDir, 'src/index.js');
            if (existsSync(entryJs)) return entryJs;
          } else {
            const subPath = rest.join('/');
            const direct = resolve(pkgDir, 'src', subPath);
            if (existsSync(`${direct}.ts`)) return `${direct}.ts`;
            if (existsSync(`${direct}.tsx`)) return `${direct}.tsx`;
            if (existsSync(`${direct}/index.ts`)) return `${direct}/index.ts`;
            if (existsSync(`${direct}/index.tsx`)) return `${direct}/index.tsx`;
          }
        }
      }
      if (importer && (importer.includes('vendor/univer-revamp') || importer.includes('vendor\\univer-revamp')) && !id.startsWith('.') && !id.startsWith('/')) {
        try {
          return require.resolve(id, { paths: [webNodeModules, rootNodeModules] });
        } catch {
          // ignore
        }
      }
      return null;
    },
    load(id) {
      if (id === '\0virtual:empty.css') {
        return '';
      }
      if (id === '\0virtual:icon-map') {
        return `
const handler = {
  get: () => new Proxy({}, { get: () => 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })
};
export const ICON_MAP = new Proxy({}, handler);
`;
      }
      return null;
    },
  };
}

// `PAGES_BASE` lets the GitHub Pages workflow build for /sheets/ without
// committing that path into the repo (local dev stays at /).
const base = process.env.PAGES_BASE ?? '/';

// Read app version from package.json so the About dialog stays in sync
// without manual bumps every release.
const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf-8'),
) as { version: string };

const collabEnabled =
  process.env.VITE_COLLAB_ENABLED === '1' || process.env.VITE_COLLAB_ENABLED === 'true';

export default defineConfig({
  base,
  plugins: [vendorResolutionPlugin(), react()],
  resolve: {
    alias: [
      { find: /^nanoid$/, replacement: nanoidEntry },
      { find: /^@univerjs\/icons$/, replacement: iconsEntry },
      { find: /^@wendellhu\/redi\/react-bindings$/, replacement: resolve(rediRoot, 'dist/esm/react-bindings/index.js') },
      { find: /^@wendellhu\/redi$/, replacement: resolve(rediRoot, 'dist/esm/index.js') },
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COLLAB_BUILD__: JSON.stringify(collabEnabled),
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
  },
  // Formula offload worker is loaded with `{ type: 'module' }`, so the
  // worker bundle must be ES (not the default IIFE). IIFE can't code-split
  // and rollup hard-errors when an ES worker imports anything multi-chunk.
  worker: {
    format: 'es',
    plugins: () => [vendorResolutionPlugin()],
  },
  // Pre-bundle the heavy / dynamically-loaded deps at server start instead
  // of letting Vite discover them mid-run. Without this, the first dynamic
  // import of '@e965/xlsx' (when the user picks an .ods / .csv file or our
  // e2e suite probes the ods module) triggers a re-optimize pass that
  // duplicates Univer modules in the dep cache — the symptom is "Identifier
  // ... already exists" DI errors and a blank grid until a hard reload.
  optimizeDeps: {
    // Same rationale as @e965/xlsx — pre-bundle echarts at dev-server
    // start. Without this, the first dynamic import of echarts (when
    // a user clicks Insert > Chart, or when a workbook with charts
    // mounts) triggers a re-optimize pass mid-run that duplicates
    // Univer modules in the dep cache. Symptom: "Identifier ...
    // already exists" DI errors and a blank grid until hard reload.
    include: [
      'exceljs',
      '@e965/xlsx',
      'echarts',
      'echarts/core',
      'echarts/charts',
      'echarts/components',
      'echarts/renderers',
      // jszip is pulled by exceljs + the xlsx round-trip path. Without
      // pre-bundling, Insert > Chart's first import triggers Vite's
      // optimize-and-reload at runtime — observed on CI as
      // "Execution context was destroyed, most likely because of a
      // navigation" inside charts-p1's page.evaluate() block right
      // after the chart insert. Pre-bundling at server boot keeps the
      // module graph stable across the test run.
      'jszip',
    ],
  },
});
