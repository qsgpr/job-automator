import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeJob, listJobs, findCareersUrl, ScraperError } from './scraper.js';
import { analyze, formatReport, generateCoverLetter } from './analyzer.js';
import { autofillForm } from './autofill.js';
import { loadHistory, appendHistory, clearHistory, saveReport } from './history.js';
import { getTimelineEvents, getSelectorReliability, getSelectorAlerts } from './observability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// ── Resume ────────────────────────────────────────────────────────────────────

app.get('/api/resume', async (_req, res) => {
  try {
    const content = (await readFile('resume.txt', 'utf8')).trim();
    res.json({ content, found: true });
  } catch {
    res.json({ content: '', found: false });
  }
});

app.post('/api/resume', async (req, res) => {
  try {
    await writeFile('resume.txt', String(req.body.content ?? '').trim());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Analyze (streaming NDJSON) ────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { url, save = false } = req.body as { url: string; save?: boolean };

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

  try {
    emit({ type: 'progress', step: 1, of: 3, message: 'Loading resume…' });
    let resumeText: string;
    try {
      resumeText = (await readFile('resume.txt', 'utf8')).trim();
      if (!resumeText) throw new Error('empty');
      emit({ type: 'progress', step: 1, of: 3, message: `Resume loaded (${resumeText.length.toLocaleString()} chars)`, done: true });
    } catch {
      emit({ type: 'error', message: 'No resume found. Paste your resume in the sidebar first.' });
      res.end();
      return;
    }

    emit({ type: 'progress', step: 2, of: 3, message: 'Scraping job page…' });
    let jd: string;
    try {
      jd = await scrapeJob(url);
      emit({ type: 'progress', step: 2, of: 3, message: `Scraped ${jd.length.toLocaleString()} characters`, done: true });
    } catch (e) {
      emit({ type: 'error', message: e instanceof ScraperError ? e.message : String(e) });
      res.end();
      return;
    }

    emit({ type: 'progress', step: 3, of: 3, message: 'Analyzing with Gemma (30–60 s)…' });
    const analysis = await analyze(jd, resumeText);
    emit({ type: 'progress', step: 3, of: 3, message: 'Analysis complete', done: true });

    let savedTo: string | null = null;
    if (save) {
      const t = analysis.title || url.split('/').pop()!.replace(/-/g, ' ');
      savedTo = await saveReport(formatReport(analysis), url, t);
    }

    const title = analysis.title || url.split('/').pop()!.replace(/-/g, ' ');
    await appendHistory({ date: new Date().toLocaleString(), title, url, score: analysis.match_score ?? null, saved_to: savedTo });

    emit({ type: 'result', data: analysis, savedTo });
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }

  res.end();
});

// ── Browse jobs ───────────────────────────────────────────────────────────────

app.post('/api/jobs', async (req, res) => {
  const { url } = req.body as { url: string };
  try {
    let jobs = await listJobs(url, true);
    let resolvedUrl: string | null = null;
    if (!jobs.length) {
      const careersUrl = await findCareersUrl(url);
      if (careersUrl && careersUrl.replace(/\/$/, '') !== url.replace(/\/$/, '')) {
        jobs = await listJobs(careersUrl, true);
        resolvedUrl = careersUrl;
      }
    }
    res.json({ jobs, resolvedUrl });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/analyze-job', async (req, res) => {
  const { url } = req.body as { url: string };
  try {
    const resumeText = (await readFile('resume.txt', 'utf8')).trim();
    if (!resumeText) {
      res.status(400).json({ error: 'No resume found.' });
      return;
    }
    const jd = await scrapeJob(url);
    const analysis = await analyze(jd, resumeText);
    await appendHistory({
      date: new Date().toLocaleString(),
      title: analysis.title || url.split('/').pop()!.replace(/-/g, ' '),
      url,
      score: analysis.match_score ?? null,
      saved_to: null,
    });
    res.json({ analysis });
  } catch (e) {
    const status = e instanceof ScraperError ? 400 : 500;
    res.status(status).json({ error: String(e) });
  }
});

// ── Cover letter ──────────────────────────────────────────────────────────────

app.post('/api/cover-letter', async (req, res) => {
  const { company, role, skills } = req.body as { company: string; role: string; skills?: string };
  try {
    const resumeText = (await readFile('resume.txt', 'utf8')).trim();
    if (!resumeText) { res.status(400).json({ error: 'No resume found.' }); return; }
    const letter = await generateCoverLetter(company, role, resumeText, skills ?? '');
    res.json({ letter });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── History ───────────────────────────────────────────────────────────────────

app.get('/api/history', async (_req, res) => {
  res.json(await loadHistory());
});

app.delete('/api/history', async (_req, res) => {
  await clearHistory();
  res.json({ ok: true });
});

// ── Autofill demo ─────────────────────────────────────────────────────────────

app.post('/api/autofill', async (req, res) => {
  const { name, email, phone, linkedin, resumeText, coverLetter, mode } = req.body;
  try {
    await autofillForm({ name, email, phone, linkedin, resumeText, coverLetter, mode: mode ?? 'type' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Observability ─────────────────────────────────────────────────────────────

app.get('/api/observability/timeline',    (_req, res) => res.json(getTimelineEvents()));
app.get('/api/observability/reliability', (_req, res) => res.json(getSelectorReliability()));
app.get('/api/observability/alerts',      (_req, res) => res.json(getSelectorAlerts()));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\nJob Automator → http://localhost:${PORT}\n`);
});
