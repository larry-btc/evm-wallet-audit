import { AuditInputError, formatUnits, validateAddresses } from './collect-snapshot.mjs';

// Addresses and selectors verified against the official application and verified
// BaseScan sources on 2026-10-20. Only these read-only contracts are queried.
export const VIRTUALS_CONTRACTS = Object.freeze({
  token: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b',
  current: '0x60a203ddcde45fbfb325bdeea93824b5726b4df8',
  legacy: '0x33e34b8684565fcf6a9dd52a7e92c4e70211a045',
});
export const VIRTUALS_SELECTORS = Object.freeze({
  baseToken: '0xc55dae63', numPositions: '0xb7d7702c',
  stakedAmountOf: '0x5fcdad91', adminUnlocked: '0x7e530d2f',
  maxWeeks: '0x2b4bce31', getPositions: '0x288b1c68',
  getMaturity: '0x605830ef', balanceOf: '0x70a08231',
  depositToken: '0xc89039c5', getDepositsOf: '0x804d9426',
  getDepositsOfLength: '0xb8162dd2', getTotalDeposit: '0x857184d1',
  isAdminUnlock: '0x0ed19792',
});
const HEX = /^0x(?:[0-9a-f]{2})*$/i;
const QUANTITY = /^0x[0-9a-f]+$/i;
const word = (value) => BigInt(value).toString(16).padStart(64, '0');
const addressWord = (address) => address.slice(2).padStart(64, '0');
const sumRaw = (items) => items.reduce((total, item) => total + BigInt(item.amountRaw), 0n).toString();
const safeCodes = new Set(['REQUEST_TIMEOUT', 'DEADLINE_EXCEEDED', 'TLS_VERIFICATION_DISABLED',
  'NETWORK_ERROR', 'RPC_ERROR', 'INVALID_RESPONSE_SCHEMA', 'HTTP_ERROR', 'UPSTREAM_UNAVAILABLE',
  'RATE_LIMITED', 'AUTH_FORBIDDEN', 'AUTH_UNAUTHORIZED']);

function fail(code) { throw Object.assign(new Error(code), { code }); }
function decodeWords(data) {
  if (typeof data !== 'string' || !HEX.test(data) || (data.length - 2) % 64 !== 0) fail('INVALID_ABI_RESPONSE');
  const result = [];
  for (let i = 2; i < data.length; i += 64) result.push(BigInt(`0x${data.slice(i, i + 64)}`));
  return result;
}
function uint(data) {
  if (typeof data !== 'string' || data.length !== 66) fail('INVALID_ABI_RESPONSE');
  const values = decodeWords(data);
  if (values.length !== 1) fail('INVALID_ABI_RESPONSE');
  return values[0].toString();
}
function boolean(data) {
  const value = uint(data);
  if (value !== '0' && value !== '1') fail('INVALID_ABI_RESPONSE');
  return value === '1';
}
function address(data) {
  const value = uint(data);
  if (BigInt(value) >= 2n ** 160n) fail('INVALID_ABI_RESPONSE');
  return `0x${BigInt(value).toString(16).padStart(40, '0')}`;
}
function iso(seconds) {
  const value = BigInt(seconds);
  if (value > 8640000000000n) return null;
  return new Date(Number(value) * 1000).toISOString();
}
function arrayWords(data, width, maxLength) {
  if (typeof data !== 'string' || data.length > 2 + (2 + maxLength * width) * 64) fail('INVALID_ABI_RESPONSE');
  const values = decodeWords(data);
  if (values.length < 2 || values[0] !== 32n || values[1] > BigInt(maxLength) ||
      values.length !== 2 + Number(values[1]) * width) fail('INVALID_ABI_RESPONSE');
  return Array.from({ length: Number(values[1]) }, (_, index) => values.slice(2 + index * width, 2 + (index + 1) * width));
}
function decodePositions(data, expected) {
  const rows = arrayWords(data, 6, expected);
  if (rows.length !== expected) fail('POSITION_COUNT_MISMATCH');
  return rows.map(([amount, start, end, numWeeks, autoRenew, id]) => {
    // A zero-filled tuple is not an absent/empty position. Avoid padded pages.
    if (amount === 0n || id === 0n || start === 0n || end < start ||
        numWeeks === 0n || numWeeks > 255n || autoRenew > 1n) fail('INVALID_POSITION');
    return {
      id: id.toString(), amountRaw: amount.toString(), amountFormatted: formatUnits(amount),
      start: start.toString(), startIso: iso(start), end: end.toString(), endIso: iso(end),
      numWeeks: numWeeks.toString(), autoRenew: autoRenew === 1n,
      maturity: autoRenew === 1n ? { kind: 'rolling', timestamp: null, iso: null } :
        { kind: 'fixed', timestamp: end.toString(), iso: iso(end), source: 'getPositions.end' },
      withdrawalSimulation: 'not_performed', withdrawalStatus: 'not_verified',
    };
  });
}
function decodeDeposits(data, maxLength) {
  return arrayWords(data, 4, maxLength).map(([amount, shares, start, end], index) => {
    if (amount === 0n || start === 0n || end < start || end >= 2n ** 64n) fail('INVALID_DEPOSIT');
    return {
      depositIndex: String(index), amountRaw: amount.toString(), amountFormatted: formatUnits(amount),
      shareAmountRaw: shares.toString(), shareAmountFormatted: formatUnits(shares),
      start: start.toString(), startIso: iso(start), end: end.toString(), endIso: iso(end),
      withdrawalSimulation: 'not_performed', withdrawalStatus: 'not_verified',
    };
  });
}
function contractResult(contract) {
  return { contract, status: 'failed', identityVerified: false, principalRaw: null,
    principalFormatted: null, positionsComplete: false, withdrawalSimulation: 'not_performed',
    rewards: { status: 'not_queried', reason: 'separate_airdrop_and_reward_contracts' }, errors: [] };
}
function finishContract(result, successCount) {
  result.status = result.errors.some(({ code }) => code === 'BASE_TOKEN_MISMATCH') ? 'failed' :
    result.errors.length ? (successCount > 0 ? 'partial' : 'failed') : 'success';
  if (result.identityVerified && result.principalRaw !== null) {
    result.principalFormatted = formatUnits(result.principalRaw);
  }
  return result;
}

/**
 * Bounded, read-only Virtuals staking inventory on Base.
 * request({method, params, signal}) must return the unwrapped RPC result or throw.
 * Its transport must verify TLS and must never connect/sign/send transactions.
 * deadlineMs is a duration for the entire collection, including injected requests
 * that ignore AbortSignal. No retries or history scanning are performed here.
 */
export async function collectVirtualsStaking({ address: input, request, deadlineMs = 12000,
  pageSize = 50, maxPositions = 1000, blockTag: suppliedBlockTag, now = () => new Date() } = {}) {
  const wallet = validateAddresses([input])[0];
  if (typeof request !== 'function' || typeof now !== 'function' ||
      !Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60000 ||
      !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200 ||
      !Number.isInteger(maxPositions) || maxPositions < 1 || maxPositions > 10000 ||
      (suppliedBlockTag !== undefined && !QUANTITY.test(suppliedBlockTag))) {
    throw new AuditInputError('INVALID_REQUEST_OPTIONS');
  }
  const startedAt = now().toISOString();
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(Object.assign(new Error('DEADLINE_EXCEEDED'), { code: 'DEADLINE_EXCEEDED' }));
    }, deadlineMs);
  });
  // Handled even when every call fails before the deadline is needed.
  deadline.catch(() => {});
  const snapshot = {
    schemaVersion: 'evm-wallet-audit.virtuals-staking.v1', address: wallet, chain: 'base',
    chainId: '8453', status: 'failed', startedAt, completedAt: null,
    blockNumber: null, blockTag: null, blockTimestamp: null, blockTimeIso: null,
    contracts: { current: contractResult(VIRTUALS_CONTRACTS.current), legacy: contractResult(VIRTUALS_CONTRACTS.legacy) },
    coverage: { completeWalletCoverage: false, currentAndLegacyBaseOnly: true,
      history: 'not_queried', rewards: 'not_queried', withdrawalSimulation: 'not_performed' },
    errors: [],
  };
  async function rpc(method, params) {
    if (timedOut) fail('DEADLINE_EXCEEDED');
    try {
      return await Promise.race([Promise.resolve().then(() => request({ method, params, signal: controller.signal })), deadline]);
    } catch (error) {
      if (timedOut) fail('DEADLINE_EXCEEDED');
      fail(safeCodes.has(error?.code) ? error.code : 'RPC_ERROR');
    }
  }
  async function field(result, method, decode, args = '', target = result.contract, errorMethod = method) {
    try {
      const raw = await rpc('eth_call', [{ to: target, data: VIRTUALS_SELECTORS[method] + args }, snapshot.blockTag]);
      return { ok: true, value: decode(raw) };
    } catch (error) {
      result.errors.push({ method: errorMethod, code: error.code ?? 'INVALID_ABI_RESPONSE' });
      return { ok: false };
    }
  }
  async function current(headerPromise) {
    const result = snapshot.contracts.current;
    result.positions = [];
    result.votingPowerRaw = null;
    result.votingPowerFormatted = null;
    result.walletBalanceRaw = null;
    result.walletBalanceFormatted = null;
    const names = ['baseToken', 'numPositions', 'stakedAmountOf', 'adminUnlocked', 'balanceOf', 'maxWeeks'];
    const values = await Promise.all(names.map((name) => field(result, name,
      name === 'baseToken' ? address : name === 'adminUnlocked' ? boolean : uint,
      ['numPositions', 'stakedAmountOf', 'balanceOf'].includes(name) ? addressWord(wallet) : '')));
    let successCount = values.filter(({ ok }) => ok).length;
    values.forEach((entry, index) => { if (entry.ok) result[names[index]] = entry.value; });
    result.identityVerified = result.baseToken === VIRTUALS_CONTRACTS.token;
    if (values[0].ok && !result.identityVerified) result.errors.push({ method: 'baseToken', code: 'BASE_TOKEN_MISMATCH' });
    if (!result.identityVerified) return finishContract(result, successCount);
    const walletBalancePromise = field(result, 'balanceOf', uint, addressWord(wallet), result.baseToken, 'walletBalance');
    if (values[2].ok) result.principalRaw = result.stakedAmountOf;
    if (values[4].ok) {
      result.votingPowerRaw = result.balanceOf;
      result.votingPowerFormatted = formatUnits(result.balanceOf);
    }
    if (values[5].ok && (BigInt(result.maxWeeks) === 0n || BigInt(result.maxWeeks) > 255n)) {
      result.errors.push({ method: 'maxWeeks', code: 'INVALID_ABI_RESPONSE' });
      delete result.maxWeeks;
    }
    if (values[1].ok) {
      const total = BigInt(result.numPositions);
      const count = Number(total > BigInt(maxPositions) ? BigInt(maxPositions) : total);
      const pages = [];
      for (let start = 0; start < count; start += pageSize) {
        const size = Math.min(pageSize, count - start);
        pages.push(field(result, 'getPositions', (data) => decodePositions(data, size), addressWord(wallet) + word(start) + word(size)));
      }
      const rows = await Promise.all(pages);
      for (const entry of rows) if (entry.ok) { result.positions.push(...entry.value); successCount++; }
      result.positionsComplete = rows.every(({ ok }) => ok) && total <= BigInt(maxPositions);
      if (total > BigInt(maxPositions)) result.errors.push({ method: 'getPositions', code: 'POSITION_LIMIT_REACHED' });
      if (new Set(result.positions.map(({ id }) => id)).size !== result.positions.length) {
        result.errors.push({ method: 'getPositions', code: 'DUPLICATE_POSITION_ID' });
        result.positionsComplete = false;
      }
      result.enumeratedPrincipalRaw = sumRaw(result.positions);
      if (result.positionsComplete && result.principalRaw !== null && result.enumeratedPrincipalRaw !== result.principalRaw) {
        result.errors.push({ method: 'stakedAmountOf', code: 'PRINCIPAL_MISMATCH' });
      }
      await Promise.all(result.positions.filter(({ autoRenew }) => autoRenew).map(async (position) => {
        const maturity = await field(result, 'getMaturity', uint, addressWord(wallet) + word(position.id));
        if (maturity.ok) {
          position.maturity = { kind: 'rolling', timestamp: maturity.value, iso: iso(maturity.value), source: 'getMaturity',
            fixedUnlockDate: false, disableAutoRenewResetsFullMaxWeeks: true };
          successCount++;
        }
      }));
    }
    const walletBalance = await walletBalancePromise;
    if (walletBalance.ok) {
      result.walletBalanceRaw = walletBalance.value;
      result.walletBalanceFormatted = formatUnits(walletBalance.value);
      successCount++;
    }
    await headerPromise;
    for (const position of result.positions) {
      if (position.autoRenew) position.withdrawalStatus = 'blocked_auto_renew';
      else if (result.adminUnlocked === false && snapshot.blockTimestamp !== null && BigInt(position.end) > BigInt(snapshot.blockTimestamp)) {
        position.withdrawalStatus = 'blocked_before_maturity';
      } else if (result.adminUnlocked === true || (snapshot.blockTimestamp !== null && BigInt(position.end) <= BigInt(snapshot.blockTimestamp))) {
        position.withdrawalStatus = 'conditions_met_not_simulated';
      }
    }
    return finishContract(result, successCount);
  }
  async function legacy(headerPromise) {
    const result = snapshot.contracts.legacy;
    result.deposits = [];
    const names = ['depositToken', 'getDepositsOfLength', 'getTotalDeposit', 'isAdminUnlock', 'getDepositsOf', 'balanceOf'];
    const values = await Promise.all(names.map((name) => field(result, name,
      name === 'depositToken' ? address : name === 'isAdminUnlock' ? boolean :
        name === 'getDepositsOf' ? (data) => decodeDeposits(data, maxPositions) : uint,
      ['getDepositsOfLength', 'getTotalDeposit', 'getDepositsOf', 'balanceOf'].includes(name) ? addressWord(wallet) : '')));
    const successCount = values.filter(({ ok }) => ok).length;
    values.forEach((entry, index) => { if (entry.ok) result[names[index]] = entry.value; });
    result.identityVerified = result.depositToken === VIRTUALS_CONTRACTS.token;
    if (values[0].ok && !result.identityVerified) result.errors.push({ method: 'depositToken', code: 'BASE_TOKEN_MISMATCH' });
    if (!result.identityVerified) return finishContract(result, successCount);
    if (values[2].ok) result.principalRaw = result.getTotalDeposit;
    if (values[5].ok) { result.shareBalanceRaw = result.balanceOf; result.shareBalanceFormatted = formatUnits(result.balanceOf); }
    if (values[4].ok) {
      result.deposits = result.getDepositsOf;
      delete result.getDepositsOf;
      result.enumeratedPrincipalRaw = sumRaw(result.deposits);
      result.positionsComplete = values[1].ok && BigInt(result.getDepositsOfLength) === BigInt(result.deposits.length);
      if (values[1].ok && !result.positionsComplete) result.errors.push({ method: 'getDepositsOf', code: 'POSITION_COUNT_MISMATCH' });
      if (result.principalRaw !== null && result.enumeratedPrincipalRaw !== result.principalRaw) {
        result.errors.push({ method: 'getTotalDeposit', code: 'PRINCIPAL_MISMATCH' });
      }
    }
    await headerPromise;
    for (const deposit of result.deposits) {
      if (result.isAdminUnlock === false && snapshot.blockTimestamp !== null && BigInt(deposit.end) > BigInt(snapshot.blockTimestamp)) {
        deposit.withdrawalStatus = 'blocked_before_maturity';
      } else if (result.isAdminUnlock === true || (snapshot.blockTimestamp !== null && BigInt(deposit.end) <= BigInt(snapshot.blockTimestamp))) {
        deposit.withdrawalStatus = result.shareBalanceRaw !== undefined && BigInt(result.shareBalanceRaw) >= BigInt(deposit.shareAmountRaw)
          ? 'conditions_met_not_simulated' : 'share_balance_not_verified';
      }
    }
    return finishContract(result, successCount);
  }
  try {
    const [chain, block] = await Promise.all([
      rpc('eth_chainId', []), suppliedBlockTag ?? rpc('eth_blockNumber', []),
    ]);
    if (typeof chain !== 'string' || !QUANTITY.test(chain) || BigInt(chain) !== 8453n) fail('CHAIN_ID_MISMATCH');
    if (typeof block !== 'string' || !QUANTITY.test(block)) fail('INVALID_BLOCK_NUMBER');
    snapshot.blockNumber = BigInt(block).toString();
    snapshot.blockTag = `0x${BigInt(block).toString(16)}`;
    const headerPromise = (async () => {
      try {
        const header = await rpc('eth_getBlockByNumber', [snapshot.blockTag, false]);
        if (!header || typeof header.number !== 'string' || !QUANTITY.test(header.number) ||
            BigInt(header.number) !== BigInt(snapshot.blockTag) || typeof header.timestamp !== 'string' ||
            !QUANTITY.test(header.timestamp)) fail('INVALID_BLOCK_HEADER');
        snapshot.blockTimestamp = BigInt(header.timestamp).toString();
        snapshot.blockTimeIso = iso(snapshot.blockTimestamp);
      } catch (error) { snapshot.errors.push({ method: 'eth_getBlockByNumber', code: error.code ?? 'INVALID_BLOCK_HEADER' }); }
    })();
    await Promise.all([headerPromise, current(headerPromise), legacy(headerPromise)]);
    const statuses = Object.values(snapshot.contracts).map(({ status }) => status);
    snapshot.status = statuses.every((status) => status === 'success') && !snapshot.errors.length ? 'success' :
      statuses.some((status) => status === 'success' || status === 'partial') ? 'partial' : 'failed';
  } catch (error) {
    snapshot.errors.push({ method: 'chain_and_block', code: error.code ?? 'RPC_ERROR' });
  } finally {
    clearTimeout(timer);
    snapshot.completedAt = now().toISOString();
  }
  return snapshot;
}
