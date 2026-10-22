import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectQuickAudit, parseQuickArgs, runQuickCli, validateQuickOptions } from './quick-audit.mjs';
import { DEBANK_ORIGIN, RPC_CHAINS } from './collect-snapshot.mjs';
import { VIRTUALS_CONTRACTS as C, VIRTUALS_SELECTORS as S } from './virtuals-staking.mjs';

const WALLET = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x2222222222222222222222222222222222222222';
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const scalar = (value) => `0x${word(value)}`;
const list = (rows) => `0x${word(32)}${word(rows.length)}${rows.flat().map(word).join('')}`;
function rpcMock({ stallEth = false, stallVirtuals = false, badToken = false } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, ...body });
    const chain = Object.values(RPC_CHAINS).find((item) => item.url === url);
    if (stallEth && chain.chainId === 1) return new Promise(() => {});
    let result;
    if (body.method === 'eth_chainId') result = `0x${chain.chainId.toString(16)}`;
    else if (body.method === 'eth_blockNumber') result = '0x123';
    else if (body.method === 'eth_getBalance') result = '0xde0b6b3a7640000';
    else if (body.method === 'eth_getBlockByNumber') result = { number: '0x123', timestamp: '0x68000000' };
    else {
      assert.equal(body.method, 'eth_call');
      const { to, data } = body.params[0];
      const selector = data.slice(0, 10);
      if (stallVirtuals && [C.current, C.legacy, C.token].includes(to)) return new Promise(() => {});
      if (to === C.current) {
        const table = { [S.baseToken]: scalar(C.token), [S.numPositions]: scalar(2),
          [S.stakedAmountOf]: scalar(1500n * 10n ** 18n), [S.adminUnlocked]: scalar(0),
          [S.maxWeeks]: scalar(104), [S.balanceOf]: scalar(0),
          [S.getPositions]: list([[1200n * 10n ** 18n,1700000000,1762899200,104,0,101],
            [300n * 10n ** 18n,1700604800,1763504000,104,0,102]]) };
        result = table[selector];
      } else if (to === C.legacy) {
        result = selector === S.depositToken ? scalar(C.token) : selector === S.getDepositsOf ? list([]) : scalar(0);
      } else if (to === C.token) result = scalar(0);
      else if (to === TOKEN) result = badToken ? '0x' : selector === '0x313ce567' ? scalar(6) : scalar(1234567890123456789n);
      assert.notEqual(result, undefined);
    }
    return { status: 200, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  };
  return { calls, fetch };
}
const base = (fetchImpl, extras = {}) => ({ addresses: [WALLET], provider: 'rpc', fetchImpl, env: {}, ...extras });

test('quick validation, CLI parsing and help default to free RPC while explicit provider choices remain available', async () => {
  assert.equal(validateQuickOptions({ addresses: [WALLET] }).provider, 'rpc');
  assert.equal(parseQuickArgs([WALLET]).provider, 'rpc');
  assert.equal(parseQuickArgs([WALLET, '--provider', 'auto']).provider, 'auto');
  assert.equal(parseQuickArgs([WALLET, '--provider', 'debank']).provider, 'debank');
  const stdout = { value: '', write(text) { this.value += text; } };
  const exit = await runQuickCli(['--help'], { stdout, fetchImpl: async () => assert.fail('Help must not query') });
  assert.equal(exit, 0);
  assert.match(stdout.value, /Default: free public RPC/);
  assert.match(stdout.value, /existing DEBANK_ACCESS_KEY is ignored/);
});

test('default quick API and CLI ignore a runtime DeBank key and query only free RPC plus Virtuals', async () => {
  const secret = 'offline-unused-runtime-debank-key';
  for (const entry of ['api', 'cli']) {
    const mock = rpcMock();
    const fetchImpl = async (url, init) => {
      assert.ok(Object.values(RPC_CHAINS).some((chain) => chain.url === url), 'Only the public RPC allowlist may be queried');
      assert.equal(init.headers.AccessKey, undefined);
      return mock.fetch(url, init);
    };
    const env = { DEBANK_ACCESS_KEY: secret };
    let result;
    if (entry === 'api') {
      result = await collectQuickAudit({ addresses: [WALLET], fetchImpl, env });
    } else {
      const stdout = { value: '', write(text) { this.value += text; } };
      const stderr = { value: '', write(text) { this.value += text; } };
      const exit = await runQuickCli([WALLET], { fetchImpl, env, stdout, stderr });
      assert.equal(exit, 0);
      assert.equal(stderr.value, '');
      result = JSON.parse(stdout.value);
    }
    assert.equal(result.status, 'success');
    assert.equal(result.snapshot.requestedProvider, 'rpc');
    assert.equal(result.snapshot.providerMode, 'rpc_native_only');
    assert.equal(result.snapshot.accounts[0].debank, undefined);
    assert.equal(result.debankConnection.status, 'not_requested');
    assert.equal(result.coverage.debankProtocolDiscovery.status, 'not_requested');
    assert.equal(result.virtuals[0].contracts.current.principalFormatted, '1500');
    assert.ok(mock.calls.some((call) => call.method === 'eth_call' && call.params[0].to === C.current));
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.deepEqual(env, { DEBANK_ACCESS_KEY: secret });
  }
});

test('first pass finds locked principal despite zero wallet balance and voting power', async () => {
  const mock = rpcMock();
  const result = await collectQuickAudit(base(mock.fetch, { tokens: [`base:${TOKEN}`] }));
  assert.equal(result.status, 'success');
  assert.equal(result.snapshot.accounts[0].rpc.chains.length, 4);
  assert.equal(result.virtuals[0].contracts.current.principalFormatted, '1500');
  assert.equal(result.virtuals[0].contracts.current.walletBalanceFormatted, '0');
  assert.equal(result.virtuals[0].contracts.current.votingPowerFormatted, '0');
  assert.equal(result.virtuals[0].contracts.current.positions.length, 2);
  assert.equal(result.knownTokens[0].quantity, '1234567890123.456789');
  assert.equal(result.knownTokens[0].price, null);
  assert.equal(result.coverage.completeWalletCoverage, false);
  assert.equal(result.coverage.history, 'not_queried');
  assert.equal(result.coverage.tokenDiscovery, 'not_available_without_indexer');
  assert.deepEqual(result.coverage.protocolsQueried, ['virtuals_base_current_and_legacy']);
  assert.deepEqual(result.coverage.directProtocolChecks, result.coverage.protocolsQueried);
  assert.equal(result.coverage.debankProtocolDiscovery.status, 'not_requested');
  assert.deepEqual(result.coverage.debankProtocolDiscovery.endpoints, []);
});

test('auto DeBank discovery reports Base Aave coverage separately from direct checks without exposing the key', async () => {
  const secret = 'offline-only-quick-debank-key';
  const paths = [];
  const fetch = async (url, init) => {
    assert.equal(new URL(url).origin, DEBANK_ORIGIN);
    assert.equal(init.headers.AccessKey, secret);
    const path = new URL(url).pathname;
    paths.push(path);
    const data = path === '/v1/chain/list' || path === '/v1/user/used_chain_list'
      ? [{ id: 'base', community_id: 8453 }]
      : path === '/v1/user/all_complex_protocol_list'
        ? [{ id: 'base_aave', chain: 'base', portfolio_item_list: [] }] : [];
    return { status: 200, json: async () => data };
  };
  const result = await collectQuickAudit(base(fetch, { provider: 'auto', chains: ['base'],
    protocols: [], env: { DEBANK_ACCESS_KEY: secret } }));
  const coverage = result.coverage;
  const discovery = coverage.debankProtocolDiscovery;
  assert.equal(result.status, 'success');
  assert.equal(paths.length, 5);
  assert.equal(result.snapshot.accounts[0].debank.endpoints.protocols.data[0].id, 'base_aave');
  assert.deepEqual(coverage.protocolsQueried, [], 'Compatibility field remains limited to direct checks');
  assert.deepEqual(coverage.directProtocolChecks, []);
  assert.equal(discovery.status, 'success');
  assert.equal(discovery.scope, 'provider_supported_chains_and_protocols_only');
  assert.deepEqual(discovery.requestedChains, ['base']);
  assert.equal(discovery.freshness, 'provider_snapshot_not_fixed_block');
  assert.equal(discovery.maxProviderUpdateDelaySeconds, 43200);
  assert.equal(discovery.actualAgeVerified, false);
  assert.equal(discovery.endpoints[0].endpoint, '/v1/user/all_complex_protocol_list');
  assert.equal(discovery.endpoints[0].address, WALLET);
  assert.equal(discovery.endpoints[0].status, 'success');
  assert.notEqual(coverage.unsupportedProtocols, 'all_other_unintegrated_protocols');
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('DeBank protocol coverage retains failures and missing-key blocks despite other source results', async () => {
  const mock = rpcMock();
  const fetch = async (url, init) => {
    if (!url.startsWith(DEBANK_ORIGIN)) return mock.fetch(url, init);
    const path = new URL(url).pathname;
    const data = path === '/v1/chain/list' ? [{ id: 'base', community_id: 8453 }] : [];
    return { status: path === '/v1/user/all_complex_protocol_list' ? 401 : 200, json: async () => data };
  };
  const denied = await collectQuickAudit(base(fetch, { provider: 'auto', chains: ['base'],
    protocols: [], env: { DEBANK_ACCESS_KEY: 'offline-only-denied-key' } }));
  assert.equal(denied.status, 'partial');
  assert.equal(denied.snapshot.accounts[0].rpc.status, 'success');
  assert.equal(denied.coverage.debankProtocolDiscovery.status, 'failed');
  assert.equal(denied.coverage.debankProtocolDiscovery.endpoints[0].errorCode, 'AUTH_UNAUTHORIZED');
  const blocked = await collectQuickAudit(base(async () => assert.fail('No network without a key'), {
    provider: 'debank', chains: ['base'], protocols: [], env: {},
  }));
  assert.equal(blocked.coverage.debankProtocolDiscovery.status, 'blocked');
  assert.equal(blocked.coverage.debankProtocolDiscovery.endpoints[0].errorCode, 'DEBANK_ACCESS_KEY_MISSING');
});

test('a stalled chain cannot block the first pass or erase Virtuals positions', async () => {
  const mock = rpcMock({ stallEth: true });
  const start = performance.now();
  const result = await collectQuickAudit(base(mock.fetch, { deadlineMs: 35 }));
  assert.ok(performance.now() - start < 300);
  assert.equal(result.status, 'partial');
  assert.equal(result.snapshot.accounts[0].rpc.chains[0].errorCode, 'DEADLINE_EXCEEDED');
  assert.equal(result.virtuals[0].contracts.current.principalFormatted, '1500');
});

test('a stalled protocol stays unknown while successful native balances are delivered', async () => {
  const mock = rpcMock({ stallVirtuals: true });
  const result = await collectQuickAudit(base(mock.fetch, { deadlineMs: 35 }));
  assert.equal(result.status, 'partial');
  assert.equal(result.snapshot.accounts[0].rpc.status, 'success');
  assert.equal(result.virtuals[0].contracts.current.principalRaw, null);
  assert.equal(result.virtuals[0].contracts.current.positionsComplete, false);
});

test('with a single connection native balances finish before a stalled optional protocol', async () => {
  const mock = rpcMock({ stallVirtuals: true });
  const result = await collectQuickAudit(base(mock.fetch, { deadlineMs: 35, concurrency: 1 }));
  assert.equal(result.status, 'partial');
  assert.equal(result.snapshot.accounts[0].rpc.status, 'success');
  assert.equal(result.virtuals[0].contracts.current.principalRaw, null);
});

test('chain selection is respected and malformed token balances never become zero', async () => {
  const mock = rpcMock({ badToken: true });
  const eth = await collectQuickAudit(base(mock.fetch, { chains: ['eth'] }));
  assert.equal(eth.virtuals.length, 0);
  assert.ok(mock.calls.every((item) => item.url === RPC_CHAINS.eth.url));
  const bad = await collectQuickAudit(base(mock.fetch, { chains: ['base'], tokens: [`base:${TOKEN}`] }));
  assert.equal(bad.knownTokens[0].errorCode, 'INVALID_RESPONSE_SCHEMA');
  assert.equal(bad.knownTokens[0].quantity, undefined);
});

test('invalid inputs and out-of-scope tokens are rejected before network calls', async () => {
  const mock = rpcMock();
  for (const extras of [
    { addresses: ['--help'] }, { deadlineMs: 46000 }, { deadlineMs: '100' },
    { protocols: ['unknown'] }, { chains: ['eth'], tokens: [`base:${TOKEN}`] },
  ]) await assert.rejects(collectQuickAudit(base(mock.fetch, extras)));
  assert.equal(mock.calls.length, 0);
});

test('native, protocol and token requests share the configured cap even with an injected transport', async () => {
  const mock = rpcMock();
  let active = 0;
  let peak = 0;
  const fetch = async (...args) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return await mock.fetch(...args);
    } finally { active--; }
  };
  const result = await collectQuickAudit(base(fetch, { chains: ['base'], concurrency: 1, tokens: [`base:${TOKEN}`] }));
  assert.equal(result.status, 'success');
  assert.equal(peak, 1);
  assert.equal(result.virtuals[0].contracts.current.principalFormatted, '1500');
  assert.equal(result.knownTokens[0].status, 'success');
});

test('CLI supports known-token hints and refuses existing output before any queries', async () => {
  assert.equal(parseQuickArgs([WALLET, '--token', `base:${TOKEN}`]).tokens.length, 1);
  const directory = await mkdtemp(join(tmpdir(), 'evm-quick-test-'));
  try {
    const output = join(directory, 'existing.json');
    await writeFile(output, 'original');
    const mock = rpcMock();
    const stdout = { write() {} };
    const stderr = { value: '', write(text) { this.value += text; } };
    const exit = await runQuickCli([WALLET, '--output', output], { fetchImpl: mock.fetch, stdout, stderr });
    assert.equal(exit, 1);
    assert.equal(JSON.parse(stderr.value).errorCode, 'OUTPUT_ALREADY_EXISTS');
    assert.equal(mock.calls.length, 0);
    assert.equal(await readFile(output, 'utf8'), 'original');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
