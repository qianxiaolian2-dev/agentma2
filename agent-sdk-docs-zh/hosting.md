# 托管 Agent SDK

> 在生产环境中部署和托管 Claude Agent SDK

## 托管要求

### 基于容器的 Sandboxing

为了安全性和隔离，SDK 应在沙箱容器环境中运行。

### 系统要求

每个 SDK 实例需要：
- Python 3.10+ 或 Node.js 18+
- 推荐：1GiB RAM、5GiB 磁盘和 1 个 CPU
- 出站 HTTPS 到 `api.anthropic.com`

## 理解 SDK 架构

Claude Agent SDK 作为长运行进程运行，该进程：
- 在持久 shell 环境中执行命令
- 在工作目录中管理文件操作
- 处理工具执行，包含来自先前交互的上下文

## Sandbox 提供商选项

- Modal Sandbox
- Cloudflare Sandboxes
- Daytona
- E2B
- Fly Machines
- Vercel Sandbox

## 生产部署模式

### 模式 1：临时会话
为每个用户任务创建一个新容器，然后在完成时销毁它。最适合一次性任务。

### 模式 2：长运行会话
为长运行任务维护持久容器实例。最适合主动代理。

### 模式 3：混合会话
临时容器，使用历史和状态进行补充。最适合与用户进行间歇性交互。

### 模式 4：单个容器
在一个全局容器中运行多个 Claude Agent SDK 进程。最适合必须紧密协作的代理。

## 常见问题

### 我如何与我的 sandboxes 通信？
暴露端口以与您的 SDK 实例通信。

### 托管容器的成本是多少？
最低成本大约是每小时运行 5 美分，主要成本是令牌。

### 代理会话在超时前可以运行多长时间？
代理会话不会超时，但建议设置 `maxTurns` 属性。
