import { listJobs, agentListJobs, scrapeJob, scrapeLinkedIn } from './scraper.js';
import { analyze } from './analyzer.js';
import {
  getUser,
  getActiveSites,
  getCachedFeedJob,
  getScrapedJob,
  upsertScrapedJob,
  setScrapedJobContent,
  markScrapedJobError,
  upsertFeedJob,
  removeStaleFeedJobs,
  removeStaleScrapedJobs,
  getCachedFeedJobsForUser,
} from './profiles.js';
import type { Job, UserPreferences, FeedFilterResult, FeedJobResult, FeedScanEvent } from './types.js';

export interface AbortSignal { readonly aborted: boolean }

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('__SCAN_ABORTED__');
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  const slice = 100;
  for (let remaining = ms; remaining > 0; remaining -= slice) {
    throwIfAborted(signal);
    await sleep(Math.min(slice, remaining));
  }
}

// ── Filter helpers ────────────────────────────────────────────────────────────

const REMOTE_SIGNALS  = ['remote', 'work from home', 'wfh', 'distributed'];
const ONSITE_SIGNALS  = ['on-site', 'onsite', 'on site', 'in-office', 'in office'];
const HYBRID_SIGNALS  = ['hybrid'];

const SENIOR_TITLE_SIGNALS = ['vp ', 'vice president', 'director', 'principal', 'staff ', 'distinguished'];
const JUNIOR_TITLE_SIGNALS = ['intern', 'internship', 'apprentice', 'graduate ', 'entry level', 'entry-level', 'junior'];

function detectWorkType(location: string): 'remote' | 'hybrid' | 'on-site' | 'unknown' {
  const l = location.toLowerCase();
  if (REMOTE_SIGNALS.some(s => l.includes(s))) return 'remote';
  if (HYBRID_SIGNALS.some(s => l.includes(s))) return 'hybrid';
  if (ONSITE_SIGNALS.some(s => l.includes(s))) return 'on-site';
  return 'unknown';
}

function extractSalaryK(text: string): number | null {
  // Match patterns: $80k, $80K, $80,000, $80 000, 80000/yr, $80k-$100k (take lower bound)
  const match = text.match(/\$\s*([\d,]+)\s*[kK]?/);
  if (!match) return null;
  const raw = parseInt(match[1].replace(/,/g, ''), 10);
  if (isNaN(raw)) return null;
  // If number looks like full dollars (>= 1000), convert to $k
  return raw >= 1000 ? Math.round(raw / 1000) : raw;
}

interface FilterResult { result: FeedFilterResult; warnings: string[] }

export function applyFilters(
  job: Job,
  prefs: UserPreferences,
  jdText?: string,
): FilterResult {
  const warnings: string[] = [];

  // ── Work type ───────────────────────────────────────────────────────────────
  if (prefs.work_type !== 'any' && job.location) {
    const detected = detectWorkType(job.location);
    if (detected !== 'unknown' && detected !== prefs.work_type) {
      const msg = `Work type: expected ${prefs.work_type}, detected ${detected}`;
      if (prefs.work_type_mode === 'hard') return { result: 'hard_skip', warnings: [msg] };
      warnings.push(msg);
    }
  }

  // ── Department ──────────────────────────────────────────────────────────────
  if (prefs.departments.length > 0) {
    // If department field is empty on the listing, hard-filter can't confirm → only soft-warn
    const dept = job.department.toLowerCase();
    const matched = !job.department || prefs.departments.some(d => dept.includes(d.toLowerCase()));
    if (!matched) {
      const msg = `Department "${job.department}" not in preferred list (${prefs.departments.join(', ')})`;
      if (prefs.departments_mode === 'hard') return { result: 'hard_skip', warnings: [msg] };
      warnings.push(msg);
    }
  }

  // ── Experience level (title heuristic) ──────────────────────────────────────
  if (prefs.exp_level !== 'any') {
    const title = job.title.toLowerCase();
    if (prefs.exp_level === 'entry') {
      const tooDenior = SENIOR_TITLE_SIGNALS.some(s => title.includes(s));
      if (tooDenior) {
        const msg = `Experience level: role appears senior for entry-level preference`;
        if (prefs.exp_level_mode === 'hard') return { result: 'hard_skip', warnings: [msg] };
        warnings.push(msg);
      }
    } else if (prefs.exp_level === 'senior') {
      const tooJunior = JUNIOR_TITLE_SIGNALS.some(s => title.includes(s));
      if (tooJunior) {
        const msg = `Experience level: role appears junior for senior preference`;
        if (prefs.exp_level_mode === 'hard') return { result: 'hard_skip', warnings: [msg] };
        warnings.push(msg);
      }
    }
  }

  // ── Location ────────────────────────────────────────────────────────────────
  if (prefs.location_pref) {
    const jobLoc  = (job.location || '').toLowerCase();
    const prefLoc = prefs.location_pref.toLowerCase();
    // Remote jobs are always included regardless of location pref
    const isRemote = REMOTE_SIGNALS.some(s => jobLoc.includes(s));
    if (!isRemote && jobLoc && !jobLoc.includes(prefLoc)) {
      const msg = `Location "${job.location}" doesn't match preference "${prefs.location_pref}"`;
      if (prefs.location_pref_mode === 'hard') return { result: 'hard_skip', warnings: [msg] };
      warnings.push(msg);
    }
  }

  // ── Salary (only when JD text is available) ─────────────────────────────────
  if (prefs.salary_min !== null && jdText) {
    const salaryK = extractSalaryK(jdText);
    if (salaryK !== null && salaryK < prefs.salary_min) {
      const msg = `Salary $${salaryK}k is below your floor of $${prefs.salary_min}k`;
      if (prefs.salary_mode === 'hard') return { result: 'hard_skip', warnings: [msg] };
      warnings.push(msg);
    }
    // If no salary found → always show (per spec), no warning
  }

  return {
    result: warnings.length > 0 ? 'soft_warn' : 'pass',
    warnings,
  };
}

// ── Feed scan ─────────────────────────────────────────────────────────────────

export async function runFeedScan(
  userId: number,
  emit: (event: FeedScanEvent) => void,
  signal?: AbortSignal,
  options?: { analyze?: boolean },
): Promise<void> {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  throwIfAborted(signal);
  const shouldAnalyze = options?.analyze !== false;

  const sites = getActiveSites(userId);
  emit({ type: 'scan_start', total_sites: sites.length });

  let totalAnalyzed = 0;
  let totalCached   = 0;
  let totalSkipped  = 0;

  for (let i = 0; i < sites.length; i++) {
    if (signal?.aborted) break;
    const site = sites[i];
    emit({ type: 'site_start', site_id: site.id, site_name: site.name, site_index: i, total_sites: sites.length });

    // ── Detect LinkedIn search sites ──────────────────────────────────────────
    const isLinkedIn =
      site.ats_type === 'linkedin' ||
      site.url.toLowerCase().includes('linkedin.com/jobs/search');

    let jobs: Job[];
    // For LinkedIn we collect descriptions in the same pass to avoid re-loading
    // each job page a second time during the per-job loop below.
    let linkedInDescriptions: Map<string, string> | null = null;

    const atsOverride = site.ats_type
      ? { type: site.ats_type, slug: site.ats_slug }
      : undefined;
    try {
      if (isLinkedIn) {
        emit({
          type:      'agent_step',
          site_id:   site.id,
          site_name: site.name,
          message:   'LinkedIn scraper — loading search results and extracting descriptions…',
        });
        const linkedInResults = await scrapeLinkedIn(site.url, emit);
        throwIfAborted(signal);
        jobs = linkedInResults.map(r => r.job);
        linkedInDescriptions = new Map(linkedInResults.map(r => [r.job.url, r.description]));
      } else if (site.ats_type === 'agent') {
        // Stream each navigation step so the UI can show Gemma's progress
        jobs = await agentListJobs(site.url, (step, action, currentUrl) => {
          emit({
            type:      'agent_step',
            site_id:   site.id,
            site_name: site.name,
            message:   `[${step}] ${action.action}${action.url ? ' → ' + action.url : action.selector ? ' → ' + action.selector : ''}: ${action.reason}`,
          });
        });
        throwIfAborted(signal);
      } else {
        jobs = await listJobs(site.url, true, atsOverride);
        throwIfAborted(signal);
      }
    } catch (e) {
      if ((e as Error).message === '__SCAN_ABORTED__') break;
      emit({ type: 'site_error', site_id: site.id, site_name: site.name, message: String(e) });
      continue;
    }

    emit({ type: 'site_jobs_found', site_id: site.id, site_name: site.name, job_count: jobs.length });

    const seenUrls: string[] = [];

    for (const job of jobs) {
      if (signal?.aborted) break;
      seenUrls.push(job.url);
      upsertScrapedJob(site.id, job);

      const linkedInDescription = linkedInDescriptions?.get(job.url) ?? null;
      if (linkedInDescription) {
        setScrapedJobContent(job.url, linkedInDescription);
      }

      // ── Pre-filter (no JD text yet) ────────────────────────────────────────
      const pre = applyFilters(job, user.preferences);
      if (pre.result === 'hard_skip') {
        totalSkipped++;
        // Still upsert so we track it, but don't record analysis
        upsertFeedJob(userId, site.id, job);
        emit({ type: 'job_filtered', site_id: site.id, site_name: site.name,
          job: { job, site_id: site.id, site_name: site.name,
            filter_result: 'hard_skip', warnings: pre.warnings, analysis: null, analyzed: false } });
        continue;
      }

      // ── Cache check ────────────────────────────────────────────────────────
      const cached = getCachedFeedJob(userId, job.url);
      if (cached?.analysis) {
        // Job already analyzed — emit from cache, refresh last_seen
        upsertFeedJob(userId, site.id, job); // updates last_seen + title/location
        totalCached++;
        const result: FeedJobResult = {
          job,
          site_id:       site.id,
          site_name:     site.name,
          filter_result: cached.filter_result,
          warnings:      cached.warnings,
          analysis:      cached.analysis,
          analyzed:      true,
        };
        emit({ type: 'job_result', from_cache: true, job: result });
        continue;
      }

      // Show newly discovered jobs immediately, even before scoring finishes.
      upsertFeedJob(userId, site.id, job, {
        analysis: null,
        filter_result: pre.result,
        warnings: pre.warnings,
      });
      emit({ type: 'job_discovered', job: {
        job,
        site_id: site.id,
        site_name: site.name,
        filter_result: pre.result,
        warnings: pre.warnings,
        analysis: null,
        analyzed: false,
      } });
      if (!shouldAnalyze) continue;

      // ── New job — scrape + analyze ──────────────────────────────────────────
      emit({ type: 'job_analyzing', site_id: site.id, site_name: site.name,
        job: { job, site_id: site.id, site_name: site.name,
          filter_result: pre.result, warnings: pre.warnings, analysis: null, analyzed: false } });

      let analysis = null;
      let finalFilter = pre;

      try {
        let jdText = getScrapedJob(job.url)?.jd_text ?? linkedInDescription;
        if (!jdText) {
          jdText = await scrapeJob(job.url);
          throwIfAborted(signal);
          setScrapedJobContent(job.url, jdText);
        }

        finalFilter = applyFilters(job, user.preferences, jdText);
        if (finalFilter.result === 'hard_skip') {
          totalSkipped++;
          upsertFeedJob(userId, site.id, job);
          emit({ type: 'job_filtered', site_id: site.id, site_name: site.name,
            job: { job, site_id: site.id, site_name: site.name,
              filter_result: 'hard_skip', warnings: finalFilter.warnings, analysis: null, analyzed: false } });
          continue;
        }

        analysis = await analyze(jdText, user.resume_text, job.url);
        throwIfAborted(signal);
        totalAnalyzed++;
        // Pace requests to avoid Gemini burst rate limits (2 calls per job)
        await sleepWithAbort(1500, signal);
      } catch (e) {
        if ((e as Error).message === '__SCAN_ABORTED__') break;
        markScrapedJobError(job.url, (e as Error).message);
        finalFilter = { ...finalFilter, warnings: [...finalFilter.warnings, `Analysis failed: ${(e as Error).message}`] };
      }

      // Persist to cache regardless of whether analysis succeeded
      upsertFeedJob(userId, site.id, job, {
        analysis,
        filter_result: finalFilter.result,
        warnings:      finalFilter.warnings,
      });

      const result: FeedJobResult = {
        job,
        site_id:       site.id,
        site_name:     site.name,
        filter_result: finalFilter.result,
        warnings:      finalFilter.warnings,
        analysis,
        analyzed:      analysis !== null,
      };
      emit({ type: 'job_result', from_cache: false, job: result });
    }

    // ── Prune jobs that disappeared from this site ─────────────────────────────
    removeStaleScrapedJobs(site.id, seenUrls);
    const removed = removeStaleFeedJobs(userId, site.id, seenUrls);
    emit({ type: 'site_done', site_id: site.id, site_name: site.name, removed });
  }

  if (signal?.aborted) {
    emit({ type: 'scan_cancelled', analyzed: totalAnalyzed, skipped: totalSkipped,
      message: shouldAnalyze
        ? `Scan stopped — ${totalAnalyzed} analyzed, ${totalCached} from cache, ${totalSkipped} filtered`
        : `Discovery stopped — ${totalCached} already-scored, ${totalSkipped} filtered` });
    return;
  }

  emit({ type: 'scan_done', analyzed: totalAnalyzed, skipped: totalSkipped,
    message: shouldAnalyze
      ? `${totalAnalyzed} newly analyzed, ${totalCached} from cache, ${totalSkipped} filtered`
      : `${totalCached} already scored, ${totalSkipped} filtered; discovery cache refreshed` });
}

// ── Re-analyze cached jobs without a full discovery scan ──────────────────────

export async function reanalyzeFeedJobs(
  userId:  number,
  jobUrls: string[] | 'all',
  emit:    (event: FeedScanEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  throwIfAborted(signal);

  const allCached = getCachedFeedJobsForUser(userId);
  const targets = jobUrls === 'all'
    ? allCached
    : allCached.filter(c => jobUrls.includes(c.job.url));

  emit({ type: 'scan_start', total_sites: targets.length });

  let done = 0;
  for (const cached of targets) {
    if (signal?.aborted) break;
    const { job, site_id } = cached;

    emit({ type: 'job_analyzing', site_id, site_name: cached.site_name,
      job: { job, site_id, site_name: cached.site_name,
        filter_result: 'pass', warnings: [], analysis: null, analyzed: false } });

    let analysis = null;
    try {
      let jdText = getScrapedJob(job.url)?.jd_text ?? null;
      if (!jdText) {
        jdText = await scrapeJob(job.url);
        throwIfAborted(signal);
        setScrapedJobContent(job.url, jdText);
      }
      analysis = await analyze(jdText, user.resume_text, job.url);
      throwIfAborted(signal);
      await sleepWithAbort(1500, signal);
    } catch (e) {
      if ((e as Error).message === '__SCAN_ABORTED__') break;
      markScrapedJobError(job.url, (e as Error).message);
      emit({ type: 'site_error', site_id, site_name: job.title,
        message: `Re-analysis failed: ${(e as Error).message}` });
      done++;
      continue;
    }

    upsertFeedJob(userId, site_id, job, {
      analysis,
      filter_result: 'pass',
      warnings: [],
    });

    done++;
    const result: FeedJobResult = {
      job, site_id, site_name: cached.site_name,
      filter_result: 'pass', warnings: [], analysis, analyzed: true,
    };
    emit({ type: 'job_result', from_cache: false, job: result });
  }

  if (signal?.aborted) {
    emit({ type: 'scan_cancelled', analyzed: done, skipped: 0,
      message: `Re-analysis stopped — ${done} job${done !== 1 ? 's' : ''} updated` });
    return;
  }

  emit({ type: 'scan_done', analyzed: done, skipped: 0,
    message: `${done} job${done !== 1 ? 's' : ''} re-analyzed` });
}
