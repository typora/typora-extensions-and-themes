# Ignorance Knowledge Graphs

A side-panel graph of the notes in your workspace folder. Notes are nodes; `[[wiki]]` links, Markdown links and front-matter `parent:` / `up:` are edges. Everything is computed locally and no network access is requested. (The UI is in Simplified Chinese.)

用于 Typora 2.0 的工作区双链关系图。打开文件夹后建立索引，在侧栏「图谱」视图里查看当前笔记的局部图或整个工作区的全局图。

- 节点是工作区里的 Markdown 笔记，边来自 `[[wiki]]` 链接、Markdown 链接，以及 front matter 里的 `parent:` / `up:`。找不到目标的链接显示为虚线断链节点。
- 点击节点查看路径、属性、任务、复习卡片数、上级、下级、反向链接和出链。
- 搜索支持名称、`#标签`、`path:目录`，范围选择和搜索在同一个输入框里。顶部的「孤立 / 断链 / 待办」带数量，图标开关控制分组边界、层级线和箭头。
- 左侧目录树顶部的色条按目录显示笔记占比，点色条或目录前的色块只看这个目录，再点一次恢复。
- 笔记超过 60 篇时，孤立笔记不画在图上，收在画布左下角的「孤立 · N」胶囊里，点开后按名称列出。
- 图谱画布获得焦点后，方向键选中相邻方向最近的笔记，Esc 取消选择；全屏按钮或 Esc 进出全屏。
- 图谱计算全部在本机完成，不访问网络。

## 模型整理建议

默认关闭。在扩展设置里打开「图谱模型整理」后，点击详情里的「整理建议」，会把当前笔记的节选（默认最多 3000 字）和候选笔记路径发给「智能」设置里选定的模型，返回摘要、标签和可能关联的笔记。扩展不保存也不读取 API 密钥，结果只显示，不写回笔记。

## 权限

| 权限 | 用途 |
| --- | --- |
| `workspace: read` | 读取工作区里的 Markdown 文件，建立索引和链接关系 |
| `document: read` | 读取当前文档的路径和未保存内容，让当前笔记的图保持最新 |
| `ai` | 仅在打开「图谱模型整理」并点击「整理建议」时调用「智能」里已选的模型 |

没有 `network`、`process`、`clipboard`。索引缓存在扩展专用存储中。

升级时如果清单新增了权限，Typora 会在 设置 ▸ 扩展 里把本扩展标为「需要你的授权」，点「查看权限…」确认后图谱视图才会出现在「视图」菜单里。

## Vendored library

`vendor/js-yaml.js` is `dist/js-yaml.js` from js-yaml 4.3.2 (MIT license in `vendor/LICENSE-js-yaml.txt`), with only the trailing `sourceMappingURL` comment and trailing whitespace removed. It parses front matter. The long-line warning for this file is expected.
