import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { turtleAnimationFiles } from './src/turtle-animation.ts';

const clientLibraries = ['@fontsource-variable/nunito', 'lucide-react', 'react', 'react-dom', 'scheduler', 'zod'];

export default defineConfig({
  plugins: [{
    name: 'android-download',
    configurePreviewServer(server) {
      const filename = 'one-life-daybook.apk';
      const path = resolve(server.config.root, filename);

      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `/${filename}` || !['GET', 'HEAD'].includes(request.method ?? '')) {
          next();
          return;
        }

        const file = statSync(path, { throwIfNoEntry: false });
        if (!file?.isFile()) {
          response.statusCode = 404;
          response.end('The Android installer is not available.');
          return;
        }
        response.setHeader('Content-Type', 'application/vnd.android.package-archive');
        response.setHeader('Content-Disposition', 'attachment; filename="One-Life-Daybook.apk"');
        response.setHeader('Content-Length', file.size);
        response.setHeader('Cache-Control', 'no-store');
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(path).on('error', (error) => response.destroy(error)).pipe(response);
      });
    },
  }, {
    name: 'client-license-notices',
    apply: 'build',
    generateBundle() {
      const source = clientLibraries.map((name) => {
        const license = readFileSync(new URL(`../../node_modules/${name}/LICENSE`, import.meta.url), 'utf8');
        return `${name}\n\n${license.trimEnd()}`;
      }).join('\n\n');
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: `${source}\n` });
    },
  }, {
    name: 'offline-shell',
    apply: 'build',
    generateBundle(_options, bundle) {
      const publicFiles = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...turtleAnimationFiles];
      const files = ['/', '/index.html', ...publicFiles,
        ...Object.keys(bundle).filter((file) => /\.(css|js|woff2)$/.test(file) || file === 'third-party-notices.txt').map((file) => `/${file}`)];
      const hash = createHash('sha256').update(files.join('\n'));
      for (const file of ['index.html', ...publicFiles.map((path) => `public${path}`)]) {
        hash.update(readFileSync(new URL(file, import.meta.url)));
      }
      const cache = `one-life-${hash.digest('hex').slice(0, 16)}`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const cacheName = ${JSON.stringify(cache)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(${JSON.stringify(files)})));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('one-life-') && key !== cacheName).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isAppPage = url.pathname === '/' || url.pathname === '/index.html';
  if (request.mode === 'navigate' && !isAppPage) return;
  if (url.pathname.endsWith('.apk')) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    if (request.mode === 'navigate') return (await cache.match('/index.html')) || fetch(request);
    // This cache contains only static build assets. Module requests may send a different Origin header.
    return (await cache.match(request, { ignoreVary: true })) || fetch(request);
  }));
});` });
    },
  }],
});

