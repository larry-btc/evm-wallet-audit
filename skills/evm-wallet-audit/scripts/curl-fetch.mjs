import { spawn } from 'node:child_process';

const failure = (code) => Object.assign(new Error(code), { code });
const quote = (value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t')}"`;

// Secure system-curl transport for environments where Node's CA path is unavailable.
// Credentials and request bodies go over stdin, never argv or temporary files.
export function createCurlFetch({ concurrency = 6, timeoutMs = 6000, deadlineMs = 40000,
  maxResponseBytes = 16 * 1024 * 1024, spawnImpl = spawn } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000 ||
      !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 55000) {
    throw failure('INVALID_TRANSPORT_OPTIONS');
  }
  const expires = performance.now() + deadlineMs;
  const queue = [];
  let active = 0;
  let deadlineReached = false;
  const stats = { started: 0, completed: 0, failed: 0, peakConcurrent: 0 };

  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      if (!job.done) job.start();
    }
  }

  const fetchImpl = (input, init = {}) => new Promise((resolve, reject) => {
    let url;
    let config;
    try {
      url = new URL(input);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw failure('HTTPS_REQUIRED');
      const method = init.method ?? 'GET';
      if (!['GET', 'POST'].includes(method) || (init.body !== undefined && typeof init.body !== 'string')) {
        throw failure('INVALID_REQUEST');
      }
      const lines = [`request = ${quote(method)}`];
      const headers = init.headers instanceof Headers ? [...init.headers] : Object.entries(init.headers ?? {});
      for (const [name, value] of headers) {
        if (!/^[A-Za-z0-9-]+$/.test(name) || typeof value !== 'string' || /[\r\n\0]/.test(value)) {
          throw failure('INVALID_REQUEST_HEADERS');
        }
        lines.push(`header = ${quote(`${name}: ${value}`)}`);
      }
      if (init.body !== undefined) {
        if (Buffer.byteLength(init.body) > 1024 * 1024 || init.body.includes('\0')) throw failure('REQUEST_TOO_LARGE');
        lines.push(`data-raw = ${quote(init.body)}`);
      }
      config = `${lines.join('\n')}\n`;
    } catch (error) {
      reject(failure(error?.code ?? 'INVALID_REQUEST'));
      return;
    }
    let child;
    let timer;
    let started = false;
    const job = { done: false, start };
    const abort = () => finish(failure('REQUEST_ABORTED'));
    function finish(error, response) {
      if (job.done) return;
      job.done = true;
      if (error?.code === 'DEADLINE_EXCEEDED') deadlineReached = true;
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abort);
      if (error && child) child.kill('SIGKILL');
      if (started) active--;
      if (error) { stats.failed++; reject(error); }
      else { stats.completed++; resolve(response); }
      drain();
    }
    function start() {
      const remaining = expires - performance.now();
      if (deadlineReached || remaining <= 0) { finish(failure('DEADLINE_EXCEEDED')); return; }
      clearTimeout(timer);
      started = true;
      active++;
      stats.started++;
      stats.peakConcurrent = Math.max(stats.peakConcurrent, active);
      const limitMs = Math.min(timeoutMs, remaining);
      timer = setTimeout(() => finish(failure(remaining <= timeoutMs ? 'DEADLINE_EXCEEDED' : 'REQUEST_TIMEOUT')), Math.ceil(limitMs));
      try {
        child = spawnImpl('curl', ['--disable', '--silent', '--globoff', '--proto', '=https',
          '--proto-redir', '=https', '--max-redirs', '0', '--connect-timeout', String(Math.min(3, limitMs / 1000)),
          '--max-time', String(limitMs / 1000), '--write-out', '\n%{http_code}', '--url', url.toString(), '--config', '-'],
        { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        const chunks = [];
        let size = 0;
        child.stdout.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxResponseBytes) { finish(failure('RESPONSE_TOO_LARGE')); return; }
          chunks.push(chunk);
        });
        // Upstream error text may contain sensitive input. Discard it.
        child.stderr.on('data', () => {});
        child.stdin.on('error', () => finish(failure('TRANSPORT_ERROR')));
        child.on('error', () => finish(failure('TRANSPORT_UNAVAILABLE')));
        child.on('close', (code) => {
          if (job.done) return;
          if (code !== 0) { finish(failure(code === 28 ? 'REQUEST_TIMEOUT' : 'TRANSPORT_ERROR')); return; }
          const output = Buffer.concat(chunks).toString('utf8');
          const split = output.lastIndexOf('\n');
          const statusText = output.slice(split + 1);
          if (split < 0 || !/^[1-5][0-9]{2}$/.test(statusText)) { finish(failure('INVALID_HTTP_RESPONSE')); return; }
          const body = output.slice(0, split);
          finish(null, { status: Number(statusText), json: async () => JSON.parse(body) });
        });
        child.stdin.end(config);
      } catch { finish(failure('TRANSPORT_UNAVAILABLE')); }
    }
    if (init.signal?.aborted) { finish(failure('REQUEST_ABORTED')); return; }
    init.signal?.addEventListener('abort', abort, { once: true });
    const remaining = expires - performance.now();
    if (deadlineReached || remaining <= 0) { finish(failure('DEADLINE_EXCEEDED')); return; }
    timer = setTimeout(() => finish(failure('DEADLINE_EXCEEDED')), Math.ceil(remaining));
    queue.push(job);
    drain();
  });
  fetchImpl.stats = stats;
  return fetchImpl;
}
