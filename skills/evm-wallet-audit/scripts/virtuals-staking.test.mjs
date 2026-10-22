import test from 'node:test';
import assert from 'node:assert/strict';
import { collectVirtualsStaking, VIRTUALS_CONTRACTS as C, VIRTUALS_SELECTORS as S } from './virtuals-staking.mjs';

const WALLET = '0x1111111111111111111111111111111111111111';
const BLOCK = '0x123456';
const TIMESTAMP = 1750000000n;
const E18 = 10n ** 18n;
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const scalar = (n) => `0x${word(n)}`;
const addressResult = (a) => `0x${a.slice(2).padStart(64, '0')}`;
const array = (rows) => `0x${word(32)}${word(rows.length)}${rows.flat().map(word).join('')}`;
// Fully synthetic positions preserve the principal/voting-power regression without publishing user data.
const POSITIONS = [
  [1200n * E18, 1700000000n, 1762899200n, 104n, 0n, 101n],
  [300n * E18, 1700604800n, 1763504000n, 104n, 0n, 102n],
];
function fixture({ positions = POSITIONS, votingPower = 456123456789012345678n,
  deposits = [], override, onCall, baseToken = C.token, adminUnlocked = false,
  walletBalance = 1234567890123456789n } = {}) {
  return async (call) => {
    onCall?.(call);
    const custom = override?.(call);
    if (custom !== undefined) return await custom;
    const { method, params } = call;
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_blockNumber') return BLOCK;
    if (method === 'eth_getBlockByNumber') return { number: BLOCK, timestamp: `0x${TIMESTAMP.toString(16)}` };
    assert.equal(method, 'eth_call');
    assert.equal(params[1], BLOCK, 'all contract reads use the fixed block');
    const { to, data } = params[0];
    const selector = data.slice(0, 10);
    if (to === C.token) {
      assert.equal(selector, S.balanceOf);
      return scalar(walletBalance);
    }
    if (to === C.current) {
      const table = {
        [S.baseToken]: addressResult(baseToken), [S.numPositions]: scalar(positions.length),
        [S.stakedAmountOf]: scalar(positions.reduce((s, p) => s + p[0], 0n)),
        [S.adminUnlocked]: scalar(adminUnlocked ? 1 : 0), [S.maxWeeks]: scalar(104),
        [S.balanceOf]: scalar(votingPower),
      };
      if (selector === S.getPositions) {
        const start = Number(BigInt(`0x${data.slice(74, 138)}`));
        const count = Number(BigInt(`0x${data.slice(138, 202)}`));
        assert.ok(count <= positions.length - start, 'last page never requests zero padding');
        return array(positions.slice(start, start + count));
      }
      if (selector === S.getMaturity) return scalar(TIMESTAMP + 104n * 604800n);
      assert.ok(selector in table, `unknown current selector ${selector}`);
      return table[selector];
    }
    assert.equal(to, C.legacy);
    const table = {
      [S.depositToken]: addressResult(C.token), [S.getDepositsOfLength]: scalar(deposits.length),
      [S.getTotalDeposit]: scalar(deposits.reduce((s, p) => s + p[0], 0n)),
      [S.isAdminUnlock]: scalar(1), [S.getDepositsOf]: array(deposits),
      [S.balanceOf]: scalar(deposits.reduce((s, p) => s + p[1], 0n)),
    };
    assert.ok(selector in table, `unknown legacy selector ${selector}`);
    return table[selector];
  };
}

test('synthetic two-position regression: 1500 principal, separate voting power and exact unlocks', async () => {
  const calls = [];
  const result = await collectVirtualsStaking({ address: WALLET, request: fixture({ onCall: (c) => calls.push(c) }), pageSize: 1 });
  assert.equal(result.status, 'success');
  assert.equal(result.blockNumber, '1193046');
  assert.equal(result.blockTimeIso, '2025-06-15T15:06:40.000Z');
  const current = result.contracts.current;
  assert.equal(current.principalRaw, '1500000000000000000000');
  assert.equal(current.principalFormatted, '1500');
  assert.equal(current.votingPowerFormatted, '456.123456789012345678');
  assert.equal(current.walletBalanceRaw, '1234567890123456789');
  assert.equal(current.walletBalanceFormatted, '1.234567890123456789');
  assert.equal(current.positions[0].id, '101');
  assert.equal(current.positions[0].maturity.iso, '2025-11-11T22:13:20.000Z');
  assert.equal(current.positions[1].maturity.iso, '2025-11-18T22:13:20.000Z');
  assert.ok(current.positions.every((p) => p.withdrawalStatus === 'blocked_before_maturity'));
  assert.equal(current.positionsComplete, true);
  assert.equal(current.withdrawalSimulation, 'not_performed');
  assert.equal(result.contracts.legacy.principalRaw, '0');
  assert.equal(result.contracts.legacy.positionsComplete, true);
  assert.ok(calls.every((c) => ['eth_call', 'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber'].includes(c.method)));
});

test('zero voting power cannot erase positive principal, even after expiry', async () => {
  const positions = [[123456789012345678901n, 1700000000n, 1700604800n, 1n, 0n, 99n]];
  const result = await collectVirtualsStaking({ address: WALLET, request: fixture({ positions, votingPower: 0n }) });
  assert.equal(result.contracts.current.principalRaw, '123456789012345678901');
  assert.equal(result.contracts.current.principalFormatted, '123.456789012345678901');
  assert.equal(result.contracts.current.votingPowerRaw, '0');
  assert.equal(result.contracts.current.positions[0].withdrawalStatus, 'conditions_met_not_simulated');
});

test('auto-renew maturity is rolling and admin unlock cannot bypass it', async () => {
  const positions = [[10n * E18, 1700000000n, 1700604800n, 104n, 1n, 99n]];
  const result = await collectVirtualsStaking({ address: WALLET, request: fixture({ positions, adminUnlocked: true }) });
  const position = result.contracts.current.positions[0];
  assert.equal(position.maturity.kind, 'rolling');
  assert.equal(position.maturity.source, 'getMaturity');
  assert.equal(position.maturity.fixedUnlockDate, false);
  assert.equal(position.maturity.disableAutoRenewResetsFullMaxWeeks, true);
  assert.equal(position.withdrawalStatus, 'blocked_auto_renew');
});

test('RPC failures preserve other fields and never become zero/empty holdings', async () => {
  const result = await collectVirtualsStaking({ address: WALLET, request: fixture({ override: ({ method, params }) => {
    if (method === 'eth_call' && params[0].to === C.current && params[0].data.startsWith(S.numPositions)) {
      return Promise.reject(Object.assign(new Error('private upstream body'), { code: 'RPC_ERROR' }));
    }
  } }) });
  const current = result.contracts.current;
  assert.equal(result.status, 'partial');
  assert.equal(current.principalFormatted, '1500');
  assert.equal(current.numPositions, undefined);
  assert.equal(current.positionsComplete, false);
  assert.deepEqual(current.errors, [{ method: 'numPositions', code: 'RPC_ERROR' }]);
  assert.ok(!JSON.stringify(result).includes('private upstream body'));
});

test('wallet spot-balance failure remains independently unknown while staking is preserved', async () => {
  const result = await collectVirtualsStaking({ address: WALLET, request: fixture({ override: ({ method, params }) =>
    method === 'eth_call' && params[0].to === C.token ? Promise.reject(new Error('failed')) : undefined }) });
  const current = result.contracts.current;
  assert.equal(current.principalFormatted, '1500');
  assert.equal(current.positionsComplete, true);
  assert.equal(current.walletBalanceRaw, null);
  assert.equal(current.walletBalanceFormatted, null);
  assert.deepEqual(current.errors, [{ method: 'walletBalance', code: 'RPC_ERROR' }]);
  assert.equal(result.status, 'partial');
});

test('global deadline bounds an injected request that ignores abort and retains successful totals', async () => {
  let aborted = false;
  const began = Date.now();
  const result = await collectVirtualsStaking({ address: WALLET, deadlineMs: 30,
    request: fixture({ override: ({ method, params, signal }) => {
      if (method === 'eth_call' && params[0].data.startsWith(S.getPositions)) {
        signal.addEventListener('abort', () => { aborted = true; });
        return new Promise(() => {});
      }
    } }) });
  assert.ok(Date.now() - began < 1000);
  assert.equal(aborted, true);
  assert.equal(result.status, 'partial');
  assert.equal(result.contracts.current.principalFormatted, '1500');
  assert.equal(result.contracts.current.positionsComplete, false);
  assert.ok(result.contracts.current.errors.some((e) => e.code === 'DEADLINE_EXCEEDED'));
});

test('wrong chain stops before any contract read', async () => {
  let reads = 0;
  const result = await collectVirtualsStaking({ address: WALLET, request: fixture({
    onCall: ({ method }) => { if (method === 'eth_call') reads++; },
    override: ({ method }) => method === 'eth_chainId' ? '0x1' : undefined,
  }) });
  assert.equal(result.status, 'failed');
  assert.equal(reads, 0);
  assert.equal(result.errors[0].code, 'CHAIN_ID_MISMATCH');
});

test('base token mismatch is failed identity, without presenting VIRTUAL principal', async () => {
  const result = await collectVirtualsStaking({ address: WALLET,
    request: fixture({ baseToken: '0x1111111111111111111111111111111111111111' }) });
  assert.equal(result.contracts.current.status, 'failed');
  assert.equal(result.contracts.current.identityVerified, false);
  assert.equal(result.contracts.current.principalRaw, null);
  assert.equal(result.contracts.current.principalFormatted, null);
});

test('malformed ABI and padded zero positions are errors, not an empty wallet', async () => {
  for (const response of ['0x', array([[0n, 0n, 0n, 0n, 0n, 0n], [0n, 0n, 0n, 0n, 0n, 0n]])]) {
    const result = await collectVirtualsStaking({ address: WALLET, request: fixture({ override: ({ method, params }) =>
      method === 'eth_call' && params[0].data.startsWith(S.getPositions) ? response : undefined }) });
    assert.equal(result.contracts.current.status, 'partial');
    assert.equal(result.contracts.current.principalFormatted, '1500');
    assert.equal(result.contracts.current.positionsComplete, false);
  }
});

test('position cap is explicit partial coverage with separately verified total principal', async () => {
  const result = await collectVirtualsStaking({ address: WALLET, maxPositions: 1, request: fixture() });
  assert.equal(result.contracts.current.status, 'partial');
  assert.equal(result.contracts.current.positions.length, 1);
  assert.equal(result.contracts.current.positionsComplete, false);
  assert.equal(result.contracts.current.principalFormatted, '1500');
  assert.ok(result.contracts.current.errors.some((e) => e.code === 'POSITION_LIMIT_REACHED'));
});

test('legacy deposit principal and shares remain separate and withdrawal is never claimed simulated', async () => {
  const deposits = [[100n * E18, 250n * E18, 1700000000n, 1800000000n]];
  const result = await collectVirtualsStaking({ address: WALLET, request: fixture({ deposits }) });
  const legacy = result.contracts.legacy;
  assert.equal(legacy.principalFormatted, '100');
  assert.equal(legacy.shareBalanceFormatted, '250');
  assert.equal(legacy.deposits[0].withdrawalStatus, 'conditions_met_not_simulated');
  assert.equal(legacy.deposits[0].withdrawalSimulation, 'not_performed');
});

test('supplied fixed block is honored; invalid input makes no requests', async () => {
  const calls = [];
  const result = await collectVirtualsStaking({ address: WALLET, blockTag: BLOCK,
    request: fixture({ onCall: (c) => calls.push(c) }) });
  assert.equal(result.status, 'success');
  assert.ok(!calls.some((c) => c.method === 'eth_blockNumber'));
  let touched = false;
  await assert.rejects(collectVirtualsStaking({ address: '0x0000000000000000000000000000000000000000',
    request: () => { touched = true; } }), /ZERO_ADDRESS_NOT_ALLOWED/);
  assert.equal(touched, false);
});
