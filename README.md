# Job Automator

A local AI tool that scrapes job postings, scores them against your resume, generates cover letters, and demos browser-based form auto-fill — all powered by Gemma running on your machine via Ollama.

## What it does

| Feature | Description |
|---|---|
| **Analyze Job** | Paste a job URL → Playwright scrapes it → Gemma scores your resume fit (0–100) |
| **Browse Jobs** | Enter a company's careers page → lists all open roles with 1-click analysis |
| **Cover Letter** | Generates a tailored 3-4 paragraph cover letter from your resume + role |
| **Auto-Fill Demo** | Playwright opens a real browser and types your application fields live |
| **History** | Tracks every job you've analyzed with scores and timestamps |
| **Observability** | Per-run traces, LLM latency, token usage, and selector drift alerts |

## Architecture

```
main.py          CLI entry point
app.py           Streamlit web UI
scraper.py       Playwright scraper + Greenhouse/Lever public APIs
analyzer.py      LangChain + Gemma (via Ollama) — resume analysis, cover letters
autofill.py      Playwright form auto-fill demo
observability.py SQLite-backed run traces and selector reliability stats
```

**Scraper dispatch** (fastest path first):
1. Greenhouse public JSON API — instant, no browser needed
2. Lever public JSON API — instant, no browser needed
3. Playwright + structured card selectors
4. Playwright + Gemma (LLM reads the link list and identifies job postings)

**Bot-detection handling**: multi-phrase block detection, realistic user-agent + viewport, random human-timing delays.

## Prerequisites

- Python 3.9+
- [Ollama](https://ollama.com) installed and running
- Gemma 4 26B pulled: `ollama pull gemma4:26b`
- Playwright browsers installed (done during setup)

## Setup

```bash
# 1. Clone
git clone https://github.com/<your-username>/job-automator.git
cd job-automator

# 2. Virtual environment
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# 3. Dependencies
pip install -r requirements.txt
playwright install chromium

# 4. Add your resume
# Create resume.txt in the project root and paste your resume text into it
touch resume.txt

# 5. Start Ollama (in a separate terminal)
ollama serve
```

## Usage

### Streamlit UI (recommended)

```bash
streamlit run app.py
```

Opens at `http://localhost:8501` with all six tabs.

### CLI

```bash
# Analyze a single job posting
python3 main.py https://boards.greenhouse.io/company/jobs/12345

# Analyze and save a report
python3 main.py --url <url> --save

# List all open roles from a careers page
python3 main.py --list-jobs https://company.com/careers

# Show analysis history
python3 main.py --history
```

## Supported job boards

Works best with:
- **Greenhouse** (`boards.greenhouse.io`) — uses public API, fastest
- **Lever** (`jobs.lever.co`) — uses public API, fastest
- **Ashby, Workday, iCIMS, BambooHR, Workable** — Playwright fallback
- **Any custom careers page** — Playwright + Gemma link extraction

Indeed and LinkedIn actively block headless browsers and are not reliable targets.

## Notes

- `resume.txt`, `cover_letter.txt`, `history.json`, `reports/`, and `observability.db` are gitignored — they contain personal data and should never be committed.
- Analysis takes 30–60 seconds depending on your hardware (Gemma 4 26B is a large model).
- The auto-fill demo targets the local `form.html` file included in the repo — it does not submit to any real job board.
