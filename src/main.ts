import { Command } from 'commander';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scrapeJob, listJobs, ScraperError } from './scraper.js';
import { analyze, loadResume, formatReport } from './analyzer.js';
import type { HistoryEntry } from './types.js';

const HISTORY_FILE = 'history.json';
const REPORTS_DIR  = 'reports';

// ─── history ──────────────────────────────────────────────────────────────────

async function loadHistory(): Promise<HistoryEntry[]> {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(await readFile(HISTORY_FILE, 'utf8')) as HistoryEntry[];
  } catch {
    return [];
  }
}

async function appendHistory(entry: HistoryEntry): Promise<void> {
  const history = await loadHistory();
  history.push(entry);
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function showHistory(history: HistoryEntry[]): void {
  if (!history.length) {
    console.log('\nNo jobs analyzed yet. Run: npx tsx src/main.ts <url>');
    return;
  }
  const line = '='.repeat(60);
  console.log(`\n${line}`);
  console.log(`JOB HISTORY  (${history.length} analyzed)`);
  console.log(line);
  for (const entry of [...history].reverse()) {
    const score = entry.score;
    const bar   = typeof score === 'number' ? '#'.repeat(Math.floor(score / 10)).padEnd(10) : '?'.padEnd(10);
    console.log(`\n  ${entry.title ?? 'Unknown'}`);
    console.log(`  Score : ${score ?? '?'}/100  [${bar}]`);
    console.log(`  Date  : ${entry.date ?? '?'}`);
    console.log(`  URL   : ${entry.url ?? '?'}`);
    if (entry.saved_to) console.log(`  File  : ${entry.saved_to}`);
  }
  console.log(`\n${line}\n`);
}

async function saveReport(reportText: string, url: string, title: string): Promise<string> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
  const slug = title.toLowerCase().slice(0, 40).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = join(REPORTS_DIR, `${timestamp}_${slug}.txt`);
  const header = `URL: ${url}\nDate: ${new Date().toLocaleString()}\n`;
  await writeFile(filename, header + reportText + '\n');
  return filename;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('job-automator')
    .description('Scrape and analyze job postings with Gemma')
    .argument('[url]', 'job URL to analyze (positional form)')
    .option('--url <url>',              'job URL to analyze (explicit flag form)')
    .option('--save',                   'save the report to a timestamped file in reports/')
    .option('--list-jobs <listingUrl>', 'list jobs from a careers or job board page')
    .option('--history',                'show the job analysis history log')
    .addHelpText('after', `
examples:
  npx tsx src/main.ts https://boards.greenhouse.io/company/jobs/12345
  npx tsx src/main.ts --url <url> --save
  npx tsx src/main.ts --list-jobs https://company.com/careers
  npx tsx src/main.ts --history`);

  program.parse(process.argv);
  const opts = program.opts<{ url?: string; save?: boolean; listJobs?: string; history?: boolean }>();
  const positional = program.args[0];

  // ── subcommands that don't need a URL ─────────────────────────────────────

  if (opts.history) {
    showHistory(await loadHistory());
    return;
  }

  if (opts.listJobs) {
    console.log(`\nLoading job listings from:\n  ${opts.listJobs}\n`);
    const jobs = await listJobs(opts.listJobs, true);
    if (!jobs.length) {
      console.log('No jobs found.');
    } else {
      console.log(`Found ${jobs.length} job(s):\n`);
      for (const [i, job] of jobs.entries()) {
        console.log(`  ${i + 1}. ${job.title}`);
        const extra = [job.location, job.department].filter(Boolean).join(' · ');
        if (extra) console.log(`     ${extra}`);
        console.log(`     ${job.url}\n`);
      }
    }
    return;
  }

  // ── analyze a URL ─────────────────────────────────────────────────────────

  const url = positional ?? opts.url;
  if (!url) {
    program.help();
    return;
  }

  // Step 1: scrape
  console.log('\n[1/3] Scraping job description...');
  console.log(`      ${url}`);
  let jobDescription: string;
  try {
    jobDescription = await scrapeJob(url);
    console.log(`      Extracted ${jobDescription.length} characters`);
  } catch (e) {
    if (e instanceof ScraperError) {
      console.error(`\nScraper error: ${e.message}`);
      console.error('\nTips:');
      console.error('  • Greenhouse and Lever job pages work reliably');
      console.error('  • Indeed and LinkedIn often block headless browsers');
      console.error('  • Try the URL in your browser first to confirm it loads');
      process.exit(1);
    }
    throw e;
  }

  // Step 2: load resume
  console.log('\n[2/3] Loading resume...');
  let resume: string;
  try {
    resume = await loadResume();
    console.log(`      Loaded ${resume.length} characters`);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      console.error('\nError: resume.txt not found.');
      console.error('Create it: touch resume.txt  then paste your resume text inside.');
    } else {
      console.error(`\nError: ${err.message}`);
    }
    process.exit(1);
  }

  // Step 3: analyze
  console.log('\n[3/3] Analyzing with Gemma (30-60 seconds)...');
  let analysis;
  try {
    analysis = await analyze(jobDescription!, resume!);
  } catch (e) {
    console.error(`\nAnalysis error: ${(e as Error).message}`);
    process.exit(1);
  }

  const reportText = formatReport(analysis);
  console.log(reportText);

  let savedTo: string | null = null;
  if (opts.save) {
    const title = analysis.title || url.replace(/\/$/, '').split('/').pop()!.replace(/-/g, ' ');
    savedTo = await saveReport(reportText, url, title);
    console.log(`Report saved: ${savedTo}`);
  }

  const title = analysis.title || url.replace(/\/$/, '').split('/').pop()!.replace(/-/g, ' ');
  await appendHistory({
    date:     new Date().toLocaleString(),
    title,
    url,
    score:    analysis.match_score ?? null,
    saved_to: savedTo,
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
