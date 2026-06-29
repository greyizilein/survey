Yes — I can see the problem.

The reload duplication is coming from the autosave flow, especially on Analyze and Presentations:

- The page starts with old messages restored from `localStorage`.
- At that moment `conversationId` is still `null` because the real saved chat has not finished loading from the backend yet.
- The autosave effect sees: “messages exist, but no conversation id”, so it creates a new chat row.
- A moment later the app loads the actual saved chat, but the duplicate row has already been created.

## Plan

1. **Add a history hydration gate**
   - Introduce a `historyReady` / `hasLoadedInitialConversation` guard in `app.analyze.tsx`, `app.presentations.tsx`, and `app.agent.tsx`.
   - Autosave will not run until the route has finished deciding whether it is loading:
     - a specific `?chat=` conversation,
     - the latest saved conversation,
     - a folder-scoped new chat,
     - or a genuinely fresh chat.

2. **Stop local draft state from creating backend duplicates on page load**
   - Keep local draft persistence only as a fallback for unsaved work.
   - Do not allow restored `localStorage` messages to immediately create a database chat before the backend history check completes.

3. **Clear stale local draft state after loading a real saved chat**
   - When `handleSelectConversation` loads a backend conversation, sync/replace the local state with that conversation instead of letting stale local data compete with it.

4. **Keep the existing protections**
   - Preserve the `pendingIdRef` insert lock that prevents duplicate rows during streaming.
   - Preserve the title fix so user-renamed chats do not revert.

5. **Verify the fix**
   - Reload Analyze, Presentations, and Agent with an existing saved chat.
   - Confirm reload updates the same `chat_conversations.id` instead of inserting a new row.
   - Confirm starting a truly new chat still creates exactly one row only after the user sends content.