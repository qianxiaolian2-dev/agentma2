# 知识库配置

AgentMa 的知识库 v1 使用本地目录直读，也支持从页面真实上传文件到服务端本地知识库目录；不做切片、embedding 或向量库。Agent 运行时会把已启用的目录传给 Claude Agent SDK 的 `additionalDirectories`，并引导模型使用 `Glob`、`Grep`、`Read` 检索 markdown、文本、CSV 和上传 `.xlsx` 生成的 `.md` 表格摘要。

## 默认允许目录

未配置环境变量时，服务端只允许保存这些根目录下的知识来源：

```bash
$HOME/Documents
$HOME/Obsidian
$HOME/Notes
$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents
```

路径会先经过 `realpath` 解析后再比较，符号链接不能绕过白名单。

## 修改白名单

用 `AGENTMA_KNOWLEDGE_ROOT_ALLOWLIST` 覆盖默认值，多个根目录用冒号分隔：

```bash
export AGENTMA_KNOWLEDGE_ROOT_ALLOWLIST="$HOME/Documents:$HOME/Obsidian:/Volumes/WorkNotes"
npm run server
```

保存知识库来源时，路径必须存在、必须是目录、进程必须有读取权限，并且必须位于白名单根目录内。

## Obsidian vault 路径

在 Obsidian 里打开目标 vault 后，可以通过 Finder 的“显示简介”或终端 `pwd` 找到目录。常见路径示例：

```bash
/Users/xiaoqin/Obsidian/MainVault
/Users/xiaoqin/Documents/Notes
/Users/xiaoqin/Library/Mobile Documents/iCloud~md~obsidian/Documents/MainVault
```

多个 vault 可以在“知识库”页面添加多行，每一行配置一个名称和绝对路径。

## 页面上传

“知识库”页面支持直接选择文件或打开文件夹上传。当前支持 `.md`、`.markdown`、`.txt`、`.csv`、`.xls`、`.xlsx`：

- 文本、Markdown 和 CSV 会按原文件写入服务端知识库目录。
- `.xlsx` 会保留原文件，并额外生成同名 `.md` 表格摘要，例如 `report.xlsx.md`，方便 Agent 用 `Grep` 和 `Read` 检索。
- `.xls` 会保留原文件；旧版 Excel 二进制暂不生成表格摘要。
- 上传目录默认位于数据目录的 `knowledge-uploads/<tenant>/<uploadId>` 下，并自动注册为知识源。

## Agent 使用方式

1. 在左侧“知识库”页面添加并测试目录。
2. 保存来源。
3. 在 Agent 市场编辑模板，勾选“启用知识库”。
4. 对话时该 Agent 会获得已启用目录的只读访问范围，并优先用 `Glob`、`Grep`、`Read` 查找笔记内容。

## 只读保护

知识库来源保存为 `read_only=true`，这不仅是提示文案，而是**服务端强制的不变式**：

- Agent 运行时，凡是写文件的工具（`Write`、`Edit`、`MultiEdit`、`NotebookEdit`）只要目标路径落在任一只读知识目录内，都会在权限闸口被直接拒绝（`知识库目录为只读`）。
- 这道检查发生在租户权限策略**之前**，所以即使在 Permissions 页给这些工具配了 `allow`，也无法绕过。
- 单元校验见 `npm run smoke:knowledge-guard`（无需模型、秒级）。

**关于 `Bash`**：知识目录的写保护针对的是上述结构化写工具。`Bash` 能写到进程可达的任意位置（不限于 vault），属于通用风险，默认就需要人工确认（不在自动放行白名单内）。因此本设计不对 `Bash` 命令做正则解析式拦截——那样既脆弱又容易误判；若模板启用了 `Bash` 且你担心它改动笔记，依赖默认的人工确认即可，不要给 `Bash` 配 `allow` 策略。
