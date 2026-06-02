# 知识库配置

AgentMa 的知识库 v1 使用本地目录直读，不做上传、切片、embedding 或向量库。Agent 运行时会把已启用的目录传给 Claude Agent SDK 的 `additionalDirectories`，并引导模型使用 `Glob`、`Grep`、`Read` 检索 markdown 笔记。

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

## Agent 使用方式

1. 在左侧“知识库”页面添加并测试目录。
2. 保存来源。
3. 在 Agent 市场编辑模板，勾选“启用知识库”。
4. 对话时该 Agent 会获得已启用目录的只读访问范围，并优先用 `Glob`、`Grep`、`Read` 查找笔记内容。

知识库来源保存为 `read_only=true`。v1 的知识库能力面向读取笔记，不会主动向 vault 写入内容。
