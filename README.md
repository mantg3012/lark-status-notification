# lark-status-notification

A Cloudflare Worker that turns the Lark system statuses **Remote** / **Off** on when the matching Lark Approval request is approved, and off when the request is revoked.

## How it works

- **Webhook** `POST /lark/events` receives `approval_instance` events from Lark (decrypts, checks the verification token, answers the URL challenge).
  - Approved request active today → `batch_open`; the status hides itself at the request's real `end` time (half-day requests end with the half day).
  - Approved request for a future date → stored in Workers KV (`SCHEDULE`).
  - Canceled/reverted request → removed from KV; the status is closed if it is currently active.
- **Cron** `0 1 * * *` (08:00 Asia/Ho_Chi_Minh) reads KV, re-checks that each request is still approved, and opens statuses for requests starting today.
- Future requests live in KV instead of a full daily scan because the Cloudflare Free plan allows only 50 subrequests per invocation. Original design: [docs/original-spec.md](docs/original-spec.md).

## Lark app configuration

Scopes (tenant token):
- `personal_settings:status:system_status_update` — list/create statuses
- `personal_settings:status:system_status_operate` — open/close statuses for users
- `approval:approval:readonly`, `approval:approval` — read requests, subscribe to forms

Event: `approval_instance`, mode **Send events to developer server**, Request URL `https://<worker>/lark/events`.

The form → status mapping is `APPROVAL_MAPPING` in `wrangler.toml` (approval_code → `statusTitle` and the id of the date widget).

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars           # fill in LARK_APP_ID, LARK_APP_SECRET, LARK_ENCRYPT_KEY, LARK_VERIFICATION_TOKEN
npm run setup                             # create missing statuses + subscribe to the forms
npm run try-open -- Remote <open_id> 10   # show a status for 10 minutes
```

Deploy:

```bash
npx wrangler kv namespace create SCHEDULE   # put the id in wrangler.toml
npx wrangler secret put LARK_APP_ID          # repeat for all 4 secrets
npx wrangler deploy
npm run backfill                             # collect already-approved future requests
npx wrangler kv bulk put backfill-kv.json --binding SCHEDULE --remote
```

## Commands

| Command | Purpose |
|---|---|
| `npm test` / `npm run typecheck` | unit tests / type check (Worker + scripts) |
| `npx wrangler tail` | live logs (one JSON line: `action`, `instance_code`, `user`, `status`, `result`) |

## Notes

- Scripts read `.dev.vars` and **override** any `LARK_*` variables already exported in the shell. If the shell exports another app's credentials, the token belongs to that app and every API call fails with `99991672`.
- `backfill-kv.json` contains employee open_ids; it is git-ignored. Delete it after uploading.
- Logs never include form contents or leave reasons.
