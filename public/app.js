// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score) {
  if (score >= 70) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

function scoreLabel(score) {
  if (score >= 70) return 'Strong match';
  if (score >= 50) return 'Partial match';
  return 'Weak match';
}

function scoreClass(score) {
  if (score >= 70) return 'score-strength';
  if (score >= 50) return 'score-partial';
  return 'score-weak';
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function el(tag, cls, inner) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (inner !== undefined) e.innerHTML = inner;
  return e;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiGet(path) {
  const r = await fetch(path);
  return r.json();
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function apiDelete(path) {
  const r = await fetch(path, { method: 'DELETE' });
  return r.json();
}

// Streams NDJSON from a POST endpoint; calls onEvent for each parsed object.
async function streamPost(path, body, onEvent) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { onEvent(JSON.parse(line)); } catch {}
    }
  }
}

// ── Resume sidebar ────────────────────────────────────────────────────────────

async function initResume() {
  const input  = document.getElementById('resume-input');
  const badge  = document.getElementById('resume-badge');
  const saveBtn = document.getElementById('save-resume-btn');

  const { content, found } = await apiGet('/api/resume');
  input.value = content;
  updateResumeBadge(badge, content, found);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const { ok } = await apiPost('/api/resume', { content: input.value });
    saveBtn.disabled = false;
    if (ok) {
      updateResumeBadge(badge, input.value, true);
      toast('Resume saved');
    } else {
      toast('Save failed', 'error');
    }
  });
}

function updateResumeBadge(badge, content, found) {
  const chars = content?.trim().length ?? 0;
  if (found && chars > 0) {
    badge.textContent = `${chars.toLocaleString()} chars`;
    badge.className = 'resume-badge set';
  } else {
    badge.textContent = 'not set';
    badge.className = 'resume-badge';
  }
}

// ── Tab navigation ────────────────────────────────────────────────────────────

function initTabs() {
  const btns   = document.querySelectorAll('.nav-btn');
  const panels = document.querySelectorAll('.tab-panel');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      btns.forEach(b => b.classList.toggle('active', b === btn));
      panels.forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
      onTabActivate(tab);
    });
  });
}

function onTabActivate(tab) {
  if (tab === 'history')  loadHistory();
  if (tab === 'observe')  loadObservability();
}

// ── Analyze tab ───────────────────────────────────────────────────────────────

function initAnalyzeTab() {
  const btn     = document.getElementById('analyze-btn');
  const urlInput = document.getElementById('analyze-url');
  const saveChk = document.getElementById('analyze-save');
  const logEl   = document.getElementById('analyze-log');
  const resultEl = document.getElementById('analyze-result');

  btn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { toast('Enter a job URL first', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Analyzing…';
    logEl.innerHTML = '';
    logEl.classList.remove('hidden');
    resultEl.classList.add('hidden');
    resultEl.innerHTML = '';

    let lastResult = null;

    await streamPost('/api/analyze', { url, save: saveChk.checked }, evt => {
      if (evt.type === 'progress') {
        appendLogEntry(logEl, evt.message, evt.done ? 'done' : 'active');
      } else if (evt.type === 'result') {
        lastResult = evt;
        appendLogEntry(logEl, 'Analysis complete ✓', 'done');
      } else if (evt.type === 'error') {
        appendLogEntry(logEl, evt.message, 'error');
      }
    });

    if (lastResult) {
      resultEl.innerHTML = renderAnalysisHTML(lastResult.data, lastResult.savedTo);
      resultEl.classList.remove('hidden');
      attachExpandHandlers(resultEl);
    }

    btn.disabled = false;
    btn.textContent = 'Analyze';
  });
}

function appendLogEntry(container, message, state = 'active') {
  const icons = { done: '✓', error: '✗', active: '›' };
  const existing = container.querySelector(`.log-entry.active`);
  if (existing) existing.classList.remove('active');

  const div = el('div', `log-entry ${state}`);
  div.innerHTML = `<span class="log-icon">${icons[state] ?? '›'}</span><span>${message}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderAnalysisHTML(analysis, savedTo) {
  const score = analysis.match_score ?? 0;
  const circ  = 2 * Math.PI * 42; // circumference for r=42
  const offset = circ * (1 - score / 100);
  const color  = scoreColor(score);

  const reqHtml  = listItems(analysis.requirements ?? [], false);
  const nthHtml  = listItems(analysis.nice_to_have ?? [], false);

  return `
  <div class="card">
    <div class="score-card">
      <div class="score-circle-wrap">
        <svg viewBox="0 0 110 110">
          <circle class="score-ring-track" cx="55" cy="55" r="42"/>
          <circle class="score-ring-fill"
            cx="55" cy="55" r="42"
            stroke="${color}"
            stroke-dasharray="${circ.toFixed(2)}"
            stroke-dashoffset="${offset.toFixed(2)}"
          />
        </svg>
        <div class="score-circle-value">
          <span class="score-number ${scoreClass(score)}">${score}</span>
          <span class="score-label">/ 100</span>
        </div>
      </div>
      <div class="score-meta">
        ${analysis.title ? `<div class="score-title">${esc(analysis.title)}</div>` : ''}
        <div class="score-summary ${scoreClass(score)}" style="font-size:12px;font-weight:600;margin-bottom:6px">${scoreLabel(score)}</div>
        ${analysis.summary ? `<div class="score-summary">${esc(analysis.summary)}</div>` : ''}
        ${savedTo ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Saved → ${esc(savedTo)}</div>` : ''}
      </div>
    </div>
  </div>

  <div class="two-col">
    <div class="col-card strengths">
      <div class="col-card-title">Strengths</div>
      <div class="pill-list">${pillList(analysis.strengths ?? [], 'strengths')}</div>
    </div>
    <div class="col-card gaps">
      <div class="col-card-title">Gaps</div>
      <div class="pill-list">${pillList(analysis.gaps ?? [], 'gaps')}</div>
    </div>
  </div>

  ${reqHtml ? `
  <div class="expand-section">
    <button class="expand-btn">
      <span class="chevron">›</span> Key Requirements (${analysis.requirements?.length ?? 0})
    </button>
    <div class="expand-body"><div class="pill-list">${reqHtml}</div></div>
  </div>` : ''}

  ${nthHtml ? `
  <div class="expand-section">
    <button class="expand-btn">
      <span class="chevron">›</span> Nice to Have (${analysis.nice_to_have?.length ?? 0})
    </button>
    <div class="expand-body"><div class="pill-list">${nthHtml}</div></div>
  </div>` : ''}`;
}

function pillList(items, type) {
  return items.map(s =>
    `<div class="pill"><span class="pill-dot"></span><span>${esc(s)}</span></div>`
  ).join('');
}

function listItems(items) {
  return items.map(s =>
    `<div class="pill"><span class="pill-dot" style="background:var(--text-muted)"></span><span>${esc(s)}</span></div>`
  ).join('');
}

function attachExpandHandlers(container) {
  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('open');
      btn.nextElementSibling.classList.toggle('open');
    });
  });
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Browse tab ────────────────────────────────────────────────────────────────

function initBrowseTab() {
  const btn       = document.getElementById('browse-btn');
  const urlInput  = document.getElementById('browse-url');
  const infoEl    = document.getElementById('browse-info');
  const filtersEl = document.getElementById('browse-filters');
  const jobsEl    = document.getElementById('browse-jobs');
  const keyword   = document.getElementById('browse-keyword');

  let allJobs = [];

  btn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { toast('Enter a careers page URL', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Loading…';
    jobsEl.innerHTML = `<div class="empty-state"><span class="spinner"></span></div>`;
    infoEl.classList.add('hidden');
    filtersEl.classList.add('hidden');

    const data = await apiPost('/api/jobs', { url });

    btn.disabled = false;
    btn.textContent = 'Load Jobs';

    if (data.error) {
      jobsEl.innerHTML = `<div class="empty-state" style="color:var(--danger)">${esc(data.error)}</div>`;
      return;
    }

    allJobs = data.jobs ?? [];

    if (data.resolvedUrl) {
      infoEl.className = 'card';
      infoEl.style.cssText = 'padding:10px 16px;font-size:12px;color:var(--text-dim);margin-bottom:0';
      infoEl.innerHTML = `Careers page found: <span style="color:var(--text)">${esc(data.resolvedUrl)}</span>`;
      infoEl.classList.remove('hidden');
    }

    if (!allJobs.length) {
      jobsEl.innerHTML = `<div class="empty-state">No jobs found.</div>`;
      return;
    }

    filtersEl.classList.remove('hidden');
    renderJobs(allJobs, jobsEl);
  });

  keyword.addEventListener('input', () => {
    const kw = keyword.value.toLowerCase();
    const filtered = allJobs.filter(j =>
      [j.title, j.location, j.department].join(' ').toLowerCase().includes(kw)
    );
    renderJobs(filtered, jobsEl);
  });
}

function renderJobs(jobs, container) {
  if (!jobs.length) {
    container.innerHTML = `<div class="empty-state">No jobs match the filter.</div>`;
    return;
  }
  container.innerHTML = `<div style="font-size:12px;color:var(--text-dim);margin:12px 0 8px">${jobs.length} job(s)</div>`;
  const grid = el('div', 'job-grid');
  jobs.forEach((job, i) => grid.appendChild(buildJobCard(job, i)));
  container.appendChild(grid);
}

function buildJobCard(job, index) {
  const card = el('div', 'job-card');
  card.dataset.url = job.url;

  const tags = [job.location, job.department].filter(Boolean)
    .map(t => `<span class="tag">${esc(t)}</span>`).join('');

  card.innerHTML = `
    <div class="job-card-header">
      <div>
        <div class="job-card-title">${esc(job.title)}</div>
        ${tags ? `<div class="job-card-tags">${tags}</div>` : ''}
      </div>
    </div>
    <div class="job-card-actions">
      <button class="btn btn-primary btn-sm analyze-job-btn">Analyze</button>
      <button class="btn btn-secondary btn-sm copy-url-btn">Copy URL</button>
      <a class="btn btn-ghost btn-sm" href="${esc(job.url)}" target="_blank" rel="noopener">Open →</a>
    </div>
    <div class="job-card-result hidden"></div>`;

  card.querySelector('.analyze-job-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const resultEl = card.querySelector('.job-card-result');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    const data = await apiPost('/api/analyze-job', { url: job.url });

    btn.disabled = false;
    btn.textContent = 'Re-analyze';

    if (data.error) {
      resultEl.innerHTML = `<div style="color:var(--danger);font-size:12px">${esc(data.error)}</div>`;
      resultEl.classList.remove('hidden');
      return;
    }

    const analysis = data.analysis;
    const score    = analysis.match_score ?? 0;
    const color    = scoreColor(score);

    resultEl.innerHTML = `
      <div class="inline-score">
        <span class="inline-score-num" style="color:${color}">${score}</span>
        <div class="inline-score-bar">
          <div class="inline-score-fill" style="width:${score}%;background:${color}"></div>
        </div>
        <span style="font-size:11px;color:var(--text-dim)">${scoreLabel(score)}</span>
      </div>
      ${analysis.summary ? `<div style="font-size:12px;color:var(--text-dim);line-height:1.6">${esc(analysis.summary)}</div>` : ''}`;
    resultEl.classList.remove('hidden');
  });

  card.querySelector('.copy-url-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(job.url).then(() => toast('URL copied'));
  });

  return card;
}

// ── Cover Letter tab ──────────────────────────────────────────────────────────

function initCoverTab() {
  const btn      = document.getElementById('cover-btn');
  const company  = document.getElementById('cover-company');
  const role     = document.getElementById('cover-role');
  const skills   = document.getElementById('cover-skills');
  const resultEl = document.getElementById('cover-result');

  btn.addEventListener('click', async () => {
    if (!company.value.trim() || !role.value.trim()) {
      toast('Enter a company and role first', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Writing…';
    resultEl.classList.add('hidden');

    const data = await apiPost('/api/cover-letter', {
      company: company.value.trim(),
      role:    role.value.trim(),
      skills:  skills.value.trim(),
    });

    btn.disabled = false;
    btn.textContent = 'Generate Cover Letter';

    if (data.error) { toast(data.error, 'error'); return; }

    resultEl.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="font-size:14px;font-weight:600">${esc(role.value)} — ${esc(company.value)}</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" id="copy-cover-btn">Copy</button>
            <button class="btn btn-secondary btn-sm" id="dl-cover-btn">Download</button>
          </div>
        </div>
        <div class="cover-letter-box">${esc(data.letter)}</div>
      </div>`;
    resultEl.classList.remove('hidden');

    document.getElementById('copy-cover-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(data.letter).then(() => toast('Copied to clipboard'));
    });

    document.getElementById('dl-cover-btn').addEventListener('click', () => {
      const blob = new Blob([data.letter], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cover_letter_${company.value.toLowerCase().replace(/\s+/g, '_')}.txt`;
      a.click();
    });
  });
}

// ── Demo tab ──────────────────────────────────────────────────────────────────

function initDemoTab() {
  const btn      = document.getElementById('demo-btn');
  const statusEl = document.getElementById('demo-status');

  btn.addEventListener('click', async () => {
    const name     = document.getElementById('demo-name').value.trim();
    const email    = document.getElementById('demo-email').value.trim();
    const phone    = document.getElementById('demo-phone').value.trim();
    const linkedin = document.getElementById('demo-linkedin').value.trim();
    const mode     = document.querySelector('input[name="demo-mode"]:checked')?.value ?? 'type';

    if (!name || !email) { toast('Name and email are required', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Opening Chrome…';

    statusEl.innerHTML = `<div style="font-size:12px;color:var(--text-dim)">Opening Chrome on your screen…</div>`;
    statusEl.classList.remove('hidden');

    const data = await apiPost('/api/autofill', { name, email, phone, linkedin, mode });

    btn.disabled = false;
    btn.textContent = 'Run Demo →';

    if (data.error) {
      statusEl.innerHTML = `<div style="font-size:12px;color:var(--danger)">${esc(data.error)}</div>`;
    } else {
      statusEl.innerHTML = `<div style="font-size:12px;color:var(--success)">Demo complete — application submitted!</div>`;
    }
  });
}

// ── History tab ───────────────────────────────────────────────────────────────

async function loadHistory() {
  const container = document.getElementById('history-content');
  container.innerHTML = `<div class="empty-state"><span class="spinner"></span></div>`;

  const history = await apiGet('/api/history');

  if (!history.length) {
    container.innerHTML = `<div class="empty-state">No jobs analyzed yet. Use the Analyze tab to get started.</div>`;
    return;
  }

  const rows = [...history].reverse();

  const actions = el('div', '', `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:12px;color:var(--text-dim)">${rows.length} job(s) analyzed</span>
      <button class="btn btn-ghost btn-sm" id="clear-history-btn" style="color:var(--danger)">Clear history</button>
    </div>`);

  const wrap = el('div', 'table-wrap');
  const table = el('table', '');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Job Title</th>
        <th>Score</th>
        <th>URL</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(e => {
        const score = e.score;
        const color = typeof score === 'number' ? scoreColor(score) : 'var(--text-muted)';
        return `<tr>
          <td>${esc(e.date ?? '')}</td>
          <td style="color:var(--text);font-family:var(--font)">${esc(e.title ?? '')}</td>
          <td><span style="color:${color};font-weight:600">${score ?? '—'}</span></td>
          <td><a href="${esc(e.url ?? '')}" target="_blank" rel="noopener" style="color:var(--primary)">${esc((e.url ?? '').slice(0, 50))}…</a></td>
        </tr>`;
      }).join('')}
    </tbody>`;

  wrap.appendChild(table);
  container.innerHTML = '';
  container.appendChild(actions);
  container.appendChild(wrap);

  document.getElementById('clear-history-btn').addEventListener('click', async () => {
    if (!confirm('Clear all history?')) return;
    await apiDelete('/api/history');
    loadHistory();
  });
}

// ── Observability tab ─────────────────────────────────────────────────────────

async function loadObservability() {
  const container = document.getElementById('observe-content');
  container.innerHTML = `<div class="empty-state"><span class="spinner"></span></div>`;

  const [timeline, reliability, alerts] = await Promise.all([
    apiGet('/api/observability/timeline'),
    apiGet('/api/observability/reliability'),
    apiGet('/api/observability/alerts'),
  ]);

  container.innerHTML = '';

  // Alerts
  if (alerts.length) {
    const title = el('div', 'section-title', `⚠ ${alerts.length} Selector Drift Alert(s)`);
    title.style.color = 'var(--warning)';
    container.appendChild(title);

    const wrap = el('div', 'table-wrap');
    wrap.innerHTML = `<table>
      <thead><tr><th>Severity</th><th>Context</th><th>Selector</th><th>Recent</th><th>Overall</th><th>Drop</th></tr></thead>
      <tbody>${alerts.map(a => `<tr>
        <td class="alert-${a.severity}">${a.severity}</td>
        <td>${esc(a.context)}</td>
        <td>${esc(a.selector)}</td>
        <td>${a.recent_rate}%</td>
        <td>${a.overall_rate}%</td>
        <td class="alert-${a.severity}">${a.drop}pp</td>
      </tr>`).join('')}</tbody>
    </table>`;
    container.appendChild(wrap);
  }

  // Timeline
  container.appendChild(el('div', 'section-title', 'Run Timeline'));
  if (!timeline.length) {
    container.appendChild(el('div', 'empty-state', 'No runs yet. Analyze a job first.'));
  } else {
    const wrap = el('div', 'table-wrap');
    wrap.innerHTML = `<table>
      <thead><tr><th>Time</th><th>Run</th><th>Step</th><th>Tool</th><th>Latency</th><th>Tokens</th><th>Status</th></tr></thead>
      <tbody>${timeline.map(r => `<tr>
        <td>${esc(r.time ?? '')}</td>
        <td>${esc(r.run_id ?? '')}</td>
        <td>${esc(r.step ?? '')}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${esc(r.tool_call ?? '')}</td>
        <td>${r.latency_ms != null ? Math.round(r.latency_ms) + ' ms' : '—'}</td>
        <td>${r.total_tokens ?? '—'}</td>
        <td style="color:${r.error ? 'var(--danger)' : 'var(--success)'}">${r.error ? '✗ err' : '✓'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    container.appendChild(wrap);
  }

  // Selector reliability
  container.appendChild(el('div', 'section-title', 'Selector Reliability'));
  if (!reliability.length) {
    container.appendChild(el('div', 'empty-state', 'No selector data yet.'));
  } else {
    const wrap = el('div', 'table-wrap');
    wrap.innerHTML = `<table>
      <thead><tr><th>Context</th><th>Selector</th><th>Attempts</th><th>Recent %</th><th>Overall %</th><th>Avg ms</th></tr></thead>
      <tbody>${reliability.map(r => `<tr>
        <td>${esc(r.context)}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(r.selector)}</td>
        <td>${r.attempts}</td>
        <td style="color:${r.recent_rate >= 80 ? 'var(--success)' : 'var(--warning)'}">${r.recent_rate}%</td>
        <td>${r.overall_rate}%</td>
        <td>${r.avg_latency_ms ?? '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    container.appendChild(wrap);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initResume();
  initTabs();
  initAnalyzeTab();
  initBrowseTab();
  initCoverTab();
  initDemoTab();
});
