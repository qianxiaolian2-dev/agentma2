# AgentMa Dashboard

当前 `dashboard/` 是一个前后端合一的单机部署项目：

- 前端：React + Vite
- 后端：Express
- 持久化：SQLite
- 线上地址：`https://dandelion.skin`

## 目录

- 接口文档：[`docs/api.md`](./docs/api.md)

## 本地运行

安装依赖：

```bash
npm install
```

启动后端：

```bash
npm run server
```

启动前端开发环境：

```bash
npm run dev
```

默认端口：

- 前端：`5173`
- 后端：`3001`

## 构建

仅构建前端静态资源：

```bash
npx vite build
```

说明：

- 仓库当前 `npm run build` 仍会受到现存 TypeScript 问题影响
- 线上部署实际依赖 `dashboard/dist/` 和本地常驻的 `server.ts`

## 数据位置

- SQLite：`~/Library/Application Support/agentma2/dashboard.sqlite`
- JWT Secret：`~/Library/Application Support/agentma2/jwt-secret`

## 聊天历史

聊天历史现在已落到 SQLite，不再以浏览器 `localStorage` 作为主存。

对应接口见：

- [`docs/api.md#4-聊天历史`](./docs/api.md)
