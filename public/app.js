// ── Helpers ───────────────────────────────────────────────────────────────────

const ICON_CHECK = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_X     = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_DOT   = `<svg width="5" height="5" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg>`;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreColor(s) {
  return s >= 70 ? 'var(--success)' : s >= 50 ? 'var(--warning)' : 'var(--danger)';
}

function scoreLabel(s) {
  return s >= 70 ? 'Strong match' : s >= 50 ? 'Partial match' : 'Weak match';
}

function scoreBadgeClass(s) {
  return s >= 70 ? 'strong' : s >= 50 ? 'partial' : 'weak';
}

function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── API ───────────────────────────────────────────────────────────────────────

const api = {
  get:    path       => fetch(path).then(r => r.json()),
  post:   (path, b)  => fetch(path, { method: 'POST',   headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  delete: path       => fetch(path, { method: 'DELETE' }).then(r => r.json()),

  async stream(path, body, onEvent) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) try { onEvent(JSON.parse(line)); } catch {}
      }
    }
  },
};

// ── Resume sidebar ────────────────────────────────────────────────────────────

async function initResume() {
  const input   = document.getElementById('resume-input');
  const badge   = document.getElementById('resume-badge');
  const saveBtn = document.getElementById('save-resume-btn');

  const { content, found } = await api.get('/api/resume');
  input.value = content;
  setResumeBadge(badge, content, found);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const { ok } = await api.post('/api/resume', { content: input.value });
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
    if (ok) { setResumeBadge(badge, input.value, true); toast('Resume saved'); }
    else toast('Save failed', 'error');
  });
}

function setResumeBadge(badge, content, found) {
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
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
      if (tab === 'history') loadHistory();
      if (tab === 'observe') loadObservability();
    });
  });
}

// ── Analysis progress (stepper + skeleton) ────────────────────────────────────

function buildStepperHTML() {
  const steps = [
    { name: 'Load resume',    hint: 'resume.txt' },
    { name: 'Scrape page',    hint: 'Playwright Chrome' },
    { name: 'Analyze',        hint: 'Gemma 4 26B · 30–60 s' },
  ];
  const items = steps.map((s, i) => `
    <div class="step-item">
      <div class="step-dot" id="sd-${i+1}">${i+1}</div>
      <div class="step-name" id="sn-${i+1}">${s.name}</div>
      <div class="step-hint" id="sh-${i+1}">${s.hint}</div>
    </div>
    ${i < 2 ? `<div class="step-connector" id="sc-${i+1}"></div>` : ''}
  `).join('');

  return `
    <div class="analysis-progress">
      <div class="stepper">${items}</div>
      <div class="progress-track"><div class="progress-fill" id="pf"></div></div>
    </div>`;
}

function buildSkeletonHTML() {
  const shimmerLines = (widths, h = 12) =>
    widths.map(w => `<div class="skel-line shimmer" style="width:${w}%;height:${h}px;margin-bottom:7px"></div>`).join('');

  const shimmerItems = count =>
    Array.from({ length: count }, () =>
      `<div class="result-item shimmer" style="height:38px;border-radius:7px;margin-bottom:6px"></div>`
    ).join('');

  return `
    <div class="card" style="margin-bottom:16px">
      <div class="score-card">
        <div class="skel-circle shimmer"></div>
        <div style="flex:1;padding-top:6px">
          ${shimmerLines([55, 30, 85, 70])}
        </div>
      </div>
    </div>
    <div class="two-col">
      <div class="col-card strengths">
        <div class="col-card-header">
          <div class="skel-line shimmer" style="width:50%;height:11px"></div>
        </div>
        ${shimmerItems(3)}
      </div>
      <div class="col-card gaps">
        <div class="col-card-header">
          <div class="skel-line shimmer" style="width:50%;height:11px"></div>
        </div>
        ${shimmerItems(3)}
      </div>
    </div>`;
}

const PROGRESS_MAP = {
  '1a': 5, '1f': 20,
  '2a': 25, '2f': 50,
  '3a': 55, '3f': 100,
};

function applyStepUpdate(step, done, message) {
  const dot  = document.getElementById(`sd-${step}`);
  const name = document.getElementById(`sn-${step}`);
  const hint = document.getElementById(`sh-${step}`);
  const fill = document.getElementById('pf');
  if (!dot) return;

  if (done) {
    dot.className  = 'step-dot done';
    dot.innerHTML  = ICON_CHECK;
    const conn = document.getElementById(`sc-${step}`);
    if (conn) conn.classList.add('done');
    name?.classList.add('done');
    hint?.classList.add('done');
  } else {
    dot.className = 'step-dot active';
    dot.innerHTML = `<span class="spinner-sm"></span>`;
    name?.classList.add('active');
    hint?.classList.add('active');
  }

  if (hint && message) hint.textContent = message;
  if (fill) fill.style.width = (PROGRESS_MAP[`${step}${done ? 'f' : 'a'}`] ?? 0) + '%';
}

// ── Analysis result HTML ──────────────────────────────────────────────────────

function buildResultItems(items, type) {
  if (!items?.length) {
    return `<div class="col-card-empty">None identified</div>`;
  }
  const icon = type === 'strength' ? ICON_CHECK : ICON_X;
  return items.map(s => `
    <div class="result-item ${type}-item">
      <span class="result-item-icon">${icon}</span>
      <span>${esc(s)}</span>
    </div>`).join('');
}

function buildExpandItems(items) {
  return items.map(s => `
    <div class="expand-item">
      <span class="expand-item-dot"></span>
      <span>${esc(s)}</span>
    </div>`).join('');
}

function renderAnalysisHTML(analysis, savedTo) {
  const score = analysis.match_score ?? 0;
  const circ  = 2 * Math.PI * 42;
  const offset = circ * (1 - score / 100);
  const color  = scoreColor(score);

  const strengths = buildResultItems(analysis.strengths, 'strength');
  const gaps      = buildResultItems(analysis.gaps, 'gap');
  const reqs      = analysis.requirements?.length ? buildExpandItems(analysis.requirements) : '';
  const nth       = analysis.nice_to_have?.length  ? buildExpandItems(analysis.nice_to_have)  : '';

  return `
  <div class="result-card">
    <div class="card" style="margin-bottom:16px">
      <div class="score-card">
        <div class="score-circle-wrap">
          <svg viewBox="0 0 110 110">
            <circle class="score-ring-track" cx="55" cy="55" r="42"/>
            <circle class="score-ring-fill"
              cx="55" cy="55" r="42"
              stroke="${color}"
              stroke-dasharray="${circ.toFixed(2)}"
              stroke-dashoffset="${circ.toFixed(2)}"
              id="score-ring-anim"
            />
          </svg>
          <div class="score-circle-value">
            <span class="score-number" style="color:${color}">${score}</span>
            <span class="score-label">/ 100</span>
          </div>
        </div>
        <div class="score-meta">
          ${analysis.title ? `<div class="score-title">${esc(analysis.title)}</div>` : ''}
          <span class="score-badge ${scoreBadgeClass(score)}">${scoreLabel(score)}</span>
          ${analysis.summary ? `<div class="score-summary-text">${esc(analysis.summary)}</div>` : ''}
          ${savedTo ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted)">Saved → ${esc(savedTo)}</div>` : ''}
        </div>
      </div>
    </div>

    <div class="two-col">
      <div class="col-card strengths">
        <div class="col-card-header">
          <span class="col-card-title">Your Strengths</span>
          <span class="col-card-count">${analysis.strengths?.length ?? 0}</span>
        </div>
        <div class="result-items">${strengths}</div>
      </div>
      <div class="col-card gaps">
        <div class="col-card-header">
          <span class="col-card-title">Gaps to Address</span>
          <span class="col-card-count">${analysis.gaps?.length ?? 0}</span>
        </div>
        <div class="result-items">${gaps}</div>
      </div>
    </div>

    ${reqs ? `
    <div class="expand-section">
      <button class="expand-btn">
        <span class="chevron">›</span>
        Key Requirements
        <span style="margin-left:auto;font-size:11px;opacity:0.6">${analysis.requirements.length}</span>
      </button>
      <div class="expand-body">${reqs}</div>
    </div>` : ''}

    ${nth ? `
    <div class="expand-section">
      <button class="expand-btn">
        <span class="chevron">›</span>
        Nice to Have
        <span style="margin-left:auto;font-size:11px;opacity:0.6">${analysis.nice_to_have.length}</span>
      </button>
      <div class="expand-body">${nth}</div>
    </div>` : ''}
  </div>`;
}

function attachResultHandlers(container) {
  // Expand/collapse
  container.querySelectorAll('.expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('open');
      btn.nextElementSibling.classList.toggle('open');
    });
  });

  // Animate score ring
  requestAnimationFrame(() => {
    const ring = container.querySelector('#score-ring-anim');
    if (ring) {
      const circ = parseFloat(ring.getAttribute('stroke-dasharray'));
      const score = parseInt(container.querySelector('.score-number')?.textContent ?? '0');
      const target = circ * (1 - score / 100);
      requestAnimationFrame(() => { ring.style.strokeDashoffset = target; });
    }
  });
}

// ── Analyze tab ───────────────────────────────────────────────────────────────

function initAnalyzeTab() {
  const btn      = document.getElementById('analyze-btn');
  const urlInput = document.getElementById('analyze-url');
  const saveChk  = document.getElementById('analyze-save');
  const logEl    = document.getElementById('analyze-log');
  const resultEl = document.getElementById('analyze-result');

  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

  btn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { toast('Paste a job URL first', 'error'); return; }

    // Reset
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Analyzing…';
    logEl.innerHTML   = buildStepperHTML();
    logEl.classList.remove('hidden');
    resultEl.innerHTML = buildSkeletonHTML();
    resultEl.classList.remove('hidden');

    let lastResult = null;

    await api.stream('/api/analyze', { url, save: saveChk.checked }, evt => {
      if (evt.type === 'progress') {
        applyStepUpdate(evt.step, !!evt.done, evt.message);
      } else if (evt.type === 'result') {
        lastResult = evt;
        applyStepUpdate(3, true, 'Done');
      } else if (evt.type === 'error') {
        resultEl.innerHTML = `
          <div class="card" style="border-color:var(--danger-border)">
            <div style="color:var(--danger);font-size:13px;font-weight:600;margin-bottom:8px">Analysis failed</div>
            <div style="font-size:12px;color:var(--text-dim);font-family:var(--mono);white-space:pre-wrap">${esc(evt.message)}</div>
          </div>`;
      }
    });

    if (lastResult) {
      resultEl.innerHTML = renderAnalysisHTML(lastResult.data, lastResult.savedTo);
      attachResultHandlers(resultEl);
    }

    btn.disabled = false;
    btn.textContent = 'Analyze';
  });
}

// ── Browse tab ────────────────────────────────────────────────────────────────

function initBrowseTab() {
  const btn      = document.getElementById('browse-btn');
  const urlInput = document.getElementById('browse-url');
  const infoEl   = document.getElementById('browse-info');
  const filtersEl = document.getElementById('browse-filters');
  const jobsEl   = document.getElementById('browse-jobs');

  let allJobs = [];

  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });

  btn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { toast('Enter a careers page URL', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Loading…';
    jobsEl.innerHTML = `<div class="empty-state"><span class="spinner-sm"></span><br><br>Fetching job listings…</div>`;
    infoEl.classList.add('hidden');
    filtersEl.classList.add('hidden');

    const data = await api.post('/api/jobs', { url });

    btn.disabled = false;
    btn.textContent = 'Load Jobs';

    if (data.error) {
      jobsEl.innerHTML = `<div class="card" style="border-color:var(--danger-border)"><div style="color:var(--danger);font-size:13px">${esc(data.error)}</div></div>`;
      return;
    }

    allJobs = data.jobs ?? [];

    if (data.resolvedUrl) {
      infoEl.className = 'info-banner';
      infoEl.innerHTML = `Careers page auto-detected: <strong>${esc(data.resolvedUrl)}</strong>`;
      infoEl.classList.remove('hidden');
    }

    if (!allJobs.length) {
      jobsEl.innerHTML = `<div class="empty-state">No jobs found. Try the direct careers page URL.</div>`;
      return;
    }

    filtersEl.classList.remove('hidden');
    renderJobList(allJobs, jobsEl);
  });

  document.getElementById('browse-keyword').addEventListener('input', e => {
    const kw = e.target.value.toLowerCase();
    const filtered = allJobs.filter(j =>
      [j.title, j.location, j.department].join(' ').toLowerCase().includes(kw)
    );
    renderJobList(filtered, jobsEl);
  });
}

function renderJobList(jobs, container) {
  const countEl = document.getElementById('browse-count');
  if (countEl) countEl.textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;

  if (!jobs.length) {
    container.innerHTML = `<div class="empty-state">No jobs match that filter.</div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'job-grid';
  jobs.forEach(job => grid.appendChild(buildJobCard(job)));

  container.innerHTML = '';
  container.appendChild(grid);
}

function buildJobCard(job) {
  const card = document.createElement('div');
  card.className = 'job-card';

  const tags = [job.location, job.department].filter(Boolean)
    .map(t => `<span class="tag">${esc(t)}</span>`).join('');

  card.innerHTML = `
    <div class="job-card-title">${esc(job.title)}</div>
    ${tags ? `<div class="job-card-tags" style="margin-top:5px">${tags}</div>` : ''}
    <div class="job-card-actions">
      <button class="btn btn-primary btn-sm">Analyze</button>
      <button class="btn btn-secondary btn-sm">Copy URL</button>
      <a class="btn btn-ghost btn-sm" href="${esc(job.url)}" target="_blank" rel="noopener">Open →</a>
    </div>
    <div class="job-card-result hidden"></div>`;

  const [analyzeBtn, copyBtn] = card.querySelectorAll('button');
  const resultEl = card.querySelector('.job-card-result');

  analyzeBtn.addEventListener('click', async () => {
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<span class="spinner"></span>';

    const data = await api.post('/api/analyze-job', { url: job.url });
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Re-analyze';

    if (data.error) {
      resultEl.innerHTML = `<div style="color:var(--danger);font-size:12px;font-family:var(--mono)">${esc(data.error)}</div>`;
      resultEl.classList.remove('hidden');
      return;
    }

    const a = data.analysis;
    const s = a.match_score ?? 0;
    const c = scoreColor(s);

    resultEl.innerHTML = `
      <div class="inline-score">
        <span class="inline-score-num" style="color:${c}">${s}</span>
        <div class="inline-score-bar">
          <div class="inline-score-fill" style="width:0%;background:${c}" id="isf-${job.url.length}"></div>
        </div>
        <span class="inline-score-label">${scoreLabel(s)}</span>
      </div>
      ${a.summary ? `<div style="font-size:12px;color:var(--text-dim);line-height:1.65;margin-top:4px">${esc(a.summary)}</div>` : ''}
      ${(a.strengths?.length || a.gaps?.length) ? `
      <div class="two-col" style="margin-top:10px">
        <div class="col-card strengths" style="padding:12px">
          <div class="col-card-header"><span class="col-card-title">Strengths</span><span class="col-card-count">${a.strengths?.length ?? 0}</span></div>
          <div class="result-items">${buildResultItems(a.strengths, 'strength')}</div>
        </div>
        <div class="col-card gaps" style="padding:12px">
          <div class="col-card-header"><span class="col-card-title">Gaps</span><span class="col-card-count">${a.gaps?.length ?? 0}</span></div>
          <div class="result-items">${buildResultItems(a.gaps, 'gap')}</div>
        </div>
      </div>` : ''}`;

    resultEl.classList.remove('hidden');
    // Animate bar
    requestAnimationFrame(() => {
      const bar = resultEl.querySelector('.inline-score-fill');
      if (bar) requestAnimationFrame(() => { bar.style.width = s + '%'; });
    });
  });

  copyBtn.addEventListener('click', () => {
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
      toast('Enter company and role first', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Writing…';
    resultEl.innerHTML = `
      <div class="card" style="min-height:180px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px">
        <span class="spinner-sm"></span>
        <span style="font-size:12px;color:var(--text-muted)">Gemma is writing your cover letter… 20–40 seconds</span>
      </div>`;
    resultEl.classList.remove('hidden');

    const data = await api.post('/api/cover-letter', {
      company: company.value.trim(),
      role:    role.value.trim(),
      skills:  skills.value.trim(),
    });

    btn.disabled = false;
    btn.textContent = 'Generate Cover Letter';

    if (data.error) {
      toast(data.error, 'error');
      resultEl.classList.add('hidden');
      return;
    }

    resultEl.innerHTML = `
      <div class="card result-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:14px;font-weight:600">${esc(role.value)}</div>
            <div style="font-size:12px;color:var(--text-dim);margin-top:2px">${esc(company.value)}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" id="copy-cover-btn">Copy</button>
            <button class="btn btn-secondary btn-sm" id="dl-cover-btn">Download</button>
          </div>
        </div>
        <div class="cover-letter-box">${esc(data.letter)}</div>
      </div>`;

    document.getElementById('copy-cover-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(data.letter).then(() => toast('Copied to clipboard'));
    });
    document.getElementById('dl-cover-btn').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data.letter], { type: 'text/plain' }));
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
    statusEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim)"><span class="spinner-sm"></span> Launching Playwright — watch your screen…</div>`;
    statusEl.classList.remove('hidden');

    const data = await api.post('/api/autofill', { name, email, phone, linkedin, mode });

    btn.disabled = false;
    btn.textContent = 'Run Demo →';

    statusEl.innerHTML = data.error
      ? `<div style="font-size:12px;color:var(--danger)">${esc(data.error)}</div>`
      : `<div style="font-size:12px;color:var(--success);display:flex;align-items:center;gap:6px">${ICON_CHECK} Demo complete — application submitted!</div>`;
  });
}

// ── History tab ───────────────────────────────────────────────────────────────

async function loadHistory() {
  const container = document.getElementById('history-content');
  container.innerHTML = `<div class="empty-state"><span class="spinner-sm"></span></div>`;

  const history = await api.get('/api/history');
  const rows = [...history].reverse();

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">No jobs analyzed yet.<br>Use the Analyze tab to get started.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <span style="font-size:12px;color:var(--text-dim)">${rows.length} job${rows.length !== 1 ? 's' : ''} analyzed</span>
      <button class="btn btn-danger-ghost btn-sm" id="clear-history-btn">Clear history</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Date</th><th>Job Title</th><th>Score</th><th>URL</th></tr>
        </thead>
        <tbody>
          ${rows.map(e => {
            const s = e.score;
            const c = typeof s === 'number' ? scoreColor(s) : 'var(--text-muted)';
            const label = typeof s === 'number' ? scoreLabel(s) : '—';
            return `<tr>
              <td style="white-space:nowrap;font-family:var(--mono)">${esc(e.date ?? '')}</td>
              <td style="color:var(--text);font-family:var(--font);font-size:13px">${esc(e.title ?? '')}</td>
              <td>
                <span style="color:${c};font-weight:700;font-family:var(--mono)">${s ?? '—'}</span>
                <span style="color:var(--text-muted);font-size:11px;margin-left:5px">${label}</span>
              </td>
              <td><a href="${esc(e.url ?? '')}" target="_blank" rel="noopener" style="color:var(--primary);font-size:11px;word-break:break-all">${esc((e.url ?? '').replace(/^https?:\/\//, '').slice(0, 60))}…</a></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;

  document.getElementById('clear-history-btn').addEventListener('click', async () => {
    if (!confirm('Clear all history?')) return;
    await api.delete('/api/history');
    loadHistory();
  });
}

// ── Observability tab ─────────────────────────────────────────────────────────

async function loadObservability() {
  const container = document.getElementById('observe-content');
  container.innerHTML = `<div class="empty-state"><span class="spinner-sm"></span></div>`;

  const [timeline, reliability, alerts] = await Promise.all([
    api.get('/api/observability/timeline'),
    api.get('/api/observability/reliability'),
    api.get('/api/observability/alerts'),
  ]);

  container.innerHTML = '';

  if (alerts.length) {
    const banner = document.createElement('div');
    banner.className = 'alert-banner';
    banner.innerHTML = `⚠ ${alerts.length} selector drift alert${alerts.length !== 1 ? 's' : ''} detected`;
    container.appendChild(banner);

    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `<table>
      <thead><tr><th>Severity</th><th>Context</th><th>Selector</th><th>Recent %</th><th>Overall %</th><th>Drop</th></tr></thead>
      <tbody>${alerts.map(a => `<tr>
        <td style="color:${a.severity === 'high' ? 'var(--danger)' : 'var(--warning)'}">● ${a.severity}</td>
        <td>${esc(a.context)}</td>
        <td style="font-family:var(--mono);font-size:11px">${esc(a.selector)}</td>
        <td>${a.recent_rate}%</td>
        <td>${a.overall_rate}%</td>
        <td style="color:${a.severity === 'high' ? 'var(--danger)' : 'var(--warning)'}">−${a.drop}pp</td>
      </tr>`).join('')}</tbody>
    </table>`;
    container.appendChild(wrap);
  }

  const t1 = document.createElement('div');
  t1.className = 'section-title';
  t1.textContent = 'Run Timeline';
  container.appendChild(t1);

  if (!timeline.length) {
    container.appendChild(Object.assign(document.createElement('div'), { className: 'empty-state', textContent: 'No runs yet. Analyze a job first.' }));
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `<table>
      <thead><tr><th>Time</th><th>Run ID</th><th>Step</th><th>Tool</th><th>Latency</th><th>Tokens</th><th>Status</th></tr></thead>
      <tbody>${timeline.map(r => `<tr>
        <td style="white-space:nowrap">${esc(r.time ?? '')}</td>
        <td style="font-family:var(--mono)">${esc(r.run_id ?? '')}</td>
        <td>${esc(r.step ?? '')}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-size:11px">${esc(r.tool_call ?? '')}</td>
        <td>${r.latency_ms != null ? Math.round(r.latency_ms) + ' ms' : '—'}</td>
        <td>${r.total_tokens ?? '—'}</td>
        <td style="color:${r.error ? 'var(--danger)' : 'var(--success)'}">${r.error ? '✗' : '✓'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    container.appendChild(wrap);
  }

  const t2 = document.createElement('div');
  t2.className = 'section-title';
  t2.textContent = 'Selector Reliability';
  container.appendChild(t2);

  if (!reliability.length) {
    container.appendChild(Object.assign(document.createElement('div'), { className: 'empty-state', textContent: 'No selector data yet.' }));
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = `<table>
      <thead><tr><th>Context</th><th>Selector</th><th>Attempts</th><th>Recent</th><th>Overall</th><th>Avg ms</th></tr></thead>
      <tbody>${reliability.map(r => `<tr>
        <td>${esc(r.context)}</td>
        <td style="font-family:var(--mono);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(r.selector)}</td>
        <td>${r.attempts}</td>
        <td style="color:${r.recent_rate >= 80 ? 'var(--success)' : 'var(--warning)'}">${r.recent_rate}%</td>
        <td>${r.overall_rate}%</td>
        <td>${r.avg_latency_ms ?? '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    container.appendChild(wrap);
  }
}

// ── Resume Builder tab ────────────────────────────────────────────────────────

function initResumeTab() {
  let staged = [];

  const dropZone   = document.getElementById('drop-zone');
  const fileInput  = document.getElementById('resume-file-input');
  const browseBtn  = document.getElementById('browse-files-btn');
  const stagedEl   = document.getElementById('staged-files');
  const actionsEl  = document.getElementById('merge-actions');
  const mergeBtn   = document.getElementById('merge-btn');
  const logEl      = document.getElementById('merge-log');
  const resultEl   = document.getElementById('merge-result');
  const masterText = document.getElementById('master-resume-text');
  const saveBtn    = document.getElementById('save-master-btn');
  const statusEl   = document.getElementById('master-save-status');
  const metaEl     = document.getElementById('master-meta');

  // Load current master into textarea
  api.get('/api/resume').then(({ content, found }) => {
    masterText.value = content;
    setMasterMeta(metaEl, content, found);
    // Also sync sidebar badge
    const badge = document.getElementById('resume-badge');
    if (badge) setResumeBadge(badge, content, found);
  });

  // Save master
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const { ok } = await api.post('/api/resume', { content: masterText.value });
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Changes';
    if (ok) {
      statusEl.textContent = 'Saved';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
      setMasterMeta(metaEl, masterText.value, true);
      const badge = document.getElementById('resume-badge');
      if (badge) setResumeBadge(badge, masterText.value, true);
      toast('Master resume saved');
    } else {
      toast('Save failed', 'error');
    }
  });

  // File handling
  function addFiles(files) {
    const valid = Array.from(files).filter(f => /\.(pdf|docx|txt)$/i.test(f.name));
    if (!valid.length) { toast('Only PDF, DOCX, and TXT files are supported', 'error'); return; }
    staged = [...staged, ...valid].slice(0, 10);
    renderStaged();
  }

  function renderStaged() {
    if (!staged.length) {
      stagedEl.classList.add('hidden');
      actionsEl.classList.add('hidden');
      return;
    }
    stagedEl.innerHTML = staged.map((f, i) => `
      <div class="staged-file">
        <span class="staged-file-icon">${fileTypeIcon(f.name)}</span>
        <span class="staged-file-name">${esc(f.name)}</span>
        <span class="staged-file-size">${fmtSize(f.size)}</span>
        <button class="staged-file-remove" data-i="${i}">✕</button>
      </div>`).join('');
    stagedEl.classList.remove('hidden');
    actionsEl.classList.remove('hidden');

    stagedEl.querySelectorAll('.staged-file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        staged.splice(parseInt(btn.dataset.i), 1);
        renderStaged();
      });
    });
  }

  // Stop propagation so clicking "Browse files" doesn't also trigger the dropZone click handler
  browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

  // Only open file picker when clicking the zone itself, not child buttons
  dropZone.addEventListener('click', e => {
    if (!e.target.closest('button')) fileInput.click();
  });
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });

  const MERGE_BTN_LABEL = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg> Extract &amp; Update Master`;

  // Merge
  mergeBtn.addEventListener('click', async () => {
    if (!staged.length) return;
    mergeBtn.disabled = true;
    mergeBtn.innerHTML = '<span class="spinner"></span> Processing…';
    logEl.innerHTML = '';
    logEl.classList.remove('hidden');
    resultEl.classList.add('hidden');

    const resetBtn = () => { mergeBtn.disabled = false; mergeBtn.innerHTML = MERGE_BTN_LABEL; };

    const form = new FormData();
    staged.forEach(f => form.append('files', f));

    let res;
    try {
      res = await fetch('/api/resume/merge', { method: 'POST', body: form });
    } catch (e) {
      appendLogEntry(logEl, `Network error: ${e.message}`, 'error');
      resetBtn();
      return;
    }

    // If the server returned a plain JSON error (not our NDJSON stream), show it
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('ndjson')) {
      const text = await res.text().catch(() => '');
      let msg = `Server error ${res.status}`;
      try { msg = JSON.parse(text).error ?? msg; } catch {}
      appendLogEntry(logEl, msg, 'error');
      resetBtn();
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let lastResult = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'progress') {
              appendLogEntry(logEl, evt.message, 'active');
            } else if (evt.type === 'result') {
              lastResult = evt;
              appendLogEntry(logEl, 'Done', 'done');
            } else if (evt.type === 'error') {
              appendLogEntry(logEl, evt.message, 'error');
            }
          } catch {}
        }
      }
    } catch (e) {
      appendLogEntry(logEl, `Stream error: ${e.message}`, 'error');
    }

    resetBtn();

    if (lastResult) {
      renderMergeResult(lastResult, resultEl, masterText, metaEl);
      staged = [];
      renderStaged();
    }
  });

  function renderMergeResult(r, resultEl, masterText, metaEl) {
    const { had_master, additions, updated, filenames } = r;
    masterText.value = updated;
    setMasterMeta(metaEl, updated, true);
    const badge = document.getElementById('resume-badge');
    if (badge) setResumeBadge(badge, updated, true);

    let html = '';
    if (!had_master) {
      html = `
        <div class="card result-card" style="border-color:var(--success-border)">
          <div style="color:var(--success);font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px;margin-bottom:6px">
            ${ICON_CHECK} Master created from ${filenames.length} file${filenames.length !== 1 ? 's' : ''}
          </div>
          <div style="font-size:12px;color:var(--text-dim)">${updated.length.toLocaleString()} characters · Click <strong>Save Changes</strong> to save.</div>
        </div>`;
    } else if (!additions) {
      html = `
        <div class="card" style="border-color:var(--success-border)">
          <div style="color:var(--success);font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px">
            ${ICON_CHECK} Already up to date — no new information found in the uploaded file${filenames.length !== 1 ? 's' : ''}.
          </div>
        </div>`;
    } else {
      html = `
        <div class="card result-card">
          <div style="font-weight:600;font-size:13px;color:var(--success);display:flex;align-items:center;gap:8px;margin-bottom:10px">
            ${ICON_CHECK} New information extracted
          </div>
          <div class="additions-box">${esc(additions)}</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:10px">
            Appended to your master resume below. Click <strong>Save Changes</strong> to save.
          </div>
        </div>`;
    }

    resultEl.innerHTML = html;
    resultEl.classList.remove('hidden');
  }
}

function setMasterMeta(el, content, found) {
  if (!el) return;
  const chars = content?.trim().length ?? 0;
  el.textContent = found && chars > 0
    ? `${chars.toLocaleString()} characters · ${content.trim().split('\n').length} lines`
    : '';
}

function fileTypeIcon(name) {
  if (/\.pdf$/i.test(name)) return '📄';
  if (/\.docx$/i.test(name)) return '📝';
  return '📃';
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initResume();
  initTabs();
  initAnalyzeTab();
  initBrowseTab();
  initCoverTab();
  initDemoTab();
  initResumeTab();
});
