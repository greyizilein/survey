# Surveyor Automation Service

A tiny headless-browser microservice that opens a survey URL and fills it
with AI-generated answers, then submits it. This runs separately from the
main Surveyor app because the main app is deployed on Cloudflare Workers,
which cannot launch a browser.

## Run locally

```bash
cd automation-service
npm install && npx playwright install --with-deps chromium
npm start
```

The service listens on `PORT` (default `8787`).

## Deploy on Render (recommended, free tier works)

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In Render, click **New > Blueprint**, point it at this repo, and select
   the `automation-service` directory — Render will read `render.yaml` and
   build the included `Dockerfile` automatically.
3. After it deploys, copy the service URL (e.g. `https://surveyor-automation.onrender.com`)
   and the auto-generated `AUTOFILL_API_TOKEN` value from the service's
   Environment tab.

Alternatively deploy the `Dockerfile` to Fly.io, Railway, or any small VPS.
Set these env vars on whichever host you use:

- `PORT` — port to listen on (Render sets this automatically)
- `AUTOFILL_API_TOKEN` — shared secret; the main app must send it as
  `Authorization: Bearer <token>`
- `AUTOFILL_MAX_CONCURRENCY` — max parallel browser fills (default 3)

## API

`POST /fill`

```json
{
  "url": "https://docs.google.com/forms/d/e/.../viewform",
  "answers": [
    { "question_id": "q1", "question": "How satisfied are you?", "answer": "Very satisfied" }
  ]
}
```

Returns `{ "filled": number, "submitted": boolean, "pages": number }`.

## Wire it up to the main app (Lovable)

The main Surveyor app stays deployed on Lovable exactly as-is — only this
small service needs a host that can run a browser.

In your Lovable project's environment variables / secrets, set:

- `AUTOFILL_SERVICE_URL` — base URL of this service (e.g. `https://surveyor-automation.onrender.com`)
- `AUTOFILL_API_TOKEN` — same token shown in Render's Environment tab for this service

Once both are set and the app redeploys, the "Auto-fill" button in a
project's response list calls this service directly — a background browser
opens the real form, fills it, and submits it. No browser extension needed.
