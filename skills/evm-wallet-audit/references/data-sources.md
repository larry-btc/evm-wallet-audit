# Data sources and bounded fallbacks

[简体中文](data-sources.zh-CN.md) · [Skill entry](../SKILL.md)

Source implementation notes checked: 2026-10-21. Online, consult relevant official documentation when needed: parameters, chain catalogs, prices, and availability may change. Do not rely on a fixed advertised chain count. For requested offline work, use the supplied materials and disclose the lack of live verification.

## Free default

- Discover assets with built-in search/web reading: a [DeBank public profile](https://debank.com/) at `/profile/<PUBLIC_ADDRESS>`, official explorers, and protocol pages. Run this alongside limited public RPC verification. Do not control a browser, desktop/native app, local tabs/windows, or the user's browsing session. The scripts do not scrape DeBank webpage holdings.
- `scripts/quick-audit.mjs` defaults to `rpc`: no DeBank key is read or used, no call goes to `pro-openapi.debank.com`, and no credential dialog opens. Native ETH on four chains, Base Virtuals, and explicitly supplied known token contracts use public HTTPS RPC without registration or signatures. They verify known assets; they do not replace broad asset discovery.
- Record only content actually read, the source, and its stated update time. Fetch time is not update time. Search snippets, cached pages, and historical snapshots are leads, not current holdings. Disclose unreadable filters, Wallet/protocol categories, hidden small assets, collapsed chains, and incomplete pagination. Zero Wallet spot balance does not exclude protocol principal; web valuation is not withdrawable value.
- A JS shell, loading screen, or read failure is a web-discovery gap. It proves neither site unavailability nor an empty wallet. Continue authorized public RPC checks of known contracts, without browser/UI takeover, CAPTCHA bypass, private signatures, new keys, or credit purchases.
- Keep web discovery inside the remaining first-round budget. An official explorer can be one bounded alternate source; otherwise deliver confirmed data and gaps. Free access does not guarantee complete or one-minute coverage.

## Public RPC

Requirements are **Node.js 22+ and system `curl`**. Run paths relative to the skill directory. The quick audit shares concurrency 6, a 40-second collection budget, and a 6-second per-request timeout across native balances, known tokens, and Virtuals. Quick audit caps the collection budget at 45 seconds. Completed data survives slower-item failures.

The system curl transport verifies HTTPS, disables personal curl configuration, and does not follow redirects. Request headers/body pass through child-process standard input rather than command arguments. The scripts do not load `.env`, install dependencies, or weaken TLS verification.

| ID | Network / chain ID | Bundled public endpoint | Source |
| --- | --- | --- | --- |
| eth | Ethereum / 1 | `https://ethereum-rpc.publicnode.com` | [Provider](https://ethereum.publicnode.com/) |
| base | Base / 8453 | `https://mainnet.base.org` | [Base](https://docs.base.org/get-started/connect-to-base) |
| arb | Arbitrum One / 42161 | `https://arb1.arbitrum.io/rpc` | [Arbitrum](https://docs.arbitrum.io/chain-info) |
| op | OP Mainnet / 10 | `https://mainnet.optimism.io` | [Optimism](https://docs.optimism.io/op-mainnet/network-information/connecting-to-op) |

Native reads verify `eth_chainId`, record `eth_blockNumber`, and call `eth_getBalance` at that fixed block. Only these four chains' native ETH is automatically checked by the collector; absent ERC-20/NFT/DeFi coverage is **not zero**. Unknown `--chains` identifiers stay unsupported rather than silently disappearing.

Repeat `--token chain:contract` for known ERC-20 contracts. This verifies network identity and reads `balanceOf` and `decimals` at a fixed block; it does not price tokens or scan history. `--protocols none` disables Virtuals. `scripts/collect-snapshot.mjs` is also usable independently but does not include the protocol-specific module. Quick audit adds Base VIRTUAL spot/current/legacy staking according to actual scope; its exit check uses state conditions and performs **no withdrawal simulation**.

When extending a chain, verify the current official RPC and chain ID before reading; use the [Ethereum JSON-RPC reference](https://ethereum.org/en/developers/docs/apis/json-rpc/) for methods. `eth_call` reads known contracts; it cannot enumerate arbitrary holdings. Indexers/events discover candidates, whose current balances still need verification. Record historical block/time ranges and pagination completeness.

Do not automatically loop retries. `DEADLINE_EXCEEDED` is the total deadline and `REQUEST_TIMEOUT` is one request timeout; neither means zero. Keep node errors, wrong chain IDs, invalid responses, and authentication failures as failures. The standalone collector's Node transport rejects disabled certificate verification with `TLS_VERIFICATION_DISABLED`. Restore normal verification only for the child process or use the quick audit's safe curl transport; do not change persistent environment configuration.

If Node cannot connect but system curl can validate the same endpoint, curl may be one bounded alternate read. Still verify chain ID and pin the balance to a recorded block; save evidence and name the transport. Never use `-k`/`--insecure`, put credential-bearing URLs/headers in arguments, or imply public-node availability is guaranteed.

## Optional advanced path: DeBank commercial API

**Use only after the user explicitly chooses this provider.** Default free checks do not ask for an AccessKey or spend an existing account's credits. `--provider auto/debank` and `scripts/query-with-debank.mjs` belong to this opt-in path.

Official references: [authentication/credits](https://docs.cloud.debank.com/en/readme/open-api), [chain catalog](https://docs.cloud.debank.com/en/readme/api-pro-reference/chain), [user assets/history](https://docs.cloud.debank.com/en/readme/api-pro-reference/user), and [console/pricing](https://cloud.debank.com/).

The adapter sends GET requests only to `https://pro-openapi.debank.com`:

| Purpose | Path | Meaning and limits |
| --- | --- | --- |
| Supported chains | `/v1/chain/list` | Map numeric chain IDs with `community_id`; failure leaves coverage unknown |
| Previously used chains | `/v1/user/used_chain_list` | A lead; omitted chains are not proof of no prior use |
| Wallet tokens | `/v1/user/all_token_list`, `is_all=true` | Provider-listed tokens, including non-core/derivative tokens; deduplicate |
| Protocol positions | `/v1/user/all_complex_protocol_list` | Supported protocols only, not arbitrary contracts |
| NFTs | `/v1/user/all_nft_list`, `is_all=true` | Provider coverage; reference prices are not executable bids |

Use provider `chain_ids` such as `eth/base/arb/op`, distinct from numeric chain IDs. Without `--chains`, the adapter uses the provider's default supported scope, not “all EVM chains.” The separate `complex_app_list` is **not integrated**; do not claim coverage of App protocols such as Hyperliquid through this adapter.

For an explicitly chosen commercial run, the collector can take `DEBANK_ACCESS_KEY` from the existing process environment and send it as the `AccessKey` header. Do not ask the user to paste a key in chat or create `.env`. If no runtime credential exists and the user explicitly requests connection, `scripts/query-with-debank.mjs` is an optional **macOS-only, manually invoked user utility**. Do not launch its UI from this skill. After the user confirms obtaining a key from the official console and runs it themselves, it presents its own local hidden-input dialog, retains the key only in process memory, forces DeBank mode, and does not mutate `process.env` or persistent settings. It does not read browser UI. Never pass the key as a script argument. Other platforms need an already authorized runtime credential; this helper is not cross-platform.

For acceptance, use one authorized address and chain with `--chains` and `--protocols none`. Read each endpoint's status and provider update time. RPC fallback success does not prove DeBank is connected. Report insufficient credits, authentication errors, and pending user input; never buy a plan automatically. If the user did not request setup, continue public read-only methods.

Protocol lists may be cached; the official source notes a worst case of 12 hours. Retain `update_at`; important specific positions may need the documented `/v1/user/protocol` or direct contract reads. Fast responses are not proof of current chain state.

`price=0` means no price data: preserve quantity as unpriced. A JSON-number `raw_amount` may lose integer precision during normal parsing; get exact integers from `balanceOf` when needed and do not label a floating-point parse as exact raw balance. Success with no items is limited to that provider/request scope. HTTP 401/403, 429, or invalid list/item structure is a failed read, not an empty wallet. The scripts save structurally validated data and bounded error codes, not request headers or upstream error bodies.

## Indexers, explorers, and special protocols

Use currently accessible official explorers/indexers and protocol documents; record actual source and scope, and verify important stale webpage balances on-chain. Blockscout's old keyless per-instance API is deprecated: consult its [current API documentation](https://docs.blockscout.com/devs/apis) for authentication/routes rather than copying obsolete bulk-scan endpoints.

Claims, locks, exit queues, unfinished bridge messages, and retired protocols require specific checks. Absence from an aggregator is not exclusion; a project's website alone does not establish a claimable amount. After one source fails, try at most one reasonable alternative for that question, then stop with a gap. A closed website, stopped network, readable contract, and recoverable funds are separate findings.
