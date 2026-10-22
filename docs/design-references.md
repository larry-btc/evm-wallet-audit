# Open-source design references · 开源做法调研

核对日期：2026-10-21。以下为公开仓库和官方格式文档的取样，不是热度排行榜，也不表示其设计适合全部照搬。仅借鉴组织与维护方法，没有把第三方 Skill 正文或源码复制进本项目。

## 参考了什么

| 样本 | 已核实做法 | 本项目采用 | 不照搬的部分 |
| --- | --- | --- | --- |
| [Anthropic Skills](https://github.com/anthropics/skills) | `skills/<name>/SKILL.md`，资源按需分层；插件市场将多个 Skill 分组；许可可能按 Skill 不同 | 自包含安装目录、清楚的用途和触发描述、按需参考资料 | 不建立多插件市场，不假定仓库内每份内容都可自由复制 |
| [OpenAI Skills](https://github.com/openai/skills) | 当前 README 已标记弃用，指向 [OpenAI Plugins](https://github.com/openai/plugins)；旧 Skill 使用独立许可和 `agents/openai.yaml` | 执行说明与客户端展示信息分离；安装目录自带许可 | 不把旧安装说明当当前默认；不为单 Skill 增加插件外壳 |
| [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills) | README 给出安装、用途和入口，部分测试/构建放在独立包中，有特定检查 workflow | 一条安装入口、明确覆盖、离线验证、独立开发工具 | 不增加 discovery 发布系统和自动打标签发布 |
| [Superpowers](https://github.com/obra/superpowers) | 除格式外，重视真实会话与行为测试；对不同客户端提供安装适配 | 增加失败、越界请求和条件建议的行为用例；声明实际验证范围 | 不接管用户全局工作方式，不强制与钱包排查无关的开发流程 |

取样时 GitHub REST `stargazers_count`：Anthropic 182,544、旧 OpenAI 28,201、Vercel 32,733、Superpowers 302,683。数值会变化，仅用于说明选取的是已有广泛关注的样本，不作为质量证明。对应[Anthropic 数据](https://api.github.com/repos/anthropics/skills)、[OpenAI 数据](https://api.github.com/repos/openai/skills)、[Vercel 数据](https://api.github.com/repos/vercel-labs/agent-skills)、[Superpowers 数据](https://api.github.com/repos/obra/superpowers)。

## 格式规范与维护惯例的区别

[Agent Skills 官方规范](https://agentskills.io/specification)要求 `SKILL.md` 包含 YAML 元信息与 Markdown 正文，`name` 和 `description` 必填；脚本、参考资料和素材目录是可选的。短主入口、按需加载细节是推荐方法。README、CI、双语文件、贡献说明和许可证属于公开分发的维护安排，不全是格式强制项。

`allowed-tools` 为实验字段，各客户端支持不同，不能把它当成只读沙箱。本项目用固定 RPC 读取方法、凭据默认关闭和离线回归限制实际脚本行为。指令与检查都不能替代运行环境的权限控制。

[官方写作建议](https://agentskills.io/skill-creation/best-practices)强调从真实任务中提炼经验、用实际执行改进，并减少无用上下文。因此英文 `SKILL.md` 作为唯一发现入口，中文翻译单独保存；模型不需要每次把两种语言重复加载。

## 许可与安全

“能在 GitHub 看见”不等于“可以复制后再开源”。例如 Anthropic 的 [webapp-testing 许可](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/LICENSE.txt)和 [docx 限制性许可](https://github.com/anthropics/skills/blob/main/skills/docx/LICENSE.txt)不同。Vercel README 声明 MIT，但本次 `main` 文件树未见独立根 LICENSE；本项目主动附完整许可，避免单独安装后不清楚授权。

本项目选择 [MIT](https://choosealicense.com/licenses/mit/)，允许商用、修改和分发，并要求保留版权与许可。根目录和安装目录放相同正文。协议数据和网站另有各自条款，不随本项目授权。

安全说明重点是公开地址与身份关联、外部服务可见请求、不可信代币元数据、禁止秘密或交易操作，以及不给虚假的私密报告入口。公开例子使用合成地址和合成仓位，避免从真实金额、仓位 ID 与精确时间反推出使用者。

## 主要原始资料

- Anthropic：[README](https://github.com/anthropics/skills/blob/main/README.md)、[Skill 例子](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md)、[插件清单](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json)。
- OpenAI：[弃用说明](https://github.com/openai/skills/blob/main/README.md)、[贡献与安全联系](https://github.com/openai/skills/blob/main/contributing.md)、[客户端展示配置](https://github.com/openai/skills/blob/main/skills/.curated/gh-fix-ci/agents/openai.yaml)、[当前插件结构](https://github.com/openai/plugins/blob/main/README.md)。
- Vercel：[README](https://github.com/vercel-labs/agent-skills/blob/main/README.md)、[React 检查](https://github.com/vercel-labs/agent-skills/blob/main/.github/workflows/react-best-practices-ci.yml)、[discovery workflow](https://github.com/vercel-labs/agent-skills/blob/main/.github/workflows/agent-skills-discovery.yml)、[安装工具文档](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)。
- Superpowers：[README](https://github.com/obra/superpowers/blob/main/README.md)、[行为测试](https://github.com/obra/superpowers/blob/main/tests/claude-code/README.md)、[MIT 许可](https://github.com/obra/superpowers/blob/main/LICENSE)。
- 本地 CI 的固定 action 版本来自 [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) 和 [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)；发布时仍需实际跑通 CI，不把配置文件存在当成远端通过。

## English summary

This package borrows self-contained skill directories and progressive references from Anthropic, separate client metadata and bundled licensing from the former OpenAI skills repository, clear installation and focused validation from Vercel, and behavior evaluation from Superpowers. The OpenAI skills repository is currently deprecated in favor of plugins; a plugin manifest is not a universal Skill requirement.

The Agent Skills specification requires a `SKILL.md` entry with name and description metadata. Bilingual READMEs, governance files, and CI are publishing choices. The English entry and separate Chinese translation avoid doubling every agent invocation. A full MIT license is bundled at both levels. Only structure and maintenance ideas were adopted; third-party skill implementations were not copied. Popularity is not a security or quality guarantee.
