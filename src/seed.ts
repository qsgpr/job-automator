/**
 * seed.ts — Demo user seed data
 *
 * Called on server startup (idempotent). Seeds a demo user with realistic
 * pre-filled data so visitors can click "Try Demo" and see the app working
 * immediately.
 *
 * Demo credentials:
 *   Email:    demo@notchup.app
 *   Password: Demo1234!   (must be created manually in Supabase — see README)
 */

import { db } from './observability.js';

const DEMO_EMAIL = 'demo@notchup.app';

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const DEMO_RESUME = `Alex Rivera
demo@notchup.app | +1-555-0100 | linkedin.com/in/alex-rivera-dev | San Francisco, CA

SUMMARY
Mid-level software engineer with 6 years of experience building mobile and backend systems.
Passionate about developer tooling, clean APIs, and shipping products that scale. Strong
track record working across the stack from iOS apps to Node.js microservices on AWS.

EXPERIENCE

Senior Software Engineer — Luminary Labs (Remote) | Jan 2022 – Present
- Led iOS development for a B2C productivity app (Swift, SwiftUI) reaching 120k MAU.
- Redesigned the push-notification pipeline on Node.js + AWS SQS, reducing latency by 40%.
- Introduced end-to-end TypeScript across the team's backend services; cut runtime errors ~30%.
- Mentored two junior engineers; ran weekly architecture reviews.
- Stack: Swift, SwiftUI, TypeScript, Node.js, PostgreSQL, AWS (ECS, SQS, S3, Lambda).

Software Engineer — Luminary Labs | Aug 2020 – Dec 2021
- Built the core iOS onboarding flow and in-app subscription logic (StoreKit 2).
- Developed REST API endpoints in Express/Node.js consumed by iOS and React web clients.
- Integrated Stripe for subscription billing; handled webhooks for plan changes and renewals.
- Owned CI/CD pipeline on GitHub Actions; reduced build times from 18 min to 8 min.

Junior Software Engineer — Brightwave Inc. | Jun 2019 – Jul 2020
- Shipped features in a React + Redux web dashboard for an IoT device management platform.
- Wrote data-ingestion scripts in Python that processed ~2 M sensor readings/day into PostgreSQL.
- Collaborated with mobile team on shared API contracts; wrote OpenAPI specs.

SKILLS
Languages:   Swift, TypeScript, JavaScript, Python, SQL
Mobile:      iOS (Swift, SwiftUI, UIKit, StoreKit 2, CoreData)
Backend:     Node.js, Express, REST, GraphQL, WebSockets
Frontend:    React, Next.js, HTML/CSS, Tailwind
Databases:   PostgreSQL, SQLite, Redis
Cloud/Ops:   AWS (ECS, SQS, Lambda, S3, RDS), Docker, GitHub Actions, Terraform (basics)
Testing:     XCTest, Jest, Supertest, Playwright

EDUCATION
B.S. Computer Science — University of California, San Diego | 2019
GPA 3.7 | Relevant coursework: Distributed Systems, Database Systems, Mobile Computing

PROJECTS
JobPilot (personal, open-source) — CLI tool that auto-fills Greenhouse ATS forms using Playwright.
  github.com/arivera-dev/jobpilot | TypeScript, Node.js, Playwright

CERTIFICATIONS
AWS Certified Developer – Associate (2023)
`.trim();

const DEMO_SITES = [
  {
    name: 'Stripe',
    url: 'https://stripe.com/jobs',
    notes: 'Payments infrastructure. Engineering roles often use Greenhouse.',
    ats_type: 'greenhouse',
    ats_slug: 'stripe',
  },
  {
    name: 'Linear',
    url: 'https://linear.app/careers',
    notes: 'Project management tool. Small, high-quality eng team.',
    ats_type: 'ashby',
    ats_slug: 'linear',
  },
  {
    name: 'Vercel',
    url: 'https://vercel.com/careers',
    notes: 'Frontend cloud platform. Strong TypeScript/React focus.',
    ats_type: 'greenhouse',
    ats_slug: 'vercel',
  },
];

const DEMO_FEED_JOBS = [
  {
    job_url: 'https://stripe.com/jobs/listing/software-engineer-mobile-ios/6543210',
    job_title: 'Software Engineer, Mobile (iOS)',
    location: 'San Francisco, CA / Remote',
    department: 'Engineering',
    match_score: 87,
    filter_result: 'pass',
    analysis_json: JSON.stringify({
      title: 'Software Engineer, Mobile (iOS) at Stripe',
      match_score: 87,
      summary: 'Strong match. Role requires iOS/Swift expertise and backend API experience — both core to Alex\'s background. Stripe\'s payments domain aligns with StoreKit/Stripe experience.',
      requirements: [
        '4+ years iOS development (Swift, UIKit/SwiftUI)',
        'Experience with RESTful API design and integration',
        'Familiarity with backend services (Node.js, Python, or similar)',
        'Understanding of payments or fintech a plus',
      ],
      strengths: [
        'SwiftUI and UIKit experience across 3+ years',
        'Direct Stripe integration experience (StoreKit 2, webhooks)',
        'Full-stack background bridges mobile and backend conversations',
      ],
      gaps: [
        'No explicit fintech or payments-domain experience beyond Stripe SDK usage',
        'Role mentions Kotlin/Android as a plus — not in resume',
      ],
      recommendation: 'Apply — strong technical fit. Emphasize Stripe webhook work and SQS pipeline.',
    }),
    warnings_json: '[]',
  },
  {
    job_url: 'https://linear.app/careers/software-engineer-backend',
    job_title: 'Software Engineer, Backend',
    location: 'Remote (US)',
    department: 'Engineering',
    match_score: 74,
    filter_result: 'pass',
    analysis_json: JSON.stringify({
      title: 'Software Engineer, Backend at Linear',
      match_score: 74,
      summary: 'Good match for backend skills. Linear is TypeScript-first which aligns perfectly. Smaller team means broader scope — a good opportunity but may require more product ownership than previous roles.',
      requirements: [
        'Strong TypeScript / Node.js',
        'Experience with PostgreSQL at scale',
        'GraphQL API design',
        'Distributed systems knowledge',
      ],
      strengths: [
        'TypeScript across full stack — matches Linear\'s engineering culture',
        'PostgreSQL experience in production environments',
        'Node.js backend service experience at Luminary Labs',
      ],
      gaps: [
        'GraphQL listed as skill but not highlighted in projects — worth elaborating',
        'Linear operates at a smaller scale than ideal for "PostgreSQL at scale" claim',
      ],
      recommendation: 'Apply — TypeScript fit is excellent. Tailor resume to emphasize GraphQL work.',
    }),
    warnings_json: '[]',
  },
  {
    job_url: 'https://vercel.com/careers/software-engineer-dx',
    job_title: 'Software Engineer, Developer Experience',
    location: 'Remote',
    department: 'Engineering',
    match_score: 68,
    filter_result: 'pass',
    analysis_json: JSON.stringify({
      title: 'Software Engineer, Developer Experience at Vercel',
      match_score: 68,
      summary: 'Decent match. Vercel DX role centers on CLI tooling, Next.js internals, and developer-facing APIs. JobPilot project shows tooling interest. React/TypeScript are strong but role skews heavily toward frontend/DX rather than backend.',
      requirements: [
        'Deep knowledge of Next.js and the React ecosystem',
        'Experience building CLI tools or developer-facing APIs',
        'Understanding of build systems, bundlers (Webpack, Turbopack)',
        'Strong TypeScript',
      ],
      strengths: [
        'JobPilot personal project demonstrates CLI tooling experience',
        'React and TypeScript in production',
        'Next.js listed in skills',
      ],
      gaps: [
        'No direct Next.js production experience — only listed as a skill',
        'Build systems / bundler internals not in resume',
        'Role is frontend-heavy; Alex\'s strength is mobile + backend',
      ],
      recommendation: 'Consider applying — stretch role, but DX tooling interest evident. Highlight JobPilot prominently.',
    }),
    warnings_json: JSON.stringify(['Match score below 70 — review gaps before applying']),
  },
];

export function seedDemoUser(): void {
  const ts = now();

  // ── 1. Check if demo user already exists ────────────────────────────────────
  const existing = db.prepare(
    `SELECT id FROM users WHERE email = ?`
  ).get(DEMO_EMAIL) as { id: number } | undefined;

  let userId: number;

  if (existing) {
    userId = existing.id;
    console.log(`[seed] Demo user already exists (id=${userId}), skipping profile seed.`);
  } else {
    // ── 2. Insert demo user ────────────────────────────────────────────────────
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users
        (name, email, phone, linkedin, resume_text,
         work_authorized, requires_sponsorship, years_experience,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Alex Rivera',
      DEMO_EMAIL,
      '+1-555-0100',
      'linkedin.com/in/alex-rivera-dev',
      DEMO_RESUME,
      'Yes',
      'No',
      '5-7 years',
      ts,
      ts,
    );
    userId = lastInsertRowid as number;

    // ── 3. Insert default preferences ─────────────────────────────────────────
    db.prepare(`INSERT INTO user_preferences (user_id) VALUES (?)`).run(userId);

    console.log(`[seed] Demo user created (id=${userId}).`);
  }

  // ── 4. Seed job sites (idempotent via UNIQUE url constraint) ─────────────────
  const insertSite = db.prepare(`
    INSERT INTO job_sites (name, url, notes, active, ats_type, ats_slug, added_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(url) DO NOTHING
  `);

  for (const site of DEMO_SITES) {
    insertSite.run(site.name, site.url, site.notes, site.ats_type, site.ats_slug, ts);
  }

  // ── 5. Seed feed jobs (idempotent via UNIQUE user_id+job_url constraint) ─────
  // We need site IDs for the feed_jobs foreign key
  const getSiteId = db.prepare(`SELECT id FROM job_sites WHERE url = ?`);

  // Map site URLs to seeded job entries
  const siteUrlByJob: Record<string, string> = {
    [DEMO_FEED_JOBS[0].job_url]: 'https://stripe.com/jobs',
    [DEMO_FEED_JOBS[1].job_url]: 'https://linear.app/careers',
    [DEMO_FEED_JOBS[2].job_url]: 'https://vercel.com/careers',
  };

  const insertFeedJob = db.prepare(`
    INSERT INTO feed_jobs
      (user_id, site_id, job_url, job_title, location, department,
       analysis_json, match_score, filter_result, warnings_json, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, job_url) DO NOTHING
  `);

  for (const job of DEMO_FEED_JOBS) {
    const siteUrl = siteUrlByJob[job.job_url];
    const siteRow = getSiteId.get(siteUrl) as { id: number } | undefined;
    if (!siteRow) {
      console.warn(`[seed] Could not find site id for ${siteUrl}, skipping feed job ${job.job_title}.`);
      continue;
    }
    insertFeedJob.run(
      userId,
      siteRow.id,
      job.job_url,
      job.job_title,
      job.location,
      job.department,
      job.analysis_json,
      job.match_score,
      job.filter_result,
      job.warnings_json,
      ts,
      ts,
    );
  }

  console.log(`[seed] Demo data ready. Login: ${DEMO_EMAIL} / Demo1234!`);
}
