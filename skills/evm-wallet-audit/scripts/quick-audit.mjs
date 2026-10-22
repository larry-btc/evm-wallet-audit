#!/usr/bin/env node
import { lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AuditInputError, collectSnapshot, createRequestGate, formatUnits, parseArgs, RPC_CHAINS,
  validateAddresses, writeSnapshot } from './collect-snapshot.mjs';
import { createCurlFetch } from './curl-fetch.mjs';
import { collectVirtualsStaking } from './virtuals-staking.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const error = (code) => Object.assign(new Error(code), { code });
const safeCodes = new Set(['REQUEST_TIMEOUT', 'DEADLINE_EXCEEDED', 'RPC_ERROR', 'INVALID_RESPONSE_SCHEMA',
  'CHAIN_ID_MISMATCH', 'HTTP_ERROR', 'TRANSPORT_ERROR', 'TRANSPORT_UNAVAILABLE', 'REQUEST_ABORTED']);
const codeOf = (caught) => safeCodes.has(caught?.code) ? caught.code : 'NETWORK_ERROR';
const quantity = (raw) => typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw);
const uintWord = (raw) => typeof raw === 'string' && /^0x[0-9a-f]{64}$/i.test(raw);

function rpcClient(chain, fetchImpl, expiresAt) {
  let nextId = 0;
  return async ({ method, params, signal }) => {
    if (!['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_call'].includes(method)) throw error('RPC_ERROR');
    const remaining = expiresAt - performance.now();
    if (remaining <= 0) throw error('DEADLINE_EXCEEDED');
    if (signal?.aborted) throw error('REQUEST_ABORTED');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timer;
    const id = ++nextId;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(error('DEADLINE_EXCEEDED'));
      }, remaining);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await fetchImpl(chain.url, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
        if (response.status < 200 || response.status >= 300) throw error('HTTP_ERROR');
        const body = await response.json();
        if (!body || body.jsonrpc !== '2.0' || body.id !== id || !own(body, 'result') || own(body, 'error')) {
          throw error(body?.error ? 'RPC_ERROR' : 'INVALID_RESPONSE_SCHEMA');
        }
        return body.result;
      })()]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

function normalizeTokens(tokens, chains) {
  if (!Array.isArray(tokens) || tokens.length > 20) throw new AuditInputError('INVALID_TOKEN_SELECTION');
  const seen = new Set();
  return tokens.map((token) => {
    if (typeof token !== 'string') throw new AuditInputError('INVALID_TOKEN_SELECTION');
    const [chain, contract, extra] = token.split(':');
    if (!own(RPC_CHAINS, chain) || extra !== undefined || (chains && !chains.includes(chain))) {
      throw new AuditInputError('INVALID_TOKEN_SELECTION');
    }
    return { chain, contract: validateAddresses([contract])[0] };
  }).filter(({ chain, contract }) => {
    const key = `${chain}:${contract}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function validateQuickOptions({ addresses, provider = 'rpc', chains = null,
  protocols = ['virtuals'], tokens = [], deadlineMs = 40000, concurrency = 6 } = {}) {
  // Reuse the collector's public input validation before any network activity.
  const normalizedAddresses = validateAddresses(addresses);
  if (!Number.isInteger(deadlineMs) || !Number.isInteger(concurrency)) throw new AuditInputError('INVALID_QUICK_OPTIONS');
  const validationArgs = [...normalizedAddresses, '--provider', provider,
    '--deadline-ms', String(deadlineMs), '--concurrency', String(concurrency)];
  if (chains !== null) {
    if (!Array.isArray(chains) || chains.some((item) => typeof item !== 'string')) throw new AuditInputError('INVALID_CHAINS');
    validationArgs.push('--chains', chains.join(','));
  }
  const validated = parseArgs(validationArgs);
  if (deadlineMs > 45000 || !Array.isArray(protocols) || protocols.some((name) => name !== 'virtuals')) {
    throw new AuditInputError('INVALID_QUICK_OPTIONS');
  }
  return { ...validated, selectedTokens: normalizeTokens(tokens, validated.chains) };
}

/** Current-state first pass, not an exhaustive history or portfolio discovery engine. */
export async function collectQuickAudit({ addresses, provider = 'rpc', chains = null,
  protocols = ['virtuals'], tokens = [], deadlineMs = 40000, concurrency = 6,
  fetchImpl, env = process.env } = {}) {
  const validated = validateQuickOptions({ addresses, provider, chains, protocols, tokens, deadlineMs, concurrency });
  const selectedTokens = validated.selectedTokens;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const expiresAt = started + deadlineMs;
  const rawTransport = fetchImpl ?? createCurlFetch({ concurrency, deadlineMs });
  const acquire = createRequestGate(concurrency, expiresAt);
  const transport = async (url, init = {}) => {
    const release = await acquire();
    if (!release) throw error('DEADLINE_EXCEEDED');
    try {
      if (init.signal?.aborted) throw error('REQUEST_ABORTED');
      return await rawTransport(url, init);
    } finally { release(); }
  };
  if (rawTransport.stats) transport.stats = rawTransport.stats;
  // Optional protocol/token work cannot occupy every slot before native balances finish.
  // Hold a lane slot until the underlying operation actually settles, even if aborted.
  const laneLimit = Math.max(1, Math.floor(concurrency / 3));
  const laneGates = { protocol: createRequestGate(laneLimit, expiresAt), token: createRequestGate(laneLimit, expiresAt) };
  const clients = new Map();
  const client = (chain, lane = 'token') => {
    const key = `${lane}:${chain}`;
    if (!clients.has(key)) {
      const laneTransport = async (...args) => {
        const release = await laneGates[lane]();
        if (!release) throw error('DEADLINE_EXCEEDED');
        try { return await transport(...args); }
        finally { release(); }
      };
      clients.set(key, rpcClient(RPC_CHAINS[chain], laneTransport, expiresAt));
    }
    return clients.get(key);
  };
  const anchors = new Map();
  const anchor = (chain) => {
    if (!anchors.has(chain)) anchors.set(chain, (async () => {
      const request = client(chain);
      const id = await request({ method: 'eth_chainId', params: [] });
      if (!quantity(id) || BigInt(id) !== BigInt(RPC_CHAINS[chain].chainId)) throw error('CHAIN_ID_MISMATCH');
      const block = await request({ method: 'eth_blockNumber', params: [] });
      if (!quantity(block)) throw error('INVALID_RESPONSE_SCHEMA');
      return `0x${BigInt(block).toString(16)}`;
    })());
    return anchors.get(chain);
  };
  const nativeTask = collectSnapshot({ addresses: validated.addresses, provider, chains: validated.chains,
    fetchImpl: transport, env, deadlineMs, timeoutMs: 6000, concurrency }).catch((caught) =>
    ({ status: 'failed', errorCode: codeOf(caught), accounts: [] }));
  // At very low concurrency finish the cheap inventory first, then optional work.
  const optionalReady = concurrency < 3 ? nativeTask.then(() => {}) : Promise.resolve();
  const virtualsSelected = protocols.includes('virtuals') && (!validated.chains || validated.chains.includes('base'));
  const protocolTasks = virtualsSelected ? validated.addresses.map((address) =>
    optionalReady.then(() => collectVirtualsStaking({ address, request: client('base', 'protocol'),
      deadlineMs: Math.max(1, Math.ceil(expiresAt - performance.now())) })).catch((caught) =>
      ({ address, status: 'failed', errorCode: codeOf(caught) }))) : [];
  const tokenTasks = validated.addresses.flatMap((address) => selectedTokens.map(async ({ chain, contract }) => {
    const base = { address, chain, chainId: RPC_CHAINS[chain].chainId, contract, source: RPC_CHAINS[chain].url,
      price: null, valuationStatus: 'unpriced', status: 'failed' };
    try {
      await optionalReady;
      const blockTag = await anchor(chain);
      const request = client(chain);
      const [balance, decimals] = await Promise.all([
        request({ method: 'eth_call', params: [{ to: contract, data: `0x70a08231${address.slice(2).padStart(64, '0')}` }, blockTag] }),
        request({ method: 'eth_call', params: [{ to: contract, data: '0x313ce567' }, blockTag] }),
      ]);
      if (!uintWord(balance) || !uintWord(decimals) || BigInt(decimals) > 255n) throw error('INVALID_RESPONSE_SCHEMA');
      const rawAmount = BigInt(balance).toString();
      return { ...base, status: 'success', blockTag, rawAmount, decimals: Number(BigInt(decimals)),
        quantity: formatUnits(rawAmount, Number(BigInt(decimals))), fetchedAt: new Date().toISOString() };
    } catch (caught) { return { ...base, errorCode: codeOf(caught), fetchedAt: new Date().toISOString() }; }
  }));
  const [snapshot, virtuals, knownTokens] = await Promise.all([nativeTask, Promise.all(protocolTasks), Promise.all(tokenTasks)]);
  const statuses = [snapshot.status, ...virtuals.map((item) => item.status), ...knownTokens.map((item) => item.status)];
  const directProtocolChecks = virtualsSelected ? ['virtuals_base_current_and_legacy'] : [];
  const protocolDiscovery = snapshot.accounts.flatMap((account) => {
    const endpoint = account.debank?.endpoints?.protocols;
    return endpoint ? [{ address: account.address, endpoint: '/v1/user/all_complex_protocol_list',
      status: endpoint.status, ...(endpoint.errorCode ? { errorCode: endpoint.errorCode } : {}),
      ...(endpoint.fetchedAt ? { fetchedAt: endpoint.fetchedAt } : {}) }] : [];
  });
  const discoveryStatuses = protocolDiscovery.map((endpoint) => endpoint.status);
  const discoveryStatus = discoveryStatuses.length === 0 ? 'not_requested' :
    discoveryStatuses.every((status) => status === 'success') ? 'success' :
    discoveryStatuses.some((status) => status === 'success' || status === 'partial') ? 'partial' :
    discoveryStatuses.every((status) => status === 'blocked') ? 'blocked' :
    discoveryStatuses.every((status) => status === 'unsupported') ? 'unsupported' : 'failed';
  const debankAssets = snapshot.accounts.flatMap((account) =>
    ['tokens', 'protocols', 'nfts'].map((name) => account.debank?.endpoints?.[name]).filter(Boolean));
  const connectionStatus = !debankAssets.length ? 'not_requested' :
    snapshot.providerMode === 'debank_blocked' ? 'not_configured' :
    debankAssets.every((endpoint) => endpoint.status === 'success') ? 'verified' :
    debankAssets.some((endpoint) => endpoint.status === 'success') ? 'partial' : 'failed';
  return {
    schemaVersion: 'evm-wallet-audit.quick.v1', mode: 'quick_current_state',
    startedAt, completedAt: new Date().toISOString(), addresses: validated.addresses,
    status: statuses.every((status) => status === 'success') ? 'success' :
      statuses.some((status) => status === 'success' || status === 'partial') ? 'partial' : 'failed',
    timing: { elapsedMs: Math.round(performance.now() - started), budgetMs: deadlineMs, concurrency,
      targetChatResponseMs: 60000, chatResponseGuaranteed: false },
    transport: fetchImpl ? 'injected' : 'system_curl_verified_tls',
    debankConnection: { status: connectionStatus, verified: connectionStatus === 'verified',
      scope: 'requested_debank_asset_endpoints_only', completeWalletCoverage: false },
    coverage: { completeWalletCoverage: false, history: 'not_queried', rewards: 'not_queried',
      tokenDiscovery: snapshot.providerMode === 'debank_with_rpc_fallback' ? 'provider_supported_scope' : 'not_available_without_indexer',
      knownTokensOnly: selectedTokens,
      // Compatibility: protocolsQueried continues to list only fixed-contract RPC checks.
      protocolsQueried: directProtocolChecks, directProtocolChecks,
      debankProtocolDiscovery: { status: discoveryStatus, provider: 'debank',
        scope: 'provider_supported_chains_and_protocols_only', requestedChains: validated.chains,
        freshness: 'provider_snapshot_not_fixed_block', maxProviderUpdateDelaySeconds: 43200,
        actualAgeVerified: false, endpoints: protocolDiscovery },
      unsupportedProtocols: 'not_exhaustively_determined', withdrawalSimulation: 'not_performed' },
    snapshot, virtuals, knownTokens, ...(transport.stats ? { transportStats: { ...transport.stats } } : {}),
  };
}

export function parseQuickArgs(args) {
  const forwarded = [];
  const tokens = [];
  let protocols = ['virtuals'];
  let protocolOption = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token') {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new AuditInputError('INVALID_ARGUMENTS');
      tokens.push(value);
    } else if (args[i] === '--protocols') {
      if (protocolOption) throw new AuditInputError('INVALID_ARGUMENTS');
      protocolOption = true;
      const value = args[++i];
      if (value !== 'virtuals' && value !== 'none') throw new AuditInputError('INVALID_ARGUMENTS');
      protocols = value === 'none' ? [] : ['virtuals'];
    } else forwarded.push(args[i]);
  }
  const options = parseArgs(forwarded);
  if (!options.help && !forwarded.includes('--provider')) options.provider = 'rpc';
  return { ...options, protocols, tokens };
}

export async function runQuickCli(args = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  try {
    const options = parseQuickArgs(args);
    if (options.help) {
      stdout.write('Usage: node quick-audit.mjs ADDRESS [ADDRESS...] [--provider rpc|auto|debank] [--chains eth,base,arb,op] [--protocols virtuals|none] [--token base:CONTRACT] [--deadline-ms 40000] [--concurrency 6] [--output NEW_FILE.json]\nDefault: free public RPC, no key or secret prompt required; existing DEBANK_ACCESS_KEY is ignored. DeBank requires an explicit --provider auto or --provider debank choice.\nCurrent-state first pass; no exhaustive asset discovery or history scan. Requires system curl.\n');
      return 0;
    }
    if (options.output) {
      try { await lstat(options.output); throw new AuditInputError('OUTPUT_ALREADY_EXISTS'); }
      catch (caught) { if (caught?.code !== 'ENOENT') throw caught; }
    }
    const result = await collectQuickAudit({ ...options, ...dependencies });
    if (options.output) await writeSnapshot(options.output, result);
    else stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'success' || result.status === 'partial' ? 0 : 2;
  } catch (caught) {
    stderr.write(`${JSON.stringify({ status: 'failed', errorCode: caught instanceof AuditInputError ? caught.code : 'INTERNAL_ERROR' })}\n`);
    return 1;
  }
}

const entryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entryPath && entryPath === await realpath(fileURLToPath(import.meta.url))) process.exitCode = await runQuickCli();
