# 中文文档未翻译文本报告

审计日期：2026-08-27

修复状态：已于 2026-08-27 复核并修正本报告列出的 129 行保守扫描候选文本。

> 本文档保留初始审计结果作为记录。修复后，结构验证正常通过。随后执行的更严格词汇审计仍检测到 133 个高置信度候选项，分布在 58 个文件中，其中包括 JSON/JSX 内的用户可见文本。因此，目前仍不能确认整个中文 locale 已完成翻译。

## 范围

- 审查目录：`content/docs/zh`
- 中文文件总数：239
- 中文 MDX 文档：229
- 英文文件总数：239
- `en` 与 `zh` 的文件结构完整且一致。
- 本报告关注用户可见的英文散文。产品名称、API 名称、标识符、代码、命令、路径、JSON 键以及必须原样保留的枚举值不计为翻译错误。

## 结论摘要

初始保守扫描检测到至少 129 行高概率未翻译或中英混合文本，分布在 47 个 MDX 文件中，共命中 324 个常见英语功能词。这些候选行现已逐项复核，并在属于用户可见散文时完成修正。

这是最低估计值。为了减少误报，扫描排除了代码块、行内代码、大部分 JSON/JSX 属性，并且通常要求一行至少出现两个常见英语词。因此，只包含一个英文残留词的混合句子可能没有计入。

## 检测到的英语词

下表仅统计上述 129 行候选文本。每个词仍需结合上下文判断，因为它可能出现在 SQL、标识符或 API 枚举中。

| 英语词 | 次数 | 英语词 | 次数 | 英语词 | 次数 |
| --- | ---: | --- | ---: | --- | ---: |
| get | 23 | the | 21 | to | 20 |
| if | 19 | and | 18 | not | 16 |
| is | 12 | or | 12 | for | 12 |
| no | 12 | at | 11 | where | 9 |
| select | 7 | with | 7 | of | 6 |
| use | 6 | on | 6 | from | 6 |
| after | 5 | last | 5 | set | 4 |
| available | 4 | create | 4 | in | 4 |
| add | 4 | are | 4 | all | 4 |
| open | 4 | uses | 3 | used | 3 |
| between | 3 | yes | 3 | that | 2 |
| your | 2 | run | 2 | most | 2 |
| each | 2 | make | 2 | this | 2 |
| do | 2 | once | 2 | creating | 2 |
| first | 2 | than | 2 | be | 2 |
| default | 2 | lets | 1 | using | 1 |
| when | 1 | it | 1 | want | 1 |
| click | 1 | needs | 1 | over | 1 |
| including | 1 | choose | 1 | ensure | 1 |
| before | 1 | does | 1 | both | 1 |
| only | 1 | its | 1 | allow | 1 |
| return | 1 | more | 1 |  |  |

人工复核还确认以下英语词被当作普通散文使用：`automatically`、`available`、`collection`、`companies`、`content`、`cost`、`data`、`documents`、`endpoint`、`evaluation`、`execution`、`integrates`、`operation`、`pagination`、`processed`、`required`、`response`、`search`、`services`、`supports`、`tasks`、`tool`、`trigger`、`workflow`。这些词在标识符或产品契约中可能有效，但不应替代正常的简体中文说明。

## 候选行最多的文件

| 文件 | 候选行数 |
| --- | ---: |
| `blocks/evaluator.mdx` | 12 |
| `blocks/parallel.mdx` | 11 |
| `blocks/router.mdx` | 9 |
| `blocks/api.mdx` | 9 |
| `tools/intercom.mdx` | 7 |
| `blocks/response.mdx` | 6 |
| `blocks/guardrails.mdx` | 6 |
| `tools/apollo.mdx` | 5 |
| `tools/grafana.mdx` | 5 |
| `tools/kalshi.mdx` | 4 |
| `tools/incidentio.mdx` | 4 |
| `tools/hunter.mdx` | 3 |
| `tools/elasticsearch.mdx` | 3 |
| `tools/gitlab.mdx` | 3 |
| `triggers/api.mdx` | 2 |
| `triggers/manual.mdx` | 2 |
| `blocks/wait.mdx` | 2 |
| `tools/google_drive.mdx` | 2 |
| `tools/google_slides.mdx` | 2 |
| `tools/zendesk.mdx` | 2 |
| `tools/postgresql.mdx` | 2 |
| `tools/index.mdx` | 2 |
| `tools/mysql.mdx` | 2 |

另外 24 个至少含一行候选文本的文件：

`indicators/inputs.mdx`、`triggers/webhook.mdx`、`triggers/generic.mdx`、`triggers/portfolio.mdx`、`knowledgebase/tags.mdx`、`blocks/human_in_the_loop.mdx`、`blocks/memory.mdx`、`copilot/index.mdx`、`tools/salesforce.mdx`、`tools/arxiv.mdx`、`tools/clay.mdx`、`tools/microsoft_planner.mdx`、`tools/fireflies.mdx`、`tools/youtube.mdx`、`tools/datadog.mdx`、`tools/asana.mdx`、`tools/dropbox.mdx`、`tools/greptile.mdx`、`tools/x.mdx`、`tools/wikipedia.mdx`、`tools/discord.mdx`、`tools/supabase.mdx`、`tools/huggingface.mdx`、`tools/calendly.mdx`。

## 已确认的代表性问题

| 位置 | 检测到的文本 | 问题 |
| --- | --- | --- |
| `indicators/inputs.mdx:8` | `该 namespace lets 你 define 参数 that users 可以 configure...` | 严重的中英混合句。 |
| `triggers/webhook.mdx:40` | `Get Webhook URL — Copy the automatically generated unique endpoint` | 整句未翻译。 |
| `triggers/generic.mdx:66` | `The trigger passes the full event payload to your workflow...` | 整句未翻译。 |
| `triggers/manual.mdx:17` | `使用 it 当你 want到执行 workflow immediately...` | 中英混合且难以理解。 |
| `triggers/manual.mdx:20` | `无配置 needed — 仅 click Run.` | 用户操作说明未翻译。 |
| `blocks/router.mdx:43` | `Intelligent content routing: Use AI to understand intent and context` | 标题和说明未翻译。 |
| `blocks/evaluator.mdx:43` | `Score Content Quality: Use AI to evaluate...` | 标题和说明未翻译。 |
| `blocks/response.mdx:49` | `Set Status Codes: Configure appropriate HTTP status codes...` | 标题和说明未翻译。 |
| `blocks/api.mdx:42` | `Connect to external services: Make HTTP requests...` | 标题和说明未翻译。 |
| `blocks/wait.mdx:38` | `Add time delays: Pause execution...` | 标题和说明未翻译。 |
| `blocks/parallel.mdx:152` | `Parallel Type: Choose between 'count' or 'collection'` | 普通说明未翻译；字面 API 值可以保留。 |
| `blocks/guardrails.mdx:48` | `Validate JSON Structure: Ensure LLM outputs are valid JSON...` | 标题和说明未翻译。 |
| `copilot/index.mdx:82` | `Today、Yesterday、This Week、Last Week、Older` | 可见时间分组标签未翻译；需确认是否必须与 UI 保持一致。 |
| `tools/arxiv.mdx:345` | `Integrates ArXiv... search... get... Does not require...` | 整段为中英混合文本。 |
| `tools/elasticsearch.mdx:1770` | `全部 its documents. 此 operation is irreversible.` | 关键的不可逆警告未完整翻译。 |
| `tools/apollo.mdx:1846` | `创建 up 到 100 contacts 在 once... Supports deduplication...` | 整段严重混合。 |
| `tools/intercom.mdx:1521` | `全部 companies... pagination support... larger than...` | 整段严重混合。 |
| `tools/greptile.mdx:100` | `查询 repositories 在 natural 语言和 get answers...` | 整段严重混合。 |
| `tools/index.mdx:10` | `工具 are powerful components... allow... interact...` | 工具章节的主要介绍未正确翻译。 |
| `tools/huggingface.mdx:150` | `Higher values make output more random` | 参数说明未翻译。 |

## 不应自动翻译的误报

- 协议及方法：`GET`、`POST`、`PUT`、`DELETE`、`PATCH`、`HTTP`、`API`、`SDK`、`MCP`。
- 产品和服务名称：`TradingGoose`、`PineTS`、`GitHub`、`Intercom`、`Apollo` 等。
- 标识符及字段名：`first_name`、`created_at`、`last_activity_at`、`single_select`、`user_id`。
- SQL 关键字和查询：`SELECT`、`FROM`、`WHERE`、`LIMIT`。
- API 要求的字面枚举值：例如 `yes`、`no`、`open`、`running`、`count`、`collection`。
- 代码、命令、路径、URL、环境变量以及代码块内容。
- 已确定的模块或功能专名，例如作为模块名称出现的 `Human in the Loop`；其周围说明仍应使用中文。

## 最终判断

中文 locale 在文件数量和结构上完整，本报告初始列出的 129 行也已完成上下文复核和必要修正。但更严格的后续扫描仍发现 133 个高置信度候选项，尤其是 JSON/JSX 中的用户可见标签、占位符和说明，因此内容翻译仍不能视为全部完成。不能通过全局替换完成修复，因为相同英语词可能既是未翻译散文，也可能是必须保留的技术契约。
