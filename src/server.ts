import express from 'express';
import multer from 'multer';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { scrapeJob, listJobs, findCareersUrl, searchCompanyUrls, ScraperError } from './scraper.js';
import { analyze, formatReport, generateCoverLetter, mergeResumes, diffResumes } from './analyzer.js';
import { autofillForm } from './autofill.js';
import { loadHistory, appendHistory, clearHistory, saveReport } from './history.js';
import { getTimelineEvents, getSelectorReliability, getSelectorAlerts, getAnalysisInputs, getSetting, setSetting, getAllSettings } from './observability.js';
import { storeJobEmbedding, findSimilarJobs, listStoredEmbeddings } from './embeddings.js';
import { sendNtfy } from './notify.js';
import { reloadScheduler } from './scheduler.js';
import { createUser, listUsers, getUser, deleteUser, updateUserResume, updateUserContact, updateUserPreferences, listSites, addSite, updateSite, deleteSite, getCachedFeedJobsForUser, getCachedFeedJob, clearFeedJobAnalysis, clearAllFeedJobAnalyses, upsertFeedJob, listApplications, addApplication, updateApplication, removeApplication } from './profiles.js';
import { autoApply } from './apply.js';
import { runFeedScan, reanalyzeFeedJobs } from './feed.js';

const _require = createRequire(import.meta.url);

async function extractFileText(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf' || mimetype === 'application/pdf') {
    const pdfParse = _require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === '.docx' || mimetype.includes('wordprocessingml')) {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString('utf8');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|docx|txt)$/i.test(file.originalname)
      || ['text/plain', 'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         ].includes(file.mimetype);
    cb(null, ok);
  },
});

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
  const { url, save = false, userId } = req.body as { url: string; save?: boolean; userId?: number };

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

  try {
    emit({ type: 'progress', step: 1, of: 3, message: 'Loading resume…' });
    let resumeText: string;
    try {
      if (userId) {
        const u = getUser(userId);
        if (!u?.resume_text) throw new Error('empty');
        resumeText = u.resume_text;
      } else {
        resumeText = (await readFile('resume.txt', 'utf8')).trim();
        if (!resumeText) throw new Error('empty');
      }
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
    const analysis = await analyze(jd, resumeText, url);
    emit({ type: 'progress', step: 3, of: 3, message: 'Analysis complete', done: true });

    let savedTo: string | null = null;
    if (save) {
      const t = analysis.title || url.split('/').pop()!.replace(/-/g, ' ');
      savedTo = await saveReport(formatReport(analysis), url, t);
    }

    const title = analysis.title || url.split('/').pop()!.replace(/-/g, ' ');
    await appendHistory({ date: new Date().toLocaleString(), title, url, score: analysis.match_score ?? null, saved_to: savedTo });

    // Store embedding in background — don't block the response
    storeJobEmbedding(url, title, jd, analysis.match_score).catch(() => {});

    emit({ type: 'result', data: analysis, savedTo });
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }

  res.end();
});

app.post('/api/similar-jobs', async (req, res) => {
  const { jd } = req.body as { jd: string };
  if (!jd?.trim()) { res.status(400).json({ error: 'jd required' }); return; }
  try {
    const jobs = await findSimilarJobs(jd);
    res.json({ jobs });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/embeddings', (_req, res) => {
  res.json({ embeddings: listStoredEmbeddings() });
});

// ── Company search ────────────────────────────────────────────────────────────

app.post('/api/search-company', async (req, res) => {
  const { query } = req.body as { query: string };
  if (!query?.trim()) { res.status(400).json({ error: 'query is required' }); return; }
  try {
    const results = await searchCompanyUrls(query.trim());
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
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
  const { url, userId } = req.body as { url: string; userId?: number };
  try {
    let resumeText: string;
    if (userId) {
      const u = getUser(userId);
      if (!u?.resume_text) { res.status(400).json({ error: 'No resume found for this user.' }); return; }
      resumeText = u.resume_text;
    } else {
      resumeText = (await readFile('resume.txt', 'utf8')).trim();
    }
    if (!resumeText) {
      res.status(400).json({ error: 'No resume found.' });
      return;
    }
    const jd = await scrapeJob(url);
    const analysis = await analyze(jd, resumeText, url);
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
  const { company, role, skills, userId } = req.body as { company: string; role: string; skills?: string; userId?: number };
  try {
    let resumeText: string;
    if (userId) {
      const u = getUser(userId);
      if (!u?.resume_text) { res.status(400).json({ error: 'No resume found for this user.' }); return; }
      resumeText = u.resume_text;
    } else {
      resumeText = (await readFile('resume.txt', 'utf8')).trim();
    }
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

// ── Resume merge (streaming NDJSON) ──────────────────────────────────────────

// Two-step middleware: catch multer errors and still reply with NDJSON so the
// client's content-type check always succeeds and errors are displayed.
app.post('/api/resume/merge',
  (req, res, next) => upload.array('files', 10)(req, res, err => {
    if (err) {
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.write(JSON.stringify({ type: 'error', message: `Upload error: ${err.message}` }) + '\n');
      res.end();
      return;
    }
    next();
  }),
  async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

  if (!files.length) {
    emit({ type: 'error', message: 'No files received. Supported formats: PDF, DOCX, TXT.' });
    res.end(); return;
  }

  try {
    // Extract text from each file
    const texts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      emit({ type: 'progress', message: `Reading ${f.originalname} (${i + 1}/${files.length})…` });
      const text = await extractFileText(f.buffer, f.mimetype, f.originalname);
      if (!text.trim()) {
        emit({ type: 'error', message: `Could not extract text from ${f.originalname}` });
        res.end(); return;
      }
      texts.push(text);
    }

    // Load existing master
    let master = '';
    try { master = (await readFile('resume.txt', 'utf8')).trim(); } catch {}

    let additions = '';
    let updated = '';

    if (!master) {
      emit({ type: 'progress', message: texts.length > 1
        ? `Merging ${texts.length} files into a master resume… (30–60 s)`
        : 'Creating master resume…' });
      updated = await mergeResumes(texts);
      additions = updated;
    } else {
      emit({ type: 'progress', message: 'Comparing files against your master resume…' });
      emit({ type: 'progress', message: 'Gemma is extracting new information… (30–60 s)' });
      additions = await diffResumes(master, texts);
      updated = additions ? `${master}\n\n${additions}` : master;
    }

    emit({ type: 'result', additions, updated, had_master: !!master, filenames: files.map(f => f.originalname) });
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }
  res.end();
});

app.post('/api/autofill', async (req, res) => {
  const { name, email, phone, linkedin, resumeText, coverLetter, mode } = req.body;
  try {
    await autofillForm({ name, email, phone, linkedin, resumeText, coverLetter, mode: mode ?? 'type' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

app.get('/api/users', (_req, res) => {
  res.json(listUsers());
});

app.post('/api/users', (req, res) => {
  const { name, email } = req.body as { name: string; email?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }
  try {
    res.json(createUser(name.trim(), (email ?? '').trim()));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/users/:id', (req, res) => {
  const user = getUser(Number(req.params.id));
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(user);
});

app.delete('/api/users/:id', (req, res) => {
  try { deleteUser(Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/users/:id/resume', async (req, res) => {
  const { content } = req.body as { content: string };
  try {
    updateUserResume(Number(req.params.id), String(content ?? '').trim());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/users/:id/contact', (req, res) => {
  try {
    updateUserContact(Number(req.params.id), req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/users/:id/preferences', (req, res) => {
  try {
    updateUserPreferences(Number(req.params.id), req.body);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Job sites ─────────────────────────────────────────────────────────────────

app.get('/api/sites', (_req, res) => res.json(listSites()));

app.post('/api/sites', (req, res) => {
  const { name, url, notes, ats_type, ats_slug } = req.body as { name: string; url: string; notes?: string; ats_type?: string; ats_slug?: string };
  if (!name?.trim() || !url?.trim()) { res.status(400).json({ error: 'name and url are required' }); return; }
  try { res.json(addSite(name.trim(), url.trim(), notes?.trim(), ats_type?.trim(), ats_slug?.trim())); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.put('/api/sites/:id', (req, res) => {
  try { updateSite(Number(req.params.id), req.body); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.delete('/api/sites/:id', (req, res) => {
  try { deleteSite(Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Feed cache ────────────────────────────────────────────────────────────────

app.get('/api/feed/cached', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
  try {
    res.json(getCachedFeedJobsForUser(userId));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ── Auto-apply (streaming NDJSON) ────────────────────────────────────────────

app.post('/api/apply', async (req, res) => {
  const { userId, jobUrl } = req.body as { userId: number; jobUrl: string };
  if (!userId || !jobUrl) { res.status(400).json({ error: 'userId and jobUrl are required' }); return; }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

  try {
    await autoApply(Number(userId), jobUrl, emit);
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }
  res.end();
});

// ── Feed scan (streaming NDJSON) ──────────────────────────────────────────────

app.post('/api/feed/scan', async (req, res) => {
  const { userId } = req.body as { userId: number };
  if (!userId) { res.status(400).json({ error: 'userId is required' }); return; }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const signal = { aborted: false };
  res.on('close', () => { signal.aborted = true; });

  const emit = (obj: object) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };

  try {
    await runFeedScan(Number(userId), emit, signal);
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }
  if (!res.writableEnded) res.end();
});

// ── Re-analyze one job ────────────────────────────────────────────────────────

app.post('/api/feed/reanalyze', async (req, res) => {
  const { userId, jobUrl } = req.body as { userId: number; jobUrl: string };
  if (!userId || !jobUrl) { res.status(400).json({ error: 'userId and jobUrl required' }); return; }

  const user = getUser(Number(userId));
  if (!user?.resume_text) { res.status(400).json({ error: 'No resume found for this user.' }); return; }

  const cached = getCachedFeedJob(Number(userId), jobUrl);
  if (!cached) { res.status(404).json({ error: 'Job not found in feed cache.' }); return; }

  try {
    const jdText = await scrapeJob(jobUrl);
    const analysis = await analyze(jdText, user.resume_text, jobUrl);
    upsertFeedJob(Number(userId), cached.site_id, cached.job, {
      analysis,
      filter_result: cached.filter_result,
      warnings: cached.warnings,
    });
    res.json({ analysis });
  } catch (e) {
    const status = e instanceof ScraperError ? 400 : 500;
    res.status(status).json({ error: String(e) });
  }
});

// ── Re-analyze all / selected jobs (streaming NDJSON) ─────────────────────────

app.post('/api/feed/reanalyze-all', async (req, res) => {
  const { userId, jobUrls } = req.body as { userId: number; jobUrls?: string[] };
  if (!userId) { res.status(400).json({ error: 'userId is required' }); return; }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const signal = { aborted: false };
  res.on('close', () => { signal.aborted = true; });

  const emit = (obj: object) => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };

  try {
    await reanalyzeFeedJobs(Number(userId), jobUrls ?? 'all', emit, signal);
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }
  if (!res.writableEnded) res.end();
});

// ── Observability ─────────────────────────────────────────────────────────────

app.get('/api/observability/timeline',    (_req, res) => res.json(getTimelineEvents()));
app.get('/api/observability/reliability', (_req, res) => res.json(getSelectorReliability()));
app.get('/api/observability/alerts',      (_req, res) => res.json(getSelectorAlerts()));
app.get('/api/observability/inputs',      (_req, res) => res.json(getAnalysisInputs()));

// ── Settings ──────────────────────────────────────────────────────────────────

app.get('/api/settings', (_req, res) => res.json(getAllSettings()));

app.post('/api/settings', (req, res) => {
  const patch = req.body as Record<string, string>;
  const allowed = ['scan_enabled','scan_cron','scan_user_id','ntfy_topic','ntfy_server','alert_enabled','alert_threshold'];
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k)) setSetting(k, String(v ?? ''));
  }
  reloadScheduler();
  res.json({ ok: true });
});

app.post('/api/settings/test-ntfy', async (req, res) => {
  const { topic, server } = req.body as { topic: string; server?: string };
  if (!topic?.trim()) { res.status(400).json({ error: 'topic is required' }); return; }
  try {
    await sendNtfy(topic, 'Job Automator test', 'Connection is working ✓', server || 'https://ntfy.sh', 4);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Applications (kanban board) ───────────────────────────────────────────────

app.get('/api/applications', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
  res.json(listApplications(userId));
});

app.post('/api/applications', (req, res) => {
  const { userId, jobUrl, jobTitle, siteName, matchScore } = req.body as {
    userId: number; jobUrl: string; jobTitle: string; siteName?: string; matchScore?: number;
  };
  if (!userId || !jobUrl) { res.status(400).json({ error: 'userId and jobUrl required' }); return; }
  try {
    const app = addApplication(Number(userId), jobUrl, jobTitle, siteName ?? '', matchScore ?? null);
    res.json(app);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.patch('/api/applications/:id', (req, res) => {
  const id     = Number(req.params.id);
  const userId = Number(req.body.userId);
  const { status, notes } = req.body as { userId: number; status?: string; notes?: string };
  if (!id || !userId) { res.status(400).json({ error: 'id and userId required' }); return; }
  const result = updateApplication(id, userId, { status: status as any, notes });
  result ? res.json(result) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/applications/:id', (req, res) => {
  const id     = Number(req.params.id);
  const userId = Number(req.query.userId);
  if (!id || !userId) { res.status(400).json({ error: 'id and userId required' }); return; }
  removeApplication(id, userId);
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────

reloadScheduler();

app.listen(PORT, () => {
  console.log(`\nJob Automator → http://localhost:${PORT}\n`);
});
