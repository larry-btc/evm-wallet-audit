# Contributing · 贡献

## English

Useful contributions include a verified protocol reader, clearer coverage reporting, failure-case tests, or documentation corrections. Discuss a substantial new chain or integration before building it.

- Keep the default free, read-only, and usable without credentials. Any commercial integration must be explicit opt-in. Never add wallet signing, transactions, browser takeover, or secret discovery.
- For protocol support, document chain ID, official contract identity, ABI/source links, read methods, fixed-block behavior, pagination, principal/receipt mapping, debt, and exit conditions. Never infer an empty wallet from errors or missing indexer records.
- Use synthetic fixtures, including position IDs, quantities, dates, and block numbers. Do not submit a user's wallet history, reports, keys, browser state, or personal paths. Public protocol contracts are appropriate evidence.
- Keep English and Chinese documentation aligned. `skills/evm-wallet-audit/SKILL.md` is the executable entry; `SKILL.zh-CN.md` is its translation. Load detailed references only when needed.
- Run `npm run check` without installing packages or querying private wallets. For behavior changes, exercise the relevant [agent cases](tests/behavior-cases.md). Describe the trigger, resulting behavior, evidence, and checks in the pull request.

Adding an API call does not establish all-chain coverage, actual liquidity, or withdrawability. Say what remains unverified. Avoid unrelated changes and generated reports. See [security reporting](SECURITY.md) for vulnerabilities.

## 中文

欢迎补充已核实的协议读取器、覆盖状态改进、失败用例和文档修正。新增大范围链支持或集成前，先讨论范围。

- 默认免费、只读、无需凭据；商业接口必须明确选择。不要加入签名、交易、浏览器接管或搜索密钥的能力。
- 新协议说明链 ID、官方合约身份、ABI/源码来源、读取方法、固定区块、分页、本金与凭证映射、债务和退出条件。错误或索引缺失不能推断钱包为空。
- 夹具全部使用合成的地址、仓位 ID、数量、日期与区块。不要提交用户历史、报告、密钥、浏览器状态或私人路径；公开协议合约可以作为证据。
- 英文和中文文档同步维护。`skills/evm-wallet-audit/SKILL.md` 是执行入口，`SKILL.zh-CN.md` 为翻译；细节放在按需读取的参考资料中。
- 无需安装依赖，运行 `npm run check`，不查询私人钱包。行为变更补充相关[代理用例](tests/behavior-cases.md)。PR 说明触发问题、最终行为、证据和验证。

新增一个接口不等于全链覆盖、真实流动性或可提现能力。明确未知项，不混入无关改动和生成的报告。漏洞按[安全说明](SECURITY.md)反馈。
