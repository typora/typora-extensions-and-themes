# Ignorance File Viewers

在 Typora 编辑区预览非 Markdown 文件。在文件树里点开文件即可，不需要任何权限。

文件树默认只列 Markdown 和纯文本，要显示其他文件，在设置 ▸ 文件把文件树过滤改为「全部文件」，重启 Typora。

| 类型 | 扩展名 | 预览方式 |
|---|---|---|
| 结构化数据 | json、yaml、yml、toml、xml | 可折叠的树，可切到源码；解析出错时显示错误并回到源码；大于 3MB 只显示源码 |
| 代码与网页 | html、htm、css、js、mjs、cjs、ts、tsx、jsx、py、java、go、rs、c、cpp、h、sh、zsh、sql、ini | 带行号和简易着色的源码，可编辑并保存（Tab 缩进、⌘S）；HTML 另有预览模式 |
| Office 文档 | docx、xlsx、pptx | 只读：docx 转为文档，xlsx 按工作表显示，pptx 按页显示文字 |

## 限制

- HTML 预览在沙箱 iframe 中渲染当前编辑内容，页面脚本不执行，相对路径的样式和图片不加载。
- 代码着色是简易正则，不处理 HTML 内嵌的 script 与 style。
- Office 只支持 docx、xlsx、pptx。xlsx 日期显示为序列号、公式只显示缓存值、不合并单元格；pptx 看不到图片与图表；docx 的页眉页脚、文本框会丢失。

## 第三方库

以下库取自各自的发布包，除 js-yaml 删去末尾的 sourceMappingURL 注释外未做修改，许可文本放在使用它的文件夹里。

| 库 | 版本 | 许可 | 用途 | 文件 |
|---|---|---|---|---|
| js-yaml | 4.3.2 | MIT | 解析 YAML | `viewers/data/js-yaml.js`（发布包的 `dist/js-yaml.js`） |
| smol-toml | 1.9.1 | BSD-3-Clause | 解析 TOML | `viewers/data/smol-toml/`（发布包的 `dist/*.js`） |
| JSZip | 3.10.2 | MIT | 解压 xlsx、pptx | `viewers/office/jszip.js`（发布包的 `dist/jszip.js`） |
| mammoth | 1.13.0 | BSD-2-Clause | docx 转 HTML | `viewers/office/mammoth.browser.js`（发布包的 `mammoth.browser.js`） |


## 许可

MIT，见 `LICENSE`。
