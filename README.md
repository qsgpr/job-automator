# Job Automator

A local AI tool that scrapes job postings, scores them against your resume, generates cover letters, and demos browser-based form auto-fill — all powered by Gemma running on your machine via Ollama.

Built with TypeScript, Playwright, and LangChain.

## What it does

| Feature | Description |
|---|---|
| **Analyze Job** | Paste a job URL → Playwright scrapes it → Gemma scores your resume fit (0–100) |
| **Browse Jobs** | Enter a company's careers page → lists all open roles |
| **Cover Letter** | Generates a tailored 3-4 paragraph cover letter from your resume + role |
| **Auto-Fill Demo** | Playwright opens a real browser and types your application fields live |
| **History** | Tracks every job you've analyzed with scores and timestamps |
| **Observability** | Per-run traces, LLM latency, token usage, and selector drift alerts |

## Architecture

```
src/
  main.ts          CLI entry point (Commander)
  scraper.ts       Playwright scraper + Greenhouse/Lever public APIs
  analyzer.ts      LangChain + Gemma (via Ollama) — analysis, cover letters
  autofill.ts      Playwright form auto-fill demo
  observability.ts SQLite-backed run traces and selector reliability stats
  types.ts         Shared interfaces
```

**Scraper dispatch** (fastest path first):
1. Greenhouse public JSON API — instant, no browser needed
2. Lever public JSON API — instant, no browser needed
3. Playwright + structured card selectors
4. Playwright + Gemma (LLM reads the link list and identifies job postings)

**Bot-detection handling**: multi-phrase block detection, realistic user-agent + viewport, random human-timing delays.

## Prerequisites

- Node.js 18+
- [Ollama](https://ollama.com) installed and running
- Gemma 4 26B pulled: `ollama pull gemma4:26b`

## Setup

```bash
# 1. Clone
git clone https://github.com/<your-username>/job-automator.git
cd job-automator

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npx playwright install chromium

# 4. Add your resume
touch resume.txt   # then paste your resume text inside

# 5. Start Ollama (in a separate terminal)
ollama serve
```

## Usage

### Analyze a single job posting

```bash
npx tsx src/main.ts https://boards.greenhouse.io/company/jobs/12345

# Save a report to reports/
npx tsx src/main.ts --url <url> --save
```

### List all open roles from a careers page

```bash
npx tsx src/main.ts --list-jobs https://company.com/careers
```

### Show analysis history

```bash
npx tsx src/main.ts --history
```

### Run the auto-fill demo

```bash
npx tsx src/autofill.ts
npx tsx src/autofill.ts --mode instant
npx tsx src/autofill.ts --mode instant_per_field --from-files
```

## Supported job boards

Works best with:
- **Greenhouse** (`boards.greenhouse.io`) — uses public API, fastest
- **Lever** (`jobs.lever.co`) — uses public API, fastest
- **Ashby, Workday, iCIMS, BambooHR, Workable** — Playwright fallback
- **Any custom careers page** — Playwright + Gemma link extraction

Indeed and LinkedIn actively block headless browsers and are not reliable targets.

## Notes

- `resume.txt`, `cover_letter.txt`, `history.json`, `reports/`, and `observability.db` are gitignored — personal data, never committed.
- Analysis takes 30–60 seconds depending on your hardware (Gemma 4 26B is a large model).
- The auto-fill demo targets the local `form.html` file — it does not submit to any real job board.
