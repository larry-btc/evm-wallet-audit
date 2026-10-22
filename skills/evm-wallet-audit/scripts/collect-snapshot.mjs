#!/usr/bin/env node
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const SCHEMA_VERSION = 'evm-wallet-audit.snapshot.v1';
export const DEBANK_ORIGIN = 'https://pro-openapi.debank.com';
export const RPC_CHAINS = Object.freeze({
  eth: { chainId: 1, symbol: 'ETH', url: 'https://ethereum-rpc.publicnode.com' },
  base: { chainId: 8453, symbol: 'ETH', url: 'https://mainnet.base.org' },
  arb: { chainId: 42161, symbol: 'ETH', url: 'https://arb1.arbitrum.io/rpc' },
  op: { chainId: 10, symbol: 'ETH', url: 'https://mainnet.optimism.io' },
});
const DEFAULT_CHAINS = Object.keys(RPC_CHAINS);
const PROVIDERS = new Set(['auto', 'rpc', 'debank']);
const TRANSPORT_ERROR_CODES = new Set(['REQUEST_TIMEOUT', 'DEADLINE_EXCEEDED', 'REQUEST_ABORTED',
  'TRANSPORT_ERROR', 'TRANSPORT_UNAVAILABLE', 'RESPONSE_TOO_LARGE', 'INVALID_HTTP_RESPONSE']);
const HEX_QUANTITY = /^0x[0-9a-f]+$/i;
const own = (object, field) => Object.prototype.hasOwnProperty.call(object, field);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class AuditInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AuditInputError';
    this.code = code;
  }
}

export function validateAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) throw new AuditInputError('ADDRESS_REQUIRED');
  const unique = [];
  for (const address of addresses) {
    if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(address)) {
      throw new AuditInputError('INVALID_ADDRESS');
    }
    const normalized = address.toLowerCase();
    if (/^0x0{40}$/.test(normalized)) throw new AuditInputError('ZERO_ADDRESS_NOT_ALLOWED');
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  if (unique.length > 5) throw new AuditInputError('TOO_MANY_ADDRESSES');
  return unique;
}

function validateChains(chains) {
  if (chains === null || chains === undefined) return null;
  if (!Array.isArray(chains) || chains.length === 0 || chains.length > 100) {
    throw new AuditInputError('INVALID_CHAINS');
  }
  const normalized = chains.map((chain) => typeof chain === 'string' ? chain.toLowerCase() : '');
  if (normalized.some((chain) => !/^[a-z0-9_-]{1,40}$/.test(chain))) {
    throw new AuditInputError('INVALID_CHAINS');
  }
  return [...new Set(normalized)];
}

export function formatUnits(raw, decimals = 18) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 ||
      !(typeof raw === 'bigint' || (typeof raw === 'string' && /^\d+$/.test(raw)))) {
    throw new AuditInputError('INVALID_INTEGER_AMOUNT');
  }
  const value = BigInt(raw);
  if (value < 0n) throw new AuditInputError('INVALID_INTEGER_AMOUNT');
  if (decimals === 0) return value.toString();
  const padded = value.toString().padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}

function summarize(items) {
  const statuses = items.map((item) => item.status);
  if (statuses.length === 0) return 'not_requested';
  if (statuses.every((status) => status === 'success')) return 'success';
  if (statuses.some((status) => status === 'success' || status === 'partial')) return 'partial';
  if (statuses.every((status) => status === 'unsupported')) return 'unsupported';
  if (statuses.every((status) => status === 'blocked')) return 'blocked';
  return 'failed';
}

function summarizeAssets(items, discoveryResults = []) {
  const status = summarize(items);
  return status === 'success' && discoveryResults.some((result) => result.status !== 'success')
    ? 'partial' : status;
}

function httpFailure(status) {
  if ([404, 405, 410, 501].includes(status)) return { status: 'unsupported', errorCode: 'ENDPOINT_UNSUPPORTED' };
  if (status === 401) return { status: 'failed', errorCode: 'AUTH_UNAUTHORIZED' };
  if (status === 403) return { status: 'failed', errorCode: 'AUTH_FORBIDDEN' };
  if (status === 429) return { status: 'failed', errorCode: 'RATE_LIMITED' };
  if (status >= 500) return { status: 'failed', errorCode: 'UPSTREAM_UNAVAILABLE' };
  return { status: 'failed', errorCode: 'HTTP_ERROR' };
}

function validateRequestOptions(timeoutMs, deadlineMs, concurrency) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 12000 ||
      !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new AuditInputError('INVALID_REQUEST_OPTIONS');
  }
}

export function createRequestGate(concurrency, deadlineAt) {
  let active = 0;
  const waiting = [];
  const pump = () => {
    while (active < concurrency && waiting.length) {
      const entry = waiting.shift();
      if (entry.done) continue;
      entry.done = true;
      clearTimeout(entry.timer);
      if (performance.now() >= deadlineAt) {
        entry.resolve(null);
        continue;
      }
      active++;
      let released = false;
      entry.resolve(() => {
        if (released) return;
        released = true;
        active--;
        pump();
      });
    }
  };
  return () => new Promise((resolve) => {
    const remaining = deadlineAt - performance.now();
    if (remaining <= 0) return resolve(null);
    const entry = { resolve, done: false };
    entry.timer = setTimeout(() => {
      entry.done = true;
      resolve(null);
    }, Math.ceil(remaining));
    waiting.push(entry);
    pump();
  });
}

// Both limits also bound injected fetch implementations that ignore AbortSignal.
async function requestJson(url, init, context) {
  if (context.fetchImpl === globalThis.fetch && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    return { status: 'blocked', errorCode: 'TLS_VERIFICATION_DISABLED', fetchedAt: context.now().toISOString() };
  }
  const failure = (errorCode) => {
    if (errorCode === 'DEADLINE_EXCEEDED') context.deadlineExceeded = true;
    return { status: 'failed', errorCode };
  };
  const release = await context.acquireRequest();
  const remaining = context.deadlineAt - performance.now();
  if (!release || remaining <= 0) {
    release?.();
    return { ...failure('DEADLINE_EXCEEDED'), fetchedAt: context.now().toISOString() };
  }
  const controller = new AbortController();
  let timer;
  let expiredCode;
  const timeoutCode = remaining <= context.timeoutMs ? 'DEADLINE_EXCEEDED' : 'REQUEST_TIMEOUT';
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      expiredCode = timeoutCode;
      controller.abort();
      resolve(failure(timeoutCode));
    }, Math.min(context.timeoutMs, Math.ceil(remaining)));
  });
  const operation = (async () => {
    try {
      const response = await context.fetchImpl(url, { ...init, signal: controller.signal, redirect: 'error' });
      if (!response || !Number.isInteger(response.status)) {
        return { status: 'failed', errorCode: 'INVALID_HTTP_RESPONSE' };
      }
      if (response.status < 200 || response.status >= 300) return httpFailure(response.status);
      try {
        const data = await response.json();
        return performance.now() >= context.deadlineAt
          ? failure('DEADLINE_EXCEEDED') : { status: 'success', data };
      } catch (caught) {
        return failure(expiredCode ?? (TRANSPORT_ERROR_CODES.has(caught?.code) ? caught.code : 'INVALID_JSON'));
      }
    } catch (caught) {
      return failure(expiredCode ?? (TRANSPORT_ERROR_CODES.has(caught?.code) ? caught.code : 'NETWORK_ERROR'));
    }
  })();
  // An uncooperative timed-out fetch retains its slot until it actually settles.
  // This prevents replacement requests from exceeding the shared concurrency cap.
  operation.finally(release);
  try {
    const result = await Promise.race([operation, deadline]);
    return { ...result, fetchedAt: context.now().toISOString() };
  } finally {
    clearTimeout(timer);
  }
}

function validList(data, kind) {
  const nonemptyString = (value) => typeof value === 'string' && value.length > 0;
  const decimalAmount = (value) => (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value));
  return Array.isArray(data) && data.every((item) => {
    if (!isObject(item) || !nonemptyString(item.id)) return false;
    if (kind === 'chain') return Number.isSafeInteger(item.community_id) && item.community_id > 0;
    if (!nonemptyString(item.chain)) return false;
    if (kind === 'token') return decimalAmount(item.amount);
    if (kind === 'protocol') return Array.isArray(item.portfolio_item_list) && item.portfolio_item_list.every(isObject);
    if (kind === 'nft') return nonemptyString(item.contract_id) && nonemptyString(item.inner_id);
    return false;
  });
}

function containsKey(data, key) {
  const pending = [data];
  const visited = new WeakSet();
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && value.includes(key)) return true;
    if (value === null || typeof value !== 'object' || visited.has(value)) continue;
    visited.add(value);
    for (const [name, child] of Object.entries(value)) {
      if (name.includes(key)) return true;
      pending.push(child);
    }
  }
  return false;
}

async function debankList(path, params, key, context, kind) {
  const url = new URL(path, DEBANK_ORIGIN);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const result = await requestJson(url.toString(), {
    method: 'GET', headers: { accept: 'application/json', AccessKey: key },
  }, context);
  if (result.status === 'success' && containsKey(result.data, key)) {
    return { status: 'failed', errorCode: 'SENSITIVE_DATA_IN_RESPONSE', fetchedAt: result.fetchedAt };
  }
  if (result.status === 'success' && !validList(result.data, kind)) {
    return { status: 'failed', errorCode: 'INVALID_RESPONSE_SCHEMA', fetchedAt: result.fetchedAt };
  }
  if (result.status === 'success' && kind !== 'chain' && params.chain_ids &&
      result.data.some((item) => !params.chain_ids.split(',').includes(item.chain))) {
    return { status: 'failed', errorCode: 'CHAIN_SCOPE_MISMATCH', fetchedAt: result.fetchedAt };
  }
  if (result.status === 'success') {
    result.source = url.toString();
    if (result.data.length === 0) result.emptyMeaning = 'no_items_returned_by_provider_within_queried_scope';
  }
  return result;
}

async function rpcCall(chain, method, params, context) {
  const result = await requestJson(chain.url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }, context);
  if (result.status !== 'success') return result;
  if (!isObject(result.data) || result.data.jsonrpc !== '2.0' || result.data.id !== 1 ||
      !own(result.data, 'result') || own(result.data, 'error') ||
      typeof result.data.result !== 'string' || !HEX_QUANTITY.test(result.data.result)) {
    return {
      status: 'failed',
      errorCode: isObject(result.data?.error) ? 'RPC_ERROR' : 'INVALID_RESPONSE_SCHEMA',
      fetchedAt: result.fetchedAt,
    };
  }
  return { ...result, data: result.data.result };
}

async function collectRpcChain(address, chainName, context) {
  const chain = own(RPC_CHAINS, chainName) ? RPC_CHAINS[chainName] : undefined;
  if (!chain) return { chain: chainName, status: 'unsupported', errorCode: 'CHAIN_UNSUPPORTED', fetchedAt: context.now().toISOString() };
  const base = { chain: chainName, chainId: chain.chainId, symbol: chain.symbol, decimals: 18, source: chain.url };
  const chainId = await rpcCall(chain, 'eth_chainId', [], context);
  if (chainId.status !== 'success') return { ...base, ...chainId };
  if (BigInt(chainId.data) !== BigInt(chain.chainId)) {
    return { ...base, status: 'failed', errorCode: 'CHAIN_ID_MISMATCH', fetchedAt: chainId.fetchedAt };
  }
  const block = await rpcCall(chain, 'eth_blockNumber', [], context);
  if (block.status !== 'success') return { ...base, ...block };
  const blockTag = `0x${BigInt(block.data).toString(16)}`;
  const balance = await rpcCall(chain, 'eth_getBalance', [address, blockTag], context);
  if (balance.status !== 'success') return { ...base, blockTag, ...balance };
  const rawWei = BigInt(balance.data).toString();
  return { ...base, status: 'success', blockTag, rawWei, balanceFormatted: formatUnits(rawWei), fetchedAt: balance.fetchedAt };
}

export async function collectSnapshot({ addresses, provider = 'rpc', chains = null,
  fetchImpl = globalThis.fetch, env = process.env, timeoutMs = 6000, deadlineMs = 40000,
  concurrency = 6, now = () => new Date() } = {}) {
  const normalizedAddresses = validateAddresses(addresses);
  if (!PROVIDERS.has(provider)) throw new AuditInputError('INVALID_PROVIDER');
  const requestedChains = validateChains(chains);
  if (typeof fetchImpl !== 'function') throw new AuditInputError('INVALID_REQUEST_OPTIONS');
  validateRequestOptions(timeoutMs, deadlineMs, concurrency);
  const started = performance.now();
  const deadlineAt = started + deadlineMs;
  const context = { fetchImpl, timeoutMs, now, deadlineAt, deadlineExceeded: false,
    acquireRequest: createRequestGate(concurrency, deadlineAt) };
  const key = provider !== 'rpc' && typeof env?.DEBANK_ACCESS_KEY === 'string' ? env.DEBANK_ACCESS_KEY.trim() : '';
  const useDeBank = provider === 'debank' || (provider === 'auto' && Boolean(key));
  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    startedAt: now().toISOString(),
    requestedProvider: provider,
    providerMode: useDeBank ? (key ? 'debank_with_rpc_fallback' : 'debank_blocked') : 'rpc_native_only',
    addresses: normalizedAddresses,
    requestedChains,
    timing: { deadlineMs, requestTimeoutMs: timeoutMs, concurrency },
    coverage: {
      completeWalletCoverage: false,
      rpc: { assetTypes: ['native_coin'], defaultChains: DEFAULT_CHAINS,
        excludes: ['other_evm_chains', 'erc20', 'defi', 'lp', 'staking', 'nft', 'claims', 'history'] },
      debank: { scope: 'provider_supported_chains_and_protocols_only',
        excludesGuarantees: ['all_evm_chains', 'all_protocols', 'all_claims', 'all_historical_assets', 'realizable_value'],
        chainDirectoryEnumerated: false },
    },
    notices: [
      'Empty results and zero native balances do not prove that the wallet has no other assets.',
      'DeBank price=0 means no price data; unpriced assets must remain visible.',
      'DeBank numeric amounts, including raw_amount returned as a JSON number, may have lost integer precision and are not authoritative exact units.',
      'RPC balances are exact decimal strings at each chain-specific blockTag; the chains are not sampled at one shared time.',
      'No private key, mnemonic, wallet connection, signature, or transaction is required.',
    ],
    accounts: [],
  };
  if (useDeBank) {
    snapshot.debankChainList = key
      ? await debankList('/v1/chain/list', {}, key, context, 'chain')
      : { status: 'blocked', errorCode: 'DEBANK_ACCESS_KEY_MISSING', fetchedAt: now().toISOString() };
    snapshot.coverage.debank.chainDirectoryEnumerated = snapshot.debankChainList.status === 'success';
  }
  snapshot.accounts = await Promise.all(normalizedAddresses.map(async (address) => {
    const account = { address };
    if (useDeBank) {
      const unsupportedChains = requestedChains && snapshot.debankChainList.status === 'success'
        ? requestedChains.filter((name) => !snapshot.debankChainList.data.some((chain) => chain.id === name)) : [];
      const queryChains = requestedChains?.filter((name) => !unsupportedChains.includes(name));
      const allChainParams = { id: address };
      if (queryChains?.length) allChainParams.chain_ids = queryChains.join(',');
      const endpoints = Object.fromEntries(await Promise.all([
        ['usedChains', '/v1/user/used_chain_list', { id: address }, 'chain'],
        ['tokens', '/v1/user/all_token_list', { ...allChainParams, is_all: true }, 'token'],
        ['protocols', '/v1/user/all_complex_protocol_list', allChainParams, 'protocol'],
        ['nfts', '/v1/user/all_nft_list', { ...allChainParams, is_all: true }, 'nft'],
      ].map(async ([name, path, params, kind]) => {
        if (!key) {
          return [name, { status: 'blocked', errorCode: 'DEBANK_ACCESS_KEY_MISSING', fetchedAt: now().toISOString() }];
        }
        if (name !== 'usedChains' && queryChains?.length === 0) {
          return [name, { status: 'unsupported', errorCode: 'CHAIN_UNSUPPORTED', fetchedAt: now().toISOString() }];
        }
        return [name, await debankList(path, params, key, context, kind)];
      })));
      account.debank = { status: summarizeAssets([
        endpoints.tokens, endpoints.protocols, endpoints.nfts,
        ...unsupportedChains.map(() => ({ status: 'unsupported' })),
      ], [snapshot.debankChainList, endpoints.usedChains]), endpoints,
        ...(unsupportedChains.length ? { unsupportedChains: unsupportedChains.map((chain) => ({ chain, status: 'unsupported', errorCode: 'CHAIN_UNSUPPORTED' })) } : {}) };
    }
    const needsRpc = !useDeBank || (Boolean(key) &&
      (snapshot.debankChainList.status !== 'success' || account.debank.status !== 'success'));
    if (needsRpc) {
      const results = await Promise.all((requestedChains ?? DEFAULT_CHAINS)
        .map((chain) => collectRpcChain(address, chain, context)));
      account.rpc = { status: summarize(results), reason: useDeBank ? 'debank_incomplete_native_only_fallback' : 'native_only_scan', chains: results };
    }
    account.status = summarize([...(account.debank ? [account.debank] : []), ...(account.rpc ? [account.rpc] : [])]);
    return account;
  }));
  snapshot.completedAt = now().toISOString();
  snapshot.timing.elapsedMs = Math.round(performance.now() - started);
  snapshot.timing.deadlineExceeded = context.deadlineExceeded;
  snapshot.status = summarize(snapshot.accounts);
  return snapshot;
}

export function parseArgs(args) {
  const options = { addresses: [], provider: 'rpc', chains: null, output: null, deadlineMs: 40000, concurrency: 6 };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg.startsWith('-')) {
      if (!['--provider', '--chains', '--output', '--deadline-ms', '--concurrency'].includes(arg) || seen.has(arg)) throw new AuditInputError('INVALID_ARGUMENTS');
      seen.add(arg);
      const value = args[++index];
      if (!value || value.startsWith('-')) throw new AuditInputError('INVALID_ARGUMENTS');
      if (arg === '--provider') options.provider = value;
      if (arg === '--chains') options.chains = value.split(',');
      if (arg === '--output') options.output = value;
      if (arg === '--deadline-ms' || arg === '--concurrency') {
        if (!/^\d+$/.test(value)) throw new AuditInputError('INVALID_REQUEST_OPTIONS');
        options[arg === '--deadline-ms' ? 'deadlineMs' : 'concurrency'] = Number(value);
      }
    } else options.addresses.push(arg);
  }
  options.addresses = validateAddresses(options.addresses);
  if (!PROVIDERS.has(options.provider)) throw new AuditInputError('INVALID_PROVIDER');
  options.chains = validateChains(options.chains);
  validateRequestOptions(6000, options.deadlineMs, options.concurrency);
  return options;
}

export async function writeSnapshot(output, snapshot) {
  try {
    await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    throw new AuditInputError(error?.code === 'EEXIST' ? 'OUTPUT_ALREADY_EXISTS' : 'OUTPUT_WRITE_FAILED');
  }
}

async function ensureOutputAvailable(output) {
  try {
    await lstat(output);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new AuditInputError('OUTPUT_CHECK_FAILED');
  }
  throw new AuditInputError('OUTPUT_ALREADY_EXISTS');
}

export async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  try {
    const options = parseArgs(args);
    if (options.help) {
      stdout.write('Usage: node collect-snapshot.mjs ADDRESS [ADDRESS...] [--provider rpc|auto|debank] [--chains eth,base,arb,op] [--output NEW_FILE.json] [--deadline-ms 40000] [--concurrency 6]\nDefault: free public RPC; existing DEBANK_ACCESS_KEY is ignored. DeBank requires an explicit --provider auto or --provider debank choice.\nMaximum 5 unique EVM addresses. Deadline 1-60000 ms; concurrency 1-12. Read-only. No wallet connection or signing.\n');
      return 0;
    }
    if (options.output) await ensureOutputAvailable(options.output);
    const snapshot = await collectSnapshot({ ...options, ...dependencies });
    if (options.output) await writeSnapshot(options.output, snapshot);
    else stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return snapshot.status === 'success' || snapshot.status === 'partial' ? 0 : 2;
  } catch (error) {
    stderr.write(`${JSON.stringify({ status: 'failed', errorCode: error instanceof AuditInputError ? error.code : 'INTERNAL_ERROR' })}\n`);
    return 1;
  }
}

const entryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entryPath && entryPath === await realpath(fileURLToPath(import.meta.url))) {
  process.exitCode = await runCli();
}
