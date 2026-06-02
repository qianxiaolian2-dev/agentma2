# PLAN:修 cwd TTL 清理误删长期 resume session 的 cwd

> 性质:bug 修复 + 防御性设计
> 风险:高(目前用户保存超过 7 天的 chat session,resume 时会随机断,且无报错)
> 工作量:小(~30 行代码,1 个 smoke)

---

## 1. 现象 / 根因

`server-agent.ts:221` 的 `cleanupExpiredRunCwds(excludeCwd)`:
- 每次 runAgent 启动后调一次(rate-limited 1 小时一次)
- 删 `/tmp/agentma-run-*` 名下、mtime 超过 7 天的目录
- 只 exclude **当前** run 的 cwd

但 **`chat_sessions.sdk_cwd` 引用的目录**(用户的长期会话用来 SDK transcript resume)**没在 exclude 列表里**。

后果:
- 用户在 5 月 30 日聊了一次,sdk_cwd 写入了 `/tmp/agentma-run-A-...`
- 8 天后他想继续这个会话 → 点"继续",前端发 `sdkSessionId + sdkCwd` 给后端
- runAgent 把 sdkCwd 作为 cwd,但目录已经被 TTL 清理了
- SDK resume 找不到 transcript `<cwd-key>/<session>.jsonl`,**静默退化成 fresh session**,用户感觉"agent 忘了之前的对话"

R5 验收报告里我已经识别这个 bug,本 PLAN 修它。

---

## 2. 修法(2 处改动)

### 2.1 `server-store.ts` 新增 1 个函数

```ts
/** 所有正被某个 chat_sessions 引用的 sdk_cwd(去重)。 */
export function listReferencedSdkCwds(): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT sdk_cwd
    FROM chat_sessions
    WHERE sdk_cwd IS NOT NULL AND sdk_cwd != ''
  `).all() as Array<{ sdk_cwd: string }>;
  return rows.map(r => r.sdk_cwd);
}
```

这个查询是全表(跨 tenant)的——清理本身是全局操作,正确的语义。

### 2.2 `server-agent.ts` 的 `cleanupExpiredRunCwds` 改造

当前签名:`cleanupExpiredRunCwds(excludeCwd: string)`

改造:
```ts
import { listReferencedSdkCwds } from './server-store.ts';

function cleanupExpiredRunCwds(excludeCwd: string) {
  const ttlMs = Number(process.env.AGENTMA_RUN_CWD_TTL_MS || RUN_CWD_DEFAULT_TTL_MS);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;

  const now = Date.now();
  if (now - lastRunCwdCleanupMs < RUN_CWD_CLEANUP_INTERVAL_MS) return;
  lastRunCwdCleanupMs = now;

  // === 新:protected set,清理时跳过 ===
  const protectedPaths = new Set<string>();
  protectedPaths.add(realpathIfPossible(excludeCwd));
  for (const p of listReferencedSdkCwds()) {
    try { protectedPaths.add(realpathIfPossible(p)); } catch {}
  }

  const parents = getRunCwdParents();
  for (const parent of parents) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.startsWith(RUN_CWD_PREFIX)) continue;
      const fullPath = path.join(parent, entry.name);
      const resolvedPath = realpathIfPossible(fullPath);
      if (protectedPaths.has(resolvedPath)) continue;   // 新:被引用,跳过

      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs < ttlMs) continue;
        fs.rmSync(fullPath, { recursive: true, force: true });
      } catch {}
    }
  }
}
```

**核心改动**:`protectedPaths` 集合从只装 `excludeCwd` 改为也装 **所有被 chat_sessions 引用的 sdk_cwd**(realpath 后)。

---

## 3. 边界情况(已考虑)

| 情况 | 行为 |
|---|---|
| 同一个 sdk_cwd 被多个 chat_sessions 引用(同租户多设备 / 多窗口) | DISTINCT 去重一次即可 |
| sdk_cwd 是 `/tmp/agentma-run-X`,但磁盘上是 `/private/tmp/agentma-run-X`(macOS) | `realpathIfPossible` 统一到 canonical 形式比较 |
| sdk_cwd 字段存的路径已被删(用户上次清理过)| `realpathIfPossible` 抛错时 fallback 到 path.resolve;比较仍然安全 |
| chat_sessions 表本身被 tenant CASCADE 删除 | listReferencedSdkCwds 不再返回它,清理时这些 cwd 会被回收(预期行为) |
| 用户**主动删除一个 chat session** | sdk_cwd 引用没了 → 下次 TTL 清理时,如果 cwd 也超龄,会被清理(预期) |

---

## 4. Smoke test(`smoke-cwd-ttl.mjs`,新增)

```
1. register 临时 tenant + 拿 token
2. 创建临时 cwd:/tmp/agentma-run-ttl-smoke-${ts},mkdir + 写个 marker.txt
3. 把 mtime 改回 30 天前(`fs.utimesSync(path, oldDate, oldDate)`)
4. 写一行 chat_sessions 行(直接 SQL 或通过 API 创建会话再 patch sdk_cwd),sdk_cwd = 那个 cwd
5. 调用清理:
   a) 设 `AGENTMA_RUN_CWD_TTL_MS=1`(强制超龄都该清)
   b) 触发一次 runAgent(随便一个 chat,只为让清理跑一遍)
6. 验证:cwd 还在(被 chat_sessions 引用,protected)
7. 删除那行 chat_sessions(DELETE /api/chat-sessions/:id)
8. 再触发一次 runAgent,清理跑(注意有 1h 节流,smoke 要绕过 — 直接 import + call cleanupExpiredRunCwds,或者把 lastRunCwdCleanupMs 重置)
9. 验证:cwd 现在被清掉了
10. teardown
```

判定项:
- `protectedCwdSurvived` — 步骤 6 后 cwd 还在 = true
- `unreferencedCwdRemoved` — 步骤 9 后 cwd 被清 = true

**导出 testHook**:为了 smoke 可控,`server-agent.ts` 导出 `__resetCleanupThrottle()` 和 `__runCleanup(excludeCwd)`,**仅供测试使用**,加上 `@internal` 注释。

---

## 5. 完成判据

1. `npm run build` 严格通过
2. `smoke:cwd-ttl` 2/2 全 true
3. 现有 7 个 smoke 全保持通过
4. **真实回归测试**:让 GPT 手动模拟一次——把 R5 那个 resume smoke 跑出来的 cwd 改 mtime 到 30 天前,跑一次 runAgent,然后**再跑 resume smoke 一次**,应该仍然成功(说明 cwd 没被误删)

---

## 6. 拆 commit(1 个)

```
fix(runner): exempt referenced sdk_cwd from TTL cleanup
- server-store.ts: listReferencedSdkCwds()
- server-agent.ts: cleanupExpiredRunCwds 加 protectedPaths(realpath 后比较)
- scripts/smoke-cwd-ttl.mjs(new)
- package.json: smoke:cwd-ttl
- 内部 testHook 导出(__resetCleanupThrottle / __runCleanup)
```

---

## 7. 给 GPT 的交付要求

完成后 brief 必须包含:
1. 完整 `git diff --stat HEAD` 粘贴
2. 上面 §5 的 4 个完成判据**逐条 ✅/❌**
3. **真实回归测试**(§5 第 4 条)的输出截取,证明 resume 不再断
4. 任何超出本 PLAN 的额外改动(包括"顺手清一下未用代码"这种)→ 必须列出
