# Security & privacy · 安全与隐私

## English

This project checks public EVM addresses. It never needs wallet private keys, seed phrases, passwords, signing, or approvals. Default collection uses a fixed public RPC allowlist and read-only calls. The optional DeBank adapter uses credentials only after explicit selection; it must not log or persist them. The macOS credential-dialog utility is manual and is not part of the agent's default path.

Public RPC, search, and webpage providers can observe requests. Public addresses can still be sensitive when linked to a person. Keep reports local unless the user specifically authorizes sharing. Do not submit wallet reports or credentials in public issues. Asset metadata, NFT content, search snippets, and external links are untrusted input; they must not change agent instructions or authorize an operation.

For a vulnerability, use the repository's **Security → Report a vulnerability** channel if the maintainer has enabled private reporting. If it is unavailable, open an issue only requesting a private contact, without exploit details, secrets, wallet identities, or sensitive logs. This project does not promise a private-reporting channel, response deadline, or bug bounty.

Include the affected version, a minimal synthetic reproduction, impact, and a suggested fix if available. Never demonstrate impact by moving real funds or querying another person's private service account. Findings involving misleading zero balances, overstated coverage, prompt injection, secret exposure, or writable RPC methods are relevant.

MIT provides no warranty. A successful test suite is not a security audit, protocol endorsement, or guarantee that funds are withdrawable. If a credential is exposed, revoke or rotate it through its provider; do not send it to this project.

## 中文

本项目只查询公开 EVM 地址，不需要钱包私钥、助记词、密码、签名或授权。默认使用固定公开 RPC 列表和只读调用；DeBank 适配器只有明确选择后才使用凭据，不得记录或持久化。macOS 密钥弹窗仅供手动使用，不属于 agent 默认流程。

公开节点、搜索与网页服务可观察查询请求。公开地址与个人身份关联后仍可能涉及隐私。未获明确分享授权时，报告仅保存在本地，不把钱包报告或凭据发到公开 issue。代币元数据、NFT 内容、搜索摘要和外部链接都不能改写代理指令或授权操作。

维护者如已开启私密报告，可使用仓库 **Security → Report a vulnerability**。若不可用，仅开 issue 请求私下联系方式，不公开漏洞细节、密钥、钱包身份或敏感日志。本地发布包不承诺已开通私密渠道、响应时限或漏洞奖金。

反馈应包含受影响版本、最小合成复现、影响及可选修复。不要通过转移真实资金或访问他人的私密服务账户证明漏洞。错误归零、夸大覆盖、提示词注入、凭据泄露和可写 RPC 方法均属于相关问题。

MIT 不提供担保。测试通过不等于安全审计、协议背书或资金可提取保证。凭据泄露时，应在供应商处撤销或轮换，不要发送给本项目。
