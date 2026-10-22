# EVM 钱包资产排查

[English](README.md) · 简体中文

输入公开 EVM 钱包地址，直接在聊天中获得余额、已支持的质押仓位、推荐处理方案、证据和查询缺口。它是一个只读的 Agent Skill。

**首版覆盖有限。** 默认使用免费公开数据，不连接钱包、不需要私钥、不签名、不转账。用于资产盘点，不是智能合约安全审计或被盗资金追回服务。

## 实际能查什么

| 范围 | 免费脚本首轮已接入 |
| --- | --- |
| 原生 ETH | Ethereum、Base、Arbitrum One、Optimism |
| Base 上的 VIRTUAL | 现货余额、Virtuals 当前与旧版质押合约 |
| 其他 ERC-20 | 通过 `--token` 明确提供的合约；不会自动发现所有代币 |
| 其他 DeFi、NFT、奖励、历史 | 由 agent 根据可读取的公开资料补查，尚无自动或全量发现 |

Agent 可以用内置搜索和网页读取查阅 DeBank、区块浏览器和协议页面，但动态网页可能读不到资产内容。**脚本没有自动抓取 DeBank 免费网页资产列表。** 读不到和未接入的范围会明确保留为缺口，请求成功不代表钱包为空或已全部查完。

默认给采集 40 秒，争取约 1 分钟内交付首轮聊天结果。网络和模型整理可能超时，历史深查需要更多时间；不承诺全链、全协议或必定一分钟完成。

## 使用条件

- 支持 Agent Skills 且能够运行本地脚本的客户端。发现资产和核实当前处理路径还需要内置搜索、网页读取能力；Skill 不需要也不会接管浏览器。
- 脚本需要 Node.js 22+ 和系统 `curl`。下面可选的第三方安装工具目前要求 Node.js 22.20+。
- 能访问公开 RPC 节点。默认排查不需要 API Key，也没有 npm 包依赖。

## 安装

使用 [Skills CLI](https://github.com/vercel-labs/skills/blob/main/docs/commands.md) 从 GitHub 安装：

```bash
npx skills add larry-btc/evm-wallet-audit --skill evm-wallet-audit
```

按提示选择客户端，默认安装在当前项目。也可以把整个 `skills/evm-wallet-audit` 目录复制到客户端文档指定的 Skill 目录，保留脚本、参考资料和 `LICENSE.txt`，不需要修改全局设置。

如已下载或克隆本仓库，文件夹命名为 `evm-wallet-audit`，也可以在其上一级目录安装本地副本：

```bash
npx skills add ./evm-wallet-audit --skill evm-wallet-audit
```

目录遵循 Agent Skills 格式，尚未逐个验证各客户端的完整安装体验。`agents/openai.yaml` 只提供 Codex 展示信息；当前独立包不需要额外插件或市场注册。

## 在聊天中使用

把占位符换成要查询的公开地址：

```text
用 $evm-wallet-audit 排查 <公开 EVM 地址>，特别检查 Virtuals 质押。
直接在聊天中给出资产清单、推荐处理方案、证据和未覆盖范围，使用免费来源。

Use $evm-wallet-audit to check <PUBLIC_EVM_ADDRESS>. Give me the asset list,
recommended handling, sources, and coverage gaps here in chat.
```

每批最多 5 个不同地址，回复跟随用户语言。根据当前证据，建议可能是保留 gas、等待解锁、先核实赎回路径、检查债务风险或暂不交互，不预设全部卖出或退出。

可以先看[中英文合成结果示例](examples/sample-report.md)。它只展示交付样式，不是真实链上结果，也不代表资产已可提取。

## 可选：独立运行采集脚本

在仓库根目录运行：

```bash
node skills/evm-wallet-audit/scripts/quick-audit.mjs --help
node skills/evm-wallet-audit/scripts/quick-audit.mjs YOUR_PUBLIC_EVM_ADDRESS --provider rpc
```

把 `YOUR_PUBLIC_EVM_ADDRESS` 替换为实际公开地址；占位符故意不是有效地址。脚本向终端输出 JSON 快照，由 agent 整理聊天报告和建议。单独运行脚本不会自动发现全部资产，也不会自动产出完整处理建议。

| 参数 | 用途 |
| --- | --- |
| `--chains eth,base,arb,op` | 限定查询链 |
| `--protocols none` | 关闭 Base Virtuals 专项 |
| `--token base:CONTRACT` | 复查已知 ERC-20 合约，可重复传入，最多 20 项 |
| `--deadline-ms 40000` | 采集预算；快查最多接受 45,000 毫秒 |
| `--concurrency 6` | 全来源共享并发上限，范围 1–12 |
| `--output NEW_FILE.json` | 明确导出到本地新文件；拒绝覆盖旧文件 |

退出码 `0` 包括成功与**部分成功**；`2` 表示没有成功或部分成功的采集；`1` 表示输入、输出或内部错误。必须继续查看 JSON 中的状态、逐来源错误和覆盖范围。整数金额保持字符串，无报价保留未知，快照不自动计算钱包总净值。

进阶可选：保留 DeBank Cloud 适配器，只有明确选择 `--provider auto` 或 `--provider debank` 且另行授权使用运行时凭据才启用。两个采集入口默认都为 `rpc`，忽略已有的 DeBank Key。Cloud 可能需要付费套餐。`query-with-debank.mjs` 是仅支持 macOS 的手动密钥弹窗工具，不属于 Skill 默认流程，Skill 不得主动调用本机界面。详见[数据源说明](skills/evm-wallet-audit/references/data-sources.zh-CN.md)。

## 隐私与边界

只接受公开地址。公开服务能够看到查询地址与网络请求，不能提供匿名保证。排查不需要私钥、助记词、钱包连接、代币授权或交易；脚本不会上传或公开分享报告。

代币元数据和链接不可信，处理入口需单独核实。RPC 失败不等于余额为零，投票权不等于质押本金，报价不证明可卖出或赎回；首轮不进行退出模拟。详见[安全说明](SECURITY.md)和[结果口径](skills/evm-wallet-audit/references/report-contract.zh-CN.md)。

## 开发与验证

```bash
npm run check
```

无需 `npm install`。检查会运行离线回归测试，并验证元信息、必要文件、双语链接、合成地址夹具、私人路径和只读 RPC 方法。这是有限的发布检查，不是完整密钥扫描器或安全认证。[行为用例](tests/behavior-cases.md)覆盖仅靠代码测试不能证明的聊天表现。

本地检查环境为 macOS、Node.js 25.8.2、curl 8.7.1。[CI 模板](docs/ci-checks.example.yml) 的覆盖目标为 Ubuntu/macOS、Node 22/24，目前尚未启用；有 workflow 权限的维护者可将其放到 `.github/workflows/checks.yml`。Windows、远端 CI 执行和其他客户端的完整安装体验尚未验证。

- [贡献方式](CONTRIBUTING.md)
- [变更记录](CHANGELOG.md)
- [开源做法调研](docs/design-references.md)
- [中文 Skill 说明](skills/evm-wallet-audit/SKILL.zh-CN.md) · [English instructions](skills/evm-wallet-audit/SKILL.md)

## 许可

按 [MIT](LICENSE) 授权，独立安装目录也附带[相同许可证](skills/evm-wallet-audit/LICENSE.txt)。协议名称、外部网站和数据仍适用各自权利与服务条款。本项目独立开发，不代表 DeBank、Virtuals、OpenAI、Anthropic 或 Vercel 的认可或背书。
