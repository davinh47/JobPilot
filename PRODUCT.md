# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

JobPilot serves individual job seekers who need one place to maintain resumes, discover relevant openings, prepare applications, and track outcomes. It supports both local self-hosted use and an authenticated cloud deployment, with Simplified Chinese and English interfaces.

## Product Purpose

JobPilot turns a candidate's real resume, preferences, job descriptions, and application history into a practical job-search workspace. Success means the user can move from a credible opportunity to a tailored, evidence-grounded application without losing source material, status history, or control over decisions.

## Positioning

JobPilot combines deterministic job and application management with constrained AI assistance. AI may analyze, explain, search, restructure, translate, and draft, but it does not invent candidate facts or freely mutate authoritative data.

## Operating Context

Users import PDF, DOCX, or text resumes; edit structured resume sections; maintain language-linked base resumes; define role-specific search preferences; discover jobs from web search, connected company sources, manual URLs, and a Chrome extension; add selected jobs to an application pipeline; and prepare tailored resumes, cover letters, and interviews. Background work reports completion through notifications while the rest of the workspace remains usable.

## Capabilities and Constraints

- The application is built with Next.js, TypeScript, Drizzle ORM, and SQLite/libSQL-compatible storage.
- DeepSeek and OpenAI are supported through the backend; the browser never calls model providers directly.
- The interface works without AI for resume editing, manual job capture, and application tracking.
- Listing status and application status remain separate, and expired listings are retained with evidence.
- Original resumes and source snapshots are immutable; current structured state and job-specific resume versions remain traceable to sources.
- User-provided facts outrank AI-derived memories. Generated claims must be grounded in resume evidence or cited web sources.
- Job descriptions and web pages are untrusted input. PII must not be placed in public search queries.
- The first release does not automatically submit applications or send email.
- All user-facing AI output follows the active Chinese or English interface language unless the user explicitly selects an output language for a document.

## Brand Commitments

The product name is JobPilot. The interface should feel like a calm, capable professional workspace rather than a marketing dashboard or advertising feed. It may use selective motion and color to make automated work legible, but operational content and user decisions remain visually primary.

## Evidence on Hand

The repository contains the working application, bilingual product copy, representative local data flows, automated tests, a packaged Chrome extension, and open-source/cloud deployment branches. No testimonials, commercial benchmarks, or customer claims should be invented.

## Product Principles

- Keep the user in control of consequential decisions.
- Automate setup and repetitive research while exposing sources, uncertainty, and status.
- Preserve original evidence and make every derived artifact traceable.
- Remain useful without an AI provider connection.
- Prefer a small number of understandable choices over configuration-heavy workflows.

## Accessibility & Inclusion

Core workflows must remain keyboard-accessible, responsive on desktop and mobile web, legible in Chinese and English, and understandable without relying on color alone.
