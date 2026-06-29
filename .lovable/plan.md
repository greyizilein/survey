## Scope
Trim the `/app/analyze` composer toolbar: remove the paperclip attach button and both prompt-builder triggers. Drag-and-drop file ingestion stays as a silent fallback so existing CSV/transcript flows keep working.

## Edits — `src/routes/_authenticated/app.analyze.tsx`

1. **Attach button** (~lines 1587–1596): delete the `<Button title="Attach files">` wrapping `<Paperclip />`. Keep the hidden `<input ref={docFileInputRef} />` so drag-and-drop and programmatic handlers stay intact.

2. **Desktop "Create prompt" button** (~lines 1801–1819): delete the entire `TooltipProvider` block wrapping the hammer/Logo button.

3. **Desktop "Meta prompt" button** (~lines 1821–1839): delete the Max-tier `TooltipProvider` block (Logo + Sparkles).

4. **Mobile prompt dropdown** (~lines 1841–1863): delete the `DropdownMenu` whose trigger is the `🔨` button (Create Prompt + Meta Prompt items).

5. **Import cleanup**: drop `Paperclip` from the `lucide-react` import (line 26). Leave `Logo`, `Sparkles`, `DropdownMenu*` imports alone if still used elsewhere; otherwise remove only the now-unused ones.

## Left intentionally untouched
- Prompt-builder state and helpers (`promptMode`, `startPromptBuild`, `executePrompt`, the inline "Prompt ready. Execute it now?" banner, `send()`'s `promptMode` branch). They become unreachable but harmless; removing them risks touching the streaming logic. Can prune in a follow-up if you want a fully clean file.
- Data source, Instructions, model picker, send button, drag-and-drop file routing.

## Verification
- Visual: composer shows only Data, Instructions, model picker, send. No paperclip, no hammer.
- Build: typecheck passes (no dangling `Paperclip` reference).
- Functional: drag a CSV onto the composer → still ingests via `handleIncomingFiles`.
