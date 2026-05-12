import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? join(__dirname, '..', 'observability.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    email                TEXT NOT NULL DEFAULT '',
    phone                TEXT NOT NULL DEFAULT '',
    linkedin             TEXT NOT NULL DEFAULT '',
    resume_text          TEXT NOT NULL DEFAULT '',
    supabase_user_id     TEXT,
    street               TEXT NOT NULL DEFAULT '',
    city                 TEXT NOT NULL DEFAULT '',
    state                TEXT NOT NULL DEFAULT '',
    zip                  TEXT NOT NULL DEFAULT '',
    work_authorized      TEXT NOT NULL DEFAULT '',
    requires_sponsorship TEXT NOT NULL DEFAULT '',
    available_start      TEXT NOT NULL DEFAULT '',
    years_experience     TEXT NOT NULL DEFAULT '',
    ts_proficiency       TEXT NOT NULL DEFAULT '',
    llm_frameworks       TEXT NOT NULL DEFAULT '[]',
    additional_info      TEXT NOT NULL DEFAULT '',
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_preferences (
    user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    work_type           TEXT NOT NULL DEFAULT 'any',
    work_type_mode      TEXT NOT NULL DEFAULT 'soft',
    departments         TEXT NOT NULL DEFAULT '[]',
    departments_mode    TEXT NOT NULL DEFAULT 'soft',
    salary_min          INTEGER,
    salary_mode         TEXT NOT NULL DEFAULT 'soft',
    exp_level           TEXT NOT NULL DEFAULT 'any',
    exp_level_mode      TEXT NOT NULL DEFAULT 'soft',
    location_pref       TEXT NOT NULL DEFAULT '',
    location_pref_mode  TEXT NOT NULL DEFAULT 'soft'
  );

  CREATE TABLE IF NOT EXISTS job_sites (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    url      TEXT NOT NULL UNIQUE,
    notes    TEXT NOT NULL DEFAULT '',
    active   INTEGER NOT NULL DEFAULT 1,
    ats_type TEXT NOT NULL DEFAULT '',
    ats_slug TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feed_jobs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    site_id        INTEGER NOT NULL,
    job_url        TEXT NOT NULL,
    job_title      TEXT NOT NULL DEFAULT '',
    location       TEXT NOT NULL DEFAULT '',
    department     TEXT NOT NULL DEFAULT '',
    analysis_json  TEXT,
    match_score    INTEGER,
    filter_result  TEXT NOT NULL DEFAULT 'pass',
    warnings_json  TEXT NOT NULL DEFAULT '[]',
    first_seen     TEXT NOT NULL,
    last_seen      TEXT NOT NULL,
    UNIQUE(user_id, job_url)
  );

  CREATE TABLE IF NOT EXISTS scraped_jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id       INTEGER NOT NULL,
    job_url       TEXT NOT NULL UNIQUE,
    job_title     TEXT NOT NULL DEFAULT '',
    location      TEXT NOT NULL DEFAULT '',
    department    TEXT NOT NULL DEFAULT '',
    jd_text       TEXT,
    scrape_status TEXT NOT NULL DEFAULT 'discovered',
    scrape_error  TEXT,
    first_seen    TEXT NOT NULL,
    last_seen     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analysis_inputs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    time      TEXT NOT NULL,
    url       TEXT,
    title     TEXT,
    score     INTEGER,
    jd_length INTEGER NOT NULL,
    jd_sent   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runs (
    run_id        TEXT PRIMARY KEY,
    run_type      TEXT NOT NULL,
    started_at    TEXT NOT NULL,
    finished_at   TEXT,
    status        TEXT NOT NULL DEFAULT 'running',
    summary_json  TEXT,
    metadata_json TEXT
  );

  CREATE TABLE IF NOT EXISTS run_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id            TEXT NOT NULL,
    time              TEXT NOT NULL,
    step              TEXT NOT NULL,
    tool_call         TEXT,
    latency_ms        REAL,
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    total_tokens      INTEGER,
    error             TEXT,
    retry_of          INTEGER,
    details_json      TEXT
  );

  CREATE TABLE IF NOT EXISTS selector_results (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    time       TEXT NOT NULL,
    context    TEXT NOT NULL,
    selector   TEXT NOT NULL,
    success    INTEGER NOT NULL,
    latency_ms REAL,
    error      TEXT
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS applications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    job_url     TEXT NOT NULL,
    job_title   TEXT NOT NULL DEFAULT '',
    site_name   TEXT NOT NULL DEFAULT '',
    match_score INTEGER,
    status      TEXT NOT NULL DEFAULT 'interested',
    notes       TEXT NOT NULL DEFAULT '',
    added_at    TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(user_id, job_url)
  );

  CREATE TABLE IF NOT EXISTS company_profiles (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name         TEXT NOT NULL UNIQUE,
    website              TEXT,
    description          TEXT,
    tech_stack           TEXT,
    culture_signals      TEXT,
    recent_news          TEXT,
    interview_talking_points TEXT,
    founded_year         INTEGER,
    employee_count       TEXT,
    funding_status       TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL,
    cache_expires_at     TEXT NOT NULL,
    data_sources_json    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_company_profiles_name ON company_profiles(company_name);
  CREATE INDEX IF NOT EXISTS idx_company_profiles_expires ON company_profiles(cache_expires_at);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_supabase_id ON users(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS tailored_resumes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_url         TEXT NOT NULL,
    base_resume_text TEXT NOT NULL,
    tailored_resume_text TEXT NOT NULL,
    job_title       TEXT NOT NULL DEFAULT '',
    job_requirements_json TEXT,
    bullets_included INTEGER,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(user_id, job_url)
  );

  CREATE TABLE IF NOT EXISTS cover_letters (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_url             TEXT NOT NULL,
    company_profile_id  INTEGER,
    company_name        TEXT NOT NULL DEFAULT '',
    job_title           TEXT NOT NULL DEFAULT '',
    content             TEXT NOT NULL,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(user_id, job_url)
  );

  CREATE TABLE IF NOT EXISTS application_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id  INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    level           TEXT NOT NULL DEFAULT 'info',
    message         TEXT NOT NULL,
    error_details   TEXT,
    retry_count     INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL
  );
`);

// ── Settings helpers ───────────────────────────────────────────────────────────

export function getSetting(key: string): string {
  const row = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? '';
}

export function setSetting(key: string, value: string): void {
  db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare(`SELECT key, value FROM app_settings`).all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function startRun(runType: string, metadata: Record<string, unknown>): string {
  const runId = randomBytes(6).toString('hex');
  db.prepare(
    `INSERT INTO runs (run_id, run_type, started_at, status, metadata_json) VALUES (?, ?, ?, 'running', ?)`
  ).run(runId, runType, now(), JSON.stringify(metadata));
  return runId;
}

export interface RunEventParams {
  runId: string;
  step: string;
  toolCall: string;
  latencyMs: number;
  tokenUsage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: string | null;
  retryOf?: number | null;
  details?: Record<string, unknown>;
}

export function addRunEvent(params: RunEventParams): void {
  const { runId, step, toolCall, latencyMs, tokenUsage = {}, error = null, retryOf = null, details } = params;
  db.prepare(`
    INSERT INTO run_events
      (run_id, time, step, tool_call, latency_ms,
       prompt_tokens, completion_tokens, total_tokens,
       error, retry_of, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId, now(), step, toolCall,
    Math.round(latencyMs * 10) / 10,
    tokenUsage.prompt_tokens ?? null,
    tokenUsage.completion_tokens ?? null,
    tokenUsage.total_tokens ?? null,
    error ? String(error) : null,
    retryOf ?? null,
    details ? JSON.stringify(details) : null,
  );
}

export function finishRun(runId: string, status: string, summary: Record<string, unknown>): void {
  db.prepare(
    `UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE run_id = ?`
  ).run(status, now(), JSON.stringify(summary), runId);
}

export interface SelectorResultParams {
  selector: string;
  context: string;
  success: boolean;
  latencyMs?: number;
  error?: string | null;
}

export function recordSelectorResult(params: SelectorResultParams): void {
  const { selector, context, success, latencyMs = 0, error = null } = params;
  db.prepare(
    `INSERT INTO selector_results (time, context, selector, success, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(now(), context, selector, success ? 1 : 0, latencyMs, error ?? null);
}

export function getTimelineEvents(limitRuns = 30, limitEvents = 400): Record<string, unknown>[] {
  return db.prepare(`
    SELECT
      e.time,
      e.run_id,
      r.run_type,
      r.status AS run_status,
      e.step,
      e.tool_call,
      ROUND(e.latency_ms, 0) AS latency_ms,
      e.prompt_tokens,
      e.completion_tokens,
      e.total_tokens,
      e.retry_of,
      e.error
    FROM run_events e
    JOIN runs r ON r.run_id = e.run_id
    WHERE r.run_id IN (
      SELECT run_id FROM runs ORDER BY started_at DESC LIMIT ?
    )
    ORDER BY e.time DESC
    LIMIT ?
  `).all(limitRuns, limitEvents) as Record<string, unknown>[];
}

interface SelectorRow {
  context: string;
  selector: string;
  attempts: number;
  successes: number;
  overall_rate: number;
  avg_latency_ms: number;
  last_error: string | null;
}

interface SelectorReliability extends SelectorRow {
  recent_rate: number;
}

export function getSelectorReliability(minAttempts = 1): SelectorReliability[] {
  const rows = db.prepare(`
    SELECT
      context,
      selector,
      COUNT(*) AS attempts,
      SUM(success) AS successes,
      ROUND(AVG(success) * 100, 1) AS overall_rate,
      ROUND(AVG(latency_ms), 0) AS avg_latency_ms,
      MAX(CASE WHEN error IS NOT NULL THEN error END) AS last_error
    FROM selector_results
    GROUP BY context, selector
    HAVING attempts >= ?
    ORDER BY context, selector
  `).all(minAttempts) as SelectorRow[];

  return rows.map(r => {
    const recent = db.prepare(`
      SELECT AVG(success) * 100
      FROM (
        SELECT success FROM selector_results
        WHERE context = ? AND selector = ?
        ORDER BY id DESC LIMIT 10
      )
    `).pluck().get(r.context, r.selector) as number | null;
    return {
      ...r,
      recent_rate: recent != null ? Math.round(recent * 10) / 10 : r.overall_rate,
    };
  });
}

export interface SelectorAlert extends SelectorReliability {
  severity: 'high' | 'medium';
  drop: number;
}

export function getSelectorAlerts(dropThreshold = 15): SelectorAlert[] {
  const alerts: SelectorAlert[] = [];
  for (const r of getSelectorReliability(3)) {
    const drop = r.overall_rate - r.recent_rate;
    if (drop >= dropThreshold) {
      alerts.push({
        ...r,
        severity: drop > 30 ? 'high' : 'medium',
        drop: Math.round(drop * 10) / 10,
      });
    }
  }
  return alerts.sort((a, b) => b.drop - a.drop);
}

export interface AnalysisInputParams {
  url?: string;
  title?: string;
  score?: number;
  jdSent: string;
}

export function recordAnalysisInput(params: AnalysisInputParams): void {
  const { url, title, score, jdSent } = params;
  db.prepare(
    `INSERT INTO analysis_inputs (time, url, title, score, jd_length, jd_sent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(now(), url ?? null, title ?? null, score ?? null, jdSent.length, jdSent);
}

export function getAnalysisInputs(limit = 20): Record<string, unknown>[] {
  return db.prepare(
    `SELECT id, time, url, title, score, jd_length, jd_sent
     FROM analysis_inputs ORDER BY id DESC LIMIT ?`
  ).all(limit) as Record<string, unknown>[];
}

// Safe migrations — these are no-ops if the column already exists
try { db.exec(`ALTER TABLE users ADD COLUMN phone    TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN linkedin TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE user_preferences ADD COLUMN departments_mode TEXT NOT NULL DEFAULT 'soft'`); } catch {}
try { db.exec(`ALTER TABLE job_sites ADD COLUMN ats_type TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE job_sites ADD COLUMN ats_slug TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE user_preferences ADD COLUMN location_pref_mode TEXT NOT NULL DEFAULT 'soft'`); } catch {}
// Address + application facts
try { db.exec(`ALTER TABLE users ADD COLUMN street               TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN city                 TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN state                TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN zip                  TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN work_authorized      TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN requires_sponsorship TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN available_start      TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN years_experience     TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN ts_proficiency       TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN llm_frameworks       TEXT NOT NULL DEFAULT '[]'`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN additional_info      TEXT NOT NULL DEFAULT ''`); } catch {}

// ── Per-user job_sites migration ──────────────────────────────────────────────
// Recreates job_sites with user_id + UNIQUE(user_id, url) if not yet migrated.
{
  const cols = (db.prepare('PRAGMA table_info(job_sites)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('user_id')) {
    db.exec(`
      CREATE TABLE job_sites_v2 (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id  INTEGER NOT NULL DEFAULT 2,
        name     TEXT NOT NULL,
        url      TEXT NOT NULL,
        notes    TEXT NOT NULL DEFAULT '',
        active   INTEGER NOT NULL DEFAULT 1,
        ats_type TEXT NOT NULL DEFAULT '',
        ats_slug TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL,
        UNIQUE(user_id, url)
      );
      INSERT OR IGNORE INTO job_sites_v2 (id, user_id, name, url, notes, active, ats_type, ats_slug, added_at)
        SELECT id, 2, name, url, notes, active, ats_type, ats_slug, added_at FROM job_sites;
      DROP TABLE job_sites;
      ALTER TABLE job_sites_v2 RENAME TO job_sites;
    `);
  }
}

// ── Application logging helpers ───────────────────────────────────────────────

export interface ApplicationLogParams {
  applicationId: number;
  userId: number;
  eventType: string;
  level?: 'info' | 'warning' | 'error';
  message: string;
  errorDetails?: string | null;
  retryCount?: number;
}

export function logApplicationEvent(params: ApplicationLogParams): void {
  const { applicationId, userId, eventType, level = 'info', message, errorDetails = null, retryCount = 0 } = params;
  db.prepare(`
    INSERT INTO application_logs
      (application_id, user_id, event_type, level, message, error_details, retry_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(applicationId, userId, eventType, level, message, errorDetails, retryCount, now());
}

export function getApplicationLogs(applicationId: number, limit = 100): Record<string, unknown>[] {
  return db.prepare(`
    SELECT id, event_type, level, message, error_details, retry_count, created_at
    FROM application_logs
    WHERE application_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(applicationId, limit) as Record<string, unknown>[];
}

export function getApplicationLastError(applicationId: number): Record<string, unknown> | null {
  return db.prepare(`
    SELECT event_type, message, error_details, created_at
    FROM application_logs
    WHERE application_id = ? AND level = 'error'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(applicationId) as Record<string, unknown> | null;
}

export { db };
