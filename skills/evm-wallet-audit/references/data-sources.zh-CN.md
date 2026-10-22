# 数据源与有界降级

[English](data-sources.md) · [Skill 入口](../SKILL.zh-CN.md)

源实现说明核对日期：2026-10-21。联网时按需查阅相关官方文档：参数、链目录、价格和可用性可能变化，不依赖固定“支持 N 条链”的宣传。用户要求离线时只用所给材料，披露未实时复核。

## 免费默认路径

- 内置搜索/网页读取可查询 [DeBank 公开钱包页](https://debank.com/)的 `/profile/<PUBLIC_ADDRESS>`、官方区块浏览器及协议页，与有限 RPC 核验并行。不控制浏览器、桌面/原生应用、本机标签页/窗口或用户浏览会话。脚本不会抓取 DeBank 网页持仓。
- `scripts/quick-audit.mjs` 默认 `rpc`：不读取或使用 DeBank key、不访问 `pro-openapi.debank.com`、不打开凭据输入框。四链原生 ETH、Base Virtuals 和显式传入的已知代币走公开 HTTPS RPC，无需注册或签名。它们核实已知资产，不能代替广泛资产发现。
- 只记录实际读到的正文、来源和所载更新时间。抓取时间不等于更新时间。搜索摘要、缓存页、历史快照只作线索，不当成本次持仓。披露读不到的筛选、Wallet/协议分类、小额隐藏、折叠链及未完分页。Wallet 现货为零不能排除协议本金，网页估值不等于可提现金额。
- JS 空壳、加载框或读取失败是网页发现缺口，不证明网站不可用或钱包为空。可继续已授权的公开 RPC 已知合约核验，不接管浏览器/UI、不绕验证码、不提取私有签名、不申请 key 或购买额度。
- 网页发现控制在首轮剩余预算内，可用官方区块浏览器作一次有界替代；仍失败就交付确认项和缺口。免费不保证完整，也不保证一分钟内完成。

## 公开 RPC

运行需要 **Node.js 22+ 与系统 `curl`**，路径相对于 Skill 目录。快查在原生币、已知代币及 Virtuals 间共享并发 6、采集预算 40 秒、单请求超时 6 秒，快查总预算最多 45 秒。慢项失败不会抹掉已完成数据。

系统 curl 正常验证 HTTPS，禁用个人 curl 配置，不跟随重定向。请求头/正文经子进程标准输入传递，不进入命令参数。脚本不读取 `.env`、不安装依赖、不降低 TLS 校验。

| 标识 | 网络 / Chain ID | 内置公开节点 | 来源 |
| --- | --- | --- | --- |
| eth | Ethereum / 1 | `https://ethereum-rpc.publicnode.com` | [提供者](https://ethereum.publicnode.com/) |
| base | Base / 8453 | `https://mainnet.base.org` | [Base](https://docs.base.org/get-started/connect-to-base) |
| arb | Arbitrum One / 42161 | `https://arb1.arbitrum.io/rpc` | [Arbitrum](https://docs.arbitrum.io/chain-info) |
| op | OP Mainnet / 10 | `https://mainnet.optimism.io` | [Optimism](https://docs.optimism.io/op-mainnet/network-information/connecting-to-op) |

原生币先核对 `eth_chainId`，记录 `eth_blockNumber`，再在固定区块读 `eth_getBalance`。独立采集器只自动核验这四链原生 ETH；未覆盖的 ERC-20/NFT/DeFi **不是零**。未知 `--chains` 标识保留为不支持，不静默删除。

已知 ERC-20 可重复传 `--token 链标识:合约`，核对网络并在固定区块读 `balanceOf` 与 `decimals`，不报价、不扫描历史。`--protocols none` 关闭 Virtuals。`scripts/collect-snapshot.mjs` 可独立使用，但不含协议专项模块。快查按实际范围增加 Base VIRTUAL 现货及当前/旧版质押；退出检查仅判断状态条件，**不执行提现模拟**。

扩链先用当前官方资料核对 RPC 与链 ID，再按[以太坊 JSON-RPC 文档](https://ethereum.org/en/developers/docs/apis/json-rpc/)读取。`eth_call` 能查已知合约，不能枚举任意资产。索引器/事件负责发现候选，当前余额仍需核验。历史查询注明区块/时间范围和分页完成度。

不自动循环重试。`DEADLINE_EXCEEDED` 是总截止，`REQUEST_TIMEOUT` 是单请求超时，都不是零。节点错误、链 ID 不符、无效响应和认证失败均保留失败。独立采集器的 Node 传输发现证书验证被禁用时，以 `TLS_VERIFICATION_DISABLED` 拒绝请求。可仅为子进程恢复正常验证，或使用快查的安全 curl，不修改持久环境配置。

Node 无法连接而系统 curl 能验证同一节点时，可用 curl 作一次有界替代；仍核对链 ID、固定区块读余额，保存证据并说明传输工具。不用 `-k`/`--insecure`，不把带凭据 URL/请求头放进参数，不承诺公共节点必然可用。

## 进阶可选：DeBank 商业 API

**仅用户明确选择该供应商后使用。** 免费默认流程不询问 AccessKey，不消费已有账户额度。`--provider auto/debank` 与 `scripts/query-with-debank.mjs` 属于此可选路径。

官方资料：[认证/额度](https://docs.cloud.debank.com/en/readme/open-api)、[链目录](https://docs.cloud.debank.com/en/readme/api-pro-reference/chain)、[用户资产/历史](https://docs.cloud.debank.com/en/readme/api-pro-reference/user)、[控制台/价格](https://cloud.debank.com/)。

适配器只对 `https://pro-openapi.debank.com` 发送 GET：

| 目的 | 路径 | 含义与限制 |
| --- | --- | --- |
| 支持链 | `/v1/chain/list` | 通过 `community_id` 映射数字链 ID；失败则覆盖未知 |
| 用过的链 | `/v1/user/used_chain_list` | 仅线索，未返回不证明从未使用 |
| 钱包代币 | `/v1/user/all_token_list`，`is_all=true` | 供应商收录，含非核心及衍生代币；仍需去重 |
| 协议仓位 | `/v1/user/all_complex_protocol_list` | 仅支持协议，不是任意合约 |
| NFT | `/v1/user/all_nft_list`，`is_all=true` | 供应商覆盖，参考价不是可成交买盘 |

使用 `eth/base/arb/op` 等供应商 `chain_ids`，它们与数字链 ID 不同。未传 `--chains` 时使用供应商默认支持范围，不是“所有 EVM 链”。尚未接入独立 `complex_app_list`，不能宣称通过本适配器覆盖 Hyperliquid 等 App 协议。

明确选择商业查询后，采集器可从既有进程环境读取 `DEBANK_ACCESS_KEY`，放入 `AccessKey` 请求头。不让用户在聊天粘贴 key，不创建 `.env`。无运行时凭据且用户明确要求接入时，可选 **仅 macOS、由用户手动调用**的 `scripts/query-with-debank.mjs`。本 Skill 不启动它的 UI。用户确认已从官方控制台取得 key 并自行运行后，由脚本自己的本地隐藏输入框输入；仅保存在进程内存、强制 DeBank 模式、不改 `process.env` 或持久设置，不读取浏览器 UI。密钥不得用脚本参数传入。其他平台需要已授权的运行时凭据，该包装脚本不是跨平台实现。

验收用一个已授权地址、一条链，配合 `--chains` 与 `--protocols none`，读取各接口状态和供应商更新时间。RPC 降级成功不证明 DeBank 已接通。额度不足、认证失败或等待输入如实报告，不自动买套餐。用户未要求接入时继续公开只读方案。

协议列表可能缓存，官方来源说明最坏可达 12 小时。保留 `update_at`；重要特定仓位可需官方 `/v1/user/protocol` 或直接合约读取。响应快不证明链上状态实时。

`price=0` 表示无报价，保留数量并标为未计价。JSON number 的 `raw_amount` 经普通解析可能丢失大整数精度；需要精确整数时用 `balanceOf`，不把浮点解析结果标成精确原始余额。成功但空列表只限该供应商/请求范围。HTTP 401/403、429 或列表/元素结构异常是读取失败，不是空钱包。脚本只保存结构校验后的数据及受限错误码，不保存请求头或上游错误正文。

## 索引器、区块浏览器与专项协议

使用当前可访问的官方区块浏览器/索引器和协议资料，记录实际来源与范围，对重要的旧网页余额链上复核。Blockscout 旧免 key 单实例接口已弃用，使用前查[当前 API 文档](https://docs.blockscout.com/devs/apis)的认证和路由，不复制旧批量扫描接口。

待领取、锁仓、退出队列、未完成桥消息和停运协议需专项核验。聚合器未出现不能排除；项目网页自身不能证明可领取额。一种来源失败后最多选一个合理替代，仍无证据就停止该项并披露缺口。网页关闭、网络停运、合约可读和资金可取回是不同结论。
