import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoryEntry } from './types.js';

const HISTORY_FILE = 'history.json';
const REPORTS_DIR  = 'reports';

export async function loadHistory(): Promise<HistoryEntry[]> {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(await readFile(HISTORY_FILE, 'utf8')) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const history = await loadHistory();
  history.push(entry);
  await writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
}

export async function clearHistory(): Promise<void> {
  await writeFile(HISTORY_FILE, '[]');
}

export async function saveReport(reportText: string, url: string, title: string): Promise<string> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
  const slug = title.toLowerCase().slice(0, 40).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = join(REPORTS_DIR, `${timestamp}_${slug}.txt`);
  await writeFile(filename, `URL: ${url}\nDate: ${new Date().toLocaleString()}\n${reportText}\n`);
  return filename;
}
