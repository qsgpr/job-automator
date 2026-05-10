# NotchUp Job Automator

A production multi-agent system that finds jobs, scores them against your resume, tailors your application materials, and submits the form — autonomously.

> Live at **[jobs.qsgpr.com](https://jobs.qsgpr.com)**

---

## What it does

- **Scrapes & scores** job listings from Greenhouse, Lever, Ashby, and Workable using a 2-node LangGraph pipeline (Gemini 2.5 Flash) that extracts requirements and scores your resume against them (0-100)
- **Researches companies** — crawls the company website and recent news before writing a single word of your cover letter
- **Tailors your resume and writes a cover letter** — per-job, grounded in the company context and gap analysis from the scoring step
- **Fills and submits application forms** — Playwright stealth browser handles field detection, resume upload, cover letter injection, and captcha solving via CapSolver

---

## Architecture

```
iOS App / Web UI
      │  Supabase JWT
      ▼
┌─────────────────────────────────────────────────┐
│              Express API (Node 22)               │
│  /api/scan  /api/apply  /api/feed  /api/board   │
└────────┬──────────────────────────┬─────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐      ┌──────────────────────┐
│  Scraper Agent  │      │  LangGraph Pipeline  │
│  (Playwright    │      │  extract → score     │
│   stealth)      │      │  (Gemini 2.5 Flash)  │
└────────┬────────┘      └──────────┬───────────┘
         │                          │
         ▼                          ▼
┌───────────────────────────────────────────────┐
│               SQLite (Better-SQLite3)          │
│  jobs · analyses · applications · settings    │
│  company_profiles · cover_letters · history   │
└───────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│          Apply Pipeline (per job)           │
│  research → tailor → cover letter → fill   │
│  → captcha solve → submit → screenshot     │
└─────────────────────────────────────────────┘
```

---

## The 7-Agent Pipeline

Each application runs these steps in sequence:

| # | Agent | What it does |
|---|-------|-------------|
| 1 | **Scraper** | Playwright stealth browser fetches job description; detects and handles bot-protection blocks |
| 2 | **Extract** | LangGraph node — Gemini parses the JD into `requirements[]` and `nice_to_have[]` |
| 3 | **Score** | LangGraph node — Gemini scores your resume against the extracted requirements; returns match score, strengths, gaps, summary |
| 4 | **Research** | Crawls company website + recent news; builds a `CompanyProfile` (mission, products, tech stack, tone) |
| 5 | **Tailor** | Rewrites resume bullets to surface the most relevant experience for this specific role |
| 6 | **Cover Letter** | Generates a personalized cover letter grounded in company context, gaps, and your strongest bullets |
| 7 | **Autofill** | Stealth Playwright fills the ATS form — detects field types, uploads resume PDF, injects cover letter, solves captchas (hCaptcha / reCAPTCHA v2+v3 / Cloudflare) via CapSolver, submits |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22, TypeScript |
| API server | Express |
| AI orchestration | LangChain + LangGraph |
| LLM | Google Gemini 2.5 Flash |
| Browser automation | Playwright + playwright-extra stealth plugin |
| Captcha solving | CapSolver API |
| Database | SQLite via Better-SQLite3 |
| Auth | Supabase JWT (HS256 / RS256) |
| Scheduling | node-cron |
| Containerization | Docker (multi-stage) |
| Tunnel | Cloudflare Tunnel |
| Host | CasaOS home server |

---

## Getting Started

### Prerequisites

- Node.js 22+
- A Google AI API key (Gemini 2.5 Flash)
- A Supabase project (for auth)

### Local dev

```bash
git clone <repo>
cd job-automator
npm install

# Copy and fill in env vars
cp .env.example .env

# Start the dev server (ts-node watch)
npm run dev:web
# → http://localhost:3000
```

### Run a scan manually

```bash
npm start
```

---

## Deployment

The production stack runs two containers behind a Cloudflare Tunnel — no open inbound ports required.

```bash
# On the CasaOS server
cp .env.example .env   # fill in secrets

docker compose -f docker-compose.server.yml up -d
```

The `tunnel` service connects outbound to Cloudflare and routes `jobs.qsgpr.com` to the app container on port 3000.

Persistent data lives in named Docker volumes (`job_data`, `resume`) so the database and resume survive container restarts.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Google AI Studio API key (Gemini 2.5 Flash) |
| `SUPABASE_JWT_SECRET` | Yes | JWT secret from your Supabase project settings |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `CAPSOLVER_API_KEY` | No | CapSolver key for automated captcha solving |
| `CLOUDFLARE_TUNNEL_TOKEN` | Prod | Cloudflare Tunnel token for `jobs.qsgpr.com` |
| `DB_PATH` | No | SQLite file path (default: `./data/observability.db`) |
| `PORT` | No | HTTP port (default: `3000`) |

---

## Project Structure

```
src/
├── server.ts          # Express routes + SSE streaming
├── graph.ts           # LangGraph 2-node analysis pipeline
├── scraper.ts         # Playwright job scraping
├── apply.ts           # Full application orchestrator + captcha handling
├── autofill.ts        # ATS form detection and field filling
├── research.ts        # Company profile crawler
├── tailor.ts          # Resume bullet tailoring
├── coverletter-agent.ts # Cover letter generation
├── analyzer.ts        # LLM prompt helpers
├── auth.ts            # Supabase JWT middleware
├── profiles.ts        # User + resume management
├── observability.ts   # SQLite schema + queries
├── scheduler.ts       # Cron-based auto-scan
├── notify.ts          # ntfy push notifications
├── history.ts         # Application event log
└── types.ts           # Shared TypeScript interfaces
```

---

## Live Demo

**[jobs.qsgpr.com](https://jobs.qsgpr.com)**

---

## License

MIT
