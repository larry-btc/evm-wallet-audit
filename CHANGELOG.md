# Changelog · 变更记录

## 0.1.0 — 2026-10-22

- Prepare a standalone Agent Skills package with English and Chinese docs, license, contribution/security guidance, and offline checks.
- Check native ETH on four chains, Base VIRTUAL spot/current/legacy staking, and explicit known-token contracts. Retain partial failures and unknown prices.
- Keep free RPC as the default in both public collectors, even when a runtime DeBank key exists. Commercial adapters remain explicit opt-in.
- Replace real-user regression positions with fully synthetic data; remove personal workspace paths and conventions from public instructions.

- 整理为独立 Skill 包，提供中英文文档、许可证、贡献/安全说明和离线检查。
- 支持四链原生 ETH、Base VIRTUAL 现货与新旧质押、显式已知代币；保留部分失败与未知价格。
- 两个公开采集入口均默认免费 RPC，已有 DeBank Key 不会自动启用商业接口。
- 真实用户仓位夹具全部改为合成样本，公开说明去除私人工作区路径与约定。
