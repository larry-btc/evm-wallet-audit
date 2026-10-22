import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createCurlFetch } from './curl-fetch.mjs';

function fakeCurl({ delay = 1, output = '{}\n200', never = false, exit = 0 } = {}) {
  const calls = [];
  let killed = 0;
  return { calls, get killed() { return killed; }, spawn(command, args, options) {
    const child = new EventEmitter();
    const call = { command, args, options, config: '' };
    calls.push(call);
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let timer;
    let closed = false;
    child.stdin = new Writable({ write(chunk, encoding, done) { call.config += chunk.toString(); done(); } });
    child.stdin.on('finish', () => {
      if (never) return;
      timer = setTimeout(() => {
        if (closed) return;
        closed = true;
        child.stdout.end(output);
        child.emit('close', exit);
      }, delay);
    });
    child.kill = () => {
      if (!closed) { closed = true; killed++; clearTimeout(timer); queueMicrotask(() => child.emit('close', -1)); }
      return true;
    };
    return child;
  } };
}

test('curl keeps verified HTTPS, disables personal curl config and sends secrets only over stdin', async () => {
  const fake = fakeCurl({ output: '{"ok":true}\n200' });
  const fetch = createCurlFetch({ spawnImpl: fake.spawn });
  const secret = 'test-only-private-header';
  const response = await fetch('https://example.org/query', { method: 'POST',
    headers: { AccessKey: secret, 'content-type': 'application/json' }, body: '{"literal":"$(no-shell) `no-shell`"}' });
  assert.deepEqual(await response.json(), { ok: true });
  const call = fake.calls[0];
  assert.equal(call.args[0], '--disable');
  assert.equal(call.options.shell, false);
  assert.ok(!call.args.some((value) => value.includes(secret) || value.includes('no-shell')));
  assert.ok(call.config.includes(secret));
  assert.ok(!call.args.includes('--insecure') && !call.args.includes('-k') && !call.args.includes('--location'));
  assert.ok(call.args.includes('=https'));
});

test('untrusted headers, non-HTTPS URLs and embedded URL credentials never start a process', async () => {
  const fake = fakeCurl();
  const fetch = createCurlFetch({ spawnImpl: fake.spawn });
  for (const [url, init] of [
    ['http://example.org', {}], ['https://name:password@example.org', {}],
    ['https://example.org', { headers: { header: 'value\nheader: injected' } }],
  ]) await assert.rejects(fetch(url, init));
  assert.equal(fake.calls.length, 0);
});

test('all curl callers share concurrency and queued work expires within the global budget', async () => {
  const fake = fakeCurl({ never: true });
  const fetch = createCurlFetch({ concurrency: 2, deadlineMs: 35, timeoutMs: 1000, spawnImpl: fake.spawn });
  const start = performance.now();
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => fetch('https://example.org')));
  assert.ok(performance.now() - start < 300);
  assert.equal(fetch.stats.peakConcurrent, 2);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.killed, 2);
  assert.ok(results.every((item) => item.status === 'rejected' && item.reason.code === 'DEADLINE_EXCEEDED'));
});

test('aborting an in-flight request kills only that owned child and lets queued work continue', async () => {
  const fake = fakeCurl({ delay: 10 });
  const fetch = createCurlFetch({ concurrency: 1, spawnImpl: fake.spawn });
  const controller = new AbortController();
  const first = fetch('https://example.org/first', { signal: controller.signal });
  const second = fetch('https://example.org/second');
  controller.abort();
  await assert.rejects(first, (caught) => caught.code === 'REQUEST_ABORTED');
  assert.equal((await second).status, 200);
  assert.equal(fake.killed, 1);
});

test('HTTP errors remain visible and oversized bodies are rejected', async () => {
  const denied = fakeCurl({ output: '{}\n429' });
  assert.equal((await createCurlFetch({ spawnImpl: denied.spawn })('https://example.org')).status, 429);
  const large = fakeCurl({ output: 'a'.repeat(100) + '\n200' });
  await assert.rejects(createCurlFetch({ maxResponseBytes: 16, spawnImpl: large.spawn })('https://example.org'),
    (caught) => caught.code === 'RESPONSE_TOO_LARGE');
});
