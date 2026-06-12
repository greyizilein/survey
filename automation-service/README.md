# Surveyor Automation Service

A tiny headless-browser microservice that opens a survey URL and fills it
with AI-generated answers, then submits it. This runs separately from the
main Surveyor app because the main app is deployed on Cloudflare Workers,
which cannot launch a browser.

## Run locally

```bash
cd automation-service
npm install   # also installs the Playwright Chromium binary
npm start
```

The service listens on `PORT` (default `8787`).

## Deploy

Deploy this folder to any Node host that allows running a browser, e.g.
Render, Fly.io, Railway, or a small VPS (Docker). Set:

- `PORT` — port to listen on
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

## Wire it up to the main app

In the main app's environment, set:

- `AUTOFILL_SERVICE_URL` — base URL of this service (e.g. `https://surveyor-fill.example.com`)
- `AUTOFILL_API_TOKEN` — same token as above

Once set, the "Auto-fill" button in a project's response list calls this
service directly — no browser extension required.
