import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { Plugin } from 'vite';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.ogv': 'video/ogg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

/** Serve the pinned suite without Vite's HTML or JavaScript transformations. */
export function conformanceAssets(directory = resolve('third_party/cts')): Plugin {
  return {
    name: 'refral-original-conformance-assets',
    configureServer(server) {
      server.middlewares.use('/third_party/cts', async (request, response) => {
        let file: string;
        let workerEntry = false;
        try {
          const url = new URL(request.url ?? '/', 'http://localhost');
          const pathname = decodeURIComponent(url.pathname);
          workerEntry = url.searchParams.has('__refral_worker') && pathname.endsWith('.js');
          file = resolve(directory, `.${pathname}`);
        } catch {
          response.writeHead(400).end();
          return;
        }
        if (!file.startsWith(directory + sep)) {
          response.writeHead(403).end();
          return;
        }
        try {
          const information = await stat(file);
          if (!information.isFile()) {
            response.writeHead(404).end();
            return;
          }
          if (workerEntry) {
            // Keep the original worker directory as the base for relative importScripts.
            const body = `import('/tests/fixtures/conformance-worker.ts').then(m => m.runOfficialWorker()).catch(error => {
              self.postMessage({ __refralWorker: new URL(location.href).searchParams.get('__refral_worker'),
                detail: { type: 'error', name: error?.name, message: String(error) } });
            });`;
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(request.method === 'HEAD' ? undefined : body);
            return;
          }
          const type = contentTypes[extname(file)] ?? 'text/plain; charset=utf-8';
          let start = 0;
          let end = information.size - 1;
          let status = 200;
          const range = request.headers.range;
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match || (!match[1] && !match[2])) {
              response.writeHead(416, { 'Content-Range': `bytes */${information.size}` }).end();
              return;
            }
            if (match[1]) {
              start = Number(match[1]);
              end = match[2] ? Math.min(Number(match[2]), end) : end;
            } else start = Math.max(0, information.size - Number(match[2]));
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
              || start > end || start >= information.size) {
              response.writeHead(416, { 'Content-Range': `bytes */${information.size}` }).end();
              return;
            }
            status = 206;
            response.setHeader('Content-Range', `bytes ${start}-${end}/${information.size}`);
          }
          response.writeHead(status, { 'Content-Type': type, 'Content-Length': Math.max(0, end - start + 1),
            'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' });
          if (request.method === 'HEAD' || information.size === 0) {
            response.end();
            return;
          }
          const stream = createReadStream(file, { start, end });
          stream.on('error', () => response.destroy());
          response.on('close', () => stream.destroy());
          stream.pipe(response);
        } catch {
          response.writeHead(404).end();
        }
      });
    },
  };
}
