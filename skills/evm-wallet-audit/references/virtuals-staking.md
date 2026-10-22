# Virtuals staking checks

[简体中文](virtuals-staking.zh-CN.md) · [Skill entry](../SKILL.md)

Source notes checked: 2026-10-20. Use when the user mentions Virtuals staking or VIRTUAL holdings/transfers provide a lead. These are two identified **Base** staking contracts, not coverage of all chains or Virtuals ecosystem protocols. Online, recheck official app configuration, proxy implementation, and ABI when needed. Changed interfaces remain gaps rather than being queried with stale assumptions.

## Identity and sources

| Scope | Base (8453) contract | Identity evidence |
| --- | --- | --- |
| Underlying VIRTUAL | `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b` | Current lock's `baseToken()` and legacy `depositToken()` |
| Current veVIRTUAL lock | `0x60a203ddcDE45fbfb325bdeEA93824B5726b4dF8` | [Official app](https://app.virtuals.io/dashboard) StakingProvider/vevirtualAbi; [proxy/source](https://basescan.org/address/0x60a203ddcDE45fbfb325bdeEA93824B5726b4dF8#code) |
| Legacy xVIRTUAL / TimeLockStaking | `0x33e34b8684565fcf6a9dd52a7e92c4e70211a045` | [Legacy app](https://legacy.virtuals.io/) X_VIRTUAL_ADDRESS; [source](https://basescan.org/address/0x33e34b8684565fcf6a9dd52a7e92c4e70211a045#code) |

The [official mechanism](https://whitepaper.virtuals.io/info-hub/usdvirtual-token-base-asset-for-ai-agents/usdvirtual-staking-and-vevirtual) locks VIRTUAL for veVIRTUAL. Ordinary voting power decays to zero at maturity; automatic maximum locking behaves differently. **Voting power is not locked principal.**

## Current contract reads

`scripts/quick-audit.mjs` calls `scripts/virtuals-staking.mjs` within the shared deadline. It reads principal, positions, voting power, and VIRTUAL spot balance without repeating historical tracing. The automated first round **does not simulate withdrawal** and retains `not_performed`; state-based exit conditions are not a successful simulation.

Verify chain ID and pin reads to a recorded block:

- `baseToken()` confirms the underlying token.
- `numPositions(address)` and `getPositions(address,start,count)` enumerate positions. The final page's count must not exceed the remaining number; this implementation otherwise fills zero-valued structures. Tuples are `(amount,start,end,uint8 numWeeks,bool autoRenew,id)[]`; amount uses 18 decimal raw units and times are Unix seconds.
- `stakedAmountOf(address)` is principal total; reconcile with the sum of all position amounts.
- `getMaturity(address,id)` and `adminUnlocked()` determine current maturity/exit conditions. With `autoRenew=true`, maturity is queried block time plus `maxWeeks` weeks, continuously rolling forward; it is **not a fixed unlock date**. Original Stake duration cannot establish current maturity after Extend/AutoRenew changes.
- `balanceOf(address)` is veVIRTUAL voting power, shown separately and never added to principal. Zero voting power does not rule out matured, unwithdrawn principal.

Cross-check important balances through an independent node at the same block. A later protocol-specific check may use read-only `eth_call`, with the public wallet as `from`, to simulate `withdraw(id)`. It sends no transaction. `Lock is not expired` means the attempted simulation failed; any other failure is also not a verified withdrawal. Do not delay the first result to perform this additional check. Zero positions must come from successful contract reads, not an RPC failure or a missing token-list entry.

## Legacy contract and history

Read `depositToken()`, `getDepositsOfLength(address)`, `getDepositsOf(address)`, and `getTotalDeposit(address)` using the current ABI. No legacy deposit excludes only this contract's current position. Do not apply legacy `isAdminUnlock()` to the current contract. Withdrawn legacy deposits may be removed from its array; an empty list does not prove the wallet never staked.

If history and current state differ, use VIRTUAL transfers and Stake/Withdraw/Extend/AutoRenew events as leads, then verify current positions again. Historical net inflow supports reconciliation, not a replacement for current state. Checking an Agent token's similarly named staking contract does not exclude VIRTUAL staking.

## Chat output and recommendations

For each position show chain, ID, principal, current maturity with time zone, auto-renew state, and exit-verification status. Separate spot VIRTUAL and locked principal. A combined quantity requires identical asset/time scope and deduplication; never add voting power.

- Unmatured positions normally need waiting and an explanation of auto-renew. If auto-renew is already off, do not recommend touching the toggle.
- In this implementation, `toggleAutoRenew(id)` **resets the maximum lock period from the action block's time whether switching on or off**. Do not suggest toggling and immediately withdrawing.
- Withdrawal requires auto-renew to be off **and** maturity or administrator unlock. `adminUnlocked=true` does not bypass the auto-renew condition.
- At maturity, recheck the official entry, Base ETH gas, and withdrawal simulation before describing a conditional exit. This check performs no transaction and does not presume selling or extending a lock.

Check airdrop eligibility/rewards separately. A general eligibility claim is not evidence this wallet can claim. The current lock ABI has no reward-claim method; that does not prove other rewards are zero. Legacy migration/exit pages are not the current contract's exit path.
