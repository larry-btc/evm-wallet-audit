# Virtuals 质押专项

[English](virtuals-staking.md) · [Skill 入口](../SKILL.zh-CN.md)

源说明核对日期：2026-10-20。用户提及 Virtuals 质押，或 VIRTUAL 持币/转账提供线索时使用。这是两个已识别的 **Base** 质押合约，不覆盖其他链及所有 Virtuals 生态协议。联网时按需重核官方配置、代理实现和 ABI；接口变化保留缺口，不沿用错误假设。

## 身份与来源

| 范围 | Base（8453）合约 | 身份依据 |
| --- | --- | --- |
| 底层 VIRTUAL | `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b` | 当前锁仓 `baseToken()` 与旧版 `depositToken()` |
| 当前 veVIRTUAL 锁仓 | `0x60a203ddcDE45fbfb325bdeEA93824B5726b4dF8` | [官方应用](https://app.virtuals.io/dashboard)的 StakingProvider/vevirtualAbi；[代理/源码](https://basescan.org/address/0x60a203ddcDE45fbfb325bdeEA93824B5726b4dF8#code) |
| 旧版 xVIRTUAL / TimeLockStaking | `0x33e34b8684565fcf6a9dd52a7e92c4e70211a045` | [旧应用](https://legacy.virtuals.io/)的 X_VIRTUAL_ADDRESS；[源码](https://basescan.org/address/0x33e34b8684565fcf6a9dd52a7e92c4e70211a045#code) |

[官方机制](https://whitepaper.virtuals.io/info-hub/usdvirtual-token-base-asset-for-ai-agents/usdvirtual-staking-and-vevirtual)为锁入 VIRTUAL 获得 veVIRTUAL。普通投票权随时间衰减，到期为零；自动最大锁定不同。**投票权不等于锁仓本金。**

## 当前合约只读核验

`scripts/quick-audit.mjs` 在共享截止内调用 `scripts/virtuals-staking.mjs`，读取本金、仓位、投票权及 VIRTUAL 现货，无需每次重查历史。自动首轮**不模拟提现**，保留 `not_performed`；状态退出条件不等于模拟成功。

核对链 ID，在记录的固定区块读取：

- `baseToken()` 确认底层代币。
- `numPositions(address)` 与 `getPositions(address,start,count)` 枚举仓位。最后一页 count 不超过剩余数量，避免此实现填充零值结构。结构为 `(amount,start,end,uint8 numWeeks,bool autoRenew,id)[]`，amount 为 18 位原始单位，时间为 Unix 秒。
- `stakedAmountOf(address)` 为本金合计，和全部仓位 amount 之和对账。
- `getMaturity(address,id)` 与 `adminUnlocked()` 判断当前到期/退出条件。`autoRenew=true` 时 maturity 是查询区块时间加 `maxWeeks` 周，持续顺延，**不是固定解锁日**。Extend/AutoRenew 变化后，最初 Stake 周数不能证明当前期限。
- `balanceOf(address)` 是 veVIRTUAL 投票权，单列且不加进本金。投票权为零不能排除已到期但未提取本金。

重要余额用独立节点在同一区块复核。后续专项可用只读 `eth_call`，以公开钱包作为 `from`，模拟 `withdraw(id)`，不发送交易。`Lock is not expired` 表示本次模拟失败，其他失败也不等于已验证可提取。不为这项额外检查拖延首轮。零仓位必须来自成功读取，不能源自 RPC 失败或代币列表缺失。

## 旧版与历史

按当前 ABI 读取 `depositToken()`、`getDepositsOfLength(address)`、`getDepositsOf(address)` 和 `getTotalDeposit(address)`。旧版无存款只排除该合约当前仓位。旧版 `isAdminUnlock()` 不适用于当前合约。已提取旧存款可能移出数组，空列表不证明从未质押。

历史和当前状态不一致时，用 VIRTUAL 转账和 Stake/Withdraw/Extend/AutoRenew 事件发现线索，再回到当前仓位核验。历史净流入支持对账，不能替代现状。查询某个 Agent 代币的同名质押不能排除 VIRTUAL 质押。

## 聊天结果与建议

逐仓位显示链、ID、本金、当前到期及其时区、自动续期状态、退出核验状态。VIRTUAL 现货与本金分开；合计须保证同一资产/时间口径并去重，绝不加投票权。

- 未到期通常需等待并说明自动续期影响；已经关闭时不建议再动开关。
- 此实现 `toggleAutoRenew(id)` **无论开启或关闭，都会从操作区块时间重设最大锁期**，不能建议切换后立即提现。
- 提现须自动续期关闭，**同时**满足到期或管理员解锁。`adminUnlocked=true` 不绕过自动续期要求。
- 到期后重核官方入口、Base ETH gas 与提现模拟，才给有条件退出方案。本专项不交易，不假设用户要卖币或延长锁仓。

空投资格和奖励另查。一般资格宣传不能证明该钱包可领。当前锁仓 ABI 没有奖励领取方法，不证明其他奖励为零。旧版迁移/退出页面不能作为当前合约退出方案。
