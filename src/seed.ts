/**
 * seed.ts — Demo user seed data
 *
 * Called on server startup (idempotent). Seeds a demo user with realistic
 * pre-filled data so visitors can click "Try Demo" and see the app working.
 *
 * Demo credentials:
 *   Email:    demo@notchup.app
 *   Password: Demo1234!
 */

import { db } from './observability.js';

export const DEMO_EMAIL    = 'demo@notchup.app';
export const DEMO_PASSWORD = 'Demo1234!';

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// ── Resume ────────────────────────────────────────────────────────────────────

const DEMO_RESUME = `Alex Rivera
alex.rivera@email.com | +1-415-555-0191 | linkedin.com/in/alex-rivera | San Francisco, CA

SUMMARY
Senior software engineer with 7 years building consumer mobile and AI-powered products.
Deep expertise in iOS (Swift/SwiftUI) and Node.js backends. Recently shipped an AI job
automation platform using LangGraph + Playwright. Passionate about developer tooling,
clean APIs, and products that genuinely change how people work.

EXPERIENCE

Senior Software Engineer, iOS & AI — Luminary Labs (Remote) | Mar 2022 – Present
• Architected and shipped a LangGraph-based job application automation system analyzing
  600+ listings with AI scoring, 3-layer form filling via Playwright, and live streaming UI.
• Led iOS development for a B2C productivity app (Swift, SwiftUI) reaching 150k MAU; built
  core onboarding, StoreKit 2 subscriptions, and offline-first sync via SwiftData.
• Redesigned push-notification pipeline (Node.js + AWS SQS), reducing p99 latency 40%.
• Introduced TypeScript across backend services; cut runtime errors ~30% in 6 months.
• Stack: Swift, SwiftUI, TypeScript, Node.js, LangChain/LangGraph, Playwright, PostgreSQL, AWS.

Software Engineer — Luminary Labs | Sep 2020 – Feb 2022
• Built core iOS onboarding and in-app subscription flow (StoreKit 2) from the ground up.
• Developed REST API endpoints in Express/Node.js consumed by iOS and React web clients.
• Integrated Stripe for subscription billing; handled webhooks for plan changes and renewals.
• Owned CI/CD pipeline on GitHub Actions; cut build times from 18 min to 8 min.

Software Engineer — Brightwave Inc. | Jun 2018 – Aug 2020
• Shipped React + Redux dashboard for IoT device management platform (B2B, 200+ clients).
• Wrote Python data-ingestion scripts processing ~2M sensor readings/day into PostgreSQL.
• Collaborated with mobile team on shared REST API contracts; maintained OpenAPI specs.

SKILLS
Mobile:    iOS (Swift, SwiftUI, UIKit, StoreKit 2, SwiftData, CoreData, XCTest)
AI/ML:     LangChain, LangGraph, Gemini/GPT-4, embeddings, RAG, prompt engineering
Backend:   Node.js, TypeScript, Express, REST, GraphQL, WebSockets, SSE
Automation: Playwright, Puppeteer, browser stealth, form-filling agents
Frontend:  React, Next.js, Vanilla JS, HTML/CSS
Databases: PostgreSQL, SQLite, Redis, Supabase
Cloud/Ops: AWS (ECS, SQS, Lambda, S3, RDS), Docker, GitHub Actions, Cloudflare Tunnel
Languages: Swift, TypeScript, JavaScript, Python, SQL

EDUCATION
B.S. Computer Science — UC San Diego | 2018  (GPA 3.7)
Relevant: Distributed Systems, Database Systems, Mobile Computing, Machine Learning

PROJECTS
Job Automator (open-source) — AI-powered job search automation platform.
  LangGraph 2-node pipeline, Playwright stealth, 3-layer ATS form filler, live streaming UI.
  Live at jobs.notchup.app | TypeScript, Node.js, LangGraph, Playwright, Gemini 2.5 Flash

CERTIFICATIONS
AWS Certified Developer – Associate (2023)`.trim();

// ── Job sites ─────────────────────────────────────────────────────────────────

const DEMO_SITES = [
  { name: 'Linear',    url: 'https://linear.app/careers',     ats_type: 'ashby',      ats_slug: 'linear' },
  { name: 'BOLD',      url: 'https://bold.com/careers',       ats_type: 'greenhouse', ats_slug: 'bold' },
  { name: 'Stripe',    url: 'https://stripe.com/jobs',        ats_type: 'greenhouse', ats_slug: 'stripe' },
  { name: 'Notion',    url: 'https://notion.so/careers',      ats_type: 'greenhouse', ats_slug: 'notion' },
  { name: 'Vercel',    url: 'https://vercel.com/careers',     ats_type: 'greenhouse', ats_slug: 'vercel' },
];

// ── Feed jobs ─────────────────────────────────────────────────────────────────

const DEMO_FEED_JOBS = [
  {
    site: 'https://linear.app/careers',
    job_url: 'https://linear.app/careers/software-engineer-ios',
    job_title: 'Software Engineer, iOS',
    location: 'Remote (US/Europe)',
    department: 'Engineering',
    match_score: 94,
    first_seen: daysAgo(5),
    analysis: {
      title: 'Software Engineer, iOS at Linear',
      match_score: 94,
      summary: 'Excellent fit. Linear is building a best-in-class project management tool in Swift/SwiftUI — Alex\'s primary stack for the past 3 years. Small, high-quality team where senior engineers ship end-to-end, which aligns with Alex\'s track record.',
      requirements: [
        '5+ years iOS development, Swift/SwiftUI',
        'Experience shipping consumer or B2B iOS apps',
        'Strong product instincts and attention to detail',
        'Comfortable with backend systems and APIs',
      ],
      strengths: [
        '3+ years production SwiftUI including complex offline-first sync',
        'Shipped iOS app to 150k MAU — directly comparable scale',
        'Full-stack background means can contribute across the product',
        'Personal automation projects show initiative and depth',
      ],
      gaps: [
        'Linear is Rust on the backend — not in resume',
        'No mention of real-time sync or CRDT experience',
      ],
      recommendation: 'Strong apply — top fit across the entire feed.',
    },
  },
  {
    site: 'https://bold.com/careers',
    job_url: 'https://bold.com/careers/senior-applied-ai-engineer',
    job_title: 'Senior Applied AI Engineer',
    location: 'Remote',
    department: 'Engineering',
    match_score: 91,
    first_seen: daysAgo(3),
    analysis: {
      title: 'Senior Applied AI Engineer at BOLD',
      match_score: 91,
      summary: 'Exceptional match. BOLD is building AI-powered career tools — exactly what the Job Automator project demonstrates. LangGraph, streaming pipelines, and Playwright experience are direct hits on the job description. Could walk into this interview with a live demo.',
      requirements: [
        'LangChain / LangGraph or similar agentic AI frameworks',
        'TypeScript / Node.js in production',
        'Experience building AI pipelines end-to-end',
        'Browser automation or web scraping',
        'Streaming / real-time systems',
      ],
      strengths: [
        'Job Automator uses LangGraph 2-node pipeline in production',
        'Playwright stealth + 3-layer ATS form filler is directly relevant',
        'TypeScript + Node.js across full backend',
        'Streaming UI with SSE already implemented',
        'AI analysis of 600+ jobs shows production-scale usage',
      ],
      gaps: [
        'BOLD may prefer Python ML experience alongside TypeScript',
        'No explicit mention of vector databases or RAG in resume',
      ],
      recommendation: 'Apply immediately — project portfolio is purpose-built for this role.',
    },
  },
  {
    site: 'https://stripe.com/jobs',
    job_url: 'https://stripe.com/jobs/listing/software-engineer-mobile-ios/6543210',
    job_title: 'Software Engineer, Mobile (iOS)',
    location: 'San Francisco, CA / Remote',
    department: 'Engineering',
    match_score: 87,
    first_seen: daysAgo(7),
    analysis: {
      title: 'Software Engineer, Mobile (iOS) at Stripe',
      match_score: 87,
      summary: 'Strong match. Stripe\'s mobile team builds complex financial UIs in Swift. Alex\'s StoreKit/Stripe payments integration experience and 150k-MAU app are directly relevant. Backend fluency valued for working across platform boundaries.',
      requirements: [
        '4+ years iOS development (Swift, UIKit or SwiftUI)',
        'Experience with REST API design and integration',
        'Backend service experience (Node.js, Python, or similar)',
        'Payments or fintech domain a plus',
      ],
      strengths: [
        'SwiftUI and UIKit experience, production at scale',
        'Direct Stripe SDK integration (billing, webhooks, StoreKit 2)',
        'Node.js backend cross-pollination fits Stripe\'s full-stack culture',
        'AWS SQS pipeline shows distributed systems awareness',
      ],
      gaps: [
        'No Android/Kotlin experience (Stripe is expanding cross-platform)',
        'Payments domain limited to Stripe SDK usage, not core finance',
      ],
      recommendation: 'Strong apply — emphasize Stripe integration and SQS work.',
    },
  },
  {
    site: 'https://notion.so/careers',
    job_url: 'https://notion.so/careers/senior-software-engineer-mobile',
    job_title: 'Senior Software Engineer, Mobile',
    location: 'New York, NY / Remote',
    department: 'Engineering',
    match_score: 82,
    first_seen: daysAgo(4),
    analysis: {
      title: 'Senior Software Engineer, Mobile at Notion',
      match_score: 82,
      summary: 'Good fit. Notion is investing heavily in mobile and offline-first capabilities — a direct overlap with Alex\'s SwiftData/CoreData sync work. Complexity of the Notion editor sets a high bar for mobile engineering quality.',
      requirements: [
        'Strong iOS experience (Swift, SwiftUI or UIKit)',
        'Offline-first or complex sync experience',
        'Collaborative editor or rich content rendering a plus',
        'Experience scaling apps to millions of users',
      ],
      strengths: [
        'Offline-first sync with SwiftData is exactly what Notion needs',
        'SwiftUI expertise matches Notion\'s modern iOS rewrite direction',
        'Scaling experience (150k MAU) shows production readiness',
      ],
      gaps: [
        'No rich text / collaborative editing experience in resume',
        'Notion mobile team skews toward very senior engineers (7-10 yrs)',
        'Role may prefer Android parity experience',
      ],
      recommendation: 'Apply — offline sync experience is a strong differentiator.',
    },
  },
  {
    site: 'https://stripe.com/jobs',
    job_url: 'https://stripe.com/jobs/listing/software-engineer-payments-platform/7529787',
    job_title: 'Software Engineer, Payments Platform',
    location: 'San Francisco, CA',
    department: 'Engineering',
    match_score: 76,
    first_seen: daysAgo(6),
    analysis: {
      title: 'Software Engineer, Payments Platform at Stripe',
      match_score: 76,
      summary: 'Decent fit on engineering quality but the role is backend/infra focused. Alex\'s Node.js and AWS experience are relevant, but the role digs deep into distributed payments infrastructure — a domain stretch.',
      requirements: [
        'Strong backend engineering (Ruby, Go, Java, or similar)',
        'Distributed systems at scale',
        'Payments, ledgering, or financial infrastructure experience',
        'Low-latency API design',
      ],
      strengths: [
        'Node.js and AWS production experience',
        'SQS + async pipeline work shows distributed systems awareness',
        'Stripe SDK usage gives product context',
      ],
      gaps: [
        'No Ruby, Go, or Java — Stripe\'s primary backend languages',
        'Payments platform is financial infrastructure, not mobile/AI',
        'Distributed systems experience is limited in resume',
      ],
      recommendation: 'Stretch role — apply if interested in pivoting to infra.',
    },
  },
  {
    site: 'https://vercel.com/careers',
    job_url: 'https://vercel.com/careers/software-engineer-dx',
    job_title: 'Software Engineer, Developer Experience',
    location: 'Remote',
    department: 'Engineering',
    match_score: 68,
    first_seen: daysAgo(8),
    analysis: {
      title: 'Software Engineer, Developer Experience at Vercel',
      match_score: 68,
      summary: 'Partial match. Vercel DX is heavy on Next.js internals, bundlers, and CLI tooling for web developers. Alex\'s TypeScript and CLI project (Job Automator) show tooling instincts, but the role skews strongly frontend/web rather than mobile or AI.',
      requirements: [
        'Deep Next.js and React ecosystem knowledge',
        'CLI tooling or developer-facing API experience',
        'Build systems, bundlers (Webpack, Turbopack)',
        'Strong TypeScript',
      ],
      strengths: [
        'TypeScript across full stack',
        'Job Automator shows CLI/automation tooling instincts',
        'React listed in skills',
      ],
      gaps: [
        'No production Next.js work — only listed as skill',
        'Build systems / bundler internals absent from resume',
        'Role is frontend-heavy; Alex\'s strength is mobile + AI',
      ],
      recommendation: 'Apply as a stretch — DX tooling interest is evident.',
    },
  },
];

// ── Applications ──────────────────────────────────────────────────────────────

const DEMO_APPLICATIONS = [
  {
    job_url: 'https://linear.app/careers/software-engineer-ios',
    job_title: 'Software Engineer, iOS',
    site_name: 'Linear',
    match_score: 94,
    status: 'interviewing',
    notes: 'Recruiter screen done — technical round scheduled for next week. Focus on Swift concurrency and offline sync.',
    added_at: daysAgo(4),
  },
  {
    job_url: 'https://bold.com/careers/senior-applied-ai-engineer',
    job_title: 'Senior Applied AI Engineer',
    site_name: 'BOLD',
    match_score: 91,
    status: 'applied',
    notes: 'Applied with Job Automator as the demo project. Waiting on response.',
    added_at: daysAgo(2),
  },
  {
    job_url: 'https://stripe.com/jobs/listing/software-engineer-mobile-ios/6543210',
    job_title: 'Software Engineer, Mobile (iOS)',
    site_name: 'Stripe',
    match_score: 87,
    status: 'applied',
    notes: 'Submitted. Strong fit on payments + SwiftUI.',
    added_at: daysAgo(6),
  },
  {
    job_url: 'https://notion.so/careers/senior-software-engineer-mobile',
    job_title: 'Senior Software Engineer, Mobile',
    site_name: 'Notion',
    match_score: 82,
    status: 'interested',
    notes: 'Want to apply — need to tailor cover letter around the offline sync angle.',
    added_at: daysAgo(1),
  },
];

// ── Seed function ─────────────────────────────────────────────────────────────

export function seedDemoUser(): void {
  const ts = now();

  // ── 1. Upsert demo user (always refresh profile data) ─────────────────────
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(DEMO_EMAIL) as { id: number } | undefined;

  let userId: number;

  if (existing) {
    userId = existing.id;
    db.prepare(`
      UPDATE users SET
        name = ?, phone = ?, linkedin = ?, resume_text = ?,
        city = ?, state = ?, work_authorized = ?, requires_sponsorship = ?,
        years_experience = ?, ts_proficiency = ?, updated_at = ?
      WHERE id = ?
    `).run(
      'Alex Rivera', '+1-415-555-0191', 'linkedin.com/in/alex-rivera',
      DEMO_RESUME, 'San Francisco', 'CA', 'Yes', 'No', '7+ years',
      'Expert', ts, userId,
    );
    console.log(`[seed] Demo user refreshed (id=${userId}).`);
  } else {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users
        (name, email, phone, linkedin, resume_text, city, state,
         work_authorized, requires_sponsorship, years_experience, ts_proficiency,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Alex Rivera', DEMO_EMAIL, '+1-415-555-0191', 'linkedin.com/in/alex-rivera',
      DEMO_RESUME, 'San Francisco', 'CA', 'Yes', 'No', '7+ years', 'Expert', ts, ts,
    );
    userId = lastInsertRowid as number;
    try { db.prepare(`INSERT INTO user_preferences (user_id) VALUES (?)`).run(userId); } catch {}
    console.log(`[seed] Demo user created (id=${userId}).`);
  }

  // Reset chat quota for demo
  try { db.prepare(`UPDATE users SET chat_token_used = 0 WHERE id = ?`).run(userId); } catch {}

  const seedFlagKey = 'demo_seed_initialized_v1';
  const existingSeedFlag = db.prepare(
    `SELECT value FROM app_settings WHERE key = ?`
  ).get(seedFlagKey) as { value: string } | undefined;
  const existingSeededSiteCount = db.prepare(
    `SELECT COUNT(*) AS count FROM job_sites WHERE user_id = ? AND url IN (${DEMO_SITES.map(() => '?').join(', ')})`
  ).get(userId, ...DEMO_SITES.map(site => site.url)) as { count: number };
  const existingFeedCount = db.prepare(
    `SELECT COUNT(*) AS count FROM feed_jobs WHERE user_id = ?`
  ).get(userId) as { count: number };
  const existingApplicationCount = db.prepare(
    `SELECT COUNT(*) AS count FROM applications WHERE user_id = ?`
  ).get(userId) as { count: number };

  const alreadySeeded =
    existingSeedFlag?.value === '1'
    || existingSeededSiteCount.count > 0
    || existingFeedCount.count > 0
    || existingApplicationCount.count > 0;

  // ── 2. Always upsert job sites (safe to run every restart) ──────────────
  const insertSite = db.prepare(`
    INSERT INTO job_sites (user_id, name, url, active, ats_type, ats_slug, added_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(user_id, url) DO UPDATE SET
      name = excluded.name,
      ats_type = excluded.ats_type,
      ats_slug = excluded.ats_slug
  `);
  for (const s of DEMO_SITES) {
    insertSite.run(userId, s.name, s.url, s.ats_type, s.ats_slug, ts);
  }

  // ── 3. Seed feed jobs for demo initialization ─────────────────────────────
  db.prepare(`DELETE FROM feed_jobs WHERE user_id = ?`).run(userId);

  const getSiteId = db.prepare(`SELECT id FROM job_sites WHERE url = ? AND user_id = ?`);
  const insertFeedJob = db.prepare(`
    INSERT INTO feed_jobs
      (user_id, site_id, job_url, job_title, location, department,
       analysis_json, match_score, filter_result, warnings_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const job of DEMO_FEED_JOBS) {
    const siteRow = getSiteId.get(job.site, userId) as { id: number } | undefined;
    if (!siteRow) {
      console.warn(`[seed] Site not found for ${job.site}, skipping ${job.job_title}.`);
      continue;
    }
    insertFeedJob.run(
      userId, siteRow.id, job.job_url, job.job_title, job.location, job.department,
      JSON.stringify(job.analysis), job.match_score, 'pass', '[]',
      job.first_seen, ts,
    );
  }

  // ── 4. Seed applications (replace demo user's applications) ───────────────
  db.prepare(`DELETE FROM applications WHERE user_id = ?`).run(userId);

  const insertApp = db.prepare(`
    INSERT INTO applications
      (user_id, job_url, job_title, site_name, match_score, status, notes, added_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const app of DEMO_APPLICATIONS) {
    insertApp.run(
      userId, app.job_url, app.job_title, app.site_name,
      app.match_score, app.status, app.notes, app.added_at, app.added_at,
    );
  }

  db.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(seedFlagKey);

  console.log(`[seed] Demo data ready — ${DEMO_FEED_JOBS.length} jobs, ${DEMO_APPLICATIONS.length} applications.`);
  console.log(`[seed] Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}
