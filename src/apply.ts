import { chromium, type Page, type Browser } from 'playwright';
import { ChatOllama } from '@langchain/ollama';
import { JsonOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getUser } from './profiles.js';
import type { ApplyEvent, User } from './types.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

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
  options?: string[];   // available choices for select / radio / checkbox
  multi?:   boolean;    // true for checkbox groups (multi-select)
}

async function extractFormFields(page: Page): Promise<FormField[]> {
  return page.evaluate((): FormField[] => {
    const results: FormField[] = [];
    const seenGroupNames = new Set<string>();

    document.querySelectorAll('input, textarea, select').forEach(el => {
      const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

      // Skip non-fillable types
      if ('type' in input && ['submit', 'button', 'hidden', 'image', 'reset'].includes(input.type)) return;

      const tagName = el.tagName.toLowerCase();
      const inputType = 'type' in input ? input.type : tagName === 'select' ? 'select' : 'textarea';
      const isCheckGroup = inputType === 'checkbox' || inputType === 'radio';

      // Deduplicate checkbox/radio groups — only emit one entry per name
      if (isCheckGroup && input.name) {
        if (seenGroupNames.has(input.name)) return;
        seenGroupNames.add(input.name);
      }

      // Build a stable CSS selector
      let sel = tagName;
      if (input.id) sel += `#${input.id}`;
      else if (input.name) sel += `[name="${input.name}"]`;
      else return;

      // Use group-level selector for checkbox/radio so we can iterate all members
      if (isCheckGroup && input.name) sel = `input[name="${input.name}"]`;

      // --- Find the question/label text ---
      let label = '';

      // 1. <label for="id">
      if (input.id) {
        const lb = document.querySelector(`label[for="${input.id}"]`);
        if (lb) label = (lb as HTMLElement).innerText.trim();
      }
      // 2. Parent <label>
      if (!label) {
        const parent = input.closest('label');
        if (parent) label = (parent as HTMLElement).innerText.replace(/(^\s+|\s+$)/g, '');
      }
      // 3. Nearest ancestor with a descriptive child (fieldset legend, div with label/p/span)
      if (!label) {
        const wrapper = input.closest('fieldset, [class*="question"], [class*="field"], [class*="form-group"], li, div');
        if (wrapper) {
          const heading = wrapper.querySelector('legend, label, p, span');
          if (heading && heading !== input) label = (heading as HTMLElement).innerText.trim();
        }
      }
      // 4. Fallback to placeholder / name
      if (!label) label = ('placeholder' in input ? input.placeholder : '') || input.name || input.id || '';

      // Clean the label: strip trailing asterisks and "required" text
      label = label.replace(/\s*\*\s*$/, '').replace(/\(required\)/i, '').trim();

      // --- Capture options for select / checkbox / radio ---
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
  const llm    = new ChatOllama({ model: 'gemma4:26b', temperature: 0, think: false });
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

// ── Apply button: find and click, wait for navigation ────────────────────────

async function clickApplyButton(
  page: Page,
  atsSelector: string | undefined,
  emit: (e: ApplyEvent) => void,
): Promise<boolean> {
  // 1. ATS-specific selector takes priority
  if (atsSelector) {
    try {
      await page.click(atsSelector, { timeout: 5000 });
      await page.waitForTimeout(2000);
      return true;
    } catch { /* fall through */ }
  }

  // 2. Generic: look for Apply button/link by visible text
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

      // Detect whether clicking opens new tab vs same-tab navigation
      const [newPage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 3000 }).catch(() => null as Page | null),
        Promise.race([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
          btn.click(),
        ]),
      ]);

      if (newPage) {
        // Opened in new tab — switch to it
        await newPage.waitForLoadState('domcontentloaded');
        await page.close();
        // We can't reassign page here; caller must use the context's active page
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

  // Multi-value: checkbox group
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

  // Single value: try each comma-separated selector variant
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
        // 1. Exact label match
        const exact = await el.selectOption({ label: val }).catch(() => null);
        if (!exact) {
          // 2. Fuzzy: find option whose text contains the value or vice versa
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

// ── Main auto-apply ───────────────────────────────────────────────────────────

export async function autoApply(
  userId: number,
  jobUrl: string,
  emit: (event: ApplyEvent) => void,
): Promise<void> {
  const user = getUser(userId);
  if (!user) throw new Error(`User ${userId} not found`);

  const [firstName, ...rest] = user.name.trim().split(' ');
  const lastName = rest.join(' ');

  const ats = detectAts(jobUrl);

  emit({ type: 'navigating', message: `Opening ${jobUrl}…` });

  const browser: Browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: null });
  let page = await context.newPage();

  let tempResumePath: string | null = null;

  try {
    // Navigate to the job / form page
    const targetUrl = ats?.map.applyUrlSuffix
      ? jobUrl.replace(/\/$/, '') + ats.map.applyUrlSuffix
      : jobUrl;

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Find + click the Apply button (handles navigation or new tab)
    const clicked = await clickApplyButton(page, ats?.map.applyBtnSelector, emit);
    if (clicked) {
      // After possible new-tab or same-tab nav, grab the active page
      const pages = context.pages();
      page = pages[pages.length - 1];
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1000);
    }

    emit({ type: 'form_found', message: `Form at ${page.url()}` });

    let filled = 0;

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
          emit({ type: 'field_filled', field: key.replace('_', ' '), filled, total });
          await page.waitForTimeout(200);
        }
      }

    } else {
      // ── Unknown site: detect iframe → extract fields → LLM → fill ─────────

      emit({ type: 'filling', message: 'Waiting for form to load…' });

      // Give SPA/React apps extra time to render
      await page.waitForTimeout(2000);

      // Wait up to 8 s for any input/select/textarea to appear
      await page.waitForSelector('input, select, textarea, iframe', { timeout: 8000 })
        .catch(() => emit({ type: 'debug', message: 'No standard form elements appeared after 8 s' }));

      // ── Check for iframe ────────────────────────────────────────────────────
      const iframes = page.frames().filter(f => f !== page.mainFrame());
      const iframeSrcs = await Promise.all(
        (await page.$$('iframe')).map(h => h.getAttribute('src').catch(() => ''))
      );
      emit({ type: 'debug', message: `Frames on page: ${page.frames().length} total, ${iframes.length} sub-frames` });
      if (iframeSrcs.length) emit({ type: 'debug', message: `iframes: ${iframeSrcs.filter(Boolean).join(' | ')}` });

      // DOM diagnostic dump (logged to terminal, not modal)
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

      // Choose which frame to extract from — prefer iframe if main frame has 0 inputs
      const mainInputCount = domSummary.counts['input'] + domSummary.counts['select'] + domSummary.counts['textarea'];
      let targetPage: Page = page;

      if (mainInputCount === 0 && iframes.length > 0) {
        emit({ type: 'debug', message: `No inputs in main frame — switching to iframe` });
        // Find the iframe frame object
        const allFrames = page.frames();
        const formFrame = allFrames.find(f => f !== page.mainFrame());
        if (formFrame) {
          // Use the frame's page-like API via page.frame()
          const iframeEl = page.frameLocator('iframe').first();
          const iframeInputCount = await iframeEl.locator('input, select, textarea').count().catch(() => 0);
          emit({ type: 'debug', message: `iframe has ${iframeInputCount} inputs` });

          if (iframeInputCount > 0) {
            // Extract fields from iframe using the frame handle
            const frameHandle = await page.$('iframe');
            if (frameHandle) {
              const frame = await frameHandle.contentFrame();
              if (frame) {
                targetPage = frame as unknown as Page;
              }
            }
          }
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

      if (!formFields.length) {
        emit({ type: 'error', message: 'No form fields found — check the Debug log for DOM details. The form may use custom React components or require manual interaction.' });
        // Don't return — still pause so user can see the browser
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
            emit({ type: 'field_filled', field: label, filled, total });
            await page.waitForTimeout(300);
          }
        }

        // Upload resume file
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

    emit({
      type: 'paused',
      message: `Filled ${filled} field${filled !== 1 ? 's' : ''}. Review the form in the browser, then submit when ready.`,
    });

    if (tempResumePath) {
      setTimeout(() => { try { unlinkSync(tempResumePath!); } catch {} }, 30000);
    }

  } catch (e) {
    await browser.close();
    throw e;
  }
}
