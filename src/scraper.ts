import { chromium, type Page, type Browser } from 'playwright';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { recordSelectorResult } from './observability.js';
import type { Job } from './types.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// Multi-word phrases that almost exclusively appear on block/CAPTCHA pages.
// Single words like "captcha" are intentionally excluded — they appear in
// legitimate job descriptions (e.g. "experience with Captcha bypass").
const BLOCK_PHRASES = [
  'please solve this captcha',
  'prove you are not a robot',
  'you have been blocked',
  'access has been denied',
  'please complete the security check',
  'verifying you are not a bot',
  'checking if the site connection is secure',
  'ray id',
];

// Single words suspicious ONLY when page content is very short
const SUSPICIOUS_IF_SHORT = ['captcha', 'cloudflare', 'unusual traffic', 'just a moment'];

export class ScraperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScraperError';
  }
}

const wait = (minMs: number, maxMs: number) =>
  new Promise<void>(resolve => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));

function checkBlock(text: string, url: string): void {
  const lower = text.toLowerCase();

  for (const phrase of BLOCK_PHRASES) {
    if (lower.includes(phrase)) {
      throw new ScraperError(
        `Bot detection triggered on ${url}\n` +
        `  Detected: '${phrase}'\n` +
        `  The page returned a block/CAPTCHA page instead of job content.\n` +
        `  Greenhouse and Lever URLs work reliably; Indeed/LinkedIn often block headless browsers.`
      );
    }
  }

  if (text.length < 1000) {
    for (const word of SUSPICIOUS_IF_SHORT) {
      if (lower.includes(word)) {
        throw new ScraperError(
          `Likely blocked on ${url}\n` +
          `  Extracted only ${text.length} chars and found '${word}' in the content.\n` +
          `  The page may be a bot-detection wall. Try the URL in your browser first.`
        );
      }
    }
  }

  if (text.length < 300) {
    throw new ScraperError(
      `Only ${text.length} characters extracted from ${url}\n` +
      `  The page may require login, use heavy JavaScript, or have blocked the scraper.`
    );
  }
}

async function makeBrowser(headless = true): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const page = await context.newPage();
  return { browser, page };
}

async function gotoWithFallback(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
}

// ─── Structured board listing ──────────────────────────────────────────────────

async function extractStructuredJobLinks(page: Page, listingUrl: string): Promise<Job[]> {
  const selector = 'a.job-result[data-location]';
  const t0 = performance.now();
  const cards = await page.$$(selector);
  recordSelectorResult({
    selector,
    context: 'scraper.listings',
    success: cards.length > 0,
    latencyMs: performance.now() - t0,
    error: cards.length === 0 ? 'No matching job cards found' : null,
  });

  const base = new URL(listingUrl).origin;
  const jobs: Job[] = [];

  for (const card of cards) {
    const href  = (await card.getAttribute('href')) ?? '';
    const loc   = (await card.getAttribute('data-location')) ?? '';
    const dept  = (await card.getAttribute('data-department')) ?? '';
    const h3    = await card.$('h3');
    const title = h3 ? (await h3.innerText()).trim() : (await card.innerText()).trim();
    jobs.push({
      title,
      url: href.startsWith('http') ? href : `${base}${href}`,
      location: loc,
      department: dept,
    });
  }

  return jobs;
}

async function listStructuredJobs(url: string, headless = true): Promise<Job[]> {
  const { browser, page } = await makeBrowser(headless);
  let jobs: Job[] = [];
  try {
    await gotoWithFallback(page, url);
    await wait(2000, 3000);
    jobs = await extractStructuredJobLinks(page, url);
  } catch (e) {
    console.log(`  Structured board scrape failed (${(e as Error).message})`);
  } finally {
    await browser.close();
  }
  return jobs;
}

// ─── Careers page discovery ────────────────────────────────────────────────────

const CAREERS_TEXT = new Set([
  'careers', 'career', 'jobs', 'job openings', 'work here',
  'work with us', 'join us', 'join our team', "we're hiring",
  'open positions', 'open roles', 'opportunities', 'come work',
]);

const CAREERS_HREF = [
  '/careers', '/jobs', '/work-here', '/join', '/opportunities',
  '/openings', '/positions', '/apply',
];

export async function findCareersUrl(url: string): Promise<string | null> {
  const { browser, page } = await makeBrowser(true);
  try {
    await gotoWithFallback(page, url);
    await wait(1000, 2000);

    const base = new URL(url).origin;
    let bestUrl: string | null = null;
    let bestScore = 0;

    for (const link of await page.$$('a[href]')) {
      const href = ((await link.getAttribute('href')) ?? '').trim();
      const text = (await link.innerText()).trim().toLowerCase();

      if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue;

      let score = 0;
      for (const kw of CAREERS_TEXT) {
        if (text === kw) { score += 4; break; }
        if (text.includes(kw)) { score += 2; break; }
      }
      for (const pattern of CAREERS_HREF) {
        if (href.toLowerCase().includes(pattern)) { score += 3; break; }
      }

      if (score > bestScore) {
        bestScore = score;
        bestUrl = href.startsWith('http') ? href : `${base}${href}`;
      }
    }

    return bestScore >= 3 ? bestUrl : null;
  } finally {
    await browser.close();
  }
}

// ─── ATS public APIs ───────────────────────────────────────────────────────────

const ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com',
  'bamboohr.com', 'rippling.com', 'workable.com',
  'myworkdayjobs.com', 'icims.com', 'smartrecruiters.com',
  'jobvite.com', 'breezy.hr', 'recruitee.com',
];

const JOB_PATH_SEGMENTS = [
  '/job/', '/jobs/', '/job-description/', '/job-opening/',
  '/careers/', '/career/', '/posting/', '/position/',
  '/openings/', '/requisition/', '/role/',
];

const EXCLUDE_URL_FRAGMENTS = [
  '/users/', '/sign_in', '/sign-in', '/login',
  '/auth/', '/account/', '/register', '/password',
  '/sessions', '/oauth',
];

const NAV_TEXTS = new Set([
  'apply', 'apply now', 'apply here', 'submit application',
  'back', 'next', 'previous', 'continue', 'go',
  'login', 'log in', 'sign in', 'sign up', 'register',
  'contact', 'contact us', 'about', 'about us', 'home',
  'blog', 'news', 'press', 'privacy', 'terms', 'cookies',
  'learn more', 'read more', 'see all', 'view all', 'show more',
  'load more', 'search', 'filter', 'reset', 'clear', 'close',
  'share', 'tweet', 'facebook', 'linkedin', 'instagram',
  'create alert', 'job alert', 'set alert', 'get notified',
  'refer a friend', 'referral',
]);

function companySlug(url: string, after: string): string {
  try {
    return (url.split(after).pop() ?? '').replace(/^\//, '').split('/')[0];
  } catch {
    return '';
  }
}

async function listGreenhouseApi(company: string): Promise<Job[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=false`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as {
      jobs: Array<{
        title?: string;
        absolute_url?: string;
        location?: { name?: string };
        departments?: Array<{ name?: string }>;
      }>;
    };
    return data.jobs
      .filter(j => j.title && j.absolute_url)
      .map(j => ({
        title: j.title!.trim(),
        url: j.absolute_url!,
        location: j.location?.name ?? '',
        department: j.departments?.[0]?.name ?? '',
      }));
  } catch (e) {
    console.log(`  Greenhouse API failed (${(e as Error).message}) — falling back to browser scrape`);
    return [];
  }
}

async function listLeverApi(company: string): Promise<Job[]> {
  const url = `https://api.lever.co/v0/postings/${company}?mode=json`;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const jobs = await r.json() as Array<{
      text?: string;
      hostedUrl?: string;
      categories?: { location?: string; team?: string };
    }>;
    if (!Array.isArray(jobs)) return [];
    return jobs
      .filter(j => j.text && j.hostedUrl)
      .map(j => ({
        title: j.text!.trim(),
        url: j.hostedUrl!,
        location: j.categories?.location ?? '',
        department: j.categories?.team ?? '',
      }));
  } catch (e) {
    console.log(`  Lever API failed (${(e as Error).message}) — falling back to browser scrape`);
    return [];
  }
}

// ─── Generic job listing scraper ───────────────────────────────────────────────

function isJobPostingUrl(href: string, listingUrl: string): boolean {
  if (href.replace(/\/$/, '') === listingUrl.replace(/\/$/, '')) return false;
  const lower = href.toLowerCase();
  if (EXCLUDE_URL_FRAGMENTS.some(f => lower.includes(f))) return false;

  // Tier 1: known ATS domain with enough path depth
  for (const domain of ATS_DOMAINS) {
    if (lower.includes(domain)) {
      const parts = href.split('/').filter(p => p && !p.match(/^https?:$/));
      if (parts.length >= 3) return true;
    }
  }

  // Tier 2: generic path segment with content after it
  for (const seg of JOB_PATH_SEGMENTS) {
    const idx = lower.indexOf(seg);
    if (idx >= 0) {
      const after = lower.slice(idx + seg.length).replace(/^\//, '').split('?')[0];
      if (after.length >= 3) return true;
    }
  }

  return false;
}

interface LinkData {
  text: string;
  url: string;
  context: string;
}

async function extractPageLinks(page: Page, baseUrl: string): Promise<LinkData[]> {
  const base = new URL(baseUrl).origin;
  const links: LinkData[] = [];
  const seen = new Set<string>();

  for (const el of await page.$$('a[href]')) {
    const href = ((await el.getAttribute('href')) ?? '').trim();
    const text = (await el.innerText()).trim();

    if (!href || !text) continue;
    if (/^(mailto:|tel:|javascript:|#)/.test(href)) continue;
    if (text.length < 5 || text.length > 150) continue;
    if (NAV_TEXTS.has(text.toLowerCase())) continue;

    const fullUrl = href.startsWith('http') ? href : `${base}${href}`;
    if (EXCLUDE_URL_FRAGMENTS.some(f => fullUrl.toLowerCase().includes(f))) continue;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);

    let context = '';
    try {
      const parentText = await el.evaluate((node: Element) => {
        const parent = node.closest('li, tr, [class*=job], [class*=card], article');
        return (parent as HTMLElement | null)?.innerText ?? '';
      }) as string;
      const ctx = parentText.replace(text, '').trim();
      if (ctx && ctx.length < 120) context = ctx;
    } catch { /* ignore */ }

    links.push({ text, url: fullUrl, context });
  }

  return links;
}

async function llmExtractJobs(linksData: LinkData[], sourceUrl: string): Promise<Job[]> {
  if (!linksData.length) return [];

  const lines = linksData.slice(0, 200).map((item, i) => {
    let line = `${i + 1}. "${item.text}" → ${item.url}`;
    if (item.context) line += `\n   nearby text: ${item.context}`;
    return line;
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `You are analyzing links extracted from a job listings webpage.
Your task: identify which links lead to INDIVIDUAL job postings (one specific open position).

NOT job postings: navigation links, "See all jobs", category pages, blog posts,
sign-in pages, alert subscriptions, social media links.

For each job posting, return:
  title      — the job title (clean up whitespace/newlines)
  url        — the full URL exactly as given
  location   — from nearby text if available, else empty string
  department — from nearby text if available, else empty string

Return ONLY a valid JSON array. Empty array [] if none found.
Example: [{"title": "Senior Engineer", "url": "https://...", "location": "Remote", "department": "Engineering"}]`],
    ['human', 'Source page: {source_url}\n\nLinks:\n\n{links}'],
  ]);

  const llm = new ChatOllama({ model: 'gemma4:26b', temperature: 0 });
  const parser = new JsonOutputParser<Job[]>();
  const chain = prompt.pipe(llm).pipe(parser);

  try {
    const raw = await chain.invoke({ source_url: sourceUrl, links: lines.join('\n') }) as unknown[];
    return raw.flatMap(item => {
      if (typeof item !== 'object' || !item) return [];
      const j = item as Record<string, unknown>;
      if (!j.title || !j.url) return [];
      return [{
        title: String(j.title).trim(),
        url: String(j.url),
        location: String(j.location ?? '').trim(),
        department: String(j.department ?? '').trim(),
      }];
    });
  } catch (e) {
    console.log(`  LLM extraction failed (${(e as Error).constructor.name}) — will try heuristic fallback`);
    return [];
  }
}

function heuristicFilter(linksData: LinkData[], listingUrl: string): Job[] {
  return linksData
    .filter(item => isJobPostingUrl(item.url, listingUrl))
    .map(item => ({ title: item.text, url: item.url, location: item.context, department: '' }));
}

async function listJobsGeneric(url: string, headless = true): Promise<Job[]> {
  const { browser, page } = await makeBrowser(headless);
  let linksData: LinkData[] = [];
  try {
    await gotoWithFallback(page, url);
    await wait(1500, 2500);
    linksData = await extractPageLinks(page, url);
  } finally {
    await browser.close();
  }

  console.log(`  Found ${linksData.length} candidate links — asking Gemma to identify job postings...`);
  const jobs = await llmExtractJobs(linksData, url);
  if (jobs.length > 0) {
    console.log(`  Gemma identified ${jobs.length} job postings`);
    return jobs;
  }

  console.log('  Gemma returned nothing — using URL-pattern heuristics as fallback');
  return heuristicFilter(linksData, url);
}

export async function listJobs(url: string, headless = true): Promise<Job[]> {
  const lower = url.toLowerCase();

  if (lower.includes('greenhouse.io')) {
    const company = companySlug(url, 'greenhouse.io/');
    if (company) {
      const jobs = await listGreenhouseApi(company);
      if (jobs.length > 0) return jobs;
    }
  }

  if (lower.includes('lever.co')) {
    const company = companySlug(url, 'lever.co/');
    if (company) {
      const jobs = await listLeverApi(company);
      if (jobs.length > 0) return jobs;
    }
  }

  const structured = await listStructuredJobs(url, headless);
  if (structured.length > 0) return structured;

  return listJobsGeneric(url, headless);
}

// ─── Single job page scraper ───────────────────────────────────────────────────

async function scrapeAccordionJobPage(page: Page): Promise<string> {
  const accordionTabs = [
    'Job Description', 'Responsibilities', 'Qualifications',
    'Benefits', 'About', 'About Us', 'About the Team',
  ];

  let expandedCount = 0;
  for (const tabName of accordionTabs) {
    const t0 = performance.now();
    try {
      const trigger = page.getByText(tabName, { exact: false }).first();
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      await wait(500, 1000);
      console.log(`  Expanded: ${tabName}`);
      expandedCount++;
      recordSelectorResult({ selector: `text:${tabName}`, context: 'scraper.accordion', success: true, latencyMs: performance.now() - t0 });
    } catch (e) {
      recordSelectorResult({ selector: `text:${tabName}`, context: 'scraper.accordion', success: false, latencyMs: performance.now() - t0, error: String(e) });
    }
  }

  recordSelectorResult({
    selector: 'accordion_any',
    context: 'scraper.accordion',
    success: expandedCount > 0,
    error: expandedCount === 0 ? 'No accordion sections were expandable' : null,
  });

  await wait(500, 1000);

  for (const selector of ['.job-content', '.job-detail', '.entry-content', "[class*='job']", 'article', 'main']) {
    try {
      const el = await page.$(selector);
      if (el) {
        const text = await el.innerText();
        if (text.length > 300) return text;
      }
    } catch { continue; }
  }

  return page.innerText('body');
}

async function scrapeGenericJobPage(page: Page): Promise<string> {
  const selectors = [
    '#content', '.job-post',
    '.posting-description', '.posting-requirements',
    '.description__text', '.jobs-description__content',
    '[data-automation-id="job-description"]',
    '[data-testid="job-description"]',
    '#job-description', '.job-description',
    'article', 'main',
  ];

  for (const sel of selectors) {
    const t0 = performance.now();
    try {
      const el = await page.$(sel);
      if (el) {
        const text = await el.innerText();
        if (text.length > 300) {
          recordSelectorResult({ selector: sel, context: 'scraper.job_content', success: true, latencyMs: performance.now() - t0 });
          return text;
        }
      }
    } catch { continue; }
  }

  recordSelectorResult({ selector: 'job_content_any', context: 'scraper.job_content', success: false, error: 'No content selector returned enough text' });
  return page.innerText('body');
}

export async function scrapeJob(url: string): Promise<string> {
  let browser: Browser | null = null;
  try {
    ({ browser } = await makeBrowser(true));
    const context = browser.contexts()[0];
    const page = context.pages()[0];

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    await wait(1500, 3000);

    let text = await scrapeAccordionJobPage(page);
    if (text.trim().length < 300) text = await scrapeGenericJobPage(page);

    await browser.close();
    const trimmed = text.trim();
    checkBlock(trimmed, url);
    return trimmed;
  } catch (e) {
    await browser?.close().catch(() => {});
    if (e instanceof ScraperError) throw e;
    const err = e as Error;
    if (err.name === 'TimeoutError') {
      throw new ScraperError(
        `Timed out loading ${url}\n  The site may be very slow, down, or actively blocking headless browsers.`
      );
    }
    throw new ScraperError(`Unexpected scraper error on ${url}: ${err.name}: ${err.message}`);
  }
}
