import { db } from './observability.js';

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS job_embeddings (
    url        TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    score      INTEGER,
    vec_json   TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// ── Ollama embedding via REST ─────────────────────────────────────────────────
// Uses /api/embed — much faster than generation since no tokens are sampled.
// gemma4:26b produces 5120-dim vectors. In production, swap for a dedicated
// embedding model (nomic-embed-text, mxbai-embed-large) to reduce latency.

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'gemma4:26b';

export async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { embeddings: number[][] };
  return data.embeddings[0];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function storeJobEmbedding(
  url: string,
  title: string,
  jdText: string,
  score?: number,
): Promise<void> {
  const vec = await getEmbedding(jdText);
  db.prepare(`
    INSERT OR REPLACE INTO job_embeddings (url, title, score, vec_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(url, title, score ?? null, JSON.stringify(vec), new Date().toISOString());
}

export interface SimilarJob {
  url:        string;
  title:      string;
  score:      number | null;
  similarity: number;
}

export async function findSimilarJobs(jdText: string, limit = 5): Promise<SimilarJob[]> {
  const rows = db.prepare(
    `SELECT url, title, score, vec_json FROM job_embeddings`
  ).all() as { url: string; title: string; score: number | null; vec_json: string }[];

  if (rows.length === 0) return [];

  const queryVec = await getEmbedding(jdText);

  return rows
    .map(row => ({
      url:        row.url,
      title:      row.title,
      score:      row.score,
      similarity: cosineSimilarity(queryVec, JSON.parse(row.vec_json) as number[]),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export function listStoredEmbeddings(): { url: string; title: string; score: number | null; created_at: string }[] {
  return db.prepare(
    `SELECT url, title, score, created_at FROM job_embeddings ORDER BY created_at DESC`
  ).all() as { url: string; title: string; score: number | null; created_at: string }[];
}
