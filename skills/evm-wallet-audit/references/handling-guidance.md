# Recommendations for each asset

[简体中文](handling-guidance.zh-CN.md) · [Skill entry](../SKILL.md)

Help the user decide what deserves action, in what order, and why. An old-wallet inventory does not imply liquidation, yield maximization, or consolidation into a destination chosen by the agent. Do not introduce unrequested investments.

## Ground the recommendation

- Give each confirmed asset/position a preferred next step: retain for gas, conditionally consolidate, redeem after verification, wait until maturity, check lending risk first, avoid interaction, or investigate. Combine items only when their constraints match.
- Include the reason, relevant steps, prerequisites, main risks, and a verified official entry when available. A link, a risk list, or “do your own research” is not a recommendation.
- Online, check current official rules and necessary chain state. A provider valuation supports a reference value, not redeemability, tradability, or claimability. With offline materials, give explicitly conditional paths without inventing current fees/state.
- Call a path verified only when identity, current position, and required conditions are supported. Otherwise say “verify X; if Y holds, consider Z.” A state-based exit condition is distinct from a successful exit simulation. Do not guess official domains/deep links.
- Fee estimates need query time, network, operation scope, and evidence. Distinguish gas, early-exit penalties, protocol fees, slippage, and bridging costs. Unknown fees stay unknown. Without reliable exit proceeds, do not calculate a certain net recovery or assert fees exceed value.

## By asset type

| Type | Conditions to verify | What the recommendation should answer |
| --- | --- | --- |
| Native coin / ordinary token | Contract identity, current balance, transferability; liquidity and tradability before discussing a swap | Retain suitable native gas if further on-chain work is needed. Consolidation is conditional on cost and a user-supplied destination. A price alone does not justify selling everything or transferring all gas |
| Staking / lock / vault share | Principal/share-to-underlying mapping, maturity, cooldown, redemption queue, claim phase, early-exit loss | Explain whether to unstake, wait, redeem, or claim. For unmatured locks, wait or compare evidenced early-exit costs. Missing UI controls do not prove lost funds; high APR alone does not justify continuing |
| LP, including V3 position NFT | Exact pool/position, remaining liquidity, underlying assets, fees/rewards, farm staking, exit limits | Explain the applicable order, such as unstake from farm → remove liquidity → collect fees/rewards; mark verified and unknown steps. Treat fee-only positions separately; not every NFT is a collectible |
| Lending / collateral | Assets, liabilities, health/liquidation risk, collateral effect of withdrawals, interest, exit limits | Prioritize evidenced urgent risks. Explain conditions for repayment first, partial exit, or waiting; do not recommend emptying collateral first or assume repayment funds/new borrowing authorization |
| Claim / refund / exit queue | Current eligibility/amount, already-claimed state, maturity/claim time, real contract, gas | Recommend a conditional current claim, waiting until a confirmed time, or eligibility verification. Judge a standalone claim's economics only with reliable amount and fees; do not count rewards twice |
| NFT | Current ownership, receipt/LP purpose, transferability, real bid/quote | Identify purpose first. Treat receipts through their protocols; ordinarily retain or price collectibles separately. Floor prices do not promise revenue. Avoid unfamiliar “claim/unlock” sites |
| Unpriced / small / suspected spam | Contract, balance, missing reliable price, evidence for risk flags | Preserve quantity; investigate or avoid interaction when no verified benefit exists. Small size affects priority, not proof of worthlessness/fraud. Never authorize unfamiliar contracts just to “clean” a wallet |
| Retired protocol / unfinished bridge | Current contract state, official migration/exit guidance, which side holds funds, completion conditions | Establish the asset and surviving path; separate verified steps from protocol-specific gaps. A closed page, old deposit, or bridge message proves neither loss nor recoverability |

## Priority and execution boundary

Lead with urgent risks supported by current evidence, then meaningful assets with clear conditions. Separate items that need waiting, pricing, or further checks. Do not recommend immediate exit for everything without the user's goal and adequate evidence.

A compact recommendation is: **preferred action → reason → verified steps/official entry → fees/prerequisites → unknowns**. Do not invent proceeds, withdrawable amounts, unlock times, or transaction parameters. Present the recommendation in chat.

Querying and advising are read-only. This skill never connects a wallet, signs, or sends a funds transaction. If execution is requested, a separate authorized workflow must confirm the exact network, contract/recipient, method, amount, minimum received/slippage, and fee before any signature.
