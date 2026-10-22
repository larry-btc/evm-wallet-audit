import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectSnapshot, DEBANK_ORIGIN, formatUnits, parseArgs, RPC_CHAINS, runCli, validateAddresses, writeSnapshot } from './collect-snapshot.mjs';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const ADDRESS_TWO = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const SECRET = 'unit-test-key-must-never-appear-in-results';
const reply = (data, status = 200) => ({ status, json: async () => data });
const rpcReply = (result) => reply({ jsonrpc: '2.0', id: 1, result });
const fixedNow = () => new Date('2026-10-20T00:00:00.000Z');

function rpcFetch({ wei = '0x1', wrongChain = false, hook } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const chain = Object.values(RPC_CHAINS).find((item) => item.url === url);
    assert.ok(chain, 'Only a fixed public RPC URL may be queried');
    if (hook) {
      const response = await hook({ url, init, body, chain });
      if (response) return response;
    }
    if (body.method === 'eth_chainId') return rpcReply(wrongChain ? '0x999' : `0x${chain.chainId.toString(16)}`);
    if (body.method === 'eth_blockNumber') return rpcReply('0x1234');
    if (body.method === 'eth_getBalance') return rpcReply(wei);
    assert.fail('Unexpected RPC method');
  };
  return { fetchImpl, calls };
}

const baseOptions = (fetchImpl) => ({ addresses: [ADDRESS], provider: 'rpc', chains: ['eth'], env: {}, fetchImpl, now: fixedNow });

function debankFetch(overrides = {}) {
  const rpc = rpcFetch();
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (!url.startsWith(DEBANK_ORIGIN)) return rpc.fetchImpl(url, init);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (ownOverride(overrides, path)) return overrides[path](url, init);
    if (path === '/v1/chain/list') return reply([{ id: 'eth', community_id: 1 }, { id: 'base', community_id: 8453 }]);
    return reply([]);
  };
  return { fetchImpl, calls, rpcCalls: rpc.calls };
}
const ownOverride = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const debankOptions = (fetchImpl, extra = {}) => ({ addresses: [ADDRESS], provider: 'auto', env: { DEBANK_ACCESS_KEY: SECRET }, fetchImpl, now: fixedNow, ...extra });

test('addresses are case-insensitively deduplicated and limited to five unique addresses', () => {
  assert.deepEqual(validateAddresses([ADDRESS_TWO, ADDRESS_TWO.toUpperCase()]), [ADDRESS_TWO]);
  assert.equal(validateAddresses(Array.from({ length: 5 }, (_, index) => `0x${String(index + 1).repeat(40)}`)).length, 5);
  assert.throws(() => validateAddresses(Array.from({ length: 6 }, (_, index) => `0x${String(index + 1).repeat(40)}`)), /TOO_MANY_ADDRESSES/);
});

test('invalid, missing, and zero addresses are rejected before fetch', async () => {
  let called = false;
  for (const addresses of [[], ['wallet.eth'], ['0x1234'], [`0x${'0'.repeat(40)}`], [null]]) {
    await assert.rejects(collectSnapshot({ addresses, fetchImpl: async () => { called = true; } }));
  }
  assert.equal(called, false);
});

test('CLI accepts the scoped options and rejects key, unknown, or duplicate flags', () => {
  assert.deepEqual(parseArgs([ADDRESS, '--provider', 'rpc', '--chains', 'ETH,base,eth', '--output', '/tmp/fresh.json']),
    { addresses: [ADDRESS], provider: 'rpc', chains: ['eth', 'base'], output: '/tmp/fresh.json', deadlineMs: 40000, concurrency: 6 });
  assert.deepEqual(parseArgs([ADDRESS, '--deadline-ms', '1200', '--concurrency', '2']),
    { addresses: [ADDRESS], provider: 'rpc', chains: null, output: null, deadlineMs: 1200, concurrency: 2 });
  for (const args of [[ADDRESS, '--key', SECRET], [ADDRESS, '--provider', 'other'], [ADDRESS, '--chains', ''],
    [ADDRESS, '--provider', 'rpc', '--provider', 'auto'], [ADDRESS, '--unknown'], [ADDRESS, '--chains', 'eth,https://example.com'],
    [ADDRESS, '--deadline-ms', '0'], [ADDRESS, '--deadline-ms', '60001'], [ADDRESS, '--deadline-ms', '1e3'],
    [ADDRESS, '--concurrency', '0'], [ADDRESS, '--concurrency', '13'], [ADDRESS, '--concurrency', '1.5'],
    [ADDRESS, '--concurrency', '2', '--concurrency', '3']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('unit formatting preserves one wei, large integers, and whole coin values exactly', () => {
  assert.equal(formatUnits('1'), '0.000000000000000001');
  assert.equal(formatUnits('1000000000000000000'), '1');
  assert.equal(formatUnits('123456789012345678901234567890'), '123456789012.34567890123456789');
  assert.equal(formatUnits(0n), '0');
  assert.throws(() => formatUnits(9007199254740992), /INVALID_INTEGER_AMOUNT/);
});

test('RPC verifies chain ID and fixes the block before querying the exact balance', async () => {
  const wei = '123456789012345678901234567890';
  const mock = rpcFetch({ wei: `0x${BigInt(wei).toString(16)}` });
  const snapshot = await collectSnapshot(baseOptions(mock.fetchImpl));
  const result = snapshot.accounts[0].rpc.chains[0];
  assert.equal(result.rawWei, wei);
  assert.equal(result.balanceFormatted, '123456789012.34567890123456789');
  assert.equal(result.blockTag, '0x1234');
  assert.deepEqual(mock.calls.map((call) => call.body.method), ['eth_chainId', 'eth_blockNumber', 'eth_getBalance']);
  assert.deepEqual(mock.calls[2].body.params, [ADDRESS, '0x1234']);
  assert.equal(snapshot.coverage.completeWalletCoverage, false);
  assert.ok(snapshot.coverage.rpc.excludes.includes('erc20'));
  assert.equal(snapshot.timing.deadlineMs, 40000);
  assert.equal(snapshot.timing.requestTimeoutMs, 6000);
  assert.equal(snapshot.timing.concurrency, 6);
  assert.equal(snapshot.timing.deadlineExceeded, false);
  assert.ok(Number.isInteger(snapshot.timing.elapsedMs) && snapshot.timing.elapsedMs >= 0);
});

test('a mismatched RPC chain ID stops that chain before balance lookup', async () => {
  const mock = rpcFetch({ wrongChain: true });
  const snapshot = await collectSnapshot(baseOptions(mock.fetchImpl));
  assert.equal(snapshot.accounts[0].rpc.chains[0].errorCode, 'CHAIN_ID_MISMATCH');
  assert.equal(mock.calls.length, 1);
  assert.equal(snapshot.status, 'failed');
});

test('RPC defaults to four known chains; unknown chains remain unsupported', async () => {
  const mock = rpcFetch();
  const defaults = await collectSnapshot({ ...baseOptions(mock.fetchImpl), chains: null });
  assert.deepEqual(defaults.accounts[0].rpc.chains.map((item) => item.chain), ['eth', 'base', 'arb', 'op']);
  const unknown = await collectSnapshot({ ...baseOptions(mock.fetchImpl), chains: ['eth', 'unknown-chain', '__proto__'] });
  assert.equal(unknown.status, 'partial');
  assert.deepEqual(unknown.accounts[0].rpc.chains.slice(1).map((item) => item.status), ['unsupported', 'unsupported']);
});

test('RPC zero balance is explicitly limited to native assets and one queried scope', async () => {
  const mock = rpcFetch({ wei: '0x0' });
  const snapshot = await collectSnapshot(baseOptions(mock.fetchImpl));
  assert.equal(snapshot.accounts[0].rpc.chains[0].rawWei, '0');
  assert.equal(snapshot.coverage.completeWalletCoverage, false);
  assert.ok(snapshot.notices.some((notice) => notice.includes('do not prove')));
});

test('timeout is bounded even when fetch ignores AbortSignal, with no retry', async () => {
  let requests = 0;
  const snapshot = await collectSnapshot({ ...baseOptions(() => { requests++; return new Promise(() => {}); }), timeoutMs: 5 });
  assert.equal(requests, 1);
  assert.equal(snapshot.accounts[0].rpc.chains[0].errorCode, 'REQUEST_TIMEOUT');
});

test('RPC malformed schema and RPC errors never become successful zero balances', async () => {
  for (const data of [{}, { jsonrpc: '2.0', id: 1, result: 0 }, { jsonrpc: '2.0', id: 1, result: '0xgarbage' },
    { jsonrpc: '2.0', id: 1, error: { code: -1, message: SECRET } }]) {
    const snapshot = await collectSnapshot(baseOptions(async () => reply(data)));
    assert.equal(snapshot.status, 'failed');
    assert.equal(snapshot.accounts[0].rpc.chains[0].rawWei, undefined);
    assert.ok(!JSON.stringify(snapshot).includes(SECRET));
  }
});

test('without a key, auto uses RPC and forced DeBank stays blocked without a request', async () => {
  const mock = rpcFetch();
  const snapshot = await collectSnapshot({ ...baseOptions(mock.fetchImpl), provider: 'auto' });
  assert.equal(snapshot.providerMode, 'rpc_native_only');
  const blocked = await collectSnapshot({ ...baseOptions(async () => assert.fail('No request allowed')), provider: 'debank' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.accounts[0].debank.endpoints.tokens.errorCode, 'DEBANK_ACCESS_KEY_MISSING');
  assert.equal(blocked.accounts[0].rpc, undefined);
});

test('default collector API and CLI ignore an existing runtime DeBank key and use only public RPC', async () => {
  for (const entry of ['api', 'cli']) {
    const mock = rpcFetch();
    const env = { DEBANK_ACCESS_KEY: SECRET };
    const stdout = { text: '', write(value) { this.text += value; } };
    const stderr = { text: '', write(value) { this.text += value; } };
    let snapshot;
    if (entry === 'api') {
      snapshot = await collectSnapshot({ addresses: [ADDRESS], chains: ['eth'], env, fetchImpl: mock.fetchImpl, now: fixedNow });
    } else {
      const exit = await runCli([ADDRESS, '--chains', 'eth'], { env, fetchImpl: mock.fetchImpl, now: fixedNow, stdout, stderr });
      assert.equal(exit, 0);
      assert.equal(stderr.text, '');
      snapshot = JSON.parse(stdout.text);
    }
    assert.equal(snapshot.requestedProvider, 'rpc');
    assert.equal(snapshot.providerMode, 'rpc_native_only');
    assert.equal(snapshot.status, 'success');
    assert.equal(snapshot.accounts[0].debank, undefined);
    assert.equal(snapshot.accounts[0].rpc.chains[0].rawWei, '1');
    assert.deepEqual(mock.calls.map((call) => call.body.method), ['eth_chainId', 'eth_blockNumber', 'eth_getBalance']);
    assert.ok(mock.calls.every(({ init }) => !Object.hasOwn(init.headers, 'AccessKey')));
    assert.ok(!JSON.stringify(snapshot).includes(SECRET));
    assert.deepEqual(env, { DEBANK_ACCESS_KEY: SECRET });
  }
});

test('DeBank uses only fixed official GET endpoints with key in the request header', async () => {
  const mock = debankFetch();
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl));
  assert.deepEqual(mock.calls.map((call) => new URL(call.url).pathname), [
    '/v1/chain/list', '/v1/user/used_chain_list', '/v1/user/all_token_list',
    '/v1/user/all_complex_protocol_list', '/v1/user/all_nft_list',
  ]);
  for (const { url, init } of mock.calls) {
    assert.equal(new URL(url).origin, DEBANK_ORIGIN);
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.AccessKey, SECRET);
    assert.equal(init.redirect, 'error');
    assert.ok(!url.includes(SECRET));
    assert.equal(new URL(url).searchParams.has('chain_ids'), false);
  }
  for (const path of ['/v1/user/all_token_list', '/v1/user/all_nft_list']) {
    assert.equal(new URL(mock.calls.find((call) => new URL(call.url).pathname === path).url).searchParams.get('is_all'), 'true');
  }
  assert.equal(snapshot.status, 'success');
  assert.equal(snapshot.coverage.debank.chainDirectoryEnumerated, true);
  assert.equal(snapshot.debankChainList.source, `${DEBANK_ORIGIN}/v1/chain/list`);
  for (const result of Object.values(snapshot.accounts[0].debank.endpoints)) {
    const source = new URL(result.source);
    assert.equal(source.origin, DEBANK_ORIGIN);
    assert.equal(source.searchParams.get('id'), ADDRESS);
    assert.ok(!result.source.includes(SECRET));
    assert.ok(!result.source.includes('AccessKey'));
  }
  assert.equal(mock.rpcCalls.length, 0);
  assert.ok(!JSON.stringify(snapshot).includes(SECRET));
  assert.ok(!JSON.stringify(snapshot).includes('AccessKey'));
});

test('unpriced token payloads are retained and raw_amount precision limitations disclosed', async () => {
  const token = { id: ADDRESS_TWO, chain: 'eth', symbol: 'UNKNOWN', amount: 3, price: 0, raw_amount: 9007199254740992 };
  const mock = debankFetch({ '/v1/user/all_token_list': () => reply([token]) });
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl));
  assert.deepEqual(snapshot.accounts[0].debank.endpoints.tokens.data, [token]);
  assert.ok(snapshot.notices.some((notice) => notice.includes('raw_amount') && notice.includes('precision')));
});

test('successful empty arrays have provider-scope empty meaning', async () => {
  const mock = debankFetch();
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl));
  assert.equal(snapshot.accounts[0].debank.endpoints.tokens.emptyMeaning, 'no_items_returned_by_provider_within_queried_scope');
});

test('DeBank 401 is retained, key is not leaked, and fallback only adds native balances', async () => {
  const mock = debankFetch(Object.fromEntries([
    '/v1/chain/list', '/v1/user/used_chain_list', '/v1/user/all_token_list',
    '/v1/user/all_complex_protocol_list', '/v1/user/all_nft_list',
  ].map((path) => [path, () => reply({ message: SECRET }, 401)])));
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['eth'] }));
  assert.equal(mock.calls.length, 5);
  assert.equal(snapshot.accounts[0].debank.endpoints.tokens.errorCode, 'AUTH_UNAUTHORIZED');
  assert.equal(snapshot.accounts[0].debank.status, 'failed');
  assert.equal(snapshot.accounts[0].rpc.status, 'success');
  assert.equal(snapshot.status, 'partial');
  assert.ok(!JSON.stringify(snapshot).includes(SECRET));
  assert.equal(mock.rpcCalls.length, 3);
});

test('successful chain and used-chain discovery cannot promote entirely failed wallet asset queries', async () => {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    if (path === '/v1/chain/list') return reply([{ id: 'eth', community_id: 1 }]);
    if (path === '/v1/user/used_chain_list') return reply([{ id: 'eth', community_id: 1 }]);
    return reply({}, 503);
  };
  const snapshot = await collectSnapshot(debankOptions(fetchImpl, { chains: ['eth'] }));
  assert.equal(snapshot.debankChainList.status, 'success');
  assert.equal(snapshot.accounts[0].debank.endpoints.usedChains.status, 'success');
  assert.equal(snapshot.accounts[0].debank.status, 'failed');
  assert.equal(snapshot.accounts[0].rpc.status, 'failed');
  assert.equal(snapshot.accounts[0].status, 'failed');
  assert.equal(snapshot.status, 'failed');
  const stdout = { text: '', write(value) { this.text += value; } };
  const stderr = { text: '', write(value) { this.text += value; } };
  const exit = await runCli([ADDRESS, '--provider', 'debank', '--chains', 'eth'], {
    fetchImpl, env: { DEBANK_ACCESS_KEY: SECRET }, stdout, stderr,
  });
  assert.equal(exit, 2);
  assert.equal(JSON.parse(stdout.text).status, 'failed');
  assert.equal(stderr.text, '');
});

test('failed used-chain discovery degrades successful asset queries to partial', async () => {
  const mock = debankFetch({ '/v1/user/used_chain_list': () => reply({}, 503) });
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['eth'] }));
  assert.equal(snapshot.accounts[0].debank.endpoints.tokens.status, 'success');
  assert.equal(snapshot.accounts[0].debank.endpoints.usedChains.status, 'failed');
  assert.equal(snapshot.accounts[0].debank.status, 'partial');
  assert.equal(snapshot.accounts[0].rpc.status, 'success');
  assert.equal(snapshot.status, 'partial');
});

test('a failed chain directory does not stop all-chain requests or claim enumeration', async () => {
  const mock = debankFetch({ '/v1/chain/list': () => reply({}, 429) });
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['eth'] }));
  assert.equal(snapshot.debankChainList.errorCode, 'RATE_LIMITED');
  assert.equal(snapshot.coverage.debank.chainDirectoryEnumerated, false);
  assert.equal(snapshot.accounts[0].debank.endpoints.tokens.status, 'success');
  assert.equal(snapshot.status, 'partial');
  assert.equal(mock.calls.length, 5);
});

test('DeBank object, primitive list elements, and malformed nested protocol lists fail schema validation', async () => {
  for (const data of [{}, [null], [{ id: 'protocol', chain: 'eth', portfolio_item_list: {} }]]) {
    const mock = debankFetch({ '/v1/user/all_complex_protocol_list': () => reply(data) });
    const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['eth'] }));
    assert.equal(snapshot.accounts[0].debank.endpoints.protocols.errorCode, 'INVALID_RESPONSE_SCHEMA');
    assert.equal(snapshot.accounts[0].debank.endpoints.protocols.data, undefined);
  }
});

test('DeBank validates each list kind instead of accepting identity fields alone', async () => {
  const malformed = [
    ['/v1/chain/list', [{ id: 'eth' }], 'directory'],
    ['/v1/chain/list', [{ id: 'eth', community_id: 0 }], 'directory'],
    ['/v1/chain/list', [{ id: 'eth', community_id: '1' }], 'directory'],
    ['/v1/user/used_chain_list', [{ id: 'eth' }], 'usedChains'],
    ['/v1/user/all_token_list', [{ id: ADDRESS_TWO, chain: 'eth' }], 'tokens'],
    ['/v1/user/all_token_list', [{ id: ADDRESS_TWO, chain: 'eth', amount: Infinity }], 'tokens'],
    ['/v1/user/all_token_list', [{ id: ADDRESS_TWO, chain: 'eth', amount: 'NaN' }], 'tokens'],
    ['/v1/user/all_token_list', [{ id: ADDRESS_TWO, chain: 'eth', amount: '1e10' }], 'tokens'],
    ['/v1/user/all_complex_protocol_list', [{ id: 'protocol', chain: 'eth' }], 'protocols'],
    ['/v1/user/all_complex_protocol_list', [{ id: 'protocol', chain: 'eth', portfolio_item_list: [null] }], 'protocols'],
    ['/v1/user/all_nft_list', [{ id: 'nft', chain: 'eth' }], 'nfts'],
    ['/v1/user/all_nft_list', [{ id: 'nft', chain: 'eth', contract_id: ADDRESS_TWO, inner_id: 1 }], 'nfts'],
  ];
  for (const [path, data, endpoint] of malformed) {
    const mock = debankFetch({ [path]: () => reply(data) });
    const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['eth'] }));
    const result = endpoint === 'directory' ? snapshot.debankChainList : snapshot.accounts[0].debank.endpoints[endpoint];
    assert.equal(result.status, 'failed', `${path} should fail`);
    assert.equal(result.errorCode, 'INVALID_RESPONSE_SCHEMA');
    assert.equal(result.data, undefined);
    if (endpoint === 'directory') assert.equal(snapshot.coverage.debank.chainDirectoryEnumerated, false);
  }
});

test('valid decimal token strings, protocol object arrays, and NFT identity strings survive unchanged', async () => {
  const tokens = [{ id: ADDRESS_TWO, chain: 'eth', amount: '12345678901234567890.000001', price: 0 }];
  const protocols = [{ id: 'protocol', chain: 'eth', portfolio_item_list: [{ name: 'Lending', stats: {} }] }];
  const nfts = [{ id: 'nft', chain: 'eth', contract_id: ADDRESS_TWO, inner_id: '0' }];
  const usedChains = [{ id: 'eth', community_id: 1 }];
  const mock = debankFetch({
    '/v1/user/all_token_list': () => reply(tokens),
    '/v1/user/all_complex_protocol_list': () => reply(protocols),
    '/v1/user/all_nft_list': () => reply(nfts),
    '/v1/user/used_chain_list': () => reply(usedChains),
  });
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl));
  assert.equal(snapshot.status, 'success');
  assert.deepEqual(snapshot.accounts[0].debank.endpoints.tokens.data, tokens);
  assert.deepEqual(snapshot.accounts[0].debank.endpoints.protocols.data, protocols);
  assert.deepEqual(snapshot.accounts[0].debank.endpoints.nfts.data, nfts);
  assert.deepEqual(snapshot.accounts[0].debank.endpoints.usedChains.data, usedChains);
});

test('scoped asset endpoints reject out-of-scope chains while discovery and other assets survive', async () => {
  const mismatches = [
    ['tokens', '/v1/user/all_token_list', [{ id: ADDRESS_TWO, chain: 'base', amount: 1 }]],
    ['protocols', '/v1/user/all_complex_protocol_list', [{ id: 'protocol', chain: 'base', portfolio_item_list: [] }]],
    ['nfts', '/v1/user/all_nft_list', [{ id: 'nft', chain: 'base', contract_id: ADDRESS_TWO, inner_id: '1' }]],
  ];
  for (const [name, path, data] of mismatches) {
    const mock = debankFetch({
      [path]: () => reply(data),
      '/v1/user/used_chain_list': () => reply([{ id: 'base', community_id: 8453 }]),
    });
    const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['eth'] }));
    const endpoints = snapshot.accounts[0].debank.endpoints;
    assert.equal(endpoints[name].status, 'failed', `${name} must fail on scope mismatch`);
    assert.equal(endpoints[name].errorCode, 'CHAIN_SCOPE_MISMATCH');
    assert.equal(endpoints[name].data, undefined);
    assert.equal(endpoints.usedChains.status, 'success', 'Discovery is intentionally not asset-scoped');
    for (const other of ['tokens', 'protocols', 'nfts'].filter((kind) => kind !== name)) {
      assert.equal(endpoints[other].status, 'success');
    }
    assert.equal(snapshot.accounts[0].rpc.status, 'success');
    assert.equal(snapshot.status, 'partial');
    assert.equal(new URL(mock.calls.find((call) => new URL(call.url).pathname === path).url).searchParams.get('chain_ids'), 'eth');
    assert.ok(!JSON.stringify(snapshot).includes(SECRET));
  }
});

test('scoped asset responses retain matching chains and the unscoped scan retains provider chains', async () => {
  const tokens = [{ id: ADDRESS_TWO, chain: 'eth', amount: 1 }, { id: ADDRESS_TWO, chain: 'base', amount: 2 }];
  for (const chains of [['eth', 'base'], null]) {
    const mock = debankFetch({ '/v1/user/all_token_list': () => reply(tokens) });
    const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains }));
    assert.equal(snapshot.status, 'success');
    assert.deepEqual(snapshot.accounts[0].debank.endpoints.tokens.data, tokens);
    assert.equal(mock.rpcCalls.length, 0);
  }
});

test('DeBank response key echoes are discarded before schema validation and never reach CLI output', async () => {
  const echoes = [
    [{ id: ADDRESS_TWO, chain: 'eth', amount: 1, description: `prefix ${SECRET} suffix` }],
    [{ id: ADDRESS_TWO, chain: 'eth', amount: 1, metadata: { [SECRET]: 'value' } }],
    { malformed: { nested: [SECRET] } },
  ];
  for (const data of echoes) {
    const mock = debankFetch({ '/v1/user/all_token_list': () => reply(data) });
    const stdout = { text: '', write(value) { this.text += value; } };
    const stderr = { text: '', write(value) { this.text += value; } };
    const exit = await runCli([ADDRESS, '--provider', 'debank', '--chains', 'eth'], {
      fetchImpl: mock.fetchImpl, env: { DEBANK_ACCESS_KEY: SECRET }, stdout, stderr,
    });
    const snapshot = JSON.parse(stdout.text);
    const result = snapshot.accounts[0].debank.endpoints.tokens;
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'SENSITIVE_DATA_IN_RESPONSE');
    assert.equal(result.data, undefined);
    assert.equal(snapshot.accounts[0].debank.endpoints.protocols.status, 'success');
    assert.equal(snapshot.accounts[0].rpc.status, 'success');
    assert.equal(exit, 0, 'Other successful asset sources remain available');
    assert.ok(!`${stdout.text}${stderr.text}`.includes(SECRET));
    assert.equal(stderr.text, '');
  }
});

test('unknown DeBank chains are retained as unsupported and never imply complete coverage', async () => {
  const mock = debankFetch();
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['eth', 'unknown-chain'] }));
  assert.equal(snapshot.accounts[0].debank.unsupportedChains[0].chain, 'unknown-chain');
  assert.equal(snapshot.accounts[0].debank.unsupportedChains[0].status, 'unsupported');
  assert.equal(snapshot.accounts[0].debank.status, 'partial');
  assert.equal(snapshot.accounts[0].rpc.chains[1].status, 'unsupported');
  assert.equal(new URL(mock.calls.find((call) => new URL(call.url).pathname === '/v1/user/all_token_list').url).searchParams.get('chain_ids'), 'eth');
});

test('an entirely unsupported DeBank chain selection never expands into an all-chain scan', async () => {
  const mock = debankFetch();
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, { chains: ['unknown-chain'] }));
  assert.equal(mock.calls.length, 2);
  assert.equal(snapshot.accounts[0].debank.endpoints.tokens.status, 'unsupported');
  assert.equal(snapshot.accounts[0].rpc.chains[0].status, 'unsupported');
  assert.equal(mock.rpcCalls.length, 0);
});

test('network exceptions and invalid JSON use safe error codes with no upstream message', async () => {
  for (const fetchImpl of [async () => { throw new Error(SECRET); }, async () => ({ status: 200, json: async () => { throw new Error(SECRET); } })]) {
    const snapshot = await collectSnapshot(baseOptions(fetchImpl));
    assert.equal(snapshot.status, 'failed');
    assert.ok(!JSON.stringify(snapshot).includes(SECRET));
    assert.ok(['NETWORK_ERROR', 'INVALID_JSON'].includes(snapshot.accounts[0].rpc.chains[0].errorCode));
  }
});

test('safe transport failures retain their codes and deadline timing without becoming zero balances', async () => {
  for (const code of ['DEADLINE_EXCEEDED', 'REQUEST_TIMEOUT', 'REQUEST_ABORTED', 'TRANSPORT_ERROR',
    'TRANSPORT_UNAVAILABLE', 'RESPONSE_TOO_LARGE', 'INVALID_HTTP_RESPONSE']) {
    const snapshot = await collectSnapshot(baseOptions(async () => {
      throw Object.assign(new Error(SECRET), { code });
    }));
    const result = snapshot.accounts[0].rpc.chains[0];
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, code);
    assert.equal(result.rawWei, undefined);
    assert.equal(snapshot.timing.deadlineExceeded, code === 'DEADLINE_EXCEEDED');
    assert.ok(!JSON.stringify(snapshot).includes(SECRET));
  }
  const unknown = await collectSnapshot(baseOptions(async () => {
    throw Object.assign(new Error(SECRET), { code: SECRET });
  }));
  assert.equal(unknown.accounts[0].rpc.chains[0].errorCode, 'NETWORK_ERROR');
  assert.ok(!JSON.stringify(unknown).includes(SECRET));
});

test('a response-body transport deadline is retained rather than mislabeled as invalid JSON', async () => {
  const snapshot = await collectSnapshot(baseOptions(async () => ({ status: 200, json: async () => {
    throw Object.assign(new Error(SECRET), { code: 'DEADLINE_EXCEEDED' });
  } })));
  assert.equal(snapshot.accounts[0].rpc.chains[0].errorCode, 'DEADLINE_EXCEEDED');
  assert.equal(snapshot.timing.deadlineExceeded, true);
  assert.ok(!JSON.stringify(snapshot).includes(SECRET));
});

test('endpoint 404 is unsupported and 429 is failed without retrying', async () => {
  for (const [status, expectedStatus, errorCode] of [[404, 'unsupported', 'ENDPOINT_UNSUPPORTED'], [429, 'failed', 'RATE_LIMITED']]) {
    let requests = 0;
    const snapshot = await collectSnapshot(baseOptions(async () => { requests++; return reply({}, status); }));
    assert.equal(requests, 1);
    assert.equal(snapshot.accounts[0].rpc.chains[0].status, expectedStatus);
    assert.equal(snapshot.accounts[0].rpc.chains[0].errorCode, errorCode);
  }
});

test('two addresses are deduplicated and processed concurrently with bounded requests', async () => {
  let active = 0;
  let peak = 0;
  const mock = rpcFetch({ hook: async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
  } });
  const snapshot = await collectSnapshot({ ...baseOptions(mock.fetchImpl), addresses: [ADDRESS, ADDRESS_TWO, ADDRESS_TWO.toUpperCase()] });
  assert.equal(snapshot.accounts.length, 2);
  assert.equal(mock.calls.length, 6);
  assert.equal(peak, 2);
});

test('the default concurrency limit is shared across addresses and RPC chains', async () => {
  let active = 0;
  let peak = 0;
  const mock = rpcFetch({ hook: async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
  } });
  const snapshot = await collectSnapshot({ ...baseOptions(mock.fetchImpl),
    addresses: [ADDRESS, ADDRESS_TWO], chains: null });
  assert.equal(peak, 6);
  assert.equal(active, 0);
  assert.equal(mock.calls.length, 24);
  assert.equal(snapshot.status, 'success');
});

test('DeBank requests and RPC fallbacks share the same configurable concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  const mock = debankFetch({ '/v1/user/all_token_list': () => reply({}, 503) });
  const fetchImpl = async (...args) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return await mock.fetchImpl(...args);
    } finally {
      active--;
    }
  };
  const snapshot = await collectSnapshot(debankOptions(fetchImpl, {
    addresses: [ADDRESS, ADDRESS_TWO], chains: ['eth', 'base'], concurrency: 3,
  }));
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.equal(mock.calls.length, 9);
  assert.equal(mock.rpcCalls.length, 12);
  assert.ok(snapshot.accounts.every((account) => account.rpc.status === 'success'));
});

test('the total deadline bounds queued and active requests even when fetch ignores cancellation', async () => {
  let requests = 0;
  const snapshot = await collectSnapshot({ ...baseOptions(() => {
    requests++;
    return new Promise(() => {});
  }), chains: null, concurrency: 1, timeoutMs: 100, deadlineMs: 30 });
  assert.equal(requests, 1, 'Queued chains must not start after the deadline');
  assert.equal(snapshot.status, 'failed');
  for (const chain of snapshot.accounts[0].rpc.chains) {
    assert.equal(chain.errorCode, 'DEADLINE_EXCEEDED');
    assert.equal(chain.rawWei, undefined);
  }
  assert.equal(snapshot.timing.deadlineExceeded, true);
  assert.ok(snapshot.timing.elapsedMs < 500);
});

test('an uncooperative request timeout does not release a slot and exceed the concurrency limit', async () => {
  let requests = 0;
  const snapshot = await collectSnapshot({ ...baseOptions(() => {
    requests++;
    return new Promise(() => {});
  }), chains: ['eth', 'base'], concurrency: 1, timeoutMs: 5, deadlineMs: 30 });
  assert.equal(requests, 1);
  assert.equal(snapshot.accounts[0].rpc.chains[0].errorCode, 'REQUEST_TIMEOUT');
  assert.equal(snapshot.accounts[0].rpc.chains[1].errorCode, 'DEADLINE_EXCEEDED');
});

test('a slow RPC chain cannot block another chain or erase its exact successful balance', async () => {
  const mock = rpcFetch({ hook: ({ chain }) => chain.chainId === 1 ? new Promise(() => {}) : undefined });
  const snapshot = await collectSnapshot({ ...baseOptions(mock.fetchImpl), chains: ['eth', 'base'],
    concurrency: 2, timeoutMs: 100, deadlineMs: 30 });
  const [eth, base] = snapshot.accounts[0].rpc.chains;
  assert.equal(eth.errorCode, 'DEADLINE_EXCEEDED');
  assert.equal(eth.rawWei, undefined);
  assert.equal(base.status, 'success');
  assert.equal(base.rawWei, '1');
  assert.equal(base.blockTag, '0x1234');
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.timing.deadlineExceeded, true);
});

test('a slow DeBank endpoint preserves other successful endpoints when the total deadline expires', async () => {
  const mock = debankFetch({ '/v1/user/all_token_list': () => new Promise(() => {}) });
  const snapshot = await collectSnapshot(debankOptions(mock.fetchImpl, {
    chains: ['eth'], timeoutMs: 100, deadlineMs: 30,
  }));
  const account = snapshot.accounts[0];
  assert.equal(account.debank.endpoints.tokens.errorCode, 'DEADLINE_EXCEEDED');
  assert.equal(account.debank.endpoints.tokens.data, undefined);
  assert.equal(account.debank.endpoints.protocols.status, 'success');
  assert.equal(account.debank.endpoints.nfts.status, 'success');
  assert.equal(account.rpc.chains[0].errorCode, 'DEADLINE_EXCEEDED');
  assert.equal(mock.rpcCalls.length, 0, 'Fallback cannot start after the budget is exhausted');
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.timing.deadlineExceeded, true);
});

test('CLI scheduling flags set the actual total deadline and preserve a nonzero all-failed exit', async () => {
  const stdout = { text: '', write(value) { this.text += value; } };
  const stderr = { text: '', write(value) { this.text += value; } };
  const exit = await runCli([ADDRESS, '--provider', 'rpc', '--chains', 'eth,base',
    '--deadline-ms', '25', '--concurrency', '1'], {
    env: {}, fetchImpl: () => new Promise(() => {}), timeoutMs: 100, stdout, stderr,
  });
  const snapshot = JSON.parse(stdout.text);
  assert.equal(exit, 2);
  assert.equal(snapshot.timing.deadlineMs, 25);
  assert.equal(snapshot.timing.concurrency, 1);
  assert.equal(snapshot.timing.deadlineExceeded, true);
  assert.equal(stderr.text, '');
});

test('fresh snapshot files are written exclusively and cannot overwrite an existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evm-wallet-audit-test-'));
  try {
    const output = join(directory, 'snapshot.json');
    await writeSnapshot(output, { status: 'success' });
    await assert.rejects(writeSnapshot(output, { status: 'overwritten' }), /OUTPUT_ALREADY_EXISTS/);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { status: 'success' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI JSON output, blocked exit status, and no-overwrite error are reviewable offline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evm-wallet-audit-cli-test-'));
  const stdout = { text: '', write(value) { this.text += value; } };
  const stderr = { text: '', write(value) { this.text += value; } };
  try {
    const exit = await runCli([ADDRESS, '--provider', 'debank'], { env: {}, fetchImpl: async () => assert.fail('No request'), stdout, stderr });
    assert.equal(exit, 2);
    assert.equal(JSON.parse(stdout.text).status, 'blocked');
    assert.equal(stderr.text, '');
    const output = join(directory, 'snapshot.json');
    await writeFile(output, 'original');
    const mock = rpcFetch();
    const fail = await runCli([ADDRESS, '--provider', 'rpc', '--chains', 'eth', '--output', output], { env: {}, fetchImpl: mock.fetchImpl, stdout, stderr });
    assert.equal(fail, 1);
    assert.equal(JSON.parse(stderr.text).errorCode, 'OUTPUT_ALREADY_EXISTS');
    assert.equal(await readFile(output, 'utf8'), 'original');
    assert.equal(mock.calls.length, 0, 'Existing output must be rejected before any network request');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('real CLI entry rejects invalid arguments without network or echoing private-looking input', () => {
  const script = fileURLToPath(new URL('./collect-snapshot.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, ADDRESS, '--key', SECRET], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).errorCode, 'INVALID_ARGUMENTS');
  assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET));
});

test('real CLI blocks network access when runtime TLS verification is disabled', () => {
  const script = fileURLToPath(new URL('./collect-snapshot.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, ADDRESS, '--provider', 'rpc', '--chains', 'eth'], {
    encoding: 'utf8', env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, timeout: 3000,
  });
  assert.equal(result.status, 2);
  const snapshot = JSON.parse(result.stdout);
  assert.equal(snapshot.status, 'blocked');
  assert.equal(snapshot.accounts[0].rpc.chains[0].errorCode, 'TLS_VERIFICATION_DISABLED');
  assert.equal(result.stderr, '');
});

test('CLI entry works through a symlinked Skill directory for help and blocked DeBank', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evm-wallet-audit-symlink-test-'));
  try {
    const installed = join(directory, 'installed-skill');
    await symlink(fileURLToPath(new URL('../', import.meta.url)), installed, 'dir');
    const script = join(installed, 'scripts', 'collect-snapshot.mjs');
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', env: {} });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^Usage:/);
    assert.match(help.stdout, /Default: free public RPC; existing DEBANK_ACCESS_KEY is ignored/);
    assert.match(help.stdout, /DeBank requires an explicit --provider auto or --provider debank choice/);
    assert.equal(help.stderr, '');
    const blocked = spawnSync(process.execPath, [script, ADDRESS, '--provider', 'debank'], { encoding: 'utf8', env: {} });
    assert.equal(blocked.status, 2);
    assert.equal(JSON.parse(blocked.stdout).status, 'blocked');
    assert.equal(JSON.parse(blocked.stdout).accounts[0].debank.endpoints.tokens.errorCode, 'DEBANK_ACCESS_KEY_MISSING');
    assert.equal(blocked.stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
