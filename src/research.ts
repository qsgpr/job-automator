import { chromium, type Browser, type Page } from 'playwright';
import type { CompanyProfile, NewsItem } from './types.js';
import { getCachedCompanyProfile, upsertCompanyProfile } from './profiles.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const wait = (minMs: number, maxMs: number) =>
  new Promise<void>(resolve => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));

// ── Rate Limiting ──────────────────────────────────────────────────────────

class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number, // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(cost: number = 1): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens < cost) {
      const waitMs = ((cost - this.tokens) / this.refillRate) * 1000;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.tokens -= cost;
    } else {
      this.tokens -= cost;
    }
  }
}

const newsLimiter = new RateLimiter(100, 100 / 86400); // 100 per day
const crunchbaseLimiter = new RateLimiter(50, 50 / (30 * 86400)); // 50 per month

// ── Web Scraping ──────────────────────────────────────────────────────────

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
    await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
  }
}

export async function scrapeWebsite(url: string): Promise<string> {
  const { browser, page } = await makeBrowser(true);
  try {
    await gotoWithFallback(page, url);
    await wait(1000, 2000);
    const content = await page.content();
    return content.slice(0, 50000); // Limit to first 50k chars
  } finally {
    await browser.close();
  }
}

// ── Claude API Integration ────────────────────────────────────────────────

async function extractWithClaude(
  html: string,
  prompt: string,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.CLAUDE_API_KEY || '';
  if (!apiKey) {
    console.warn('CLAUDE_API_KEY not set; returning empty extraction');
    return {};
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: `You are a company research expert. Extract structured information from HTML content.
Return ONLY valid JSON with the requested structure, no extra text.`,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\nHTML CONTENT:\n${html.slice(0, 20000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Claude API error: ${response.status} - ${error}`);
      return {};
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content[0]?.text || '{}';
    return JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    console.error(`Failed to extract with Claude: ${String(e)}`);
    return {};
  }
}

// ── Data Sources ───────────────────────────────────────────────────────────

export async function fetchCompanyNews(companyName: string): Promise<NewsItem[]> {
  await newsLimiter.acquire();

  const apiKey = process.env.GOOGLE_NEWS_API_KEY || '';
  if (!apiKey) {
    console.log('GOOGLE_NEWS_API_KEY not set; skipping news fetch');
    return [];
  }

  try {
    const searchUrl = new URL('https://newsapi.org/v2/everything');
    searchUrl.searchParams.set('q', companyName);
    searchUrl.searchParams.set('sortBy', 'publishedAt');
    searchUrl.searchParams.set('language', 'en');
    searchUrl.searchParams.set('pageSize', '5');
    searchUrl.searchParams.set('apiKey', apiKey);

    const response = await fetch(searchUrl.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.log(`News API error: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      articles?: Array<{
        title?: string;
        publishedAt?: string;
        url?: string;
      }>;
    };

    return (data.articles || [])
      .filter(a => a.title && a.publishedAt && a.url)
      .slice(0, 5)
      .map(a => ({
        headline: a.title!,
        date: new Date(a.publishedAt!).toISOString().split('T')[0],
        url: a.url!,
        source: 'Google News',
      }));
  } catch (e) {
    console.log(`Failed to fetch company news: ${String(e)}`);
    return [];
  }
}

export async function fetchCrunchbaseData(
  companyName: string,
): Promise<Partial<CompanyProfile>> {
  await crunchbaseLimiter.acquire();

  const apiKey = process.env.CRUNCHBASE_API_KEY || '';
  if (!apiKey) {
    console.log('CRUNCHBASE_API_KEY not set; skipping Crunchbase fetch');
    return {};
  }

  try {
    const response = await fetch('https://api.crunchbase.com/api/v4/entities/companies/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        user_key: apiKey,
        name: companyName,
        limit: 1,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.log(`Crunchbase API error: ${response.status}`);
      return {};
    }

    const data = (await response.json()) as {
      entities?: Array<{
        uuid?: string;
        name?: string;
        announced_on?: string;
        employee_count?: string;
        funding_stage?: string;
      }>;
    };

    const company = data.entities?.[0];
    if (!company) return {};

    return {
      founded_year: company.announced_on ? parseInt(company.announced_on.split('-')[0]) : null,
      employee_count: company.employee_count || null,
      funding_status: company.funding_stage || null,
    };
  } catch (e) {
    console.log(`Failed to fetch Crunchbase data: ${String(e)}`);
    return {};
  }
}

export async function scrapeCompanyWebsite(
  websiteUrl: string,
): Promise<Partial<CompanyProfile>> {
  try {
    console.log(`Scraping website: ${websiteUrl}`);
    const html = await scrapeWebsite(websiteUrl);

    const extraction = await extractWithClaude(
      html,
      `Extract company information from this HTML. Return JSON with:
{
  "description": "1-2 sentence company description",
  "tech_stack": ["tech1", "tech2", ...],
  "culture_signals": ["signal1", "signal2", ...],
  "team_size_hint": "200-500" or null
}`,
    );

    return {
      description: (extraction['description'] as string) || null,
      tech_stack: (extraction['tech_stack'] as string[]) || [],
      culture_signals: (extraction['culture_signals'] as string[]) || [],
    };
  } catch (e) {
    console.log(`Failed to scrape website: ${String(e)}`);
    return {};
  }
}

// ── Generate Talking Points ────────────────────────────────────────────────

function generateTalkingPoints(profile: Partial<CompanyProfile>): string[] {
  const points: string[] = [];

  if (profile.founded_year) {
    points.push(`Founded ${profile.founded_year}`);
  }

  if (profile.funding_status) {
    points.push(`Funding: ${profile.funding_status}`);
  }

  if (profile.employee_count) {
    points.push(`Team size: ${profile.employee_count} employees`);
  }

  if (profile.description) {
    // Extract key focus area from description
    const focuses = profile.description.match(/\b(AI|ML|blockchain|cloud|mobile|web|SaaS|infrastructure)\b/gi);
    if (focuses && focuses.length > 0) {
      points.push(`Focus: ${focuses[0]} and developer tools`);
    }
  }

  if (profile.tech_stack && profile.tech_stack.length > 0) {
    const topTechs = profile.tech_stack.slice(0, 3).join(', ');
    points.push(`Tech stack: ${topTechs}`);
  }

  if (profile.recent_news && profile.recent_news.length > 0) {
    const latestNews = profile.recent_news[0];
    points.push(`Recent: ${latestNews.headline} (${latestNews.date})`);
  }

  if (points.length === 0) {
    points.push('Company in research database');
  }

  return points;
}

// ── Main Research Orchestrator ────────────────────────────────────────────

export async function researchCompany(
  companyName: string,
  websiteUrl?: string,
): Promise<CompanyProfile> {
  console.log(`[Research] Starting research for ${companyName}`);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  const dataSources: Record<string, boolean> = {
    website: false,
    crunchbase: false,
    news: false,
  };

  let profile: Partial<CompanyProfile> = {
    company_name: companyName,
    tech_stack: [],
    culture_signals: [],
    recent_news: [],
    interview_talking_points: [],
  };

  // Fetch from Crunchbase (most likely to have founding year, funding, employees)
  if (websiteUrl || companyName) {
    const crunchbaseData = await fetchCrunchbaseData(companyName);
    if (Object.keys(crunchbaseData).length > 0) {
      profile = { ...profile, ...crunchbaseData };
      dataSources.crunchbase = true;
    }
  }

  // Scrape website if provided
  if (websiteUrl) {
    try {
      const websiteData = await scrapeCompanyWebsite(websiteUrl);
      if (Object.keys(websiteData).length > 0) {
        profile = { ...profile, ...websiteData };
        dataSources.website = true;
      }
    } catch (e) {
      console.log(`Website scrape failed for ${companyName}: ${String(e)}`);
    }
  }

  // Fetch recent news
  const news = await fetchCompanyNews(companyName);
  if (news.length > 0) {
    profile.recent_news = news;
    dataSources.news = true;
  }

  // Generate talking points
  profile.interview_talking_points = generateTalkingPoints(profile);

  // Build final profile
  const fullProfile: CompanyProfile = {
    id: 0, // Will be set by database
    company_name: companyName,
    website: websiteUrl || null,
    description: profile.description || null,
    tech_stack: profile.tech_stack || [],
    culture_signals: profile.culture_signals || [],
    recent_news: profile.recent_news || [],
    interview_talking_points: profile.interview_talking_points || [],
    founded_year: profile.founded_year || null,
    employee_count: profile.employee_count || null,
    funding_status: profile.funding_status || null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    cache_expires_at: expiresAt.toISOString(),
    data_sources: dataSources,
  };

  // Cache the result
  const cached = upsertCompanyProfile(fullProfile);
  console.log(`[Research] Cached profile for ${companyName} (ID: ${cached.id})`);

  return cached;
}

export async function getOrResearchCompany(
  companyName: string,
  websiteUrl?: string,
  forceRefresh: boolean = false,
): Promise<CompanyProfile> {
  // Check cache first
  if (!forceRefresh) {
    const cached = getCachedCompanyProfile(companyName);
    if (cached) {
      const expiresAt = new Date(cached.cache_expires_at);
      const isFresh = expiresAt > new Date();
      if (isFresh) {
        console.log(`[Research] Cache hit for ${companyName}`);
        return cached;
      }
    }
  }

  // Research and cache
  console.log(`[Research] Cache miss or forced refresh for ${companyName}`);
  return researchCompany(companyName, websiteUrl);
}
