# Security Policy

JobPilot processes resumes, contact details, employment history, job applications, and model API keys. Please treat security and privacy reports with particular care.

## Supported Versions

JobPilot is currently pre-1.0. Security fixes are applied to the latest commit on `main`; older commits and forks are not maintained by the project.

## Reporting a Vulnerability

Do not open a public issue for a vulnerability that could expose personal data, API keys, local files, extension pairing tokens, or allow unintended model/database actions.

Report the issue privately through GitHub's **Security → Report a vulnerability** flow for this repository. Include:

- affected commit or version;
- reproduction steps using synthetic data;
- expected and actual behavior;
- potential impact;
- any suggested remediation.

Do not include real resumes, credentials, tokens, or copied user data. You should receive an initial acknowledgement within seven days. A remediation timeline will depend on severity and reproducibility.

## Security Boundaries

- `data/` contains local user data and must never be committed or shared.
- `data/secrets.json` contains provider keys and the Chrome extension pairing token.
- Enabling AI transmits relevant content to the selected provider; consult that provider's data policies.
- The Chrome extension should only communicate with the local JobPilot origin declared in its manifest.
- Job descriptions and fetched pages are untrusted input.
- JobPilot does not automatically submit applications or send email.
- Public fetches reject loopback, private, link-local, metadata, and DNS-rebinding targets before every redirect.
- Cloud secrets use authenticated encryption with per-user AAD; extension tokens are stored as hashes.
- Cloud provider keys are not zero-knowledge encrypted: the backend decrypts them only when issuing an account-authorized model request. Users should prefer a separate provider key with a spending limit.
- JSON exports deliberately exclude API keys, pairing tokens, rate limits, background jobs, and derived indexes.
- No product analytics or third-party telemetry is enabled by default.

## Deployment responsibilities

Self-hosters are responsible for access control to the local machine, backups of `data/`, provider data-retention choices, and timely dependency upgrades. Cloud operators must isolate preview and production credentials, keep Supabase Storage private, protect the cron endpoint, run database migrations explicitly, and retain old encryption keys during rotation.
