import cron, { type ScheduledTask } from 'node-cron';
import { runFeedScan } from './feed.js';
import { getSetting } from './observability.js';
import { sendNtfy } from './notify.js';

let activeTask: ScheduledTask | null = null;

export function reloadScheduler(): void {
  activeTask?.stop();
  activeTask = null;

  const enabled  = getSetting('scan_enabled') === '1';
  const expr     = getSetting('scan_cron') || '0 9 * * *';
  const userId   = Number(getSetting('scan_user_id') || '0');

  if (!enabled || !userId || !cron.validate(expr)) return;

  activeTask = cron.schedule(expr, () => void runScheduledScan(userId));
  console.log(`[scheduler] Auto-scan enabled — cron: ${expr}, user: ${userId}`);
}

async function runScheduledScan(userId: number): Promise<void> {
  console.log(`[scheduler] Starting scheduled scan for user ${userId}`);

  const alertEnabled = getSetting('alert_enabled') === '1';
  const threshold    = Number(getSetting('alert_threshold') || '80');
  const ntfyTopic    = getSetting('ntfy_topic') || '';
  const ntfyServer   = getSetting('ntfy_server') || 'https://ntfy.sh';

  const highMatches: { title: string; score: number; url: string }[] = [];

  try {
    await runFeedScan(userId, evt => {
      if (
        evt.type === 'job_result' &&
        !evt.from_cache &&
        typeof evt.job?.analysis?.match_score === 'number' &&
        evt.job.analysis.match_score >= threshold
      ) {
        highMatches.push({
          title: evt.job.job.title,
          score: evt.job.analysis.match_score,
          url:   evt.job.job.url,
        });
      }
    });
  } catch (e) {
    console.error('[scheduler] Scan failed:', e);
  }

  console.log(`[scheduler] Scan done — ${highMatches.length} high-match jobs`);

  if (alertEnabled && ntfyTopic && highMatches.length > 0) {
    const lines = highMatches
      .sort((a, b) => b.score - a.score)
      .map(j => `${j.score}/100 — ${j.title}`)
      .join('\n');
    const title = `${highMatches.length} high-match job${highMatches.length > 1 ? 's' : ''} found`;
    try {
      await sendNtfy(ntfyTopic, title, lines, ntfyServer);
      console.log(`[scheduler] ntfy alert sent → ${ntfyTopic}`);
    } catch (e) {
      console.error('[scheduler] ntfy failed:', e);
    }
  }
}
