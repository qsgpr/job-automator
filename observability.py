"""
observability.py — SQLite-backed tracing for runs and selector reliability.

Tables:
  runs             — one row per pipeline execution (analyze, browse, etc.)
  run_events       — one row per step within a run (scrape, llm call, etc.)
  selector_results — one row per Playwright selector attempt
"""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "observability.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _conn() as conn:
        conn.executescript("""
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
        """)


_init_db()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ── run lifecycle ──────────────────────────────────────────────────────────────

def start_run(run_type: str, metadata: dict) -> str:
    """Open a new run and return its run_id."""
    run_id = uuid.uuid4().hex[:12]
    with _conn() as conn:
        conn.execute(
            "INSERT INTO runs (run_id, run_type, started_at, status, metadata_json) VALUES (?, ?, ?, 'running', ?)",
            (run_id, run_type, _now(), json.dumps(metadata)),
        )
    return run_id


def add_run_event(
    run_id: str,
    step: str,
    tool_call: str,
    latency_ms: float,
    token_usage: dict,
    error=None,
    retry_of=None,
    details: dict = None,
) -> None:
    """Append a timed step event to an existing run."""
    with _conn() as conn:
        conn.execute(
            """INSERT INTO run_events
               (run_id, time, step, tool_call, latency_ms,
                prompt_tokens, completion_tokens, total_tokens,
                error, retry_of, details_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id,
                _now(),
                step,
                tool_call,
                round(latency_ms, 1),
                token_usage.get("prompt_tokens"),
                token_usage.get("completion_tokens"),
                token_usage.get("total_tokens"),
                str(error) if error else None,
                retry_of,
                json.dumps(details) if details else None,
            ),
        )


def finish_run(run_id: str, status: str, summary: dict) -> None:
    """Mark a run as finished with a final status and summary."""
    with _conn() as conn:
        conn.execute(
            "UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE run_id = ?",
            (status, _now(), json.dumps(summary), run_id),
        )


# ── query helpers ──────────────────────────────────────────────────────────────

def get_timeline_events(limit_runs: int = 30, limit_events: int = 400) -> list[dict]:
    """
    Flat list of events joined with parent run metadata, newest first.
    Columns match the dataframe expected by the Observability tab.
    """
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT
                e.time,
                e.run_id,
                r.run_type,
                r.status                   AS run_status,
                e.step,
                e.tool_call,
                ROUND(e.latency_ms, 0)     AS latency_ms,
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
            """,
            (limit_runs, limit_events),
        ).fetchall()
    return [dict(r) for r in rows]


def get_selector_reliability(min_attempts: int = 1) -> list[dict]:
    """
    Per-selector aggregate stats.
    Columns: context, selector, attempts, successes, overall_rate,
             recent_rate, avg_latency_ms, last_error.
    """
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT
                context,
                selector,
                COUNT(*)                      AS attempts,
                SUM(success)                  AS successes,
                ROUND(AVG(success) * 100, 1)  AS overall_rate,
                ROUND(AVG(latency_ms), 0)     AS avg_latency_ms,
                MAX(CASE WHEN error IS NOT NULL THEN error END) AS last_error
            FROM selector_results
            GROUP BY context, selector
            HAVING attempts >= ?
            ORDER BY context, selector
            """,
            (min_attempts,),
        ).fetchall()

        result = []
        for r in rows:
            d = dict(r)
            recent_val = conn.execute(
                """
                SELECT AVG(success) * 100
                FROM (
                    SELECT success FROM selector_results
                    WHERE context = ? AND selector = ?
                    ORDER BY id DESC LIMIT 10
                )
                """,
                (d["context"], d["selector"]),
            ).fetchone()[0]
            d["recent_rate"] = round(recent_val, 1) if recent_val is not None else d["overall_rate"]
            result.append(d)

    return result


def get_selector_alerts(drop_threshold: float = 15.0) -> list[dict]:
    """
    Selectors where recent success rate has dropped vs. the overall baseline.
    severity: 'high' if drop > 30 pp, 'medium' if drop > drop_threshold.
    """
    alerts = []
    for r in get_selector_reliability(min_attempts=3):
        drop = r["overall_rate"] - r["recent_rate"]
        if drop >= drop_threshold:
            alerts.append({
                "severity":     "high" if drop > 30 else "medium",
                "context":      r["context"],
                "selector":     r["selector"],
                "recent_rate":  r["recent_rate"],
                "overall_rate": r["overall_rate"],
                "drop":         round(drop, 1),
                "attempts":     r["attempts"],
                "last_error":   r.get("last_error") or "",
            })
    alerts.sort(key=lambda a: a["drop"], reverse=True)
    return alerts


# ── selector tracing ───────────────────────────────────────────────────────────

def record_selector_result(
    selector: str,
    context: str,
    success: bool,
    latency_ms: float = 0.0,
    error: str = None,
) -> None:
    """Record one Playwright selector attempt. Called by scraper.py."""
    with _conn() as conn:
        conn.execute(
            "INSERT INTO selector_results (time, context, selector, success, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)",
            (_now(), context, selector, int(success), latency_ms, error),
        )
