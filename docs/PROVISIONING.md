# NEXUS Provisioning Checklist

Turn SaaS-readiness from 5/5-code to 5/5-live. Every item below is a
**fill-in-kredentials task** — no code change required. The code paths
are already wired and tested; supply these and flip the feature on.

> Repo: `/home/openclaw/projects/1ai-tracker` · Deploy: `pm2 restart 1ai-tracker-web` after each `.env` change (Next.js loads `.env*` at boot; env changes need a restart, not ecosystem.config.js).

---

## 1. Google OAuth — "Sign in with Google"

**Why:** login page shows a Google button; without creds it's hidden.

| Env var | Where to get |
|---|---|
| `GOOGLE_CLIENT_ID` | https://console.cloud.google.com/apis/credentials → OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | same credential's secret |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED="true"` | flip to show the button |

**Setup order:**
1. Create an OAuth 2.0 Client ID (Web application).
2. Authorized redirect URI: `${NEXTAUTH_URL}/api/auth/callback/google`
   (prod = `https://tracker.aitradepulse.com/api/auth/callback/google`).
3. Add the 3 values to `.env` **and** `.env.local` (Next precedence: `.env.local` wins).
4. **Install the Prisma adapter** (external dep, not yet installed):
   ```bash
   npm i @auth/prisma-adapter
   ```
   Without it the OAuth flow can't create a DB User. The `signIn` callback +
   `/api/auth/nexus-session` bridge are already wired — the adapter is the
   only missing runtime piece.
5. `pm2 restart 1ai-tracker-web`
6. Verify: `/login` shows "Continue with Google"; clicking it completes and
   lands authenticated with a `nexus-session` cookie.

---

## 2. SMTP Email — real verify + reset emails

**Why:** signup auto-verifies only in non-production; forgot/reset return
dev-links only without SMTP. With these set, real emails are sent and
`emailVerified` gating activates in production.

| Env var | Where to get |
|---|---|
| `MAIL_HOST` | your SMTP provider (e.g. `smtp.gmail.com`) |
| `MAIL_USER` | SMTP username / email |
| `MAIL_PASS` | SMTP password **or app-password** (Gmail needs an App Password) |
| `MAIL_PORT` | `587` (TLS) or `465` (SSL) |
| `MAIL_SECURE="false"` | `true` only for port 465 |
| `MAIL_FROM` | optional display from-address |

**Setup:**
1. Create an SMTP app-password (Gmail: Google Account → Security → App passwords).
2. Add the values to `.env` + `.env.local`.
3. `pm2 restart 1ai-tracker-web`
4. Verify: sign up with a real email → receive verification email → click
   link → `emailVerified` set; forgot-password → reset email delivered.

---

## 3. Payment Webhook HMAC Secret

**Why:** `ONEAI_PAYMENT_WEBHOOK_SECRET` signs/verifies the subscription
webhook. Missing → webhook route returns 503 (fail-closed, safe).

| Env var | Where to get |
|---|---|
| `ONEAI_PAYMENT_WEBHOOK_SECRET` | generate a random 64-hex string; **must match 1ai-payment's** |

**Setup:**
1. `openssl rand -hex 32` → set the SAME value in:
   - `1ai-tracker/.env` + `.env.local`
   - `1ai-payment/.env` (the gateway that signs the webhook)
2. `pm2 restart 1ai-tracker-web` (and restart 1ai-payment).
3. Verify: a signed paid webhook → subscription activates (plan set, role
   NOT changed); unsigned/tampered → rejected.

---

## 4. Telegram Cron Secret

**Why:** `TELEGRAM_CRON_SECRET` is the bearer for server-to-server cron
calls to `/api/v1/telegram/{broadcast,subscribe,alert,personal-alerts}`.

| Env var | Where to get |
|---|---|
| `TELEGRAM_CRON_SECRET` | `openssl rand -hex 24` |

**Setup:**
1. Add to `.env` + `.env.local`.
2. `pm2 restart 1ai-tracker-web`.
3. Wire the cron (e.g. `*/30 * * * *` calling `/api/v1/telegram/personal-alerts`
   with `Authorization: Bearer <secret>`). Without this the personal-alert
   route still works via `NEXUS_API_KEYS`, but the dedicated secret gives a
   clean separation.

---

## 5. Telegram Bot Token (optional but recommended)

**Why:** sends the actual alert messages to user chats.

| Env var | Where to get |
|---|---|
| `TELEGRAM_BOT_TOKEN` | https://t.me/BotFather → `/newbot` |

Already documented in `.env.example`; set it and the alert-service transport
activates.

---

## Summary table

| Gap | Env vars | Dep install | Status |
|---|---|---|---|
| Google OAuth | `GOOGLE_CLIENT_ID/SECRET`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` | `@auth/prisma-adapter` | code wired, needs creds |
| SMTP email | `MAIL_HOST/USER/PASS/PORT/SECURE/FROM` | — | code wired, needs creds |
| Payment webhook | `ONEAI_PAYMENT_WEBHOOK_SECRET` | — | set in both apps |
| Telegram cron | `TELEGRAM_CRON_SECRET` | — | set |
| Telegram bot | `TELEGRAM_BOT_TOKEN` | — | code wired, needs token |

After all 5: **SaaS readiness 5/5 live.** Every dimension code-complete; the
only remaining work is copy-pasting credentials.
