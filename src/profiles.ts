import { writeFileSync } from 'node:fs';
import { db } from './observability.js';
import type { User, UserPreferences, JobSite, Job, Analysis, FeedFilterResult, FeedJobResult } from './types.js';

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id:          row.id as number,
    name:        row.name as string,
    email:       (row.email    as string) ?? '',
    phone:       (row.phone    as string) ?? '',
    linkedin:    (row.linkedin as string) ?? '',
    resume_text: (row.resume_text as string) ?? '',
    created_at:  row.created_at as string,
    updated_at:  row.updated_at as string,
    street:      (row.street as string) ?? '',
    city:        (row.city   as string) ?? '',
    state:       (row.state  as string) ?? '',
    zip:         (row.zip    as string) ?? '',
    work_authorized:      (row.work_authorized      as string) ?? '',
    requires_sponsorship: (row.requires_sponsorship as string) ?? '',
    available_start:      (row.available_start      as string) ?? '',
    years_experience:     (row.years_experience     as string) ?? '',
    ts_proficiency:       (row.ts_proficiency       as string) ?? '',
    llm_frameworks:       JSON.parse((row.llm_frameworks as string) || '[]'),
    additional_info:      (row.additional_info      as string) ?? '',
    preferences: {
      work_type:      (row.work_type      as string ?? 'any') as UserPreferences['work_type'],
      work_type_mode: (row.work_type_mode as string ?? 'soft') as UserPreferences['work_type_mode'],
      departments:      JSON.parse((row.departments as string) || '[]'),
      departments_mode: (row.departments_mode as string ?? 'soft') as UserPreferences['departments_mode'],
      salary_min:       row.salary_min != null ? (row.salary_min as number) : null,
      salary_mode:    (row.salary_mode    as string ?? 'soft') as UserPreferences['salary_mode'],
      exp_level:      (row.exp_level      as string ?? 'any') as UserPreferences['exp_level'],
      exp_level_mode: (row.exp_level_mode as string ?? 'soft') as UserPreferences['exp_level_mode'],
      location_pref:      (row.location_pref      as string) ?? '',
      location_pref_mode: ((row.location_pref_mode as string) ?? 'soft') as UserPreferences['location_pref_mode'],
    },
  };
}

// ── Users ─────────────────────────────────────────────────────────────────────

export function createUser(name: string, email: string): User {
  const ts = now();
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO users (name, email, resume_text, created_at, updated_at) VALUES (?, ?, '', ?, ?)`
  ).run(name, email, ts, ts);

  const id = lastInsertRowid as number;
  db.prepare(
    `INSERT INTO user_preferences (user_id) VALUES (?)`
  ).run(id);

  return getUser(id)!;
}

export function listUsers(): User[] {
  const rows = db.prepare(`
    SELECT u.*, p.work_type, p.work_type_mode, p.departments, p.departments_mode,
           p.salary_min, p.salary_mode, p.exp_level, p.exp_level_mode,
           p.location_pref, p.location_pref_mode
    FROM users u
    LEFT JOIN user_preferences p ON p.user_id = u.id
    ORDER BY u.id
  `).all() as Record<string, unknown>[];
  return rows.map(rowToUser);
}

export function getUser(id: number): User | null {
  const row = db.prepare(`
    SELECT u.*, p.work_type, p.work_type_mode, p.departments, p.departments_mode,
           p.salary_min, p.salary_mode, p.exp_level, p.exp_level_mode,
           p.location_pref, p.location_pref_mode
    FROM users u
    LEFT JOIN user_preferences p ON p.user_id = u.id
    WHERE u.id = ?
  `).get(id) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export function updateUserContact(
  userId: number,
  fields: Partial<Pick<User,
    'name' | 'email' | 'phone' | 'linkedin' |
    'street' | 'city' | 'state' | 'zip' |
    'work_authorized' | 'requires_sponsorship' | 'available_start' |
    'years_experience' | 'ts_proficiency' | 'llm_frameworks' | 'additional_info'
  >>,
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.name                !== undefined) { sets.push('name = ?');                vals.push(fields.name); }
  if (fields.email               !== undefined) { sets.push('email = ?');               vals.push(fields.email); }
  if (fields.phone               !== undefined) { sets.push('phone = ?');               vals.push(fields.phone); }
  if (fields.linkedin            !== undefined) { sets.push('linkedin = ?');            vals.push(fields.linkedin); }
  if (fields.street              !== undefined) { sets.push('street = ?');              vals.push(fields.street); }
  if (fields.city                !== undefined) { sets.push('city = ?');                vals.push(fields.city); }
  if (fields.state               !== undefined) { sets.push('state = ?');               vals.push(fields.state); }
  if (fields.zip                 !== undefined) { sets.push('zip = ?');                 vals.push(fields.zip); }
  if (fields.work_authorized     !== undefined) { sets.push('work_authorized = ?');     vals.push(fields.work_authorized); }
  if (fields.requires_sponsorship !== undefined) { sets.push('requires_sponsorship = ?'); vals.push(fields.requires_sponsorship); }
  if (fields.available_start     !== undefined) { sets.push('available_start = ?');     vals.push(fields.available_start); }
  if (fields.years_experience    !== undefined) { sets.push('years_experience = ?');    vals.push(fields.years_experience); }
  if (fields.ts_proficiency      !== undefined) { sets.push('ts_proficiency = ?');      vals.push(fields.ts_proficiency); }
  if (fields.llm_frameworks      !== undefined) { sets.push('llm_frameworks = ?');      vals.push(JSON.stringify(fields.llm_frameworks)); }
  if (fields.additional_info     !== undefined) { sets.push('additional_info = ?');     vals.push(fields.additional_info); }
  if (!sets.length) return;
  sets.push('updated_at = ?'); vals.push(now());
  vals.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function updateUserResume(userId: number, resumeText: string): void {
  db.prepare(
    `UPDATE users SET resume_text = ?, updated_at = ? WHERE id = ?`
  ).run(resumeText, now(), userId);
  // Keep resume.txt in sync for backward compat with existing routes
  try { writeFileSync('resume.txt', resumeText); } catch {}
}

export function updateUserPreferences(userId: number, prefs: Partial<UserPreferences>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (prefs.work_type      !== undefined) { sets.push('work_type = ?');      vals.push(prefs.work_type); }
  if (prefs.work_type_mode !== undefined) { sets.push('work_type_mode = ?'); vals.push(prefs.work_type_mode); }
  if (prefs.departments      !== undefined) { sets.push('departments = ?');      vals.push(JSON.stringify(prefs.departments)); }
  if (prefs.departments_mode !== undefined) { sets.push('departments_mode = ?'); vals.push(prefs.departments_mode); }
  if (prefs.salary_min     !== undefined) { sets.push('salary_min = ?');     vals.push(prefs.salary_min); }
  if (prefs.salary_mode    !== undefined) { sets.push('salary_mode = ?');    vals.push(prefs.salary_mode); }
  if (prefs.exp_level      !== undefined) { sets.push('exp_level = ?');      vals.push(prefs.exp_level); }
  if (prefs.exp_level_mode !== undefined) { sets.push('exp_level_mode = ?'); vals.push(prefs.exp_level_mode); }
  if (prefs.location_pref      !== undefined) { sets.push('location_pref = ?');      vals.push(prefs.location_pref); }
  if (prefs.location_pref_mode !== undefined) { sets.push('location_pref_mode = ?'); vals.push(prefs.location_pref_mode); }

  if (!sets.length) return;
  vals.push(userId);
  db.prepare(`UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
}

export function deleteUser(id: number): void {
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

// ── Job sites ─────────────────────────────────────────────────────────────────

function rowToSite(row: Record<string, unknown>): JobSite {
  return {
    id:       row.id as number,
    name:     row.name as string,
    url:      row.url as string,
    notes:    (row.notes as string) ?? '',
    active:   (row.active as number) === 1,
    added_at: row.added_at as string,
    ats_type: ((row.ats_type as string) || '') as JobSite['ats_type'],
    ats_slug: (row.ats_slug as string) ?? '',
  };
}

export function listSites(): JobSite[] {
  return (db.prepare(`SELECT * FROM job_sites ORDER BY added_at DESC`).all() as Record<string, unknown>[]).map(rowToSite);
}

export function getActiveSites(): JobSite[] {
  return (db.prepare(`SELECT * FROM job_sites WHERE active = 1 ORDER BY added_at`).all() as Record<string, unknown>[]).map(rowToSite);
}

export function addSite(name: string, url: string, notes = '', ats_type = '', ats_slug = ''): JobSite {
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO job_sites (name, url, notes, active, added_at, ats_type, ats_slug) VALUES (?, ?, ?, 1, ?, ?, ?)`
  ).run(name, url, notes, now(), ats_type, ats_slug);
  return rowToSite(db.prepare(`SELECT * FROM job_sites WHERE id = ?`).get(lastInsertRowid as number) as Record<string, unknown>);
}

export function updateSite(id: number, fields: Partial<Pick<JobSite, 'name' | 'url' | 'notes' | 'active' | 'ats_type' | 'ats_slug'>>): void {
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (fields.name     !== undefined) { sets.push('name = ?');     vals.push(fields.name); }
  if (fields.url      !== undefined) { sets.push('url = ?');      vals.push(fields.url); }
  if (fields.notes    !== undefined) { sets.push('notes = ?');    vals.push(fields.notes); }
  if (fields.active   !== undefined) { sets.push('active = ?');   vals.push(fields.active ? 1 : 0); }
  if (fields.ats_type !== undefined) { sets.push('ats_type = ?'); vals.push(fields.ats_type); }
  if (fields.ats_slug !== undefined) { sets.push('ats_slug = ?'); vals.push(fields.ats_slug); }

  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE job_sites SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteSite(id: number): void {
  db.prepare(`DELETE FROM job_sites WHERE id = ?`).run(id);
}

// ── Feed job cache ─────────────────────────────────────────────────────────────

export interface CachedFeedJob {
  id:            number;
  user_id:       number;
  site_id:       number;
  site_name:     string;
  job:           Job;
  analysis:      Analysis | null;
  match_score:   number | null;
  filter_result: FeedFilterResult;
  warnings:      string[];
  first_seen:    string;
  last_seen:     string;
}

function rowToCached(row: Record<string, unknown>): CachedFeedJob {
  return {
    id:           row.id as number,
    user_id:      row.user_id as number,
    site_id:      row.site_id as number,
    site_name:    (row.site_name as string) ?? '',
    job: {
      title:      row.job_title  as string,
      url:        row.job_url    as string,
      location:   row.location   as string,
      department: row.department as string,
    },
    analysis:      row.analysis_json ? JSON.parse(row.analysis_json as string) : null,
    match_score:   row.match_score != null ? (row.match_score as number) : null,
    filter_result: (row.filter_result as FeedFilterResult) ?? 'pass',
    warnings:      JSON.parse((row.warnings_json as string) || '[]'),
    first_seen:    row.first_seen as string,
    last_seen:     row.last_seen  as string,
  };
}

/** Returns the cached entry for this user+job if it exists, else null. */
export function getCachedFeedJob(userId: number, jobUrl: string): CachedFeedJob | null {
  const row = db.prepare(`
    SELECT f.*, s.name AS site_name
    FROM feed_jobs f
    LEFT JOIN job_sites s ON s.id = f.site_id
    WHERE f.user_id = ? AND f.job_url = ?
  `).get(userId, jobUrl) as Record<string, unknown> | undefined;
  return row ? rowToCached(row) : null;
}

/** Insert a new job or update last_seen + analysis when re-seen. */
export function upsertFeedJob(
  userId:       number,
  siteId:       number,
  job:          Job,
  result?: {
    analysis:      Analysis | null;
    filter_result: FeedFilterResult;
    warnings:      string[];
  },
): void {
  const ts = now();
  const existing = getCachedFeedJob(userId, job.url);

  if (!existing) {
    db.prepare(`
      INSERT INTO feed_jobs
        (user_id, site_id, job_url, job_title, location, department,
         analysis_json, match_score, filter_result, warnings_json, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId, siteId, job.url, job.title, job.location, job.department,
      result?.analysis ? JSON.stringify(result.analysis) : null,
      result?.analysis?.match_score ?? null,
      result?.filter_result ?? 'pass',
      JSON.stringify(result?.warnings ?? []),
      ts, ts,
    );
  } else {
    // Always refresh last_seen; only overwrite analysis if a new one was produced
    const sets: string[] = ['last_seen = ?', 'job_title = ?', 'location = ?', 'department = ?'];
    const vals: unknown[] = [ts, job.title, job.location, job.department];

    if (result?.analysis) {
      sets.push('analysis_json = ?', 'match_score = ?', 'filter_result = ?', 'warnings_json = ?');
      vals.push(
        JSON.stringify(result.analysis),
        result.analysis.match_score ?? null,
        result.filter_result,
        JSON.stringify(result.warnings ?? []),
      );
    }

    vals.push(userId, job.url);
    db.prepare(`UPDATE feed_jobs SET ${sets.join(', ')} WHERE user_id = ? AND job_url = ?`).run(...vals);
  }
}

/**
 * Delete cached jobs for this user+site whose URL is no longer in `currentUrls`.
 * Returns the titles of removed jobs so the UI can show what disappeared.
 */
export function removeStaleFeedJobs(
  userId:      number,
  siteId:      number,
  currentUrls: string[],
): { title: string; url: string }[] {
  if (!currentUrls.length) {
    // If the site returned zero jobs (error?), don't prune — too risky
    return [];
  }

  const placeholders = currentUrls.map(() => '?').join(', ');
  const stale = db.prepare(`
    SELECT job_title AS title, job_url AS url
    FROM feed_jobs
    WHERE user_id = ? AND site_id = ?
      AND job_url NOT IN (${placeholders})
  `).all(userId, siteId, ...currentUrls) as { title: string; url: string }[];

  if (stale.length) {
    db.prepare(`
      DELETE FROM feed_jobs
      WHERE user_id = ? AND site_id = ?
        AND job_url NOT IN (${placeholders})
    `).run(userId, siteId, ...currentUrls);
  }

  return stale;
}

/** Load all cached feed jobs for a user, newest match_score first. */
export function getCachedFeedJobsForUser(userId: number): CachedFeedJob[] {
  return (db.prepare(`
    SELECT f.*, s.name AS site_name
    FROM feed_jobs f
    LEFT JOIN job_sites s ON s.id = f.site_id
    WHERE f.user_id = ?
    ORDER BY f.match_score DESC NULLS LAST, f.last_seen DESC
  `).all(userId) as Record<string, unknown>[]).map(rowToCached);
}

/** Wipe the analysis for one job so it can be re-analyzed on the next scan. */
export function clearFeedJobAnalysis(userId: number, jobUrl: string): void {
  db.prepare(`
    UPDATE feed_jobs SET analysis_json = NULL, match_score = NULL
    WHERE user_id = ? AND job_url = ?
  `).run(userId, jobUrl);
}

/** Wipe analyses for all cached jobs belonging to a user. */
export function clearAllFeedJobAnalyses(userId: number): void {
  db.prepare(`
    UPDATE feed_jobs SET analysis_json = NULL, match_score = NULL WHERE user_id = ?
  `).run(userId);
}

// ── Applications (kanban board) ───────────────────────────────────────────────

export type AppStatus = 'interested' | 'applied' | 'interviewing' | 'offer' | 'rejected';

export interface Application {
  id:          number;
  user_id:     number;
  job_url:     string;
  job_title:   string;
  site_name:   string;
  match_score: number | null;
  status:      AppStatus;
  notes:       string;
  added_at:    string;
  updated_at:  string;
}

function rowToApp(row: Record<string, unknown>): Application {
  return {
    id:          row.id          as number,
    user_id:     row.user_id     as number,
    job_url:     row.job_url     as string,
    job_title:   row.job_title   as string,
    site_name:   row.site_name   as string,
    match_score: row.match_score != null ? (row.match_score as number) : null,
    status:      (row.status     as AppStatus) ?? 'interested',
    notes:       (row.notes      as string)    ?? '',
    added_at:    row.added_at    as string,
    updated_at:  row.updated_at  as string,
  };
}

export function listApplications(userId: number): Application[] {
  return (db.prepare(`
    SELECT * FROM applications WHERE user_id = ? ORDER BY updated_at DESC
  `).all(userId) as Record<string, unknown>[]).map(rowToApp);
}

export function addApplication(
  userId:     number,
  jobUrl:     string,
  jobTitle:   string,
  siteName:   string,
  matchScore: number | null,
): Application {
  const ts = now();
  db.prepare(`
    INSERT INTO applications (user_id, job_url, job_title, site_name, match_score, status, notes, added_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'interested', '', ?, ?)
    ON CONFLICT(user_id, job_url) DO NOTHING
  `).run(userId, jobUrl, jobTitle, siteName, matchScore ?? null, ts, ts);
  const row = db.prepare(`SELECT * FROM applications WHERE user_id = ? AND job_url = ?`).get(userId, jobUrl) as Record<string, unknown>;
  return rowToApp(row);
}

export function updateApplication(
  id:     number,
  userId: number,
  patch:  Partial<Pick<Application, 'status' | 'notes'>>,
): Application | null {
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [now()];
  if (patch.status !== undefined) { sets.push('status = ?'); vals.push(patch.status); }
  if (patch.notes  !== undefined) { sets.push('notes = ?');  vals.push(patch.notes);  }
  vals.push(id, userId);
  db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals);
  const row = db.prepare(`SELECT * FROM applications WHERE id = ? AND user_id = ?`).get(id, userId) as Record<string, unknown> | undefined;
  return row ? rowToApp(row) : null;
}

export function removeApplication(id: number, userId: number): void {
  db.prepare(`DELETE FROM applications WHERE id = ? AND user_id = ?`).run(id, userId);
}
