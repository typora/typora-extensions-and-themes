# Ignorance Advanced

给 Typora 增加演示面板、行内徽章与彩色高亮、图表索引侧栏、中英文空格格式化，以及汇报模板。

## 内容

| 功能 | 说明 |
|---|---|
| 演示面板 | 在详情栏把当前文档按 `---` 或标题分页；支持版式注释、脚注、图标短码、KaTeX 公式；可全屏放映 |
| 演示里的图表 | 内置绘制，不依赖图表库。` ```chart ` 代码块使用 Typora 官方图表扩展的格式（`type`、`title`、`series` 加数据行），支持 bar、line、pie，其他类型显示源码并给出原因 |
| 演示里的 Mermaid 图 | 内置绘制。支持流程图（`graph` / `flowchart`：节点、箭头、连线文字、回路、嵌套 `subgraph`）、序列图（参与者、消息、注释、激活、`autonumber`、`loop` / `alt` / `opt` / `par` 块）、饼图、甘特图（分组、`done` / `active` / `crit` / `milestone`、`after`、天周小时时长，仅 `YYYY-MM-DD`），其他 Mermaid 图显示为源码并给出原因 |
| 行内徽章与高亮 | `((green:构建 \| 通过))`、`((spoiler:...))`、`((ruby:...))`、`((crumb:...))`，以及 🔴🟠🟢🔵🟣 彩色高亮 |
| 图表与图片侧栏 | 按标题列出文档里的代码块、表格、公式与图片 |
| 格式化 | 中英文之间加空格 |
| 片段与模板 | 徽章片段；汇报模板 |

编辑器里的 ` ```mermaid ` 由 Typora 自带渲染，` ```chart ` 由官方图表扩展渲染，格式相同。

## 权限

只声明 `document: read`，用于演示面板和侧栏读取当前文档，不联网，不写文件。

## 第三方库

以下库取自各自的发布包，除 Lucide 数据文件加了 `export default` 前缀外未做修改，许可文本放在同一文件夹。

| 库 | 版本 | 许可 | 用途 | 文件 |
|---|---|---|---|---|
| KaTeX | 0.16.11 | MIT | 演示里的数学公式 | `vendor/katex/` |
| Lucide（`@iconify-json/lucide`） | 1.2.136 | ISC | 演示里的图标短码 | `vendor/lucide-icons.js`（发布包的 `icons.json`，前面加了 `export default` 以便按模块加载，数据与发布包逐项一致） |

两者是上游发布的压缩版本；本扩展自己的代码都是可读源码。
