# Chat Collaboration Mode Design

## Goal

Add an explicit multi-user collaboration mode for chat sessions. A session remains private by default. When the owner enables collaboration, they can share a session link with other registered users in the same tenant. Joined users can see the session in their conversation list, send messages into the same message history, and receive realtime updates while the session is open.

This design intentionally excludes public guest access. External visitor identity, expiring anonymous links, and abuse controls should be a separate project.

## Current Context

The dashboard is a React + Vite frontend with an Express server and SQLite persistence. Chat history currently lives in `chat_sessions` and `chat_messages`. Access is isolated by `tenant_id + owner_sub`, where `owner_sub` is the user email for JWT users or `api_key:<id>` for API key callers.

The main chat surfaces are `dashboard/src/pages/Conversations.tsx` and `dashboard/src/pages/AgentChat.tsx`. Both use `dashboard/src/utils/chat-sessions.ts` for session APIs. The server routes in `dashboard/server.ts` delegate persistence and access checks to `dashboard/server-store.ts`.

## Recommended Approach

Use session-level opt-in collaboration:

- Add collaboration metadata to `chat_sessions`.
- Add a membership table for joined users.
- Treat access as "owner or member" for reads and writes.
- Keep destructive actions owner-only.
- Use Server-Sent Events to notify open browsers when a shared session changes.

This approach keeps existing private-session behavior intact and limits the security change to explicitly shared sessions.

## Data Model

Extend `chat_sessions`:

- `collaboration_enabled INTEGER NOT NULL DEFAULT 0`
- `collaboration_updated_at INTEGER`

Add `chat_session_members`:

- `session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE`
- `tenant_id TEXT NOT NULL`
- `member_sub TEXT NOT NULL`
- `role TEXT NOT NULL`
- `joined_at INTEGER NOT NULL`
- primary key: `(session_id, member_sub)`
- index: `(tenant_id, member_sub, joined_at DESC)`

Roles:

- `owner`: implicit from `chat_sessions.owner_sub`, not duplicated in the member table.
- `member`: can read the shared session and append/save messages.

The schema should be migrated with `ensureColumn` and `CREATE TABLE IF NOT EXISTS` so existing databases upgrade in place.

The project currently lacks a way to create a second user inside an existing tenant. Add a minimal admin-only same-tenant user creation path so collaboration can be used and tested:

- Store helper: create a user in the caller's `tenant_id`.
- HTTP route: `POST /api/users`, restricted to `tenant_admin`.
- Request body: `{ "name": string, "email": string, "password": string, "role": "tenant_admin" | "team_admin" | "member" }`.
- Frontend: add a compact create-user form to the existing user management page.

This is not an email invitation system. The admin creates an account and shares credentials through an existing trusted channel.

## Access Rules

Private sessions:

- Visible only to the existing owner.
- Existing behavior remains unchanged.

Shared sessions:

- Owner can read, write, rename, pin, copy, delete, and disable collaboration.
- Member can read and write messages.
- Member can copy/fork a shared session into their own private session.
- Member cannot delete the original session or change collaboration settings.
- API key identities cannot join shared sessions by link because they do not map cleanly to an interactive tenant user. They keep their current private history behavior.

Tenant boundary:

- Join and access always require matching `tenant_id`.
- A same-tenant user must explicitly join before the shared session appears in their list.
- Users from other tenants get 404 to avoid leaking whether a session exists.

## API Design

Existing chat session routes should use access-aware store helpers:

- `GET /api/chat-sessions`: return owned sessions plus joined shared sessions.
- `GET /api/chat-sessions/:id`: allow owner or member.
- `POST /api/chat-sessions`: allow owner for private sessions; allow owner or member when updating an accessible shared session.
- `PATCH /api/chat-sessions/:id`: owner-only for metadata fields that affect the original session.
- `POST /api/chat-sessions/:id/fork`: allow owner or member, creating a private copy owned by the caller.
- `DELETE /api/chat-sessions/:id`: owner-only.

Add collaboration routes:

- `PATCH /api/chat-sessions/:id/collaboration`
  - owner-only
  - body: `{ "enabled": true | false }`
  - returns the updated session with collaboration metadata

- `POST /api/chat-sessions/:id/join`
  - JWT users only
  - requires same tenant and `collaboration_enabled = 1`
  - inserts or refreshes member row for `req.auth.sub`
  - returns the joined session

- `GET /api/chat-sessions/:id/events`
  - owner or member
  - returns `text/event-stream`
  - emits `session_updated` when another request saves, patches, joins, or changes collaboration state

## Realtime Behavior

The server keeps an in-memory map of `sessionId -> Set<Response>` for collaboration SSE clients. When a session changes, the server broadcasts:

```json
{ "type": "session_updated", "sessionId": "chat-123", "updatedAt": 1780081795000 }
```

Clients do not trust the event payload as state. They call `GET /api/chat-sessions/:id` and replace local state with the server session.

This is sufficient for the current single-process deployment. Multi-process or multi-host deployment would require a shared pub/sub layer later.

## Message Ordering And Concurrency

The current persistence model replaces the full `messages` array on save. For the first collaboration version, keep that storage model but reduce accidental overwrites:

- Before saving a shared session, the client sends its current full message list as it does today.
- The server persists the latest request and broadcasts an update.
- The UI shows a small "collaboration enabled" state so users know another browser can modify the same history.
- If two users send at the same time, the last completed save wins.

This matches the existing storage design and keeps the first implementation scoped. A later append-only `chat_messages` API can provide stronger conflict handling.

## Frontend Design

Update shared types and API helpers:

- Add collaboration fields to `ChatSession`.
- Add helper functions for enabling/disabling collaboration, joining a shared session, and opening an SSE stream.

`Conversations.tsx`:

- Show a compact collaboration control in the conversation header when a session is active.
- Owner can toggle collaboration and copy the join link.
- Member sees a shared-session badge and can copy the link.
- On page load, if `join=<sessionId>` exists in the query string, call the join API and select the returned session.
- Subscribe to session events while an active shared session is open, and refresh the active session on `session_updated`.
- Update session list state after refresh so joined sessions are visible.

`AgentChat.tsx`:

- Use the same API helpers and access-aware session loading.
- If the page resumes a shared session, subscribe to updates and refresh on `session_updated`.

## Link Format

Use an authenticated app link:

```text
/conversations?join=<sessionId>
```

The link is safe to copy because it is not a bearer token. It only works after the receiver logs in as a same-tenant user, and only when collaboration remains enabled.

## Error Handling

- Joining a disabled, missing, cross-tenant, or private session returns 404.
- API key callers attempting to join return 403.
- SSE disconnects are cleaned up on request close.
- If realtime refresh fails, the UI keeps the current view and logs the error; the next manual load still reads the server state.
- Disabling collaboration removes member access for future reads and stops new joins. Open clients will lose access on their next refresh.

## Testing

Add a focused smoke script for the collaboration API:

1. Start a managed server with a temporary data directory.
2. Register User A as the tenant admin.
3. User A creates User B in the same tenant through `POST /api/users`.
4. User A creates a session.
5. User B cannot read it before collaboration is enabled.
6. User A enables collaboration.
7. User B joins and can read the session.
8. User B saves a message into the session.
9. User A reads the session and sees the new message.
10. User B cannot delete the original session.
11. User A disables collaboration and User B can no longer read it.

Also run TypeScript or build checks that are practical in the existing repo state. The README notes that `npm run build` may already be affected by unrelated TypeScript issues, so report any pre-existing failures separately.

## Out Of Scope

- Public guest collaboration links.
- Link expiration and revocation beyond disabling collaboration for the session.
- Email-based user invitations.
- Presence indicators and typing indicators.
- Conflict-free concurrent editing.
- Cross-process realtime broadcasting.
- Per-member roles beyond a single `member` role.

## Implementation Notes

Keep edits close to existing boundaries:

- Persistence and authorization logic belongs in `dashboard/server-store.ts`.
- HTTP routes and SSE connection management belongs in `dashboard/server.ts`.
- Client request helpers belong in `dashboard/src/utils/chat-sessions.ts`.
- Shared shape changes belong in `dashboard/src/simulator/types.ts`.
- UI changes should stay inside the existing chat pages and current console styling.
