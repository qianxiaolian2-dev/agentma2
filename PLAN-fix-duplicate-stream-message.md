# PLAN:修聊天回复消息显示 2 次的小 bug

> 来源:用户报告"页面回复消息的时候都会显示 2 次,最终留下的确实只有一个但是显示 2 次"
> 范围:2 个 SSE result 分支的语句顺序调整
> 性质:**纯顺序错误,无需新增逻辑**,3 处行为不一致的代码统一即可
> 风险:极低(语义不变,只是消除一帧的视觉重叠)

## 根因

result 事件处理里这个顺序错了:

```ts
setMessages(finalMsgs);                 // 助手消息进消息列表
const sid = await persistSession(...);  // ← await 让出主线程,React 在这里渲染一帧
//                                         此时 messages 已含最终消息,但 streamText 还没清
setStreamText('');                      // 太晚:用户已经看到那帧"2 次"
setStreamThinking('');
```

React 19 默认 batch 同步上下文的多个 setState,但 `await` 之后的 setState 不会被合并进上一帧。
所以在 `setMessages` 和 `setStreamText('')` 之间夹了 `await persistSession(...)`,就会有一帧渲染出"消息列表里的助手消息" + "streamText 里还没清掉的同一段内容"——视觉上就是同一回复显示 2 次。

异步完成后 `setStreamText('')` 才生效,所以"最终留下的确实只有一个"。

## 证据:同文件里有一处已经写对了

`Conversations.tsx:166-173`(bot 事件自动回复路径)的顺序是 **先清 stream 再 await**——这处没 bug:

```ts
setMessages(finalMsgs);
setStreamThinking(''); setStreamText('');                                              // ← 先清
const sid = await (persistRef.current?.(finalMsgs, activeSessionId, ...) || ...);      // ← 后 await
if (sid) setActiveSessionId(sid);
```

→ 把另两处也对齐到这个顺序即可。

## 改动清单(2 处)

### 1) `dashboard/src/pages/Conversations.tsx`(line 500-508,第二处 result 分支)

**改前**:
```ts
} else if (data.type === 'result') {
  const content = data.text || text || thinking || '';
  const respMsg: ChatMessage = { role: 'assistant', content, timestamp: Date.now() };
  const finalMsgs = [...newMsgs, respMsg];
  setMessages(finalMsgs);
  const sid = await persistSession(finalMsgs, activeSessionId, data.sdkSessionId, data.sdkCwd);
  if (sid) setActiveSessionId(sid);
  setStreamThinking('');
  setStreamText('');
}
```

**改后**(把清 stream 的两行移到 await 之前):
```ts
} else if (data.type === 'result') {
  const content = data.text || text || thinking || '';
  const respMsg: ChatMessage = { role: 'assistant', content, timestamp: Date.now() };
  const finalMsgs = [...newMsgs, respMsg];
  setMessages(finalMsgs);
  setStreamThinking('');
  setStreamText('');
  const sid = await persistSession(finalMsgs, activeSessionId, data.sdkSessionId, data.sdkCwd);
  if (sid) setActiveSessionId(sid);
}
```

### 2) `dashboard/src/pages/AgentChat.tsx`(line 211-223)

**改前**:
```ts
} else if (data.type === 'result') {
  // 完成 — 追加最终消息
  const finalContent = text || thinking || data.text || '';
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: finalContent,
    timestamp: Date.now(),
  };
  const finalMessages = [...newMessages, assistantMsg];
  setMessages(finalMessages);
  await persistSession(finalMessages, data.sdkSessionId, data.sdkCwd);
  setStreamThinking('');
  setStreamText('');
}
```

**改后**:
```ts
} else if (data.type === 'result') {
  // 完成 — 追加最终消息
  const finalContent = text || thinking || data.text || '';
  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: finalContent,
    timestamp: Date.now(),
  };
  const finalMessages = [...newMessages, assistantMsg];
  setMessages(finalMessages);
  setStreamThinking('');
  setStreamText('');
  await persistSession(finalMessages, data.sdkSessionId, data.sdkCwd);
}
```

### 同名错误也检查一下 `error` 分支

`Conversations.tsx:524-529` 同理也是 `await persistSession` 后才清 stream,**也建议一并修**:

**改前**(估计是):
```ts
} else if (data.type === 'error') {
  const err: ChatMessage = { role: 'assistant', content: `错误: ${data.message}`, timestamp: Date.now() };
  const finalMsgs = [...newMsgs, err];
  setMessages(finalMsgs);
  const sid = await persistSession(finalMsgs, activeSessionId);
  if (sid) setActiveSessionId(sid);
  setStreamThinking('');
  setStreamText('');
}
```

**改后**(清 stream 移到 await 前):
```ts
} else if (data.type === 'error') {
  const err: ChatMessage = { role: 'assistant', content: `错误: ${data.message}`, timestamp: Date.now() };
  const finalMsgs = [...newMsgs, err];
  setMessages(finalMsgs);
  setStreamThinking('');
  setStreamText('');
  const sid = await persistSession(finalMsgs, activeSessionId);
  if (sid) setActiveSessionId(sid);
}
```

`AgentChat.tsx` 的 error 分支同款也要检查。

### 不要动的地方

- **`Conversations.tsx:166-173`(第一处 result)**:顺序已经对,**不要改**,留作参考。
- **`Playground.tsx`**:没有 `streamText` 这种单独的 partial state,delta 直接 append 到 messages,这个 bug 不适用,**不要动**。

## 验收标准

1. `npm run build` 通过。
2. 浏览器里在 Conversations 页发一条消息,**整个流式过程中**(包括 result 事件刚到达那一瞬间)助手回复**只有一份**在 DOM 上;之前会看到的"2 次"消失。
3. AgentChat 单聊页同样验证。
4. 跑现有 smoke 全套(`smoke:chat-write` / `chat-resume` / `chat-session-fork` / `permission-rules` / `hook-rules` / `hook-runtime`),全过——这次改不动后端,smoke 应该全绿。
5. 异常路径(模型返回 error 事件)也测一遍:不再有 2 份"错误: xxx"重复。

## 不做的事

- 不重构 `streamText/streamThinking` 这套机制(尽管它有点鸡肋,可以直接把流式 delta 推进 messages 数组里——但那是 refactor,不是 bugfix,不在本次范围)。
- 不动 Playground。
