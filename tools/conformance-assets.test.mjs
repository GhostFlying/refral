import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { conformanceAssets } from './conformance-assets.ts';

test('official source serving preserves bytes, MIME, HEAD and media ranges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'refral-conformance-assets-'));
  let server;
  try {
    const html = '<!doctype html><script>var unchanged = true;</script>\n';
    await writeFile(join(directory, 'runner.html'), html);
    const original = 'importScripts("./original-dependency.js");';
    await writeFile(join(directory, 'worker.js'), original);
    await writeFile(join(directory, 'movie.webm'), new Uint8Array([0, 1, 2, 3, 4, 5]));
    const plugin = conformanceAssets(directory);
    let handler;
    plugin.configureServer({ middlewares: { use(_prefix, middleware) { handler = middleware; } } });
    server = createServer((request, response) => { void handler(request, response); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.match(await (await fetch(origin + '/worker.js?__refral_worker=id')).text(), /runOfficialWorker/);
    assert.equal(await (await fetch(origin + '/worker.js')).text(), original);
    const response = await fetch(origin + '/runner.html');
    assert.equal(await response.text(), html);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(html)));
    const head = await fetch(origin + '/runner.html', { method: 'HEAD' });
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(html)));
    const range = await fetch(origin + '/movie.webm', { headers: { Range: 'bytes=1-3' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('content-range'), 'bytes 1-3/6');
    assert.deepEqual(Array.from(new Uint8Array(await range.arrayBuffer())), [1, 2, 3]);
    const suffix = await fetch(origin + '/movie.webm', { headers: { Range: 'bytes=-2' } });
    assert.deepEqual(Array.from(new Uint8Array(await suffix.arrayBuffer())), [4, 5]);
    assert.equal((await fetch(origin + '/movie.webm', { headers: { Range: 'bytes=6-' } })).status, 416);
    assert.equal((await fetch(origin + '/missing.js')).status, 404);
    assert.equal((await fetch(origin + '/%2e%2e%2foutside.html')).status, 403);
    assert.equal((await fetch(origin + '/%zz')).status, 400);
  } finally {
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
