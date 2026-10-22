# 聊天结果与可选导出

[English](report-contract.md) · [Skill 入口](../SKILL.zh-CN.md)

使用用户的语言，直接在聊天中交付有用结果。分清当前持有、协议资金、建议、历史线索与未查询/失败范围。结构适应任务，不堆空章节，也不让用户必须下载才看懂。

## 默认聊天交付

- 以一分钟内首轮为目标，标明**有限快查**及实际覆盖。这是目标，不是保证。准确报告耗时：采集耗时不是包含整理的聊天总耗时。来源慢或缺少聚合接入仍可交付部分结果，不能称“全部资产查完”。长历史、金库映射和陌生协议列为后续。
- 先写发现和优先下一步，说明参考估值范围。证据不足直接说明，余额不承诺可提现。
- 用紧凑表格，如 `链 / 资产或仓位 / 数量与参考价值 / 建议 / 理由或条件`。多钱包分别标明归属。
- 随后给优先级具体方案。每项确认资产/仓位，或约束相同的一组，需首选操作、理由、路径、当前前提、费用及风险。按[处理建议](handling-guidance.zh-CN.md)判断。退出条件未知时写先查什么，不伪造可执行路径。
- 在相关建议旁放已核实官方/区块浏览器链接及证据时间。入口未核实需标明，不能把陌生元数据链接当官方推荐。
- 末尾说明实际覆盖、失败和未查范围，缺口多可用小表。分开事实、推断及条件建议。小额可合并，但披露数量/筛选范围，能进一步展开，不静默只显示大额。
- 建议不等于执行。没有交易授权不妨碍提供方案；排查/建议请求不等于签名或转账授权。

## 仅要求导出/留档时保存

在**用户指定位置**新建唯一目录，按需保存：

- `snapshot.json`：原始查询输出，不把机器输出改称人工验证。
- `wallet-audit.md`：用用户语言写结论、逐地址明细、优先核查、范围与来源。
- `assets.csv`：可筛选逐项清单，保留钱包归属。
- 补充 JSON/证据摘录：URL、获取时间、网络、区块/时间范围及分页状态。不保存凭据、浏览器会话或无关个人信息。

脚本只生成快照；agent 根据真实证据准备聊天/报告/CSV，不编造示例资产。用新后缀，不覆盖旧文件。未要求导出时，会话内临时证据即可，可用 `os.tmpdir()` 与 `fs.mkdtemp()` 创建跨平台唯一临时目录。用户未明确要求公开分享时不上传地址清单。公开目录标题避免完整地址。

## 共用信息口径

- 保留所给完整公开地址、开始/结束时间与时区、实际数据服务。
- 分开钱包余额、协议资产/债务、NFT、待领取和未核实历史线索。确认项有建议，重要未知有具体检查，不把净值称为“找回”。
- 覆盖粒度为 `地址 × 链 × 资产类型 × 来源`。无链级数据就写供应商范围，不伪造逐链成功。使用 `found`、`no_results_in_scope`、`partial`、`failed`、`blocked`（缺接入/执行前提）、`not_queried`、`unsupported`、`unverified`。接口 success 只说明请求/结构通过，实际数据需另分类。
- 记录请求范围、区块/供应商更新时间、抓取时间、失败原因和未完成分页。支持链目录成功不证明未知链或协议已查。
- 独立 RPC 采集器只覆盖**四链原生 ETH**。快查按实际范围增加 Base VIRTUAL 现货/当前/旧版质押及显式代币合约。这是有限接入核验，不是全部代币/DeFi 发现。NFT、其他协议、历史和其他链实际查询前都保留缺口。

## 建议 `assets.csv` 字段

有证据才增加字段，未知留空并解释：

```text
wallet,chain_id,chain_name,category,contract_or_native,position_or_token_id,protocol,symbol,quantity,raw_amount,decimals,price_usd,reference_value_usd,debt_usd,valuation_status,evidence_level,coverage_status,source_url,source_pointer,source_updated_at,evidence_event_at,fetched_at,block_number,overlap_group,exit_constraints,next_check
```

- `category`：`native`、`token`、`defi`、`nft`、`claim` 或 `history_lead`。
- 身份包含钱包 + 数字链 ID + 合约/原生币标识 + 仓位/Token ID，不把跨链余额合成无链归属的 Ticker 数量。
- 合约/仓位 ID 缺失时留空，用 `source_pointer` 定位源记录并标记身份未完整核实，不编造链上标识。`evidence_event_at` 为历史事件时间，区别于供应商更新及抓取时间。
- `quantity`、`raw_amount`、`position_or_token_id` 保持字符串。原始单位/NFT ID 不用浮点，供应商数字未复核时注明精度未核实。
- `price_usd`、`reference_value_usd`、`debt_usd` 无依据留空，零须有真实来源。无报价不等于无价值。
- `evidence_level`：`provider_snapshot`、`onchain_read`、`cross_checked`、`historical_only`；只有保存实际 RPC/合约证据才用 `onchain_read`。
- `valuation_status` 可为 `reference_only`、`unpriced`、`excluded_overlap`、`not_applicable`，区分价格未知与是否纳入小计。
- 文本按 RFC 4180 转义。可能触发公式的不可信文本（`=`、`+`、`-`、`@`、前置制表符/回车等）加单引号前缀。数值列独立生成并校验。CSV 解析回读核对地址、行数及带逗号/换行的名称。

## 计价与去重

- 优先分类数量，可只给**已计价钱包资产参考小计**，不强求全钱包净值。
- 参考净值如需计算：独立钱包资产 + 协议底层资产 − 协议债务。已被 LP/aToken/cToken/金库底层代表的凭证排除重复。映射未明保留为可能重叠，暂停合计，不静默删除。
- `is_wallet=false` 不自动代表额外钱包现货。核对协议奖励是否已计入，不明确时单列、不重复加总。
- NFT 需持有证据，默认不计价。历史成交/地板价只是参考，不是当前可成交收入。
- 当前资格、金额和是否已领都核实后才确认待领取。可领不等于到账；费用/退出条件未知时不给“可提净额”。
- 疑似垃圾币/诱导 NFT 单列并说明依据，不访问元数据的陌生领取站。保留小额资产，无费用估算不确定断言费用高于价值。

## 交付前

核对来源、钱包归属、覆盖、时间、价格/债务和逐项建议。失败、无报价、历史交互但现余额未知必须可见。聊天本身须可理解和使用，仅要求导出时附绝对本地链接。
