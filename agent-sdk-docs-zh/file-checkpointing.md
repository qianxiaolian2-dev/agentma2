# Rewind file changes with checkpointing (English - no Chinese version available)

> Track file changes during agent sessions and restore files to any previous state

## How checkpointing works

When you enable file checkpointing, the SDK creates backups of files before modifying them through the Write, Edit, or NotebookEdit tools.

| Tool | Description |
| --- | --- |
| Write | Creates a new file or overwrites an existing file |
| Edit | Makes targeted edits to specific parts of an existing file |
| NotebookEdit | Modifies cells in Jupyter notebooks |

## Implement checkpointing

### 1. Enable checkpointing

```python
options = ClaudeAgentOptions(
    enable_file_checkpointing=True,
    permission_mode="acceptEdits",
    extra_args={"replay-user-messages": None},
)
```

```typescript
const opts = {
  enableFileCheckpointing: true,
  permissionMode: "acceptEdits" as const,
  extraArgs: { "replay-user-messages": null }
};
```

### 2. Capture checkpoint UUID and session ID

Python:
```python
checkpoint_id = None
session_id = None

async for message in client.receive_response():
    if isinstance(message, UserMessage) and message.uuid:
        checkpoint_id = message.uuid
    if isinstance(message, ResultMessage):
        session_id = message.session_id
```

TypeScript:
```typescript
let checkpointId: string | undefined;
let sessionId: string | undefined;

for await (const message of response) {
  if (message.type === "user" && message.uuid) {
    checkpointId = message.uuid;
  }
  if ("session_id" in message) {
    sessionId = message.session_id;
  }
}
```

### 3. Rewind files

Python:
```python
async with ClaudeSDKClient(
    ClaudeAgentOptions(enable_file_checkpointing=True, resume=session_id)
) as client:
    await client.query("")
    async for message in client.receive_response():
        await client.rewind_files(checkpoint_id)
        break
```

TypeScript:
```typescript
const rewindQuery = query({
  prompt: "",
  options: { ...opts, resume: sessionId }
});

for await (const msg of rewindQuery) {
  await rewindQuery.rewindFiles(checkpointId);
  break;
}
```

## Limitations

- Write/Edit/NotebookEdit tools only: Changes made through Bash commands are not tracked
- Same session: Checkpoints are tied to the session that created them
- File content only: Creating, moving, or deleting directories is not undone
- Local files: Remote or network files are not tracked
