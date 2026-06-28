# Fix chat history bugs

Two bugs, same root cause area: the autosave effect in `app.analyze.tsx`, `app.presentations.tsx`, and `app.agent.tsx`.

## Bug 1 — Same chat appears multiple times in history

The autosave effect runs whenever `messages` (or related state) change. On the very first save, `conversationId` is still `null`, so the server inserts a new row. If state changes again before `setConversationId(id)` from the first insert resolves (very common — streaming a reply updates `messages` many times per second), the next run of the effect still sees `conversationId === null` and inserts **another** row. Result: one logical chat ends up as 2–4 rows in history.

**Fix:** Add a `creatingRef` lock + `pendingIdPromiseRef`. While the first insert is in flight, subsequent autosaves `await` the same promise instead of starting a parallel insert, then run as updates against the resolved id.

## Bug 2 — Renamed chats revert to the auto-generated title

`renameChatConversation` writes the new title to the DB, but the autosave effect always sends `title: firstUserMsg.slice(0, 80)` on every update. The next state change (e.g. opening the chat, scrolling triggering a state update, sending another message) overwrites the user's rename with the derived title.

**Fix:** Only send `title` on the initial **insert**. On updates, omit `title` so the server-side patch leaves the existing title alone. `saveChatConversation` already accepts `title` as optional — change the update branch in `chat-history.functions.ts` to skip the `title` field when it's `undefined` (same pattern already used for `folder_id`).

## Changes

1. **`src/lib/chat-history.functions.ts`** — In `saveChatConversation`'s update branch, only include `title` in the patch when `data.title` is provided (mirror the existing `folder_id` conditional).

2. **`src/routes/_authenticated/app.analyze.tsx`** (and identical pattern in `app.presentations.tsx`, `app.agent.tsx`):
   - Add `creatingRef = useRef(false)` and `pendingIdRef = useRef<Promise<string> | null>(null)`.
   - In the autosave effect:
     - If `conversationId` exists → call save **without** `title`.
     - Else if `pendingIdRef.current` exists → `await` it, then save as update without `title`.
     - Else → start the insert (with `title`), store the promise in `pendingIdRef`, set `conversationId` when it resolves, clear the ref.
   - Keep the 1s debounce; remove `conversationId` from the deps that retrigger title-changing saves (the ref-based guard makes it unnecessary).

3. No DB migration, no UI changes, no changes to `ChatHistoryMenu` or rename function.

## Verification

- Send a fresh message → exactly one row in `chat_conversations` (check via SQL).
- Stream a long reply → still one row, not multiple.
- Rename a chat → send another message in it → title stays renamed.
