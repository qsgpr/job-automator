import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { readFile } from 'node:fs/promises';
import type { Analysis, LlmAttemptMetric, TokenUsage, ContactInfo } from './types.js';
import { recordAnalysisInput } from './observability.js';
import { analyzeWithGraph } from './graph.js';

const ANALYSIS_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `You are a technical recruiter and career coach.
Analyze the job description and resume provided. Return ONLY valid JSON with this exact structure — no extra text:

{{
  "title": "the exact job title from the job description",
  "requirements": ["list of must-have skills and experience from the JD"],
  "nice_to_have": ["preferred but not required qualifications"],
  "match_score": <integer 0 to 100>,
  "strengths": ["specific resume points that match the job well"],
  "gaps": ["requirements in the JD not clearly demonstrated in the resume"],
  "summary": "2-3 sentence summary of the role and how well the candidate fits"
}}`],
  ['human', 'JOB DESCRIPTION:\n{job_description}\n\nRESUME:\n{resume}'],
]);

function extractTokenUsage(response: Record<string, unknown>): TokenUsage {
  const md = (response['response_metadata'] ?? {}) as Record<string, unknown>;
  const usage = (typeof md['token_usage'] === 'object' ? md['token_usage'] : {}) as Record<string, number>;

  const prompt_tokens    = (usage['prompt_tokens']    ?? md['prompt_eval_count'] ?? md['input_tokens'])    as number | undefined;
  const completion_tokens = (usage['completion_tokens'] ?? md['eval_count']        ?? md['output_tokens'])   as number | undefined;
  let total_tokens        = usage['total_tokens'] as number | undefined;
  if (total_tokens == null && typeof prompt_tokens === 'number' && typeof completion_tokens === 'number') {
    total_tokens = prompt_tokens + completion_tokens;
  }
  return { prompt_tokens, completion_tokens, total_tokens };
}

export async function analyzeWithMetrics(
  jobDescription: string,
  resume: string,
  url?: string,
): Promise<[Analysis, LlmAttemptMetric[]]> {
  const parser = new JsonOutputParser<Analysis>();
  const attempts: LlmAttemptMetric[] = [];

  // After cleanJobText the JD is much leaner; 6 k chars keeps even verbose
  // postings intact while staying well within the 16 k numCtx window.
  const jd      = jobDescription.slice(0, 6000);
  const resumeT = resume.slice(0, 3000);

  const fmtMessages = await ANALYSIS_PROMPT.formatMessages({ job_description: jd, resume: resumeT });

  for (let attempt = 0; attempt < 2; attempt++) {
    const temperature = attempt === 0 ? 0 : 0.1;
    // numCtx: default is often too small; think: false disables Gemma 4's
    // reasoning tokens — @langchain/ollama puts `thinking` into response.content,
    // which breaks JSON parsing.
    const llm = new ChatOllama({ model: 'gemma4:26b', temperature, numCtx: 16384, think: false });
    const t0 = performance.now();

    try {
      const response = await llm.invoke(fmtMessages);
      const latency_ms = performance.now() - t0;
      const token_usage = extractTokenUsage(response as unknown as Record<string, unknown>);
      const parsed = await parser.parse(response.content as string);

      attempts.push({ attempt: attempt + 1, tool_call: 'ollama:gemma4:26b', temperature, latency_ms, token_usage, error: null, retry_of: attempt > 0 ? attempt : null });
      recordAnalysisInput({ url, title: parsed.title, score: parsed.match_score, jdSent: jd });
      return [parsed, attempts];
    } catch (e) {
      const latency_ms = performance.now() - t0;
      attempts.push({ attempt: attempt + 1, tool_call: 'ollama:gemma4:26b', temperature, latency_ms, token_usage: {}, error: String(e), retry_of: attempt > 0 ? attempt : null });

      if (attempt === 0) {
        console.log('  (model returned invalid JSON — retrying with higher temperature...)');
        continue;
      }

      throw new Error(
        'Gemma returned malformed JSON after 2 attempts.\n' +
        'The model may be overloaded or the job description too long.\n' +
        `Detail: ${e}`
      );
    }
  }

  throw new Error('Analysis failed unexpectedly');
}

export async function analyze(
  jobDescription: string,
  resume: string,
  url?: string,
  useGraph = true,
): Promise<Analysis> {
  if (useGraph) {
    const jd = jobDescription.slice(0, 6000);
    const resumeT = resume.slice(0, 3000);
    const result = await analyzeWithGraph(jd, resumeT);
    recordAnalysisInput({ url, title: result.title, score: result.match_score, jdSent: jd });
    return result;
  }
  const [result] = await analyzeWithMetrics(jobDescription, resume, url);
  return result;
}

export { analyzeWithGraph };

export async function loadResume(path = 'resume.txt'): Promise<string> {
  const content = (await readFile(path, 'utf8')).trim();
  if (!content) throw new Error('resume.txt is empty — paste your resume text into it first');
  return content;
}

export function formatReport(analysis: Analysis): string {
  const line = '='.repeat(60);
  const parts: string[] = [`\n${line}`, 'JOB ANALYSIS REPORT', line];

  if (analysis.title) parts.push(`\nPosition: ${analysis.title}`);

  const score = analysis.match_score;
  const filled = Math.floor(score / 5);
  const bar = '#'.repeat(filled) + '-'.repeat(20 - filled);
  parts.push(`\nMatch Score: ${score}/100  [${bar}]`);
  parts.push(`\nSummary:\n  ${analysis.summary ?? ''}`);

  const section = (heading: string, items: string[], icon = '•') => {
    if (!items?.length) return [];
    return [`\n--- ${heading} ---`, ...items.map(item => `  ${icon} ${item}`)];
  };

  parts.push(...section('Key Requirements', analysis.requirements));
  parts.push(...section('Nice to Have', analysis.nice_to_have));
  parts.push(...section('Your Strengths', analysis.strengths, '✓'));
  parts.push(...section('Gaps to Address', analysis.gaps, '✗'));
  parts.push(`\n${line}`);

  return parts.join('\n');
}

const RESUME_PARSE_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `Extract contact information from the resume below.
Return ONLY valid JSON with exactly these fields (use empty string if not found):
{{
  "name":     "the person's full name",
  "email":    "email address",
  "phone":    "phone number as written in the resume",
  "linkedin": "LinkedIn URL or username",
  "location": "city and state or country"
}}`],
  ['human', '{resume}'],
]);

export async function parseResume(resumeText: string): Promise<ContactInfo> {
  const llm = new ChatOllama({ model: 'gemma4:26b', temperature: 0, think: false });
  const parser = new JsonOutputParser<ContactInfo>();
  const chain = RESUME_PARSE_PROMPT.pipe(llm).pipe(parser);
  try {
    return await chain.invoke({ resume: resumeText.slice(0, 2000) });
  } catch {
    return {};
  }
}

const COVER_LETTER_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `You are an expert career coach. Write a professional cover letter.
Return ONLY the cover letter body text — no date, no address header, no subject line.
3-4 tight paragraphs, under 380 words.

Structure:
1. Opening: one sentence connecting to the company's mission and why this role excites you
2. Body: 2-3 specific experiences from the resume that directly match the role requirements
3. Skills paragraph: weave in the highlighted skills naturally, not as a list
4. Closing: confident call to action`],
  ['human', 'Company: {company}\nRole: {role}\nSkills to highlight: {skills}\n\nResume:\n{resume}'],
]);

export async function generateCoverLetter(
  company: string,
  role: string,
  resume: string,
  skills = '',
): Promise<string> {
  const llm = new ChatOllama({ model: 'gemma4:26b', temperature: 0.3, think: false });
  const chain = COVER_LETTER_PROMPT.pipe(llm);
  const result = await chain.invoke({ company, role, resume, skills: skills || 'relevant technical experience' });
  return (result.content as string).trim();
}

// ── Resume merge / diff ────────────────────────────────────────────────────────

const DIFF_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `You are a professional resume editor. You will receive a MASTER RESUME and one or more NEW FILES.

Extract ONLY information from the new files that is genuinely absent from the master resume:
- Jobs or roles not in the master
- Projects not in the master
- Skills or certifications not listed
- Achievements or metrics not captured

Do NOT include anything already in the master, even if worded differently.
Format additions as clean resume sections (plain text, same style as the master).
If nothing is new, respond with exactly: NO_NEW_CONTENT`],
  ['human', 'MASTER RESUME:\n{master}\n\n{divider}\n\nNEW FILES:\n{files}'],
]);

const CREATE_MASTER_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `You are a professional resume writer. Merge multiple resume versions into one comprehensive master resume.

Rules:
- Include ALL unique experience, projects, skills, and achievements from every version
- Remove exact duplicates but keep variations that add detail
- Preserve specific numbers, metrics, and technical terms exactly as written
- Use clear section headers: SUMMARY, EXPERIENCE, PROJECTS, SKILLS, EDUCATION, CERTIFICATIONS
- Most recent items first within each section
- Plain text output only`],
  ['human', 'Merge {count} resume version(s) into one master:\n\n{resumes}'],
]);

export async function mergeResumes(texts: string[]): Promise<string> {
  if (texts.length === 1) return texts[0].trim();
  const llm = new ChatOllama({ model: 'gemma4:26b', temperature: 0, think: false });
  const chain = CREATE_MASTER_PROMPT.pipe(llm);
  const resumes = texts.map((t, i) => `=== VERSION ${i + 1} ===\n${t.trim()}`).join('\n\n');
  const result = await chain.invoke({ resumes, count: texts.length });
  return (result.content as string).trim();
}

export async function diffResumes(master: string, newTexts: string[]): Promise<string> {
  const llm = new ChatOllama({ model: 'gemma4:26b', temperature: 0, think: false });
  const chain = DIFF_PROMPT.pipe(llm);
  const files = newTexts.map((t, i) => `=== FILE ${i + 1} ===\n${t.trim()}`).join('\n\n');
  const result = await chain.invoke({ master, files, divider: '─'.repeat(40) });
  const text = (result.content as string).trim();
  return text === 'NO_NEW_CONTENT' ? '' : text;
}
