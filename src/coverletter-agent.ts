import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import type { Analysis, CompanyProfile, CoverLetter } from './types.js';
import { db } from './observability.js';

/**
 * Generate a personalized cover letter for a job.
 * Uses company profile, job requirements, and relevant resume bullets.
 */
export async function generateCoverLetterFromAnalysis(
  jobTitle: string,
  companyName: string,
  companyProfile: CompanyProfile | null,
  analysis: Analysis,
  resumeText: string,
): Promise<string> {
  const llm = new ChatGoogleGenerativeAI({ model: 'gemini-2.5-flash', temperature: 0.3, apiKey: process.env.GOOGLE_API_KEY });

  // Extract company context
  const companyContext = buildCompanyContext(companyName, companyProfile);

  // Build relevant experience section from resume and analysis strengths
  const relevantExperience = extractRelevantExperience(resumeText, analysis.strengths);

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', `You are an expert career coach and cover letter writer. Your task is to write a compelling, personalized cover letter.

IMPORTANT GUIDELINES:
- Write ONLY the body of the cover letter (no date, address, "Dear Hiring Manager" salutation, or signature)
- Keep it to 3-4 tight paragraphs, approximately 300-350 words
- Make it specific to the company and role — use company details and achievements
- Reference 2-3 specific accomplishments from the provided experience that match job requirements
- Avoid generic statements like "I am a passionate developer"
- Use active voice and confident language
- End with a clear call to action
- Make it ready to submit as-is to a hiring manager

Structure:
1. Opening: One compelling sentence that shows genuine interest in the company and role
2. Body: 2-3 paragraphs that connect specific experiences to job requirements
3. Closing: Confident call to action with next steps

Keep the tone professional but personable — show personality while remaining professional.`],

    ['human', `COMPANY CONTEXT:
Company: {company_name}
Role: {job_title}

{company_context}

JOB REQUIREMENTS (must-have):
{requirements}

YOUR RELEVANT EXPERIENCE:
{relevant_experience}

Write a personalized cover letter for this opportunity.`],
  ]);

  const chain = prompt.pipe(llm).pipe(new StringOutputParser());

  try {
    const result = await chain.invoke({
      company_name: companyName,
      job_title: jobTitle,
      company_context: companyContext,
      requirements: analysis.requirements.slice(0, 5).map(r => `• ${r}`).join('\n'),
      relevant_experience: relevantExperience,
    });

    return result.trim();
  } catch (e) {
    throw new Error(`Failed to generate cover letter: ${String(e)}`);
  }
}

/**
 * Build company context string from profile data.
 */
function buildCompanyContext(companyName: string, profile: CompanyProfile | null): string {
  if (!profile) {
    return `[No company profile available — focus on the job requirements and your relevant experience]`;
  }

  const parts: string[] = [`Company: ${companyName}`];

  if (profile.description) {
    parts.push(`Mission/Focus: ${profile.description.slice(0, 200)}`);
  }

  if (profile.tech_stack && profile.tech_stack.length > 0) {
    parts.push(`Tech Stack: ${profile.tech_stack.join(', ')}`);
  }

  if (profile.culture_signals && profile.culture_signals.length > 0) {
    parts.push(`Culture: ${profile.culture_signals.slice(0, 3).join(', ')}`);
  }

  if (profile.interview_talking_points && profile.interview_talking_points.length > 0) {
    parts.push(`Key Talking Points:\n${profile.interview_talking_points.slice(0, 3).map(p => `• ${p}`).join('\n')}`);
  }

  return parts.join('\n');
}

/**
 * Extract 2-3 most relevant bullet points from resume that match job requirements.
 */
function extractRelevantExperience(resumeText: string, strengths: string[]): string {
  // If we have identified strengths from analysis, use those
  if (strengths && strengths.length > 0) {
    return strengths.slice(0, 3).map(s => `• ${s}`).join('\n');
  }

  // Fallback: extract first few substantial bullet points from resume
  const bullets = resumeText
    .split('\n')
    .filter(line => line.trim().startsWith('•') || line.trim().startsWith('-'))
    .slice(0, 3)
    .map(line => line.trim().replace(/^[-•]\s*/, ''));

  return bullets.length > 0 ? bullets.map(b => `• ${b}`).join('\n') : '[See resume for details of relevant experience]';
}

/**
 * Quick validation: ensure cover letter meets basic quality criteria.
 */
export function validateCoverLetter(content: string, companyName: string): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const wordCount = content.split(/\s+/).length;

  if (wordCount < 150) {
    issues.push(`Cover letter too short (${wordCount} words, expected 250-350)`);
  }
  if (wordCount > 500) {
    issues.push(`Cover letter too long (${wordCount} words, expected 250-350)`);
  }

  if (!content.toLowerCase().includes(companyName.toLowerCase())) {
    issues.push(`Does not mention company name "${companyName}"`);
  }

  if (content.toLowerCase().includes('dear hiring manager') || content.toLowerCase().includes('to whom it may concern')) {
    issues.push(`Contains generic greeting (should not be included in body)`);
  }

  // Check for common weak phrases
  const weakPhrases = [
    'i am writing to express my interest',
    'i believe i am a perfect fit',
    'i am passionate about',
    'with my skills and experience',
  ];

  for (const phrase of weakPhrases) {
    if (content.toLowerCase().includes(phrase)) {
      issues.push(`Contains generic phrase: "${phrase}"`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ── Database persistence ──────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function rowToCoverLetter(row: Record<string, unknown>): CoverLetter {
  return {
    id: row.id as number,
    user_id: row.user_id as number,
    job_url: row.job_url as string,
    company_profile_id: row.company_profile_id != null ? (row.company_profile_id as number) : undefined,
    company_name: (row.company_name as string) || '',
    job_title: (row.job_title as string) || '',
    content: row.content as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function getCachedCoverLetter(userId: number, jobUrl: string): CoverLetter | null {
  const row = db.prepare(`
    SELECT * FROM cover_letters WHERE user_id = ? AND job_url = ?
  `).get(userId, jobUrl) as Record<string, unknown> | undefined;
  return row ? rowToCoverLetter(row) : null;
}

export function saveCoverLetter(
  userId: number,
  jobUrl: string,
  content: string,
  companyName: string,
  jobTitle: string,
  companyProfileId?: number,
): CoverLetter {
  const existing = getCachedCoverLetter(userId, jobUrl);
  const ts = now();

  if (existing) {
    db.prepare(`
      UPDATE cover_letters SET content = ?, company_name = ?, job_title = ?, company_profile_id = ?, updated_at = ?
      WHERE user_id = ? AND job_url = ?
    `).run(content, companyName, jobTitle, companyProfileId || null, ts, userId, jobUrl);
    return rowToCoverLetter(db.prepare(`SELECT * FROM cover_letters WHERE user_id = ? AND job_url = ?`).get(userId, jobUrl) as Record<string, unknown>);
  }

  db.prepare(`
    INSERT INTO cover_letters (user_id, job_url, content, company_name, job_title, company_profile_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, jobUrl, content, companyName, jobTitle, companyProfileId || null, ts, ts);

  return rowToCoverLetter(db.prepare(`SELECT * FROM cover_letters WHERE user_id = ? AND job_url = ?`).get(userId, jobUrl) as Record<string, unknown>);
}

export function getCoverLettersForUser(userId: number): CoverLetter[] {
  return (db.prepare(`
    SELECT * FROM cover_letters WHERE user_id = ? ORDER BY updated_at DESC
  `).all(userId) as Record<string, unknown>[]).map(rowToCoverLetter);
}

// ── Company Profile helpers (simple in-memory for now) ──────────────────

export function getCompanyProfile(id: number): CompanyProfile | null {
  // TODO: Implement full company profile lookup by ID
  // For now, return null - company profiles are managed via research.ts
  return null;
}

export function getOrCreateCompanyProfile(
  companyName: string,
  options: { website?: string } = {},
): CompanyProfile {
  // TODO: Implement - should call research agent or return cached
  // For now, return a minimal profile
  return {
    id: 0,
    company_name: companyName,
    website: options.website || null,
    description: null,
    tech_stack: [],
    culture_signals: [],
    recent_news: [],
    interview_talking_points: [],
    founded_year: null,
    employee_count: null,
    funding_status: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    cache_expires_at: new Date().toISOString(),
    data_sources: {},
  };
}

export function getCompanyProfileByName(name: string): CompanyProfile | null {
  // TODO: Implement - look up by name in company_profiles table
  return null;
}
