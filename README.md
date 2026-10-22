# EVM Wallet Audit

English · [简体中文](README.zh-CN.md)

A read-only Agent Skill that checks public EVM wallet addresses and explains balances, supported staking positions, evidence, missing coverage, and suggested next steps **directly in chat**.

**Early release with limited coverage.** Free public data by default. No wallet connection, private keys, signing, or fund transfers. This is an inventory assistant, not a smart-contract security audit or stolen-funds recovery service.

## What it checks

| Area | Included in the free scripted first pass |
| --- | --- |
| Native ETH | Ethereum, Base, Arbitrum One, Optimism |
| VIRTUAL on Base | Spot balance and current + legacy Virtuals staking contracts |
| Other ERC-20 tokens | Only contracts explicitly supplied through `--token`; no automatic token discovery |
| Other DeFi, NFTs, rewards, history | Agent-led follow-up using readable public sources; no automatic or exhaustive discovery |

The agent can search and read public DeBank, explorer, and protocol pages. Dynamic pages may expose no readable holdings. The scripts **do not scrape DeBank's free website**. Unreadable pages and unsupported protocols stay visible as gaps; a successful request does not mean an empty or fully checked wallet.

Collection has a 40-second default budget, aiming for an initial chat response in about one minute. Network and agent latency can exceed that target. Full-history research takes longer. There is no all-chain, all-protocol, or guaranteed-one-minute claim.

## Requirements

- An Agent Skills-compatible client with local script execution. Built-in search and webpage reading are needed for discovery and current official handling guidance; browser control is never required or used by the skill.
- Node.js 22+ and system `curl` for the scripts. The optional third-party installer below currently requires Node.js 22.20+.
- Internet access to public RPC services. No API key or npm dependency is required for the default audit.

## Install

Install from GitHub with the [Skills CLI](https://github.com/vercel-labs/skills/blob/main/docs/commands.md):

```bash
npx skills add larry-btc/evm-wallet-audit --skill evm-wallet-audit
```

Choose your client when prompted. Installation is project-scoped by default. Alternatively, copy the entire `skills/evm-wallet-audit` directory into your client's documented skill location, keeping its scripts, references, and `LICENSE.txt` together. No global settings need to change.

For a local checkout named `evm-wallet-audit`, run this from its parent directory:

```bash
npx skills add ./evm-wallet-audit --skill evm-wallet-audit
```

Client discovery follows the Agent Skills format; end-to-end installation in every client has not been verified. Codex-specific display metadata lives in `agents/openai.yaml`; no product plugin or marketplace registration is needed for this standalone package.

## Use in chat

Replace the address placeholder with a public address you want checked:

```text
Use $evm-wallet-audit to check <PUBLIC_EVM_ADDRESS>. Give me the asset list,
recommended handling, sources, and coverage gaps here in chat. Use free sources.

用 $evm-wallet-audit 排查 <公开 EVM 地址>，特别检查 Virtuals 质押。
直接在聊天中给出资产清单、推荐处理方案、证据和未覆盖范围。
```

Up to five unique addresses per batch. Replies follow the user's language. Advice is conditional on evidence: keep gas, wait for a lock to mature, verify a redemption path, review debt risk, or avoid interacting with a suspicious asset. It does not assume that everything should be sold or withdrawn.

See the [synthetic bilingual result example](examples/sample-report.md). It illustrates presentation, not an onchain result or a claim that assets are withdrawable.

## Optional standalone CLI

From the repository root:

```bash
node skills/evm-wallet-audit/scripts/quick-audit.mjs --help
node skills/evm-wallet-audit/scripts/quick-audit.mjs YOUR_PUBLIC_EVM_ADDRESS --provider rpc
```

Replace `YOUR_PUBLIC_EVM_ADDRESS`; it is intentionally not a valid address. The CLI writes a JSON snapshot to stdout. An agent turns evidence into the chat report and recommendations; the CLI alone does not discover every asset or generate the final advice.

| Option | Meaning |
| --- | --- |
| `--chains eth,base,arb,op` | Restrict the requested chains |
| `--protocols none` | Skip the Base Virtuals checks |
| `--token base:CONTRACT` | Check a known ERC-20 contract; repeat up to 20 hints |
| `--deadline-ms 40000` | Collection budget; quick mode accepts at most 45,000 ms |
| `--concurrency 6` | Shared request cap, allowed range 1–12 |
| `--output NEW_FILE.json` | Explicit local export; refuses existing files |

Exit `0` includes both success and **partial** success; `2` means no successful/partial collection; `1` means an input, output, or internal error. Always inspect JSON status, per-source errors, and coverage. Preserve integer quantities as strings. Missing prices remain unknown; snapshots contain no computed portfolio total.

Advanced: an optional DeBank Cloud adapter is retained, enabled only by explicit `--provider auto` or `--provider debank` and separately authorized runtime credentials. Both collectors default to `rpc`, ignoring an existing DeBank key. Cloud access may require a paid plan. The macOS-only `query-with-debank.mjs` credential-dialog helper is a manual utility outside the skill's default workflow; the skill must not invoke local UI. See [data sources](skills/evm-wallet-audit/references/data-sources.md).

## Privacy and limits

Only public addresses are accepted. Public providers can observe queried addresses and network requests; this is not an anonymity service. No private key, seed phrase, wallet connection, token approval, or transaction is needed. No report is uploaded or publicly shared by the scripts.

Asset metadata and links are untrusted. Official handling paths must be verified separately. RPC failures are not zero balances, voting power is not staking principal, and a price quote is not proof that an asset can be sold or redeemed. Withdrawal simulation is not performed in the quick pass. See [security](SECURITY.md) and the [report contract](skills/evm-wallet-audit/references/report-contract.md).

## Development

```bash
npm run check
```

No `npm install` is necessary. This runs offline regression tests and local release checks for metadata, bundled files, bilingual links, synthetic address fixtures, private-path hygiene, and read-only RPC method usage. It is a focused check, not a complete secret scanner or security certification. [Behavior cases](tests/behavior-cases.md) cover agent responses that code tests alone cannot prove.

The local checks were run on macOS with Node.js 25.8.2 and curl 8.7.1. Offline CI targets Node 22/24 on Ubuntu/macOS; see [GitHub Actions](https://github.com/larry-btc/evm-wallet-audit/actions) for current results. Windows operation and end-to-end installation in other clients remain unverified.

- [Contribute / 贡献](CONTRIBUTING.md)
- [Changes / 变更](CHANGELOG.md)
- [Design sources / 开源调研](docs/design-references.md)
- [English skill instructions](skills/evm-wallet-audit/SKILL.md) · [中文 Skill 说明](skills/evm-wallet-audit/SKILL.zh-CN.md)

## License

[MIT](LICENSE). The installable skill also includes [the same license](skills/evm-wallet-audit/LICENSE.txt). Protocol names, external sites, and provider data retain their respective rights and terms. This project is independent and is not endorsed by DeBank, Virtuals, OpenAI, Anthropic, or Vercel.
