# Job Automator

A full-stack job market intelligence system that automatically scrapes job listings, analyzes them against your resume using AI, and provides intelligent tracking and notifications. Built with Playwright, LangGraph, and LLM-powered analysis.

## Features

### Core Intelligence
- **Resume-Job Matching**: Uses LangGraph to extract job requirements and score your resume against them via vector embeddings
- **Multi-ATS Support**: Scrapes jobs from Greenhouse, Lever, Ashby, and Workable job boards
- **Vector Embeddings**: Ollama-powered embeddings with SQLite cosine similarity for semantic matching
- **Caching**: Automatic result caching to avoid re-processing identical jobs

### Web UI
- **Feed View**: Browse all jobs with real-time match scores, filter/search, and re-analyze capabilities
- **Application Board**: Kanban-style tracking with columns (Interested → Applied → Interviewing → Offer → Rejected)
- **Auto-Scan Scheduling**: Optional cron-based automated job scanning with customizable frequency
- **High-Match Alerts**: ntfy push notifications when jobs exceed your match threshold
- **Settings Management**: Configure scanning schedule, alert thresholds, notification topics

### CLI Tools
- Bulk job scraping with progress tracking
- Individual job analysis with detailed output
- Resume upload (PDF/DOCX) with preprocessing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Web UI (React-like)                  │
│  ├─ Feed Tab: Job listing with scores & re-analyze         │
│  ├─ Board Tab: Kanban application tracker                  │
│  ├─ Search Tab: Advanced filtering                         │
│  └─ Admin Tab: Settings & configuration                    │
└────────────┬────────────────────────────────────────────────┘
             │ NDJSON streaming
┌────────────┴────────────────────────────────────────────────┐
│                      Express Server                         │
│  ├─ /api/scan: Stream job scraping + analysis              │
│  ├─ /api/feed: Paginated cached results                    │
│  ├─ /api/applications: CRUD for tracked jobs               │
│  ├─ /api/settings: Configuration management                │
│  └─ /api/settings/test-ntfy: Notification testing          │
└────────┬──────┬──────┬──────┬──────────────────────────────┘
         │      │      │      │
    ┌────▼──┐ ┌─▼────┐│      │
    │Scraper│ │LLM   ││      │
    │       │ │Chain ││      │
    └──┬────┘ └──────┘│      │
       │              │      │
    ┌──▼──────────────▼─┐    │
    │   SQLite DB      │    │
    │ ├─ jobs          │    │
    │ ├─ analyses      │    │
    │ ├─ applications  │    │
    │ ├─ app_settings  │    │
    │ └─ resume_cache  │    │
    └──────────────────┘    │
                            │
                    ┌───────▼─────┐
                    │ Ollama LLM  │
                    │ & Embeddings│
                    └─────────────┘
```

### Pipeline: LangGraph 2-Node Analysis

1. **Extract Node**: Uses LLM to identify required skills, experience, and qualifications from job description
2. **Score Node**: Compares extracted requirements against your resume using vector similarity
3. **Output**: Match score (0-100) with detailed analysis

Vector embeddings are stored in SQLite and queried via cosine similarity for fast matching.

## Tech Stack

### Backend
- **Node.js 22** with TypeScript
- **Express.js** for HTTP API
- **LangChain/LangGraph** for AI orchestration
- **Ollama** for local LLM and embeddings (no external API costs)
- **Playwright** for headless browser automation
- **Better-SQLite3** for embedded database
- **node-cron** for scheduled scanning
- **ntfy** for push notifications

### Frontend
- **Vanilla JavaScript** (no build step needed)
- **CSS Grid/Flexbox** with modern design patterns
- **EventSource** for real-time streaming updates

### DevOps
- **Docker** multi-stage build for production
- **GitHub Actions** CI pipeline (type-check, build, Docker build)

## Installation

### Prerequisites
- **Node.js 22** or higher
- **Ollama** running locally (default: http://localhost:11434)
  - Pull required models: `ollama pull mistral` and `ollama pull nomic-embed-text`

### Setup

```bash
# Clone and install
git clone <repo>
cd job-automator
npm install

# Build TypeScript
npm run build

# Web UI (development)
npm run dev:web
# Open http://localhost:3000

# CLI tool (development)
npm run dev
```

## Usage

### Web Interface

1. **Upload Resume** (Admin tab):
   - Upload PDF or DOCX file
   - Extracts text automatically

2. **Configure Settings** (Admin tab):
   - Enable/disable auto-scanning
   - Set cron schedule (presets: Daily 9am, Weekdays 9am, Every 6h, or custom)
   - Configure ntfy topic and server for alerts
   - Set match score threshold (default: 80)

3. **Browse Feed** (Feed tab):
   - View all analyzed jobs with match scores
   - Search/filter by title, company, score
   - Click "Re-analyze" on individual jobs or "Re-scan All" to update scores
   - Click "＋ Track" to add to application board

4. **Track Applications** (Board tab):
   - Drag cards between columns (Interested → Applied → Interviewing → Offer → Rejected)
   - Add/edit notes on each application
   - Delete tracked applications

### CLI

```bash
# Scan job boards and analyze all jobs
npm start

# With progress tracking and real-time streaming output
# Results cached in SQLite, no re-processing of identical jobs
```

## Configuration

Settings are managed via the Admin tab and stored in SQLite:

| Key | Type | Description |
|-----|------|-------------|
| `scan_enabled` | bool | Auto-scan enabled |
| `scan_cron` | string | Cron expression (e.g., `0 9 * * *` = 9am daily) |
| `scan_user_id` | number | User ID for scheduled scans |
| `alert_enabled` | bool | Send ntfy alerts on high matches |
| `alert_threshold` | number | Score threshold for alerts (0-100) |
| `ntfy_topic` | string | ntfy topic (e.g., `job-alerts-username`) |
| `ntfy_server` | string | ntfy server URL (default: `https://ntfy.sh`) |

## Docker Deployment

```bash
# Build image
docker build -t job-automator .

# Run with Ollama (requires docker-compose for sidecar)
docker-compose up

# Or standalone (if Ollama runs separately)
docker run -p 3000:3000 \
  -e OLLAMA_URL=http://your-ollama-host:11434 \
  job-automator
```

## Architecture & Learning Gaps

This project bridges several advanced ML/AI engineering gaps:

### What Works Well
- **Semantic Matching**: Vector embeddings + cosine similarity properly match resume skills to job requirements
- **Streaming UX**: NDJSON streaming provides real-time feedback during long-running scans
- **Local LLM**: Ollama eliminates external API costs and latency
- **Scalable Scraping**: Playwright handles modern job boards with JavaScript rendering

### Known Limitations & Future Work

1. **Fine-tuning**: Ollama's base models aren't fine-tuned on job/resume data. A production system would:
   - Collect labeled job-resume pairs from user feedback
   - Fine-tune embeddings on job domain vocabulary
   - Use reinforcement learning to improve scoring accuracy

2. **Cloud Infrastructure**:
   - This single-server design doesn't scale to 1000s of concurrent scans
   - Production would use: job queue (Bull/RabbitMQ), distributed LLM inference (vLLM/ray), caching layer (Redis)

3. **Resume Preprocessing**:
   - Current approach loads entire resume into context
   - Better approach: extract structured data (skills, experience, education) separately and index each component

4. **Multi-round Analysis**:
   - Single LangGraph pass may miss nuanced requirements
   - Advanced systems iterate: extract → clarify ambiguities → re-score → rank

5. **Feedback Loop**:
   - No learning from which jobs the user actually applied to
   - Could retrain embeddings based on user decisions (applied ✓, rejected ✗)

## Project Structure

```
.
├── src/
│   ├── main.ts              # CLI entry point
│   ├── server.ts            # Express server + API routes
│   ├── graph.ts             # LangGraph 2-node analysis pipeline
│   ├── analyzer.ts          # LLM prompt engineering
│   ├── scraper.ts           # Playwright job scraping
│   ├── embeddings.ts        # Ollama vector embeddings
│   ├── feed.ts              # Feed aggregation logic
│   ├── profiles.ts          # Resume & application management
│   ├── observability.ts     # SQLite & settings
│   ├── scheduler.ts         # node-cron scheduled scanning
│   ├── notify.ts            # ntfy notifications
│   ├── autofill.ts          # Job application helper (future)
│   ├── apply.ts             # Application workflow (future)
│   ├── history.ts           # Activity tracking (future)
│   └── types.ts             # TypeScript interfaces
├── public/
│   ├── index.html           # Web UI markup
│   ├── style.css            # Tailwind-inspired styling
│   └── app.js               # Frontend logic
├── Dockerfile               # Multi-stage build
├── docker-compose.yml       # Ollama sidecar
├── tsconfig.json            # TypeScript config
├── package.json
└── .github/workflows/
    └── ci.yml               # GitHub Actions
```

## Development

```bash
# Type checking
npm run build

# Format check
npx tsc --noEmit

# Watch mode (backend)
npm run dev:web

# Watch mode (CLI)
npm run dev
```

## Contributing

This is a learning project exploring:
- Semantic job-resume matching with embeddings
- Streaming server-sent event UX patterns
- Local LLM integration without external APIs
- Full-stack TypeScript from scraping to UI

For bugs or improvements, open an issue or PR.

## License

MIT
