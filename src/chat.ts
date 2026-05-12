import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { db } from './observability.js';

db.prepare(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`).run();

try { db.prepare('ALTER TABLE users ADD COLUMN chat_token_used INTEGER DEFAULT 0').run(); } catch {}
try { db.prepare('ALTER TABLE users ADD COLUMN chat_token_limit INTEGER DEFAULT 100000').run(); } catch {}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface ChatQuota {
  used: number;
  limit: number;
  remaining: number;
  pct: number;
}

export interface JobContext {
  job_title: string;
  match_score: number;
  analysis_json: string | null;
  job_url: string;
}

// ~4 chars per token (rough but consistent estimate)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function getChatQuota(userId: number): ChatQuota {
  const user = db.prepare('SELECT chat_token_used, chat_token_limit FROM users WHERE id = ?').get(userId) as any;
  const used  = user?.chat_token_used  ?? 0;
  const limit = user?.chat_token_limit ?? 100000;
  const remaining = Math.max(0, limit - used);
  const pct = Math.round((remaining / limit) * 100);
  return { used, limit, remaining, pct };
}

export function getChatHistory(userId: number): ChatMessage[] {
  return db.prepare(
    'SELECT role, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY id'
  ).all(userId) as ChatMessage[];
}

export function clearChatHistory(userId: number): void {
  db.prepare('DELETE FROM chat_messages WHERE user_id = ?').run(userId);
}

function saveMessage(userId: number, role: string, content: string): void {
  db.prepare('INSERT INTO chat_messages (user_id, role, content) VALUES (?, ?, ?)').run(userId, role, content);
}

/**
 * Build a compact jobs context block that stays well under 2,000 tokens.
 * Each job gets: score, title, 1-line summary, top 2 strengths, top 2 gaps.
 * ~80–120 tokens per job × 15 jobs ≈ 1,200–1,800 tokens total.
 */
function buildJobsContext(jobs: JobContext[]): string {
  if (!jobs.length) return '';

  const lines: string[] = [`\nScanned job matches (${jobs.length} total, best first):`];

  for (const j of jobs) {
    let analysis: any = null;
    try { if (j.analysis_json) analysis = JSON.parse(j.analysis_json); } catch {}

    const score   = j.match_score;
    const title   = j.job_title;
    const summary = analysis?.summary?.slice(0, 160) ?? '';
    const strengths = (analysis?.strengths ?? []).slice(0, 2);
    const gaps      = (analysis?.gaps ?? []).slice(0, 2);

    lines.push(`\n[${score}%] ${title}`);
    if (summary)         lines.push(`  ${summary}`);
    if (strengths.length) lines.push(`  ✓ ${strengths.join(' · ')}`);
    if (gaps.length)      lines.push(`  ✗ ${gaps.join(' · ')}`);
  }

  return lines.join('\n');
}

/**
 * Select recent history that fits within a token budget.
 * Always keeps the most recent messages; drops older ones first.
 * Budget: 3,000 tokens for history (leaves headroom for system + response).
 */
function selectHistory(history: ChatMessage[], budgetTokens = 3000): ChatMessage[] {
  // Take last N messages that fit within budget, always in pairs (user+assistant)
  const reversed = [...history].reverse();
  const selected: ChatMessage[] = [];
  let used = 0;

  for (const msg of reversed) {
    const t = estimateTokens(msg.content);
    if (used + t > budgetTokens) break;
    selected.unshift(msg);
    used += t;
  }

  return selected;
}

export async function* streamChatResponse(
  userId: number,
  userMessage: string,
  userName: string,
  resumeText: string,
  jobs: JobContext[]
): AsyncGenerator<string> {
  const quota = getChatQuota(userId);
  if (quota.remaining <= 0) {
    throw new Error('Token quota exceeded. Your token limit has been reached.');
  }

  saveMessage(userId, 'user', userMessage);

  const history   = getChatHistory(userId);
  const recentHistory = selectHistory(history.slice(0, -1)); // exclude the message we just saved

  const jobsContext  = buildJobsContext(jobs);
  const resumeSnip   = resumeText.slice(0, 2500); // ~625 tokens

  const systemPrompt = `You are an AI career coach helping ${userName} with their job search. Be concise, practical, and specific — reference their actual job matches and resume when relevant.

RESUME (excerpt):
${resumeSnip}
${jobsContext}

Guidelines:
- Reference specific jobs by title and score when relevant (e.g. "For the Linear iOS role at 94%...")
- Keep responses focused — 2–4 short paragraphs max unless a longer answer is clearly needed
- Use markdown: **bold** for emphasis, bullet lists for steps or options
- For interview prep, tailor advice to the actual JD gaps shown above`;

  const llm = new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    apiKey: process.env.GOOGLE_API_KEY,
    streaming: true,
  });

  const messages = [
    new SystemMessage(systemPrompt),
    ...recentHistory.map(m =>
      m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
    ),
    new HumanMessage(userMessage),
  ];

  // Estimate input tokens for quota deduction
  const inputText = messages.map(m => typeof m.content === 'string' ? m.content : '').join(' ');
  const inputTokens = estimateTokens(inputText);

  let fullResponse = '';
  const stream = await llm.stream(messages);
  for await (const chunk of stream) {
    const text = typeof chunk.content === 'string' ? chunk.content : '';
    if (text) {
      fullResponse += text;
      yield text;
    }
  }

  if (fullResponse) {
    saveMessage(userId, 'assistant', fullResponse);
    const totalTokens = inputTokens + estimateTokens(fullResponse);
    db.prepare(
      'UPDATE users SET chat_token_used = COALESCE(chat_token_used, 0) + ? WHERE id = ?'
    ).run(totalTokens, userId);
  }
}
