# JobPilot Cloud deployment

The public `cloud` branch keeps the JobPilot interface and workflows, then adds account authentication and cloud persistence. The public `main` branch remains the local single-user edition.

## Services

- Vercel runs the Next.js application. Authenticated browser sessions immediately drain their own queued work through a tenant-scoped worker route. The checked-in Hobby-compatible cron also invokes the shared worker once per day at 03:00 UTC as an offline fallback; Pro deployments can change the schedule to `*/5 * * * *` for five-minute unattended automation.
- Supabase provides Google/email authentication and a private `resumes` Storage bucket.
- Turso (or another hosted libSQL endpoint) stores relational application data.
- Each user's model API keys are encrypted before they are stored in the database.

## Setup

1. Create a Supabase project.
2. Enable email/password authentication. To offer Google login, configure the Google provider and set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`.
3. Set `NEXT_PUBLIC_SITE_URL` to the canonical production origin (for example, `https://app.example.com`). In **Authentication → URL Configuration**, set **Site URL** to the same origin and add the exact production callback (`https://app.example.com/auth/callback`) to **Redirect URLs**. Add localhost callbacks only to development projects. Supabase silently falls back to Site URL when a requested callback is not allowlisted; JobPilot also uses `NEXT_PUBLIC_SITE_URL` so Vercel preview or legacy aliases cannot leak into confirmation, recovery, or Google OAuth links.
4. Configure **Authentication → SMTP Settings** with a domain-authenticated transactional email provider. Supabase's hosted dashboard currently keeps subjects and bodies read-only until custom SMTP is enabled; this is also required for a branded `From` address.
5. In **Authentication → Email Templates**, customize both:
   - **Confirm signup** with [`supabase/templates/confirmation-subject.txt`](../supabase/templates/confirmation-subject.txt) and [`supabase/templates/confirmation.html`](../supabase/templates/confirmation.html).
   - **Reset password** with [`supabase/templates/recovery-subject.txt`](../supabase/templates/recovery-subject.txt) and [`supabase/templates/recovery.html`](../supabase/templates/recovery.html).
   Keep `{{ .ConfirmationURL }}` unchanged. JobPilot supplies the current deployment's `/auth/callback` URL for both confirmation and recovery flows.
6. JobPilot creates the private `resumes` Storage bucket on the first resume upload. You may also create it in advance.
7. Create a hosted libSQL database and set `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.
8. Copy the variables in `.env.cloud.example` into Vercel.
9. Run `npm run db:migrate` against the hosted database once. The checked-in Vercel build command also applies pending migrations before each cloud build.
10. Run `npm run build` locally or in preview CI.
11. Deploy this branch to Vercel.

JobPilot intentionally fails the build when it detects Vercel without
`JOBPILOT_DEPLOYMENT=cloud`. This prevents an accidentally hosted local-mode
build from bypassing account authentication and tenant isolation.

Cloud startup fails fast when a required variable is missing, the database is not hosted libSQL, the encryption key is not exactly 32 bytes, or `CRON_SECRET` is weak.

`CRON_SECRET` protects `/api/cron/worker`. The route schedules due work and keeps claiming jobs for up to 180 seconds, leaving headroom inside the 300-second function duration. While a user is signed in, the app also calls `/api/background/worker`; that authenticated route can claim only that account's work and refreshes the page after the queue drains. Queue rows carry a non-null account ID, stable dedupe key, retry state, heartbeat lease, and fair scheduling metadata. Vercel Hobby permits only one cron invocation per day, but this limits unattended scheduling rather than user-triggered AI work. The default in `vercel.json` follows the Hobby cron limit so a fresh deployment is accepted. Upgrade the project only if more frequent unattended automation is required.

## Data boundaries

The cloud branch scopes resumes, jobs, applications, notifications, profile data, AI runs, AI usage, and background jobs to the authenticated account. Resume originals use private object storage. Model API keys use AES-256-GCM with per-user authenticated data and versioned keys. Extension tokens are indexed only by SHA-256 hash and confirmed with a timing-safe comparison.

### Bring-your-own-key security model

JobPilot Cloud uses a bring-your-own-key model for OpenAI and DeepSeek. Provider keys:

- are submitted over HTTPS and never stored in browser state;
- are encrypted at rest with AES-256-GCM, a random per-write initialization vector, per-user authenticated data, and a versioned server-side encryption key;
- are never returned to the browser after saving and are excluded from logs, exports, prompts, and public search queries;
- are decrypted by the JobPilot backend only when it needs to send an authorized model request for that account;
- can be replaced or deleted by the account owner from Settings.

This is application-level encryption, not zero-knowledge encryption. A functioning backend must be able to decrypt a provider key to use it, so compromise of the deployment account, encryption key, application server, or a trusted dependency remains within the threat model. Users should create a separate provider key for JobPilot, apply provider-side spending limits where available, monitor provider usage, and delete the key when it is no longer needed.

Before production:

- keep the resume bucket private and verify service-role credentials never use a `NEXT_PUBLIC_` name;
- send a real signup email and verify both the button and fallback URL resolve to the production origin rather than localhost;
- use separate preview and production databases, Supabase projects, encryption keys, and cron secrets;
- verify every production build completes the migration step before `next build`;
- configure provider pricing only if estimated costs should appear in Settings;
- exercise signup, logout, account deletion retry, JSON export, tenant isolation, and cron authorization with synthetic accounts;
- retain previous encryption keys in `JOBPILOT_SECRETS_KEYS` until all stored envelopes have rotated.

Both editions are published in `davinh47/JobPilot` under the repository license. The `main` and `cloud` release branches must point to commits created from the same source tree; only deployment configuration and infrastructure may differ. Use `main` to run JobPilot entirely on your own machine, or deploy `cloud` with the services above.
