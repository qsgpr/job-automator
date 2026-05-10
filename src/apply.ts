import { type Page, type Browser } from 'playwright';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
chromiumExtra.use(StealthPlugin());
import { HumanMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { getUser } from './profiles.js';
import type { ApplyEvent, User } from './types.js';
import { logApplicationEvent } from './observability.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const SCREENSHOTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'screenshots');
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ── Captcha detection patterns ────────────────────────────────────────────────

interface CaptchaPattern {
  type: string;
  selectors: string[];
  iframePatterns: string[];
}

const CAPTCHA_PATTERNS: CaptchaPattern[] = [
  {
    type: 'hCaptcha',
    selectors: ['[data-sitekey*="captcha"]', '.h-captcha', 'iframe[src*="hcaptcha"]', '[aria-label*="checkbox"]'],
    iframePatterns: ['hcaptcha.com', 'hcaptcha', 'hcaptcha.js'],
  },
  {
    type: 'reCAPTCHA v3',
    selectors: [
      '[data-callback*="captcha"]',
      '.g-recaptcha-container',
      'iframe[src*="recaptcha"]',
      '[data-sitekey]',
    ],
    iframePatterns: ['recaptcha', 'google.com/recaptcha'],
  },
  {
    type: 'reCAPTCHA v2 (Checkbox)',
    selectors: [
      '.g-recaptcha',
      'iframe[title*="reCAPTCHA"]',
      '[data-sitekey]',
      'div[role="presentation"]',
    ],
    iframePatterns: ['recaptcha/api2', 'recaptcha'],
  },
  {
    type: 'NoCaptcha (Cloudflare)',
    selectors: [
      '.cf-captcha',
      'iframe[src*="challenges.cloudflare"]',
      '.challenge__item',
    ],
    iframePatterns: ['cloudflare.com', 'challenges.cloudflare'],
  },
];

async function detectCaptcha(page: Page): Promise<{ detected: boolean; type: string } | null> {
  try {
    for (const pattern of CAPTCHA_PATTERNS) {
      for (const selector of pattern.selectors) {
        const found = await page.locator(selector).count().catch(() => 0);
        if (found > 0) {
          console.log(`[CAPTCHA] Detected ${pattern.type} via selector: ${selector}`);
          return { detected: true, type: pattern.type };
        }
      }

      for (const iframePattern of pattern.iframePatterns) {
        const iframes = page.frames();
        for (const frame of iframes) {
          const url = frame.url();
          if (url.includes(iframePattern)) {
            console.log(`[CAPTCHA] Detected ${pattern.type} via iframe: ${url}`);
            return { detected: true, type: pattern.type };
          }
        }
      }
    }
  } catch (e) {
    console.error('[CAPTCHA] Detection error:', (e as Error).message);
  }

  return null;
}

// ── CapSolver: auto-solve captchas ───────────────────────────────────────────

const CAPSOLVER_KEY = process.env.CAPSOLVER_API_KEY || '';
const CAPSOLVER_API = 'https://api.capsolver.com';

async function extractSiteKey(page: Page, type: string): Promise<string | null> {
  // Try data-sitekey attribute
  const siteKey = await page.evaluate(() => {
    const el = document.querySelector('[data-sitekey]') as HTMLElement | null;
    return el?.getAttribute('data-sitekey') ?? null;
  });
  if (siteKey) return siteKey;

  // Try hCaptcha iframe src
  if (type.includes('hCaptcha') || type.includes('hcaptcha')) {
    for (const frame of page.frames()) {
      const url = frame.url();
      const match = url.match(/sitekey=([a-f0-9-]+)/i);
      if (match) return match[1];
    }
  }

  return null;
}

async function solveWithCapSolver(
  page: Page,
  captchaType: string,
  emit: (obj: object) => void
): Promise<boolean> {
  if (!CAPSOLVER_KEY) {
    console.log('[CapSolver] No API key set — skipping auto-solve');
    return false;
  }

  emit({ type: 'filling', message: `🤖 Auto-solving ${captchaType} with CapSolver…` });

  const siteKey = await extractSiteKey(page, captchaType);
  if (!siteKey) {
    emit({ type: 'debug', message: 'CapSolver: could not extract site key' });
    return false;
  }

  const websiteURL = page.url();
  emit({ type: 'debug', message: `CapSolver: siteKey=${siteKey.slice(0, 8)}… url=${websiteURL}` });

  // Determine task type
  let taskType = 'HCaptchaTask';
  if (captchaType.includes('reCAPTCHA v2')) taskType = 'ReCaptchaV2Task';
  if (captchaType.includes('reCAPTCHA v3')) taskType = 'ReCaptchaV3Task';
  if (captchaType.includes('Cloudflare'))   taskType = 'AntiCloudflareTask';

  try {
    // Create task
    const createRes = await fetch(`${CAPSOLVER_API}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: CAPSOLVER_KEY,
        task: { type: taskType, websiteURL, websiteKey: siteKey },
      }),
    });
    const createData = await createRes.json() as { taskId?: string; errorCode?: string; errorDescription?: string };

    if (!createData.taskId) {
      emit({ type: 'debug', message: `CapSolver create failed: ${createData.errorDescription}` });
      return false;
    }

    emit({ type: 'debug', message: `CapSolver task created: ${createData.taskId} — polling…` });

    // Poll for result (up to 120s)
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const resultRes = await fetch(`${CAPSOLVER_API}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: CAPSOLVER_KEY, taskId: createData.taskId }),
      });
      const result = await resultRes.json() as { status?: string; solution?: { gRecaptchaResponse?: string; userAgent?: string } };

      if (result.status === 'ready' && result.solution?.gRecaptchaResponse) {
        const token = result.solution.gRecaptchaResponse;
        emit({ type: 'filling', message: '✅ Captcha solved — injecting token…' });

        // Inject token into the page
        await page.evaluate((t) => {
          // hCaptcha / reCAPTCHA response field
          const fields = [
            'h-captcha-response',
            'g-recaptcha-response',
            'cf-turnstile-response',
          ];
          for (const name of fields) {
            const el = document.querySelector(`[name="${name}"], textarea[id="${name}"]`) as HTMLTextAreaElement | null;
            if (el) { el.value = t; }
          }
          // Also trigger the hCaptcha callback if available
          if ((window as any).hcaptcha) {
            try { (window as any).hcaptcha.execute(); } catch {}
          }
        }, token);

        // Small wait for form to register the token
        await page.waitForTimeout(1500);
        emit({ type: 'filling', message: '✅ Captcha token injected — attempting submit…' });
        return true;
      }

      emit({ type: 'debug', message: `CapSolver polling… attempt ${i + 1}/24` });
    }

    emit({ type: 'debug', message: 'CapSolver timed out after 120s' });
    return false;
  } catch (e) {
    emit({ type: 'debug', message: `CapSolver error: ${(e as Error).message}` });
    return false;
  }
}

async function takeScreenshot(page: Page, label: string): Promise<{ path: string; url: string } | null> {
  try {
    const timestamp = Date.now();
    const filename = `captcha_${label}_${timestamp}.png`;
    const filepath = join(SCREENSHOTS_DIR, filename);
    await page.screenshot({ path: filepath, fullPage: false });
    console.log(`[SCREENSHOT] Saved to ${filepath}`);
    return { path: filepath, url: `/screenshots/${filename}` };
  } catch (e) {
    console.error('[SCREENSHOT] Failed:', (e as Error).message);
    return null;
  }
}

// ── Cover letter detection & injection ────────────────────────────────────────

interface CoverLetterField {
  selector: string;
  label: string;
  type: 'textarea' | 'rich_text' | 'question';
  placeholder?: string;
  required: boolean;
}

async function detectCoverLetterFields(page: Page): Promise<CoverLetterField[]> {
  return page.evaluate((): CoverLetterField[] => {
    const fields: CoverLetterField[] = [];

    // Look for textareas with "cover", "letter", "question", "tell us", "why", etc.
    document.querySelectorAll('textarea').forEach((ta) => {
      const label = ta.getAttribute('aria-label') ||
        ta.getAttribute('placeholder') ||
        document.querySelector(`label[for="${ta.id}"]`)?.textContent ||
        '';
      const labelLower = label.toLowerCase();

      if (labelLower.includes('cover') || labelLower.includes('letter') ||
          labelLower.includes('question') || labelLower.includes('tell') ||
          labelLower.includes('why') || labelLower.includes('motivation') ||
          labelLower.includes('experience')) {
        fields.push({
          selector: ta.id ? `#${ta.id}` : `textarea[name="${ta.name}"]`,
          label: label.trim(),
          type: 'textarea',
          placeholder: ta.placeholder,
          required: ta.required,
        });
      }
    });

    // Look for contenteditable divs (rich text editors)
    document.querySelectorAll('[contenteditable="true"]').forEach((el) => {
      const wrapper = el.closest('[class*="editor"], [class*="rich"], [class*="text"]');
      const label = wrapper?.querySelector('label, [role="label"]')?.textContent || '';
      const labelLower = label.toLowerCase();

      if (labelLower.includes('cover') || labelLower.includes('letter') ||
          labelLower.includes('question') || labelLower.includes('tell')) {
        const id = el.id || el.className;
        fields.push({
          selector: id ? (el.id ? `#${el.id}` : `[class*="${id}"]`) : '[contenteditable="true"]',
          label: label.trim(),
          type: 'rich_text',
          required: el.hasAttribute('required'),
        });
      }
    });

    return fields;
  });
}

async function injectCoverLetter(
  page: Page,
  selector: string,
  coverLetter: string,
  fieldType: 'textarea' | 'rich_text' | 'question',
  emit: (e: ApplyEvent) => void,
): Promise<boolean> {
  try {
    const el = page.locator(selector).first();
    const found = await el.count();
    if (!found) {
      emit({ type: 'debug', message: `Cover letter field not found: ${selector}` });
      return false;
    }

    if (fieldType === 'textarea') {
      await el.fill(coverLetter);
    } else if (fieldType === 'rich_text') {
      // For contenteditable, simulate keyboard input
      await el.focus();
      await el.evaluate((el, text) => {
        el.textContent = text;
        const event = new Event('input', { bubbles: true });
        el.dispatchEvent(event);
      }, coverLetter);
    }

    emit({
      type: 'cover_letter_injected',
      message: `Injected cover letter (${coverLetter.length} chars) into field: ${selector}`,
    });
    return true;
  } catch (e) {
    emit({ type: 'debug', message: `Failed to inject cover letter: ${(e as Error).message}` });
    return false;
  }
}

// ── Known ATS field maps ──────────────────────────────────────────────────────

type FieldKey = 'first_name' | 'last_name' | 'email' | 'phone' | 'linkedin' | 'resume_file';

interface AtsMap {
  applyUrlSuffix?: string;
  applyBtnSelector?: string;
  fields: Partial<Record<FieldKey, string>>;
  submitSelector?: string;
}

const ATS_MAPS: Record<string, AtsMap> = {
  'greenhouse.io': {
    applyBtnSelector: 'a#apply_button, a[data-mapped="true"]',
    fields: {
      first_name:  '#first_name',
      last_name:   '#last_name',
      email:       '#email',
      phone:       '#phone',
      linkedin:    '#job_application_question_answers_attributes_0_text_value, input[name*="linkedin"]',
      resume_file: '#resume',
    },
    submitSelector: '#submit_app',
  },
  'lever.co': {
    applyUrlSuffix: '/apply',
    fields: {
      first_name:  'input[name="name"]',
      last_name:   '',
      email:       'input[name="email"]',
      phone:       'input[name="phone"]',
      linkedin:    'input[name="urls[LinkedIn]"], input[placeholder*="LinkedIn"]',
      resume_file: 'input[type="file"]',
    },
    submitSelector: 'button[type="submit"]',
  },
  'ashbyhq.com': {
    fields: {
      first_name:  'input[name="firstName"], input[placeholder*="First"]',
      last_name:   'input[name="lastName"],  input[placeholder*="Last"]',
      email:       'input[name="email"], input[type="email"]',
      phone:       'input[name="phone"], input[type="tel"]',
      linkedin:    'input[placeholder*="LinkedIn"], input[name*="linkedin"]',
      resume_file: 'input[type="file"]',
    },
    submitSelector: 'button[type="submit"]',
  },
  'workable.com': {
    fields: {
      first_name:  'input[name="firstname"]',
      last_name:   'input[name="lastname"]',
      email:       'input[name="email"]',
      phone:       'input[name="phone"]',
      resume_file: 'input[type="file"]',
    },
  },
};

function detectAts(url: string): { key: string; map: AtsMap } | null {
  for (const [key, map] of Object.entries(ATS_MAPS)) {
    if (url.includes(key)) return { key, map };
  }
  return null;
}

// ── Form field extraction ─────────────────────────────────────────────────────

interface FormField {
  selector: string;
  label:    string;
  type:     string;
  required: boolean;
  options?: string[];
  multi?:   boolean;
}

async function extractFormFields(page: Page): Promise<FormField[]> {
  return page.evaluate((): FormField[] => {
    const results: FormField[] = [];
    const seenGroupNames = new Set<string>();

    document.querySelectorAll('input, textarea, select').forEach(el => {
      const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

      if ('type' in input && ['submit', 'button', 'hidden', 'image', 'reset'].includes(input.type)) return;

      const tagName = el.tagName.toLowerCase();
      const inputType = 'type' in input ? input.type : tagName === 'select' ? 'select' : 'textarea';
      const isCheckGroup = inputType === 'checkbox' || inputType === 'radio';

      if (isCheckGroup && input.name) {
        if (seenGroupNames.has(input.name)) return;
        seenGroupNames.add(input.name);
      }

      let sel = tagName;
      if (input.id) sel += `#${input.id}`;
      else if (input.name) sel += `[name="${input.name}"]`;
      else return;

      if (isCheckGroup && input.name) sel = `input[name="${input.name}"]`;

      let label = '';

      if (input.id) {
        const lb = document.querySelector(`label[for="${input.id}"]`);
        if (lb) label = (lb as HTMLElement).innerText.trim();
      }
      if (!label) {
        const parent = input.closest('label');
        if (parent) label = (parent as HTMLElement).innerText.replace(/(^\s+|\s+$)/g, '');
      }
      if (!label) {
        const wrapper = input.closest('fieldset, [class*="question"], [class*="field"], [class*="form-group"], li, div');
        if (wrapper) {
          const heading = wrapper.querySelector('legend, label, p, span');
          if (heading && heading !== input) label = (heading as HTMLElement).innerText.trim();
        }
      }
      if (!label) label = ('placeholder' in input ? input.placeholder : '') || input.name || input.id || '';

      label = label.replace(/\s*\*\s*$/, '').replace(/\(required\)/i, '').trim();

      // If label looks like a country/option value (single word, title case), it's wrong — clear it
      // so the LLM uses the selector or placeholder instead
      if (/^[A-Z][a-z]+$/.test(label) && tagName !== 'input') label = '';

      let options: string[] | undefined;
      let multi = false;

      if (tagName === 'select') {
        options = Array.from((el as HTMLSelectElement).options)
          .filter(o => o.value !== '' && o.value !== 'Select...' && o.text.trim() !== 'Select...')
          .map(o => o.text.trim())
          .filter(Boolean);
      } else if (inputType === 'checkbox' || inputType === 'radio') {
        options = Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="${inputType}"][name="${input.name}"]`))
          .map(cb => {
            const lbl = document.querySelector(`label[for="${cb.id}"]`);
            return lbl ? (lbl as HTMLElement).innerText.trim() : cb.value;
          })
          .filter(Boolean);
        multi = inputType === 'checkbox';
      }

      results.push({ selector: sel, label, type: inputType, required: input.required, options, multi });
    });

    return results;
  });
}

// ── LLM field mapping ─────────────────────────────────────────────────────────

const FIELD_MAP_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `You are filling a job application form for the user. Use their profile and resume to answer every field accurately.

Rules:
- For SELECT fields: return EXACTLY one string from the listed Options (copy it exactly).
- For MULTI-SELECT (multi=true checkbox groups): return a JSON array of matching option strings.
- For TEXT/TEXTAREA: write a concise, accurate answer drawn from the profile or resume.
- For date fields: use MM/DD/YYYY format.
- Skip fields of type "file".
- For work-authorization questions: answer Yes/No based on the user's location and citizenship.
- For salary: answer from the preferences (salary_min in $k).
- For "How did you hear": answer "Company website" or "LinkedIn" unless stated otherwise.

Return ONLY a valid JSON object. Use arrays for multi-select fields.
Example: {{"input#firstName": "Carlos", "input[name=years]": "3-5 years", "input[name=frameworks]": ["LangChain", "LlamaIndex"]}}`],
  ['human', `Profile:
Name: {name}
Email: {email}
Phone: {phone}
LinkedIn: {linkedin}
Location: {location}
Salary floor: {salary}k/yr
{extra}

Resume (excerpt):
{resume}

Form fields (selector | label | type | required | options):
{fields}

Return JSON only.`],
]);

async function llmMapFields(
  fields: FormField[],
  user: User,
  emit: (e: ApplyEvent) => void,
): Promise<Record<string, string | string[]>> {
  const llm    = new ChatGoogleGenerativeAI({ model: 'gemini-2.5-flash', temperature: 0, apiKey: process.env.GOOGLE_API_KEY });
  const parser = new JsonOutputParser<Record<string, string | string[]>>();
  const chain  = FIELD_MAP_PROMPT.pipe(llm).pipe(parser);

  const fillable = fields.filter(f => f.type !== 'file' && f.type !== 'hidden');
  const fieldList = fillable
    .map(f => {
      let line = `${f.selector} | ${f.label} | ${f.type}${f.multi ? ' (multi-select)' : ''} | ${f.required ? 'required' : 'optional'}`;
      if (f.options?.length) line += ` | Options: ${f.options.join('; ')}`;
      return line;
    })
    .join('\n');

  console.log('\n── Fields sent to Gemma ──────────────────────────');
  console.log(fieldList);
  console.log('─────────────────────────────────────────────────\n');

  try {
    const result = await chain.invoke({
      name:     user.name,
      email:    user.email,
      phone:    user.phone || '',
      linkedin: user.linkedin || '',
      location: user.preferences.location_pref || '',
      salary:   user.preferences.salary_min ?? '',
      resume:   (user.resume_text || '').slice(0, 3000),
      fields:   fieldList,
      extra: [
        user.street      ? `Street: ${user.street}`                          : '',
        user.city        ? `City: ${user.city}`                              : '',
        user.state       ? `State: ${user.state}`                            : '',
        user.zip         ? `ZIP: ${user.zip}`                                : '',
        user.work_authorized      ? `Work authorized in US: ${user.work_authorized}` : '',
        user.requires_sponsorship ? `Requires visa sponsorship: ${user.requires_sponsorship}` : '',
        user.available_start      ? `Available start date: ${user.available_start}` : '',
        user.years_experience     ? `Years of experience: ${user.years_experience}` : '',
        user.ts_proficiency       ? `TypeScript/JS proficiency: ${user.ts_proficiency}` : '',
        user.llm_frameworks?.length ? `LLM frameworks used: ${user.llm_frameworks.join(', ')}` : '',
        user.additional_info      ? `Additional info: ${user.additional_info}` : '',
      ].filter(Boolean).join('\n'),
    });

    console.log('\n── Gemma mapping result ─────────────────────────');
    console.log(JSON.stringify(result, null, 2));
    console.log('─────────────────────────────────────────────────\n');

    const mappedCount = Object.keys(result).length;
    emit({ type: 'debug', message: `Gemma mapped ${mappedCount} of ${fillable.length} fields` });

    for (const [sel, val] of Object.entries(result)) {
      const label = fields.find(f => f.selector === sel)?.label || sel;
      const display = Array.isArray(val) ? `[${val.join(', ')}]` : String(val);
      emit({ type: 'debug', message: `  → ${label}: ${display}` });
    }

    return result;
  } catch (e) {
    const msg = `LLM mapping failed: ${(e as Error).message}`;
    console.error(msg);
    emit({ type: 'error', message: msg });
    return {};
  }
}

// ── Resume temp file ─────────────────────────────────────────────────────────

function writeTempResume(text: string): string {
  const path = join(tmpdir(), `resume_apply_${Date.now()}.txt`);
  writeFileSync(path, text, 'utf8');
  return path;
}

// ── Page validator: checks if current page is an application form ─────────────

type PageType = 'application_form' | 'job_listing' | 'login' | 'error' | 'unknown';

async function classifyPage(page: Page): Promise<{ type: PageType; confidence: number; reason: string }> {
  const url = page.url();

  // Hard signals from URL
  if (/apply|application|submit/i.test(url)) return { type: 'application_form', confidence: 0.9, reason: 'URL contains apply/application' };
  if (/login|signin|sign-in|auth/i.test(url))  return { type: 'login', confidence: 0.9, reason: 'URL is login page' };
  if (/404|not-found|error/i.test(url))         return { type: 'error', confidence: 0.9, reason: 'URL is error page' };

  // DOM signals
  const signals = await page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() ?? '';
    const title = document.title?.toLowerCase() ?? '';
    const inputs = document.querySelectorAll('input:not([type=hidden]), textarea, select').length;
    const fileInputs = document.querySelectorAll('input[type=file]').length;
    const formKeywords = ['resume', 'cv', 'first name', 'last name', 'email address',
      'phone number', 'work authorization', 'cover letter', 'apply now', 'submit application'].filter(k => text.includes(k));
    const listingKeywords = ['job description', 'responsibilities', 'requirements', 'qualifications',
      'about the role', 'about the job', 'what you\'ll do'].filter(k => text.includes(k));
    return { inputs, fileInputs, formKeywords, listingKeywords, title };
  });

  // Application form: has inputs + form-related keywords
  if (signals.inputs >= 2 && signals.formKeywords.length >= 2) {
    return { type: 'application_form', confidence: 0.85, reason: `${signals.inputs} inputs, keywords: ${signals.formKeywords.slice(0,3).join(', ')}` };
  }
  if (signals.fileInputs > 0 && signals.inputs >= 1) {
    return { type: 'application_form', confidence: 0.8, reason: 'File upload field found (resume)' };
  }

  // Job listing: few/no inputs, lots of job description content
  if (signals.inputs <= 1 && signals.listingKeywords.length >= 2) {
    return { type: 'job_listing', confidence: 0.8, reason: `Job description page, ${signals.listingKeywords.length} listing signals` };
  }

  return { type: 'unknown', confidence: 0.5, reason: `${signals.inputs} inputs, no clear form signals` };
}

// Generate alternative URLs to try when we land on the wrong page
function generateAlternativeUrls(jobUrl: string, currentUrl: string): string[] {
  const alternatives: string[] = [];
  const base = jobUrl.replace(/\/$/, '');

  // Common apply URL patterns
  alternatives.push(base + '/apply');
  alternatives.push(base + '?gh_src=apply');

  // Extract ATS tokens from the URL
  const ghMatch = jobUrl.match(/gh_jid=(\d+)/);
  if (ghMatch) {
    const token = ghMatch[1];
    // Extract company from URL
    const companyMatch = jobUrl.match(/(?:greenhouse\.io\/|for=)([^&\/]+)/);
    const company = companyMatch?.[1];
    if (company) {
      alternatives.push(`https://boards.greenhouse.io/${company}/jobs/${token}/applications/new`);
    }
  }

  const leverMatch = jobUrl.match(/lever\.co\/([^\/]+)\/([a-f0-9-]+)/);
  if (leverMatch) {
    alternatives.push(`https://jobs.lever.co/${leverMatch[1]}/${leverMatch[2]}/apply`);
  }

  // If current URL differs from job URL, also try the original
  if (currentUrl !== jobUrl && !alternatives.includes(jobUrl)) {
    alternatives.push(jobUrl);
  }

  return [...new Set(alternatives)]; // deduplicate
}

// ── Apply button: find and click, wait for navigation ────────────────────────

async function clickApplyButton(
  page: Page,
  atsSelector: string | undefined,
  emit: (e: ApplyEvent) => void,
): Promise<boolean> {
  if (atsSelector) {
    try {
      await page.click(atsSelector, { timeout: 5000 });
      await page.waitForTimeout(2000);
      return true;
    } catch { /* fall through */ }
  }

  const candidates = [
    'Apply for this job',
    'Apply Now',
    'Apply now',
    'Apply',
    'Apply Here',
    'Apply here',
  ];

  for (const text of candidates) {
    try {
      const btn = page.getByRole('link', { name: text })
        .or(page.getByRole('button', { name: text }))
        .first();
      if (!await btn.count()) continue;

      emit({ type: 'navigating', message: `Clicking "${text}" button…` });

      const [newPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null as Page | null),
        Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
          btn.click(),
        ]),
      ]);

      if (newPage) {
        await newPage.waitForLoadState('domcontentloaded');
        await page.close();
        return true;
      }

      await page.waitForTimeout(2000);
      return true;
    } catch { /* try next */ }
  }

  return false;
}

// ── Fill a single field ───────────────────────────────────────────────────────

async function fillField(
  page: Page,
  selector: string,
  value: string | string[],
  emit: (e: ApplyEvent) => void,
): Promise<boolean> {
  if (!selector || value === '' || (Array.isArray(value) && !value.length)) return false;

  if (Array.isArray(value)) {
    let checked = 0;
    const checkboxes = page.locator(selector);
    const count = await checkboxes.count();
    console.log(`  checkbox group "${selector}" — ${count} options, want: ${value.join(', ')}`);
    for (let i = 0; i < count; i++) {
      const cb  = checkboxes.nth(i);
      const id  = await cb.getAttribute('id').catch(() => '');
      const val = await cb.getAttribute('value').catch(() => '') ?? '';
      let label = '';
      if (id) {
        const lb = page.locator(`label[for="${id}"]`);
        if (await lb.count()) label = (await lb.innerText()).trim();
      }
      const text = (label || val).toLowerCase();
      const shouldCheck = value.some(v => text.includes(v.toLowerCase()) || v.toLowerCase().includes(text));
      if (shouldCheck) { await cb.check().catch(() => {}); checked++; }
    }
    if (!checked) emit({ type: 'debug', message: `  ✗ no checkboxes matched for "${selector}"` });
    return checked > 0;
  }

  for (const sel of selector.split(',').map(s => s.trim())) {
    try {
      const el = page.locator(sel).first();
      const found = await el.count();
      if (!found) {
        console.log(`  selector not found: ${sel}`);
        continue;
      }
      const tag  = await el.evaluate((e: Element) => e.tagName.toLowerCase());
      const type = await el.getAttribute('type').catch(() => '');
      console.log(`  filling <${tag}${type ? ` type=${type}` : ''}> "${sel}" = "${value}"`);

      if (tag === 'select') {
        const val = String(value);
        const exact = await el.selectOption({ label: val }).catch(() => null);
        if (!exact) {
          const opts = await el.evaluate((s: Element) =>
            Array.from((s as HTMLSelectElement).options).map(o => ({ value: o.value, text: o.text.trim() }))
          );
          const lower = val.toLowerCase();
          const match = opts.find(o =>
            o.text.toLowerCase().includes(lower) || lower.includes(o.text.toLowerCase())
          );
          if (match) {
            await el.selectOption(match.value).catch(() => {});
            console.log(`    fuzzy-matched "${val}" → "${match.text}"`);
          } else {
            emit({ type: 'debug', message: `  ✗ select "${sel}" — no match for "${val}" in [${opts.map(o => o.text).join(' | ')}]` });
            console.log(`    select option not found: "${val}" — available: ${opts.map(o => o.text).join(', ')}`);
          }
        }
      } else if (type === 'radio') {
        const radios = page.locator(selector);
        const cnt    = await radios.count();
        let matched  = false;
        for (let i = 0; i < cnt; i++) {
          const r   = radios.nth(i);
          const rid = await r.getAttribute('id').catch(() => '');
          const rv  = await r.getAttribute('value').catch(() => '') ?? '';
          let rlabel = '';
          if (rid) {
            const lb = page.locator(`label[for="${rid}"]`);
            if (await lb.count()) rlabel = (await lb.innerText()).trim();
          }
          if ((rlabel || rv).toLowerCase() === String(value).toLowerCase()) {
            await r.check().catch(() => {});
            matched = true;
            break;
          }
        }
        if (!matched) emit({ type: 'debug', message: `  ✗ radio "${selector}" — option "${value}" not found` });
      } else {
        await el.fill(String(value));
      }
      return true;
    } catch (e) {
      console.log(`  fill error for "${sel}": ${(e as Error).message}`);
    }
  }
  emit({ type: 'debug', message: `  ✗ could not fill "${selector}" — element not found on page` });
  return false;
}

// ── Main auto-apply with captcha detection & error recovery ──────────────────

export async function autoApply(
  userId: number,
  jobUrl: string,
  coverLetter: string | undefined,
  applicationId: number,
  emit: (event: ApplyEvent) => void,
): Promise<void> {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const [firstName, ...rest] = user.name.trim().split(' ');
  const lastName = rest.join(' ');

  const ats = detectAts(jobUrl);

  emit({ type: 'navigating', message: `Opening ${jobUrl}…` });

  let retryCount = 0;
  const MAX_RETRIES = 3;

  while (retryCount <= MAX_RETRIES) {
    const browser: Browser = await (chromiumExtra as any).launch({ headless: !process.env.DISPLAY, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ userAgent: USER_AGENT, viewport: null });
    let page = await context.newPage();

    let tempResumePath: string | null = null;

    try {
      const targetUrl = ats?.map.applyUrlSuffix
        ? jobUrl.replace(/\/$/, '') + ats.map.applyUrlSuffix
        : jobUrl;

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Check for captcha BEFORE clicking apply button
      const captchaCheck = await detectCaptcha(page);
      if (captchaCheck?.detected) {
        const shot = await takeScreenshot(page, `pre_apply_${captchaCheck.type}`);
        emit({
          type: 'captcha_detected',
          message: `${captchaCheck.type} detected before form. Open the form URL in your browser to solve it.`,
          captcha_type: captchaCheck.type,
          screenshot_url: shot?.url,
          form_url: page.url(),
        });
        logApplicationEvent({
          applicationId,
          userId,
          eventType: 'captcha_detected_pre_apply',
          level: 'warning',
          message: `${captchaCheck.type} detected before form submission`,
          errorDetails: shot?.url,
        });
        await browser.close();
        return;
      }

      const clicked = await clickApplyButton(page, ats?.map.applyBtnSelector, emit);
      if (clicked) {
        const pages = context.pages();
        page = pages[pages.length - 1];
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(1500);
      }

      // ── Page validation + backtrack ─────────────────────────────────────────
      let pageCheck = await classifyPage(page);
      emit({ type: 'debug', message: `Page check: ${pageCheck.type} (${Math.round(pageCheck.confidence * 100)}%) — ${pageCheck.reason}` });

      if (pageCheck.type !== 'application_form') {
        emit({ type: 'navigating', message: `Not an application form (${pageCheck.type}) — looking for alternatives…` });

        // Try: click Apply button again from current page
        if (pageCheck.type === 'job_listing') {
          const retryClick = await clickApplyButton(page, ats?.map.applyBtnSelector, emit);
          if (retryClick) {
            const pages = context.pages();
            page = pages[pages.length - 1];
            await page.waitForLoadState('domcontentloaded').catch(() => {});
            await page.waitForTimeout(1500);
            pageCheck = await classifyPage(page);
            emit({ type: 'debug', message: `After retry click: ${pageCheck.type} at ${page.url()}` });
          }
        }

        // Try alternative URLs if still not on a form
        if (pageCheck.type !== 'application_form') {
          const alts = generateAlternativeUrls(jobUrl, page.url());
          for (const altUrl of alts) {
            emit({ type: 'navigating', message: `Trying alternative: ${altUrl}` });
            await page.goto(altUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(1500);
            pageCheck = await classifyPage(page);
            emit({ type: 'debug', message: `Alt page check: ${pageCheck.type} at ${page.url()}` });
            if (pageCheck.type === 'application_form') break;
          }
        }

        if (pageCheck.type !== 'application_form') {
          emit({ type: 'debug', message: `Could not find application form after backtracking — proceeding with best guess at ${page.url()}` });
        }
      }

      emit({ type: 'form_found', message: `Form at ${page.url()}` });

      let filled = 0;
      const filledValues: Record<string, string> = {}; // track label→value for copy-paste guide

      if (ats) {
        // ── Known ATS: use hardcoded selectors ────────────────────────────────

        const { fields } = ats.map;
        const knownValues: Partial<Record<FieldKey, string>> = {
          first_name:  firstName,
          last_name:   lastName,
          email:       user.email,
          phone:       user.phone,
          linkedin:    user.linkedin,
        };

        const total = Object.keys(fields).length;
        for (const [key, selector] of Object.entries(fields) as [FieldKey, string][]) {
          if (!selector) continue;
          emit({ type: 'filling', field: key, filled, total });

          if (key === 'resume_file' && user.resume_text) {
            tempResumePath = writeTempResume(user.resume_text);
            try {
              const fileInput = page.locator(selector).first();
              if (await fileInput.count()) {
                await fileInput.setInputFiles(tempResumePath);
                filled++;
                emit({ type: 'field_filled', field: 'resume (file)', filled, total });
              }
            } catch {
              emit({ type: 'upload_skipped', field: 'resume', message: 'File upload failed — attach manually' });
            }
            continue;
          }

          const value = knownValues[key] || '';
          if (!value) continue;
          const ok = await fillField(page, selector, value, emit);
          if (ok) {
            filled++;
            filledValues[key.replace('_', ' ')] = String(value);
            emit({ type: 'field_filled', field: key.replace('_', ' '), filled, total });
            await page.waitForTimeout(200);
          }
        }

      } else {
        // ── Unknown site: detect iframe → extract fields → LLM → fill ─────────

        emit({ type: 'filling', message: 'Waiting for form to load…' });
        await page.waitForTimeout(2000);
        await page.waitForSelector('input, select, textarea, iframe', { timeout: 8000 })
          .catch(() => emit({ type: 'debug', message: 'No standard form elements appeared after 8 s' }));

        const iframes = page.frames().filter(f => f !== page.mainFrame());
        const iframeSrcs = await Promise.all(
          (await page.$$('iframe')).map(h => h.getAttribute('src').catch(() => ''))
        );
        emit({ type: 'debug', message: `Frames on page: ${page.frames().length} total, ${iframes.length} sub-frames` });
        if (iframeSrcs.length) emit({ type: 'debug', message: `iframes: ${iframeSrcs.filter(Boolean).join(' | ')}` });

        const domSummary = await page.evaluate(() => {
          const counts: Record<string, number> = {};
          ['input','select','textarea','iframe','form','[role="textbox"]','[contenteditable]'].forEach(sel => {
            counts[sel] = document.querySelectorAll(sel).length;
          });
          const inputs = Array.from(document.querySelectorAll('input, select, textarea')).slice(0, 20).map(el => {
            const e = el as HTMLInputElement;
            return `<${el.tagName.toLowerCase()} id="${e.id}" name="${e.name}" type="${e.type}" class="${el.className.slice(0,40)}">`;
          });
          return { counts, inputs };
        });
        console.log('\n── DOM diagnostic ────────────────────────────────');
        console.log('Element counts:', domSummary.counts);
        console.log('First inputs:', domSummary.inputs);
        console.log('─────────────────────────────────────────────────\n');
        emit({ type: 'debug', message: `DOM: ${JSON.stringify(domSummary.counts)}` });

        const mainInputCount = domSummary.counts['input'] + domSummary.counts['select'] + domSummary.counts['textarea'];
        let targetPage: Page = page;

        // Detect ATS iframe REGARDLESS of input count — even 1 hidden input blocks the check.
        // Greenhouse/Lever/Ashby embed forms as cross-origin iframes; navigate directly to them.
        const atsIframeSrc = iframeSrcs.find(src =>
          src && (src.includes('greenhouse.io') || src.includes('lever.co') ||
                  src.includes('ashbyhq.com') || src.includes('workable.com') ||
                  src.includes('job-boards.') || src.includes('/embed/job'))
        );

        if (atsIframeSrc) {
          emit({ type: 'debug', message: `ATS iframe detected — navigating directly to: ${atsIframeSrc}` });
          await page.goto(atsIframeSrc, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(2000);
          targetPage = page; // now on the ATS page
          const newCount = await page.locator('input, select, textarea').count();
          emit({ type: 'debug', message: `ATS direct page has ${newCount} inputs` });
        } else if (mainInputCount === 0 && iframes.length > 0) {
          // Non-ATS iframe — try switching to first iframe with inputs
          for (const iframe of iframes) {
            try {
              const inputCount = await iframe.locator('input, select, textarea').count();
              if (inputCount > 0) {
                targetPage = iframe as unknown as Page;
                emit({ type: 'debug', message: `Switched to non-ATS iframe with ${inputCount} inputs` });
                break;
              }
            } catch { /* skip inaccessible frames */ }
          }
        }

        emit({ type: 'filling', message: 'Reading form fields…' });
        const formFields = await extractFormFields(targetPage);

        console.log('\n── Extracted form fields ─────────────────────────');
        for (const f of formFields) {
          const opts = f.options?.length ? ` [${f.options.slice(0, 5).join(' | ')}${f.options.length > 5 ? '…' : ''}]` : '';
          console.log(`  ${f.selector} | "${f.label}" | ${f.type}${f.multi ? ' multi' : ''}${f.required ? ' *' : ''}${opts}`);
        }
        console.log('─────────────────────────────────────────────────\n');

        emit({ type: 'debug', message: `Extracted ${formFields.length} form field${formFields.length !== 1 ? 's' : ''} from ${targetPage === page ? 'main frame' : 'iframe'}` });
        for (const f of formFields) {
          const opts = f.options?.length ? ` — options: ${f.options.slice(0, 4).join(', ')}${f.options.length > 4 ? '…' : ''}` : '';
          emit({ type: 'debug', message: `  ${f.required ? '* ' : ''}${f.label || f.selector} (${f.type})${opts}` });
        }

        // Detect and inject cover letter
        if (coverLetter) {
          emit({ type: 'filling', message: 'Detecting cover letter fields…' });
          const coverLetterFields = await detectCoverLetterFields(targetPage);
          if (coverLetterFields.length > 0) {
            emit({ type: 'debug', message: `Found ${coverLetterFields.length} potential cover letter field(s)` });
            for (const clf of coverLetterFields) {
              const injected = await injectCoverLetter(targetPage, clf.selector, coverLetter, clf.type, emit);
              if (injected) {
                filled++;
                break;
              }
            }
          }
        }

        if (!formFields.length) {
          // Standard detection failed — try AI vision fallback
          emit({ type: 'debug', message: 'Standard field detection failed — escalating to AI vision…' });
          const visionFilled = await aiVisionFill(targetPage as unknown as Page, user, emit as any);
          if (visionFilled === 0) {
            emit({ type: 'error', message: 'AI vision could not fill form automatically. Please complete manually.' });
          } else {
            filled += visionFilled;
          }
        } else {
          emit({ type: 'filling', message: `Found ${formFields.length} fields — asking Gemma to map values…` });
          const mapping = await llmMapFields(formFields, user, emit);
          const total   = Object.keys(mapping).length;

          for (const [selector, value] of Object.entries(mapping)) {
            if (!value || (Array.isArray(value) && !value.length)) continue;
            const field = formFields.find(f => f.selector === selector);
            const label = field?.label || selector;
            emit({ type: 'filling', field: label, filled, total });

            const ok = await fillField(targetPage, selector, value, emit);
            if (ok) {
              filled++;
              filledValues[label] = String(Array.isArray(value) ? value.join(', ') : value);
              emit({ type: 'field_filled', field: label, filled, total });
              await page.waitForTimeout(300);
            }
          }

          if (user.resume_text) {
            const fileField = formFields.find(f => f.type === 'file' && /resume|cv/i.test(f.label + f.selector));
            if (fileField) {
              tempResumePath = writeTempResume(user.resume_text);
              try {
                await (targetPage as Page).locator(fileField.selector).setInputFiles(tempResumePath);
                filled++;
                emit({ type: 'field_filled', field: 'resume (file)', filled, total: total + 1 });
              } catch {
                emit({ type: 'upload_skipped', field: 'resume', message: 'File upload failed — attach manually' });
              }
            }
          }
        }
      }

      // Check for captcha AFTER form filling (before submit)
      const postFillCaptcha = await detectCaptcha(page);
      if (postFillCaptcha?.detected) {
        emit({ type: 'captcha_detected', message: `${postFillCaptcha.type} detected`, captcha_type: postFillCaptcha.type, form_url: page.url() });

        // Attempt auto-solve with CapSolver first
        const solved = await solveWithCapSolver(page, postFillCaptcha.type, emit as any);

        if (!solved) {
          // CapSolver unavailable/failed — pause for manual intervention
          const shot2 = await takeScreenshot(page, `post_fill_${postFillCaptcha.type}`);
          emit({
            type: 'paused',
            message: `Filled ${filled} field${filled !== 1 ? 's' : ''}. Captcha requires manual solve — use the values below.`,
            filled_values: filledValues,
            form_url: page.url(),
            screenshot_url: shot2?.url,
          } as any);
          logApplicationEvent({ applicationId, userId, eventType: 'captcha_detected_post_fill', level: 'warning', message: `${postFillCaptcha.type} — manual solve required` });
          await browser.close();
          return;
        }
        // Solved — fall through to submission
      }

      // Try to find and click submit button
      const submitSelector = ats?.map.submitSelector;
      if (submitSelector) {
        try {
          emit({ type: 'filling', message: 'Submitting form…' });
          const submitBtn = page.locator(submitSelector).first();
          if (await submitBtn.count()) {
            await submitBtn.click();
            await page.waitForLoadState('networkidle').catch(() => {});
            emit({
              type: 'submitted',
              message: `Application submitted successfully to ${jobUrl}`,
            });
            logApplicationEvent({
              applicationId,
              userId,
              eventType: 'application_submitted',
              level: 'info',
              message: `Application submitted with ${filled} fields filled`,
            });
            await browser.close();
            return;
          }
        } catch (e) {
          console.error('Submit button click error:', (e as Error).message);
        }
      }

      // If we couldn't auto-submit, pause and ask user
      emit({
        type: 'paused',
        message: `Filled ${filled} field${filled !== 1 ? 's' : ''}. Review the form and submit.`,
        filled_values: filledValues,
        form_url: page.url(),
      } as any);

      logApplicationEvent({
        applicationId,
        userId,
        eventType: 'form_paused_for_review',
        level: 'info',
        message: `Form filled with ${filled} fields, paused for user review`,
      });

      if (tempResumePath) {
        setTimeout(() => { try { unlinkSync(tempResumePath!); } catch {} }, 30000);
      }

      await browser.close();
      return;

    } catch (e) {
      const errorMsg = (e as Error).message;
      console.error(`[Attempt ${retryCount + 1}/${MAX_RETRIES + 1}] Error:`, errorMsg);

      logApplicationEvent({
        applicationId,
        userId,
        eventType: 'apply_error',
        level: 'error',
        message: `Attempt ${retryCount + 1} failed: ${errorMsg}`,
        errorDetails: (e as Error).stack,
        retryCount,
      });

      if (tempResumePath) {
        try { unlinkSync(tempResumePath); } catch {}
      }

      await browser.close();

      if (retryCount < MAX_RETRIES) {
        retryCount++;
        const waitTime = Math.min(5000 * retryCount, 15000);
        emit({
          type: 'retry',
          message: `Retrying after ${waitTime / 1000}s (attempt ${retryCount + 1}/${MAX_RETRIES + 1})…`,
        });
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        emit({
          type: 'error',
          message: `Failed after ${MAX_RETRIES + 1} attempts: ${errorMsg}. Please try manually.`,
        });
        logApplicationEvent({
          applicationId,
          userId,
          eventType: 'apply_max_retries_exceeded',
          level: 'error',
          message: `Failed after ${MAX_RETRIES + 1} retry attempts`,
          errorDetails: errorMsg,
          retryCount: MAX_RETRIES,
        });
        throw e;
      }
    }
  }
}

// ── Greenhouse Direct API Submission ─────────────────────────────────────────

export interface GreenhouseApiResult {
  submitted: boolean;
  applicationId?: string | number;
  error?: string;
  statusCode?: number;
}

/**
 * Parse company slug and job token from Greenhouse URLs.
 *
 * Supported patterns:
 *  - https://job-boards.greenhouse.io/embed/job_app?for=COMPANY&token=JOB_TOKEN
 *  - https://boards.greenhouse.io/COMPANY/jobs/JOB_TOKEN
 *  - https://boards.greenhouse.io/COMPANY/jobs/JOB_TOKEN/applications/new
 *  - https://jobs.greenhouse.io/COMPANY/jobs/JOB_TOKEN
 */
export function parseGreenhouseUrl(jobUrl: string): { company: string; jobId: string } | null {
  // Embed format: ?for=COMPANY&token=JOB_TOKEN
  const embedMatch = jobUrl.match(/[?&]for=([^&]+).*[?&]token=([^&]+)/);
  if (embedMatch) {
    return { company: embedMatch[1], jobId: embedMatch[2] };
  }
  // Also handle token before for
  const embedMatchRev = jobUrl.match(/[?&]token=([^&]+).*[?&]for=([^&]+)/);
  if (embedMatchRev) {
    return { company: embedMatchRev[2], jobId: embedMatchRev[1] };
  }

  // boards/jobs format: boards.greenhouse.io/COMPANY/jobs/JOB_ID
  const boardsMatch = jobUrl.match(/(?:boards|jobs)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (boardsMatch) {
    return { company: boardsMatch[1], jobId: boardsMatch[2] };
  }

  // gh_jid query param with company in URL (e.g. company.com/jobs?gh_jid=12345)
  const ghJidMatch = jobUrl.match(/[?&]gh_jid=(\d+)/);
  const forMatch   = jobUrl.match(/[?&]for=([^&]+)/);
  if (ghJidMatch && forMatch) {
    return { company: forMatch[1], jobId: ghJidMatch[1] };
  }

  return null;
}

/**
 * Submit a job application directly to the Greenhouse Job Board API v1.
 * No browser, no captcha — pure HTTP POST.
 *
 * @param userId      - Local user ID to load profile from
 * @param jobUrl      - Any Greenhouse job URL (embed or boards format)
 * @param atsSlug     - Greenhouse company slug override (from ats_slug in job site config)
 * @param coverLetter - Optional cover letter text
 */
export async function applyViaGreenhouseAPI(params: {
  userId: number;
  jobUrl: string;
  atsSlug?: string;
  coverLetter?: string;
}): Promise<GreenhouseApiResult> {
  const { userId, jobUrl, atsSlug, coverLetter } = params;

  // 1. Load user profile
  const user = getUser(userId);
  if (!user) return { submitted: false, error: `User ${userId} not found` };
  if (!user.resume_text?.trim()) return { submitted: false, error: 'User has no resume on file' };

  // 2. Parse company + job ID from URL
  const parsed = parseGreenhouseUrl(jobUrl);
  const company = atsSlug?.trim() || parsed?.company;
  const jobId   = parsed?.jobId;

  if (!company) {
    return { submitted: false, error: 'Could not determine Greenhouse company slug. Provide atsSlug or use a boards.greenhouse.io URL.' };
  }
  if (!jobId) {
    return { submitted: false, error: 'Could not extract job ID from URL. Use a boards.greenhouse.io/COMPANY/jobs/ID URL.' };
  }

  // 3. Build name parts
  const [firstName, ...rest] = user.name.trim().split(' ');
  const lastName = rest.join(' ') || firstName; // fallback if single-name

  // 4. Encode resume and optional cover letter as base64
  const resumeBase64 = Buffer.from(user.resume_text, 'utf8').toString('base64');
  const clBase64     = coverLetter ? Buffer.from(coverLetter, 'utf8').toString('base64') : undefined;

  // 5. Build request body
  const body: Record<string, unknown> = {
    first_name:              firstName,
    last_name:               lastName,
    email:                   user.email,
    phone:                   user.phone || undefined,
    resume_content:          resumeBase64,
    resume_content_filename: 'resume.txt',
    answers:                 [],
  };

  if (clBase64) {
    body.cover_letter_content          = clBase64;
    body.cover_letter_content_filename = 'cover_letter.txt';
  }

  // Optional mapped fields
  if (user.linkedin) {
    body.website_addresses = [{ url: user.linkedin, type: 'linkedin' }];
  }

  // 6. POST to Greenhouse API
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company)}/jobs/${encodeURIComponent(jobId)}/applications`;

  console.log(`[Greenhouse API] POST ${apiUrl}`);

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    return { submitted: false, error: `Network error: ${(e as Error).message}` };
  }

  // 7. Parse response
  let responseBody: unknown;
  const text = await response.text();
  try { responseBody = JSON.parse(text); } catch { responseBody = text; }

  console.log(`[Greenhouse API] Status: ${response.status}`, responseBody);

  if (response.ok) {
    const appId = (responseBody as any)?.id ?? (responseBody as any)?.application_id;
    return { submitted: true, applicationId: appId, statusCode: response.status };
  }

  // Surface meaningful errors from Greenhouse
  const ghError = (responseBody as any)?.errors
    ? (responseBody as any).errors.map((e: any) => e.message || String(e)).join('; ')
    : text.slice(0, 300);

  return {
    submitted:  false,
    error:      `Greenhouse API returned ${response.status}: ${ghError}`,
    statusCode: response.status,
  };
}

// ── AI Vision Form Filler ──────────────────────────────────────────────────────
// When standard field detection fails, take a screenshot and ask Gemini Vision
// to identify the form fields and generate fill instructions.

async function aiVisionFill(page: Page, user: User, emit: (obj: object) => void): Promise<number> {
  emit({ type: 'filling', message: '🤖 Switching to AI analysis mode — reading DOM + screenshot…' });

  // 1. Accessibility tree — gives exact roles, labels, selectors (primary signal)
  const a11y = await (page as any).accessibility?.snapshot({ interestingOnly: true }).catch(() => null) ?? null;
  const a11yText = a11y ? JSON.stringify(a11y, null, 2).slice(0, 8000) : 'unavailable';

  // 2. All interactive elements with metadata (precise selectors)
  const domFields = await page.$$eval(
    'input:not([type=hidden]), select, textarea, [role="textbox"], [role="combobox"], [role="listbox"]',
    els => els.map(el => {
      const e = el as HTMLInputElement;
      const label = e.labels?.[0]?.textContent?.trim()
        || e.getAttribute('aria-label')
        || e.getAttribute('placeholder')
        || e.getAttribute('name')
        || e.id;
      return {
        tag: el.tagName.toLowerCase(),
        type: e.type || null,
        id: e.id || null,
        name: e.name || null,
        label: label || null,
        required: e.required,
        selector: e.id ? `#${e.id}` : e.name ? `[name="${e.name}"]` : null,
      };
    })
  ).catch(() => [] as any[]);

  // 3. Screenshot for visual context (handles React/custom components)
  const screenshot = await page.screenshot({ fullPage: false });
  const base64Image = screenshot.toString('base64');

  const llm = new ChatGoogleGenerativeAI({
    model: 'gemini-2.5-flash',
    temperature: 0,
    apiKey: process.env.GOOGLE_API_KEY,
  });

  const profileSummary = `Name: ${user.name}
Email: ${user.email}
Phone: ${user.phone}
LinkedIn: ${user.linkedin}
Location: ${user.city}${user.state ? ', ' + user.state : ''}
Work authorized: ${user.work_authorized}
Requires sponsorship: ${user.requires_sponsorship}
Years experience: ${user.years_experience}`.trim();

  const prompt = `You are filling out a job application form automatically.

APPLICANT PROFILE:
${profileSummary}

DOM FIELDS FOUND (use these selectors — most reliable):
${JSON.stringify(domFields, null, 2)}

ACCESSIBILITY TREE:
${a11yText}

The screenshot shows the current visual state of the form.

Generate a JSON array of fill actions. Prefer selectors from DOM FIELDS above.
Use aria-label or placeholder as fallback selector if id/name missing.
[
  {"action": "fill", "selector": "#email", "value": "carlos@email.com"},
  {"action": "select", "selector": "[name=\"country\"]", "value": "US"},
  {"action": "getByLabel", "label": "First Name", "value": "Carlos"}
]

Actions: "fill" (text input), "select" (dropdown), "getByLabel" (when no id/name).
Return ONLY valid JSON array. Skip file uploads.`;

  const msg = new HumanMessage({
    content: [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } },
      { type: 'text', text: prompt },
    ],
  });

  let filled = 0;
  try {
    const response = await llm.invoke([msg]);
    const text = (response.content as string).trim()
      .replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    let actions: Array<{ action: string; selector: string; value?: string; description?: string }> = [];
    try { actions = JSON.parse(text); } catch { emit({ type: 'debug', message: `AI vision parse error: ${text.slice(0, 200)}` }); return 0; }

    emit({ type: 'debug', message: `AI vision found ${actions.length} actions` });

    for (const act of actions) {
      try {
        const total = actions.length;
        if (act.action === 'fill' && act.value && act.selector) {
          await page.locator(act.selector).fill(act.value, { timeout: 3000 });
          emit({ type: 'field_filled', field: act.selector, filled: ++filled, total });
        } else if (act.action === 'getByLabel' && act.value && (act as any).label) {
          await page.getByLabel((act as any).label, { exact: false }).fill(act.value, { timeout: 3000 });
          emit({ type: 'field_filled', field: (act as any).label, filled: ++filled, total });
        } else if (act.action === 'select' && act.value && act.selector) {
          await page.locator(act.selector).selectOption(act.value, { timeout: 3000 });
          emit({ type: 'field_filled', field: act.selector, filled: ++filled, total });
        } else if (act.action === 'click' && act.selector) {
          await page.locator(act.selector).click({ timeout: 3000 });
          emit({ type: 'debug', message: `Clicked: ${act.description || act.selector}` });
        }
      } catch (e) {
        emit({ type: 'debug', message: `AI action failed for "${act.selector || (act as any).label}": ${(e as Error).message.slice(0, 80)}` });
      }
    }
  } catch (e) {
    emit({ type: 'debug', message: `AI vision error: ${(e as Error).message.slice(0, 200)}` });
  }

  return filled;
}
