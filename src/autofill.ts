import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSelectorResult } from './observability.js';
import type { AutofillOptions } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FORM_PATH = join(__dirname, '..', 'form.html');

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function autofillForm(options: AutofillOptions): Promise<void> {
  const {
    name,
    email,
    phone = '',
    linkedin = '',
    resumeText = '',
    coverLetter = '',
    mode = 'type',
    typingDelay = 35,
    fieldPause = 0.8,
  } = options;

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto(`file://${FORM_PATH}`, { waitUntil: 'domcontentloaded' });
  await wait(1000);

  async function fill(selector: string, text: string): Promise<void> {
    if (!text) return;
    const t0 = performance.now();
    try {
      const el = page.locator(selector);
      await el.click();
      await wait(150);

      if (mode === 'type') {
        await el.pressSequentially(text, { delay: typingDelay });
        await wait(150);
      } else if (mode === 'instant_per_field') {
        await el.fill(text);
        await wait(fieldPause * 1000);
      } else {
        await el.fill(text);
      }

      recordSelectorResult({ selector, context: 'autofill.form', success: true, latencyMs: performance.now() - t0 });
    } catch (e) {
      recordSelectorResult({ selector, context: 'autofill.form', success: false, latencyMs: performance.now() - t0, error: String(e) });
      throw e;
    }
  }

  await fill('#name', name);
  await fill('#email', email);
  await fill('#phone', phone);
  await fill('#linkedin', linkedin);
  await fill('#resume', resumeText);
  await fill('#cover', coverLetter);

  if (mode === 'type') await wait(1500);
  else if (mode === 'instant_per_field') await wait(1000);
  else await wait(500);

  await page.locator('#submitBtn').click();
  await wait(2500);

  await browser.close();
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf('--mode');
  const modeArg = args.find(a => a.startsWith('--mode='))?.split('=')[1]
    ?? (modeIdx >= 0 ? args[modeIdx + 1] : undefined)
    ?? 'type';

  const fromFiles = args.includes('--from-files');

  const resumeText = fromFiles && existsSync('resume.txt')
    ? readFileSync('resume.txt', 'utf8').trim()
    : '5+ years of browser automation engineering using Playwright, Puppeteer, and Selenium.\n' +
      'Built large-scale scraping infrastructure processing 500k pages/day.\n' +
      'Strong JavaScript/TypeScript, REST API design, and cloud deployment (AWS).\n' +
      'Experience debugging shadow DOM, iframe injection, and CAPTCHA mitigation.';

  const coverLetter = fromFiles && existsSync('cover_letter.txt')
    ? readFileSync('cover_letter.txt', 'utf8').trim()
    : 'I am excited to apply for the Senior Browser Automation Engineer role on your team. ' +
      'Your work on LLM-powered automation workflows aligns exactly ' +
      'with the systems I have designed and shipped over the past five years.';

  console.log(`Running demo in '${modeArg}' mode...`);
  autofillForm({
    name: 'Carlos Martinez',
    email: 'carlos199730@gmail.com',
    phone: '(787) 555-0100',
    linkedin: 'linkedin.com/in/carlosmartinez',
    resumeText,
    coverLetter,
    mode: modeArg as 'type' | 'instant_per_field' | 'instant',
  }).then(() => console.log('Done.')).catch(console.error);
}
