#!/usr/bin/env node
/**
 * Vercel Build Output API v3 script for TanStack Start (HorIA)
 *
 * Flow:
 *  1. Run `vite build`  → dist/client/ + dist/server/
 *  2. Bundle dist/server/server.js with esbuild into a single Node.js file
 *  3. Wrap it with a Node.js → Web-Fetch adapter (Vercel serverless format)
 *  4. Assemble .vercel/output/{config.json, static/, functions/index.func/}
 *
 * Why not Edge? The TanStack Start server bundle imports node:async_hooks,
 * which is Node.js-only and not available on Vercel Edge runtime.
 */

import { cpSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ─── 1. Vite build ────────────────────────────────────────────────────────────
console.log('\n[1/4] Vite build…');
execSync('npm run build', { stdio: 'inherit', cwd: root });

// ─── 2. Find main server asset (hash changes every build) ────────────────────
const serverAssetsDir = resolve(root, 'dist/server/assets');
const serverAssets    = readdirSync(serverAssetsDir);
const mainAsset       = serverAssets.find(f => f.startsWith('server-') && f.endsWith('.js'));
if (!mainAsset) throw new Error('Could not find dist/server/assets/server-*.js after build');
console.log(`[2/4] Main server asset: ${mainAsset}`);

// ─── 3. Write adapter + bundle with esbuild ──────────────────────────────────
console.log('[3/4] Writing adapter and bundling with esbuild…');

// The adapter converts Vercel's Node.js req/res into the Web-standard
// Request/Response pair expected by the TanStack Start fetch handler.
const adapterSrc = `
import serverModule from ${JSON.stringify(resolve(root, 'dist/server/server.js'))};

export default async function handler(req, res) {
  // ── Build URL ──
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host  = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const url   = proto + '://' + host + req.url;

  // ── Headers ──
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }

  // ── Body ──
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end',  ()  => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  // ── Call TanStack Start ──
  const request  = new Request(url, { method: req.method, headers, body: body?.length ? body : undefined });
  const response = await serverModule.fetch(request, {}, {});

  // ── Stream response ──
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));

  if (response.body) {
    const reader = response.body.getReader();
    const pump   = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
      await pump();
    };
    await pump();
  } else {
    res.end();
  }
}
`;

const adapterPath = resolve(root, '.vercel-adapter-tmp.mjs');
writeFileSync(adapterPath, adapterSrc);

// Bundle with esbuild: follow all static & dynamic imports → single CJS file
const bundlePath = resolve(root, '.vercel-bundle-tmp.js');
// esbuild is bundled inside vite — find it
const possibleEsbuildPaths = [
  'node_modules/.bin/esbuild',
  'node_modules/vite/node_modules/esbuild/bin/esbuild',
  'node_modules/esbuild/bin/esbuild',
];
const { existsSync } = await import('fs');
const esbuildBin = possibleEsbuildPaths
  .map(p => resolve(root, p))
  .find(p => existsSync(p));
if (!esbuildBin) throw new Error('esbuild binary not found');

execSync(
  [
    `"${esbuildBin}"`,
    `"${adapterPath}"`,
    '--bundle',
    '--platform=node',
    '--target=node18',
    '--format=cjs',
    '--external:node:*',      // keep Node.js built-ins external (available at runtime)
    '--log-level=warning',
    `--outfile="${bundlePath}"`,
  ].join(' '),
  { stdio: 'inherit', cwd: root }
);
console.log('    esbuild done.');

// ─── 4. Assemble .vercel/output/ ─────────────────────────────────────────────
console.log('[4/4] Assembling .vercel/output/…');

const outDir      = resolve(root, '.vercel/output');
const staticDir   = resolve(outDir, 'static');
const funcDir     = resolve(outDir, 'functions/index.func');

mkdirSync(staticDir, { recursive: true });
mkdirSync(funcDir,   { recursive: true });

// Static assets (client bundle)
cpSync(resolve(root, 'dist/client'), staticDir, { recursive: true });

// Serverless function entry
const bundledCode = readFileSync(bundlePath, 'utf8');
writeFileSync(resolve(funcDir, 'index.js'), bundledCode);

// Function runtime config (Node.js 18)
writeFileSync(
  resolve(funcDir, '.vc-config.json'),
  JSON.stringify({
    runtime:  'nodejs18.x',
    handler:  'index.js',
    launcherType: 'Nodejs',
    maxDuration: 30,
    supportsResponseStreaming: true,
  }, null, 2)
);

// Vercel routing config
// - Assets with hash in name → long-lived cache
// - /manifest.webmanifest, /robots.txt, icons → short cache, filesystem
// - Everything else → SSR function
writeFileSync(
  resolve(outDir, 'config.json'),
  JSON.stringify({
    version: 3,
    routes: [
      // Immutable hashed assets (Vite output: /assets/xxx-HASH.js|css)
      {
        src: '^/assets/(.+\\.[0-9a-f]{8,}\\.(js|css|woff2?|ttf|otf|svg|png|jpg|webp))$',
        headers: { 'cache-control': 'public, max-age=31536000, immutable' },
        continue: true,
      },
      // Let filesystem handle known static files (icons, manifest, robots…)
      { handle: 'filesystem' },
      // Everything else → SSR
      { src: '/(.*)', dest: '/index' },
    ],
  }, null, 2)
);

// Clean up tmp files
import { unlinkSync } from 'fs';
try { unlinkSync(adapterPath); } catch {}
try { unlinkSync(bundlePath);  } catch {}

console.log('\n✅  .vercel/output/ ready — Vercel will pick it up automatically.\n');
