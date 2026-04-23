import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'observability.db');

const db = new Database(DB_PATH);

db.exec(`
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
`);

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
