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
import { getTimelineEvents, getSelectorReliability, getSelectorAlerts, getAnalysisInputs, getSetting, setSetting, getAllSettings, db } from './observability.js';
import { storeJobEmbedding, findSimilarJobs, listStoredEmbeddings } from './embeddings.js';
import { sendNtfy } from './notify.js';
import { reloadScheduler } from './scheduler.js';
import { createUser, listUsers, getUser, deleteUser, updateUserResume, updateUserContact, updateUserPreferences, listSites, addSite, updateSite, deleteSite, getCachedFeedJobsForUser, getCachedFeedJob, clearFeedJobAnalysis, clearAllFeedJobAnalyses, upsertFeedJob, listApplications, addApplication, updateApplication, removeApplication, saveTailoredResume, getTailoredResume, listTailoredResumes, deleteTailoredResume } from './profiles.js';
import { autoApply, applyViaGreenhouseAPI } from './apply.js';
import { runFeedScan, reanalyzeFeedJobs } from './feed.js';
import { tailorResumeToJob } from './tailor.js';
import { generateCoverLetterFromAnalysis, validateCoverLetter, saveCoverLetter, getCachedCoverLetter, getCoverLettersForUser } from './coverletter-agent.js';
import { getCachedCompanyProfile, upsertCompanyProfile, listCompanyProfiles } from './profiles.js';
import { authMiddleware, handleRegister } from './auth.js';
import { seedDemoUser } from './seed.js';

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

// ── noVNC — serve static files + proxy websocket to VNC ──────────────────────
if (process.env.DISPLAY) {
  // Serve noVNC static files under /vnc/
  app.use('/vnc', express.static('/usr/share/novnc'));

  // Proxy websocket upgrade at /vnc/websockify → localhost:5900
  const httpServer = app.listen; // will be used by server.on('upgrade') below
}

// ── Auth (public endpoints) ───────────────────────────────────────────────────

app.post('/api/auth/register', handleRegister);

// ── Protected Routes (iOS app only — require Supabase JWT) ───────────────────
// Web UI routes (POST /api/users, GET /api/feed etc.) are intentionally public
// so the local admin console works without authentication.
app.use('/api/users/sync', authMiddleware);

// ── Resume ────────────────────────────────────────────────────────────────────

app.get('/api/resume', async (req, res) => {
  const userId = Number(req.query.userId ?? 0);
  try {
    if (userId) {
      const user = getUser(userId);
      const content = user?.resume_text?.trim() ?? '';
      return res.json({ content, found: !!content });
    }
    const content = (await readFile('resume.txt', 'utf8')).trim();
    res.json({ content, found: true });
  } catch {
    res.json({ content: '', found: false });
  }
});

app.post('/api/resume', async (req, res) => {
  const userId = Number(req.body.userId ?? 0);
  const content = String(req.body.content ?? '').trim();
  try {
    if (userId) {
      updateUserResume(userId, content);
      return res.json({ ok: true });
    }
    await writeFile('resume.txt', content);
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

    emit({ type: 'progress', step: 3, of: 3, message: 'Analyzing with AI (30–60 s)…' });
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

// ── Cover letter generation (Phase 5-6) ────────────────────────────────────

/**
 * POST /api/letters/generate
 * Generate a cover letter for a specific job using analysis + company profile
 */
app.post('/api/letters/generate', async (req, res) => {
  const { userId, jobUrl, companyProfileId } = req.body as {
    userId: number;
    jobUrl: string;
    companyProfileId?: number;
  };

  if (!userId || !jobUrl) {
    res.status(400).json({ error: 'userId and jobUrl are required' });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

  try {
    const user = getUser(userId);
    if (!user?.resume_text) {
      emit({ type: 'error', message: 'No resume found for this user.' });
      res.end();
      return;
    }

    // Check cache first
    emit({ type: 'progress', message: 'Checking cache...' });
    const cached = getCachedCoverLetter(userId, jobUrl);
    if (cached) {
      emit({ type: 'progress', message: 'Found cached cover letter', done: true });
      emit({ type: 'result', data: cached });
      res.end();
      return;
    }

    // Scrape and analyze the job
    emit({ type: 'progress', message: 'Scraping job page...' });
    const jobDescription = await scrapeJob(jobUrl);
    emit({ type: 'progress', message: 'Analyzing job requirements...' });
    const analysis = await analyze(jobDescription, user.resume_text, jobUrl);

    // Get company profile if provided or try to infer from job
    let companyProfile = null;
    if (companyProfileId) {
      emit({ type: 'progress', message: 'Loading company profile...' });
      // Note: We need to fetch by name, so we'll infer from analysis
      // In a full implementation, company_profiles table would store id and name
    }

    // Generate cover letter
    emit({ type: 'progress', message: 'Generating cover letter...' });
    const companyName = analysis.title?.split(' at ')?.[1] || 'the Company';
    const letterContent = await generateCoverLetterFromAnalysis(
      analysis.title || 'Role',
      companyName,
      companyProfile,
      analysis,
      user.resume_text,
    );

    // Validate quality
    emit({ type: 'progress', message: 'Validating cover letter...' });
    const validation = validateCoverLetter(letterContent, companyName);
    if (!validation.valid) {
      emit({ type: 'warning', message: `Quality checks: ${validation.issues.join('; ')}` });
    }

    // Save to cache
    emit({ type: 'progress', message: 'Saving to cache...' });
    const saved = saveCoverLetter(
      userId,
      jobUrl,
      letterContent,
      companyName,
      analysis.title || 'Role',
      companyProfileId,
    );

    emit({ type: 'progress', message: 'Cover letter generated successfully', done: true });
    emit({ type: 'result', data: saved });
  } catch (e) {
    const status = e instanceof ScraperError ? 400 : 500;
    emit({ type: 'error', message: String(e) });
  }
  res.end();
});

/**
 * GET /api/letters
 * Get all cached cover letters for a user
 */
app.get('/api/letters', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) {
    res.status(400).json({ error: 'userId required' });
    return;
  }
  try {
    const letters = getCoverLettersForUser(userId);
    res.json({ letters });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/letters/:jobUrl
 * Get cached cover letter for a specific job
 */
app.get('/api/letters/:jobUrl', (req, res) => {
  const userId = Number(req.query.userId);
  const jobUrl = decodeURIComponent(req.params.jobUrl);
  if (!userId) {
    res.status(400).json({ error: 'userId query param required' });
    return;
  }
  try {
    const letter = getCachedCoverLetter(userId, jobUrl);
    if (!letter) {
      res.status(404).json({ error: 'Cover letter not found' });
      return;
    }
    res.json({ letter });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Company profiles ───────────────────────────────────────────────────────────

/**
 * POST /api/research/company
 * Create or update company profile
 */
app.post('/api/research/company', (req, res) => {
  const { companyName, website, description, tech_stack, culture_signals, recent_news, interview_talking_points, founded_year, employee_count, funding_status, data_sources } = req.body as {
    companyName: string;
    website?: string;
    description?: string;
    tech_stack?: string[];
    culture_signals?: string[];
    recent_news?: Array<{ headline: string; date: string; url?: string }>;
    interview_talking_points?: string[];
    founded_year?: number;
    employee_count?: string;
    funding_status?: string;
    data_sources?: Record<string, boolean>;
  };

  if (!companyName?.trim()) {
    res.status(400).json({ error: 'companyName is required' });
    return;
  }

  try {
    const existing = getCachedCompanyProfile(companyName.trim());
    const news = (recent_news || []).map((n: any) => ({
      headline: n.headline || '',
      date: n.date || '',
      url: n.url || '',
      source: n.source || '',
    })) as any[];

    const profile = upsertCompanyProfile({
      id: existing?.id ?? 0,
      company_name: companyName.trim(),
      website: website ?? null,
      description: description ?? null,
      tech_stack: tech_stack ?? [],
      culture_signals: culture_signals ?? [],
      recent_news: news,
      interview_talking_points: interview_talking_points ?? [],
      founded_year: founded_year ?? null,
      employee_count: employee_count ?? null,
      funding_status: funding_status ?? null,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      cache_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      data_sources: data_sources ?? {},
    });
    res.json({ company_profile: profile });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/research/company/:name
 * Get company profile by name
 */
app.get('/api/research/company/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  try {
    const profile = getCachedCompanyProfile(name);
    if (!profile) {
      res.status(404).json({ error: 'Company profile not found' });
      return;
    }
    res.json({ company_profile: profile });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── History ───────────────────────────────────────────────────────────────────

app.get('/api/history', (req, res) => {
  // Pull from persistent feed_jobs DB instead of ephemeral history.json
  const userId = Number(req.query.userId ?? (req as any).user?.id ?? 0);
  try {
    const rows = userId
      ? db.prepare(`
          SELECT f.job_url AS url, f.job_title AS title, f.match_score AS score,
                 f.first_seen AS date, s.name AS site_name
          FROM feed_jobs f
          LEFT JOIN job_sites s ON s.id = f.site_id
          WHERE f.user_id = ? AND f.analysis_json IS NOT NULL
          ORDER BY f.last_seen DESC LIMIT 200
        `).all(userId) as any[]
      : db.prepare(`
          SELECT f.job_url AS url, f.job_title AS title, f.match_score AS score,
                 f.first_seen AS date, s.name AS site_name
          FROM feed_jobs f
          LEFT JOIN job_sites s ON s.id = f.site_id
          WHERE f.analysis_json IS NOT NULL
          ORDER BY f.last_seen DESC LIMIT 200
        `).all() as any[];

    const history = rows.map(r => ({
      date:    r.date?.replace('T', ' ').slice(0, 16) ?? '',
      title:   r.title ?? '',
      url:     r.url ?? '',
      score:   r.score ?? null,
      saved_to: null,
    }));
    res.json(history);
  } catch {
    res.json([]);
  }
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
    const userId = Number(req.body.userId ?? 0);

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

    // Load existing master from user record
    let master = '';
    if (userId) {
      const user = getUser(userId);
      master = user?.resume_text?.trim() ?? '';
    }
    if (!master) {
      try { master = (await readFile('resume.txt', 'utf8')).trim(); } catch {}
    }

    const combined = texts.join('\n\n').trim();
    let updated = '';
    let additions = '';

    if (!master) {
      // No existing master — save everything directly, no AI needed
      emit({ type: 'progress', message: 'No existing resume found — saving uploaded content directly…' });
      updated = combined;
      additions = combined;
    } else {
      // Has existing master — use AI to merge: give it both resumes and produce a combined one
      emit({ type: 'progress', message: 'Merging with your existing resume using AI… (30–60 s)' });
      updated = await mergeResumes([master, combined]);
      additions = updated !== master ? updated : '';
    }

    // Save to user record (always)
    if (userId) {
      updateUserResume(userId, updated);
    } else {
      await writeFile('resume.txt', updated);
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

app.post('/api/users/sync', async (req, res) => {
  try {
    const user = (req as any).user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { email, name, resume_text, phone, linkedin } = req.body;

    // Update user profile with synced data from NotchUp
    if (name) updateUserContact(user.id, { name });
    if (email) updateUserContact(user.id, { email });
    if (resume_text) updateUserResume(user.id, resume_text);
    if (phone) updateUserContact(user.id, { phone });
    if (linkedin) updateUserContact(user.id, { linkedin });

    const updatedUser = getUser(user.id);
    res.json({
      id: user.id,
      synced_at: new Date().toISOString(),
      user: updatedUser,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
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

// ── iOS App: GET /api/jobs/feed ───────────────────────────────────────────────
// Used by NotchUp iOS. Resolves userId from Supabase JWT, returns jobs in the
// format the Swift Codable structs expect.
app.get('/api/jobs/feed', authMiddleware, (req: any, res) => {
  const user = req.user;
  if (!user) { res.status(401).json({ error: 'Not authenticated' }); return; }

  const limit  = Number(req.query.limit  ?? 50);
  const offset = Number(req.query.offset ?? 0);

  try {
    const all = getCachedFeedJobsForUser(user.id);
    const page = all.slice(offset, offset + limit);

    const jobs = page
      .filter(j => j.analysis !== null)
      .map(j => ({
        id:               String(j.id),
        url:              j.job.url,
        title:            j.job.title,
        company:          j.site_name,
        location:         j.job.location ?? '',
        department:       j.job.department ?? null,
        match_score:      j.match_score ?? j.analysis?.match_score ?? 0,
        requirements:     j.analysis?.requirements ?? [],
        strengths:        j.analysis?.strengths    ?? [],
        gaps:             j.analysis?.gaps         ?? [],
        summary:          j.analysis?.summary      ?? '',
        company_profile_id: null,
      }));

    res.json({ jobs, total: all.length, limit, offset });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Auto-apply (streaming NDJSON) ────────────────────────────────────────────

app.post('/api/apply', async (req, res) => {
  const { userId, jobUrl, coverLetter, applicationId } = req.body as {
    userId: number;
    jobUrl: string;
    coverLetter?: string;
    applicationId?: number;
  };
  if (!userId || !jobUrl) { res.status(400).json({ error: 'userId and jobUrl are required' }); return; }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

  try {
    // If applicationId not provided, create an application record
    let appId = applicationId;
    if (!appId) {
      const user = getUser(userId);
      if (!user) {
        emit({ type: 'error', message: 'User not found' });
        res.end();
        return;
      }
      const app = addApplication(userId, jobUrl, '', '', null);
      appId = app.id;
    }

    await autoApply(Number(userId), jobUrl, coverLetter, appId, emit);
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }
  res.end();
});

// ── Direct API apply (Greenhouse — no browser, no captcha) ───────────────────

app.post('/api/apply-direct', async (req, res) => {
  const { userId, jobUrl, atsType, atsSlug, coverLetter } = req.body as {
    userId:      number;
    jobUrl:      string;
    atsType?:    string;
    atsSlug?:    string;
    coverLetter?: string;
  };

  if (!userId || !jobUrl) {
    res.status(400).json({ error: 'userId and jobUrl are required' });
    return;
  }

  // Only Greenhouse is supported via direct API right now
  const normalizedType = (atsType ?? '').toLowerCase();
  const isGreenhouse   =
    normalizedType === 'greenhouse' ||
    jobUrl.includes('greenhouse.io');

  if (!isGreenhouse) {
    res.status(400).json({
      error: `Direct API submission is only supported for Greenhouse. atsType received: "${atsType ?? ''}". Use /api/apply for other ATS.`,
    });
    return;
  }

  try {
    const result = await applyViaGreenhouseAPI({
      userId:      Number(userId),
      jobUrl,
      atsSlug,
      coverLetter,
    });

    if (result.submitted) {
      res.json({ submitted: true, applicationId: result.applicationId ?? null });
    } else {
      res.status(422).json({ submitted: false, error: result.error, statusCode: result.statusCode });
    }
  } catch (e) {
    res.status(500).json({ submitted: false, error: String(e) });
  }
});

// ── Application resume (after captcha user intervention) ──────────────────────

app.post('/api/applications/:id/resume', async (req, res) => {
  const { id } = req.params;
  const applicationId = Number(id);

  if (!applicationId || isNaN(applicationId)) {
    res.status(400).json({ error: 'Invalid application ID' });
    return;
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

  try {
    // TODO: Resume the browser automation after user has solved captcha
    emit({ type: 'debug', message: 'Resume endpoint called for application ' + applicationId });
    emit({ type: 'debug', message: 'Feature: auto-resume after captcha will be implemented in next iteration' });
    res.json({ status: 'resumed', message: 'Application automation resumed (manual verification required)' });
  } catch (e) {
    emit({ type: 'error', message: String(e) });
  }
  res.end();
});

// ── Get application status with logs ──────────────────────────────────────────

app.get('/api/applications/:id/status', async (req, res) => {
  const { id } = req.params;
  const applicationId = Number(id);

  if (!applicationId || isNaN(applicationId)) {
    res.status(400).json({ error: 'Invalid application ID' });
    return;
  }

  try {
    const { getApplicationLogs, getApplicationLastError } = await import('./observability.js');
    const logs = getApplicationLogs(applicationId, 50);
    const lastError = getApplicationLastError(applicationId);

    res.json({
      id: applicationId,
      logs,
      lastError,
      status: lastError ? 'failed' : 'running',
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
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

// ── Tailored Resumes ─────────────────────────────────────────────────────────

app.post('/api/resumes/tailor', async (req, res) => {
  const { userId, jobUrl, jobDescription } = req.body as {
    userId: number;
    jobUrl: string;
    jobDescription?: string;
  };

  if (!userId || !jobUrl) {
    res.status(400).json({ error: 'userId and jobUrl are required' });
    return;
  }

  try {
    // Get the user's base resume
    const user = getUser(userId);
    if (!user || !user.resume_text) {
      res.status(400).json({ error: 'User has no resume on file' });
      return;
    }

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    const emit = (obj: object) => res.write(JSON.stringify(obj) + '\n');

    emit({ type: 'progress', step: 1, of: 2, message: 'Analyzing job requirements...' });

    // Tailor the resume
    const { tailoredResume, analysis, bulletsIncluded } = await tailorResumeToJob(
      user.resume_text,
      jobUrl,
      jobDescription
    );

    emit({
      type: 'progress',
      step: 2,
      of: 2,
      message: `Tailored resume ready (${bulletsIncluded} bullets)`,
      done: true
    });

    // Save the tailored resume
    const saved = saveTailoredResume(
      userId,
      jobUrl,
      user.resume_text,
      tailoredResume,
      analysis.title,
      analysis.requirements,
      bulletsIncluded
    );

    emit({
      type: 'done',
      tailored_resume_id: saved.id,
      tailored_resume_text: saved.tailored_resume_text,
      job_title: saved.job_title,
      bullets_included: saved.bullets_included,
      match_score: analysis.match_score,
      requirements: analysis.requirements,
      created_at: saved.created_at
    });
  } catch (e) {
    res.write(JSON.stringify({ type: 'error', message: String(e) }) + '\n');
  }
});

app.get('/api/resumes/tailored', (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
  res.json(listTailoredResumes(userId));
});

app.get('/api/resumes/tailored/:jobUrl', (req, res) => {
  const userId = Number(req.query.userId);
  const jobUrl = decodeURIComponent(req.params.jobUrl);
  if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
  const tailored = getTailoredResume(userId, jobUrl);
  tailored ? res.json(tailored) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/resumes/tailored/:jobUrl', (req, res) => {
  const userId = Number(req.query.userId);
  const jobUrl = decodeURIComponent(req.params.jobUrl);
  if (!userId) { res.status(400).json({ error: 'userId required' }); return; }
  deleteTailoredResume(userId, jobUrl);
  res.json({ ok: true });
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
seedDemoUser();

app.listen(PORT, () => {
  console.log(`\nJob Automator → http://localhost:${PORT}\n`);
});

// ── Research Agent ────────────────────────────────────────────────────────────

app.post('/api/research/company', async (req, res) => {
  const { company_name, website, refresh } = req.body as {
    company_name: string;
    website?: string;
    refresh?: boolean;
  };

  if (!company_name) {
    res.status(400).json({ error: 'company_name required' });
    return;
  }

  try {
    const { getOrResearchCompany } = await import('./research.js');
    const profile = await getOrResearchCompany(
      company_name,
      website,
      refresh ?? false
    );

    res.json({
      company_profile_id: profile.id,
      company_name: profile.company_name,
      website: profile.website ?? null,
      description: profile.description ?? null,
      tech_stack: profile.tech_stack ?? [],
      culture_signals: profile.culture_signals ?? [],
      recent_news: (profile.recent_news ?? []).map((n: any) => ({
        headline: n.headline,
        date: n.date,
        url: n.url ?? '',
        source: n.source ?? '',
      })),
      interview_talking_points: profile.interview_talking_points ?? [],
      founded_year: profile.founded_year ?? null,
      employee_count: profile.employee_count ?? null,
      funding_status: profile.funding_status ?? null,
      created_at: profile.created_at,
      is_fresh: new Date(profile.cache_expires_at) > new Date(),
    });
  } catch (e) {
    console.error('Research error:', String(e));
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/research/company/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const profile = getCachedCompanyProfile(name);

  if (!profile) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }

  const expiresAt = new Date(profile.cache_expires_at);
  const isFresh = expiresAt > new Date();

  res.json({
    company_profile: {
      company_profile_id: profile.id,
      company_name: profile.company_name,
      website: profile.website ?? null,
      description: profile.description ?? null,
      tech_stack: profile.tech_stack ?? [],
      culture_signals: profile.culture_signals ?? [],
      recent_news: (profile.recent_news ?? []).map((n: any) => ({
        headline: n.headline,
        date: n.date,
        url: n.url ?? '',
        source: n.source ?? '',
      })),
      interview_talking_points: profile.interview_talking_points ?? [],
      founded_year: profile.founded_year ?? null,
      employee_count: profile.employee_count ?? null,
      funding_status: profile.funding_status ?? null,
      created_at: profile.created_at,
    },
    cached_at: profile.updated_at,
    is_fresh: isFresh,
    cache_expires_at: profile.cache_expires_at,
  });
});

app.get('/api/research/companies', (req, res) => {
  const profiles = listCompanyProfiles();
  res.json({
    companies: profiles.map(p => ({
      company_profile_id: p.id,
      company_name: p.company_name,
      website: p.website,
      created_at: p.created_at,
      is_fresh: new Date(p.cache_expires_at) > new Date(),
    })),
    total: profiles.length,
  });
});
