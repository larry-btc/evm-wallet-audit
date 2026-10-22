# Chat results and optional exports

[简体中文](report-contract.zh-CN.md) · [Skill entry](../SKILL.md)

Deliver the useful result directly in chat, in the user's language. Distinguish current holdings, funds in protocols, recommendations, historical leads, and unqueried/failed scope. Adapt the structure to the task; do not add empty sections or make a download necessary to understand the result.

## Default chat delivery

- Aim for a first result within one minute; identify it as a **limited quick check** and name actual coverage. This is a target, not a guarantee. Report elapsed time accurately: collection time is not total chat time including synthesis. Slow sources or missing aggregation do not prevent partial delivery and do not justify “all assets checked.” Long history scans, vault mappings, and unfamiliar protocols remain follow-up work.
- Lead with findings and the best next action. State the scope of any reference valuation. If evidence is insufficient, say so; a balance does not promise withdrawal.
- Use a compact table such as `chain / asset or position / quantity and reference value / recommendation / reason or condition`. Attribute each address separately in multi-wallet work.
- Follow with prioritized concrete recommendations. Every confirmed asset/position, or group with identical constraints, needs a preferred action, reason, path, current prerequisites, fees, and risks. Use [handling guidance](handling-guidance.md). If exit conditions are unknown, state what to verify first rather than inventing an executable path.
- Place verified official/explorer links and evidence times beside the relevant advice. Mark unverified entry points; never recommend unfamiliar metadata links as if official.
- End with actual coverage, failures, and unqueried scope; use a small gap table when helpful. Separate facts, inferences, and conditional advice. Small holdings may be grouped, but disclose count/filter scope and keep them available for expansion; do not silently show only the largest positions.
- Advice is not execution. Do not withhold useful recommendations merely because no transaction authorization exists; do not interpret an audit/recommendation request as permission to sign or transfer.

## Save only when export/archive is requested

Under the **user-requested location**, create a new unique directory and save relevant files:

- `snapshot.json`: original query output; do not relabel machine output as human-verified.
- `wallet-audit.md`: conclusions in the user's language, per-address detail, priority checks, scope, and sources.
- `assets.csv`: filterable item inventory preserving wallet attribution.
- Supplemental JSON/evidence extracts: URL, fetch time, network, block/time range, and pagination status. Exclude credentials, browser sessions, and unrelated personal information.

The scripts produce snapshots only; the agent prepares chat/report/CSV content from actual evidence, without fabricated example assets. Use a new suffix rather than overwrite existing files. Without a requested export, session-only temporary evidence is sufficient; a portable unique temporary directory may use `os.tmpdir()` and `fs.mkdtemp()`. Never upload the address list unless the user explicitly requests public sharing. Avoid full addresses in public directory titles.

## Shared information rules

- Retain supplied full public addresses, start/end times with time zone, and actual data providers.
- Separate wallet balances, protocol assets/debts, NFTs, claims, and unverified historical leads. Give confirmed items recommendations and important unknowns explicit checks. Do not label a net value “recovered.”
- Coverage granularity is `address × chain × asset type × source`. If the provider provides no chain-level data, report provider scope rather than inventing per-chain success. Use `found`, `no_results_in_scope`, `partial`, `failed`, `blocked` (missing access/execution prerequisites), `not_queried`, `unsupported`, or `unverified`. Endpoint success means request/structure checks passed; classify actual data separately.
- Record requested scope, block/provider update time, fetch time, failure reason, and unfinished pagination. A successful supported-chain catalog request does not verify unknown chains or protocols.
- Standalone RPC collector coverage is **four-chain native ETH only**. The quick audit may add Base VIRTUAL spot/current/legacy staking and explicitly supplied token contracts according to actual scope. These are limited integrated checks, not all-token/DeFi discovery. NFTs, other protocols, history, and other chains remain gaps unless actually checked.

## Suggested `assets.csv` fields

Add fields only when supported; unknowns stay empty with an explanation:

```text
wallet,chain_id,chain_name,category,contract_or_native,position_or_token_id,protocol,symbol,quantity,raw_amount,decimals,price_usd,reference_value_usd,debt_usd,valuation_status,evidence_level,coverage_status,source_url,source_pointer,source_updated_at,evidence_event_at,fetched_at,block_number,overlap_group,exit_constraints,next_check
```

- `category`: `native`, `token`, `defi`, `nft`, `claim`, or `history_lead`.
- Identity includes wallet + numeric chain ID + contract/native identifier + position/token ID. Do not merge cross-chain balances into an unattributed ticker quantity.
- Missing contract/position IDs stay empty. Locate the source record with `source_pointer` and mark incomplete identity; do not invent on-chain identifiers. `evidence_event_at` is a historical event time, distinct from provider update/fetch time.
- Preserve `quantity`, `raw_amount`, and `position_or_token_id` as strings. Do not use floating-point arithmetic for raw units/NFT IDs. Mark provider-number precision as unverified when not checked.
- Leave `price_usd`, `reference_value_usd`, and `debt_usd` empty without evidence; zero needs a sourced true zero. Unpriced is not worthless.
- `evidence_level`: `provider_snapshot`, `onchain_read`, `cross_checked`, or `historical_only`. Use `onchain_read` only for saved actual RPC/contract evidence.
- `valuation_status` may be `reference_only`, `unpriced`, `excluded_overlap`, or `not_applicable`; distinguish unknown price from inclusion in a subtotal.
- Escape text using RFC 4180. Prefix untrusted text that could trigger formulas (`=`, `+`, `-`, `@`, leading tabs/carriage returns, etc.) with an apostrophe. Generate and validate numeric columns separately. Parse the CSV back to check addresses, row counts, and names with commas/newlines.

## Valuation and overlap

- Prefer categorized quantities; a **priced wallet-assets reference subtotal** may be enough. Do not force a whole-wallet net value.
- If computing reference net value: independent wallet assets + protocol underlying assets − protocol debt. Exclude receipts already represented by underlying LP/aToken/cToken/vault assets. Unresolved mappings stay as possible overlaps and are not summed or silently deleted.
- `is_wallet=false` does not automatically mean extra wallet spot holdings. Check whether protocol rewards are already included; if unclear, show separately without adding again.
- NFTs need ownership evidence and are unpriced by default. Historical trades/floors are references, not current executable revenue.
- Confirm claims only after current eligibility, amount, and already-claimed state are checked. Claimable is not received; unknown fees/exit conditions preclude a “net withdrawable” amount.
- Separate suspected spam tokens/lure NFTs with evidence for the flag; do not visit unfamiliar claim sites in metadata. Keep small assets. Without cost estimates, do not assert that fees exceed value.

## Before delivery

Check source attribution, wallet identity, coverage, time, price/debt treatment, and per-item advice. Failures, missing prices, and historical interactions with unknown current balances must remain visible. The chat result must be useful on its own; attach absolute local links only for requested exports.
