import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promptDeBankKey, runDeBankCli } from './query-with-debank.mjs';

const WALLET = '0x1111111111111111111111111111111111111111';
const SECRET = 'fixture-accesskey-not-a-real-credential';
const capture = () => ({ value: '', write(text) { this.value += text; } });

test('native prompt uses hidden input and returns its value without putting the key in argv', async () => {
  const calls = [];
  const key = await promptDeBankKey({ platform: 'darwin', execFileImpl: async (...args) => {
    calls.push(args); return { stdout: ` ${SECRET}\n`, stderr: '' };
  } });
  assert.equal(key, SECRET);
  assert.ok(calls[0][1][1].includes('with hidden answer'));
  assert.ok(!JSON.stringify(calls).includes(SECRET));
});

test('cancelled prompt errors are scrubbed and unsupported platforms never launch a dialog', async () => {
  await assert.rejects(promptDeBankKey({ platform: 'linux', execFileImpl: () => assert.fail('No process') }),
    (caught) => caught.code === 'LOCAL_SECRET_PROMPT_UNSUPPORTED');
  await assert.rejects(promptDeBankKey({ platform: 'darwin', execFileImpl: async () => { throw new Error(SECRET); } }),
    (caught) => caught.code === 'LOCAL_SECRET_PROMPT_CANCELLED_OR_FAILED' && !caught.message.includes(SECRET));
});

test('one-shot DeBank query uses the key only in the official header and does not mutate the environment', async () => {
  const stdout = capture();
  const stderr = capture();
  const env = {};
  const calls = [];
  let prompts = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.equal(new URL(url).origin, 'https://pro-openapi.debank.com');
    assert.equal(init.headers.AccessKey, SECRET);
    return { status: 200, json: async () => new URL(url).pathname === '/v1/chain/list' ? [{ id: 'base', community_id: 8453 }] : [] };
  };
  const exit = await runDeBankCli([WALLET, '--chains', 'base', '--protocols', 'none'], {
    env, stdout, stderr, fetchImpl, promptKey: async () => { prompts++; return SECRET; },
  });
  assert.equal(exit, 0);
  assert.equal(prompts, 1);
  assert.equal(calls.length, 5);
  assert.equal(JSON.parse(stdout.value).snapshot.providerMode, 'debank_with_rpc_fallback');
  assert.equal(JSON.parse(stdout.value).debankConnection.verified, true);
  assert.deepEqual(env, {});
  assert.ok(!`${stdout.value}${stderr.value}${JSON.stringify(process.argv)}`.includes(SECRET));
});

test('existing runtime key needs no prompt and invalid arguments never ask for a secret', async () => {
  const stdout = capture();
  const stderr = capture();
  let prompts = 0;
  const promptKey = async () => { prompts++; return SECRET; };
  const fetchImpl = async () => ({ status: 200, json: async () => [] });
  await runDeBankCli([WALLET, '--protocols', 'none'], {
    env: { DEBANK_ACCESS_KEY: SECRET }, stdout, stderr, promptKey, fetchImpl,
  });
  assert.equal(prompts, 0);
  const invalid = await runDeBankCli([WALLET, '--key', SECRET], { stdout, stderr, promptKey });
  assert.equal(invalid, 1);
  assert.equal(prompts, 0);
  assert.ok(!`${stdout.value}${stderr.value}`.includes(SECRET));
});

test('an existing output is rejected before prompting or querying', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'debank-input-test-'));
  try {
    const output = join(directory, 'existing.json');
    await writeFile(output, 'original');
    const stderr = capture();
    const exit = await runDeBankCli([WALLET, '--output', output], { stdout: capture(), stderr,
      promptKey: async () => assert.fail('Must not prompt'), fetchImpl: async () => assert.fail('Must not query') });
    assert.equal(exit, 1);
    assert.equal(JSON.parse(stderr.value).errorCode, 'OUTPUT_ALREADY_EXISTS');
    assert.equal(await readFile(output, 'utf8'), 'original');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('full quick validation precedes the secret prompt, including token scope and maximum budget', async () => {
  for (const extra of [['--deadline-ms', '50000'], ['--token', 'unknown:0x2222222222222222222222222222222222222222'],
    ['--chains', 'eth', '--token', 'base:0x2222222222222222222222222222222222222222']]) {
    const exit = await runDeBankCli([WALLET, ...extra], { env: {}, stdout: capture(), stderr: capture(),
      promptKey: async () => assert.fail('Must validate before prompting'), fetchImpl: async () => assert.fail('Must not query') });
    assert.equal(exit, 1);
  }
});

test('RPC fallback never marks a rejected DeBank credential as verified', async () => {
  const stdout = capture();
  const fetchImpl = async (url, init) => {
    if (url.startsWith('https://pro-openapi.debank.com')) return { status: 401 };
    const request = JSON.parse(init.body);
    const result = request.method === 'eth_chainId' ? '0x2105' : '0x1';
    return { status: 200, json: async () => ({ jsonrpc: '2.0', id: request.id, result }) };
  };
  const exit = await runDeBankCli([WALLET, '--chains', 'base', '--protocols', 'none'], {
    env: { DEBANK_ACCESS_KEY: SECRET }, stdout, stderr: capture(), fetchImpl,
  });
  assert.equal(exit, 0, 'Usable partial native data remains available');
  const result = JSON.parse(stdout.value);
  assert.equal(result.status, 'partial');
  assert.equal(result.debankConnection.status, 'failed');
  assert.equal(result.debankConnection.verified, false);
  assert.ok(!stdout.value.includes(SECRET));
});
