# Contributing to JobPilot

Thanks for helping improve JobPilot. Focused bug reports, accessibility fixes, tests, documentation, and small workflow improvements are especially welcome.

## Before You Start

- Search existing issues before opening a new one.
- Keep changes scoped to one behavior or workflow.
- Open an issue before starting a large feature, schema redesign, new provider integration, or broad UI rewrite.
- Never include real resumes, job applications, API keys, pairing tokens, or other personal data in an issue, fixture, screenshot, or commit.

## Local Setup

```bash
git clone https://github.com/davinh47/JobPilot.git
cd JobPilot
npm install
cp .env.example .env.local
npm run db:setup
npm run dev
```

Create a branch from the latest `main`:

```bash
git switch -c feature/short-description
```

## Development Guidelines

- Follow the existing Next.js, TypeScript, Drizzle, and Zod patterns.
- Keep deterministic job filtering, status transitions, deduplication, and persistence outside model prompts.
- Treat resumes, job descriptions, and web content as untrusted input.
- Do not let model output write directly to the database. Validate structured output, then use a domain service and transaction.
- Preserve original source files and immutable history. Generated changes should create new versions.
- Keep Chinese and English interface copy in sync.
- Add focused tests for changed behavior, especially matching, deletion, source parsing, AI schemas, and application events.
- Avoid unrelated formatting or generated migration churn.

## Database Changes

Update `src/db/schema.ts`, then generate and inspect a migration:

```bash
npm run db:generate
npm run db:migrate
```

Commit the SQL migration and matching Drizzle metadata. Consider existing local databases and include a backfill when a new non-null field cannot be safely defaulted.

## Verification

Before opening a pull request, run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

For UI changes, verify the affected workflow in both English and Chinese and at desktop and narrow viewport widths.

## Pull Requests

Describe:

- the user problem being solved;
- the chosen behavior and any tradeoffs;
- database or privacy implications;
- tests and manual verification performed;
- screenshots for meaningful visual changes, using only synthetic data.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE) and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).

