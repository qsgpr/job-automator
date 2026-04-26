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

// setResumeBadge kept for Resume Builder tab which has its own master badge
function setResumeBadge(badge, content, found) {
  if (!badge) return;
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
      if (tab === 'feed')    refreshFeedTab();
      if (tab === 'profile') loadProfileTab();
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

// ── Browse / Search tab ───────────────────────────────────────────────────────

function initBrowseTab() {
  const searchInput  = document.getElementById('browse-search');
  const searchBtn    = document.getElementById('browse-search-btn');
  const suggestionsEl = document.getElementById('browse-suggestions');
  const btn          = document.getElementById('browse-btn');
  const urlInput     = document.getElementById('browse-url');
  const infoEl       = document.getElementById('browse-info');
  const filtersEl    = document.getElementById('browse-filters');
  const jobsEl       = document.getElementById('browse-jobs');

  let allJobs = [];

  // ── Company search → suggestions ──────────────────────────────────────────

  async function runSearch() {
    const q = searchInput.value.trim();
    if (!q) { toast('Enter a company name first', 'error'); return; }

    searchBtn.disabled = true;
    searchBtn.innerHTML = '<span class="spinner"></span>';
    suggestionsEl.innerHTML = '';
    suggestionsEl.classList.remove('hidden');
    suggestionsEl.innerHTML = `<div class="suggestion-searching"><span class="spinner-sm"></span> Searching for <strong>${esc(q)}</strong> career pages…</div>`;

    const data = await api.post('/api/search-company', { query: q });

    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';

    if (data.error || !data.results?.length) {
      suggestionsEl.innerHTML = `<div class="suggestion-empty">No results found. Try a different name or paste a URL below.</div>`;
      return;
    }

    const verified   = data.results.filter(r => r.verified);
    const unverified = data.results.filter(r => !r.verified);

    let html = '';
    if (verified.length) {
      html += `<div class="suggestion-group-label">Found (${verified.length})</div>`;
      html += verified.map(r => `
        <button class="suggestion-item verified" data-url="${esc(r.url)}">
          <div class="suggestion-title">${esc(r.title)}</div>
          <div class="suggestion-url">${esc(r.url)}</div>
        </button>`).join('');
    }
    if (unverified.length) {
      html += `<div class="suggestion-group-label" style="margin-top:${verified.length ? 10 : 0}px">Guesses — may not exist</div>`;
      html += unverified.map(r => `
        <button class="suggestion-item" data-url="${esc(r.url)}">
          <div class="suggestion-title">${esc(r.title)}</div>
          <div class="suggestion-url">${esc(r.url)}</div>
        </button>`).join('');
    }
    suggestionsEl.innerHTML = html;

    suggestionsEl.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        urlInput.value = item.dataset.url;
        suggestionsEl.classList.add('hidden');
        loadJobs(item.dataset.url);
      });
    });
  }

  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  searchBtn.addEventListener('click', runSearch);

  // ── Direct URL → load jobs ─────────────────────────────────────────────────

  async function loadJobs(url) {
    if (!url) { toast('Enter a careers page URL', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
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
  }

  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadJobs(urlInput.value.trim()); });
  btn.addEventListener('click', () => loadJobs(urlInput.value.trim()));

  document.getElementById('browse-keyword').addEventListener('input', e => {
    const kw = e.target.value.toLowerCase();
    const filtered = allJobs.filter(j =>
      [j.title, j.location, j.department].join(' ').toLowerCase().includes(kw)
    );
    renderJobList(filtered, jobsEl);
  });

  // ── Analyze role (single job URL) ─────────────────────────────────────────

  const analyzeBtn = document.getElementById('browse-analyze-btn');
  const analyzeLog = document.getElementById('browse-analyze-log');
  const analyzeResult = document.getElementById('browse-analyze-result');

  analyzeBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) { toast('Paste a job URL first', 'error'); return; }

    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing…';
    analyzeLog.innerHTML = buildStepperHTML();
    analyzeLog.classList.remove('hidden');
    analyzeResult.innerHTML = buildSkeletonHTML();
    analyzeResult.classList.remove('hidden');

    // Scroll so progress is visible
    analyzeLog.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    let lastResult = null;

    await api.stream('/api/analyze', { url, userId: activeUserId }, evt => {
      if (evt.type === 'progress') {
        applyStepUpdate(evt.step, !!evt.done, evt.message);
      } else if (evt.type === 'result') {
        lastResult = evt;
        applyStepUpdate(3, true, 'Done');
      } else if (evt.type === 'error') {
        analyzeResult.innerHTML = `
          <div class="card" style="border-color:var(--danger-border)">
            <div style="color:var(--danger);font-size:13px;font-weight:600;margin-bottom:8px">Analysis failed</div>
            <div style="font-size:12px;color:var(--text-dim);font-family:var(--mono);white-space:pre-wrap">${esc(evt.message)}</div>
          </div>`;
      }
    });

    if (lastResult) {
      analyzeResult.innerHTML = renderAnalysisHTML(lastResult.data, lastResult.savedTo);
      attachResultHandlers(analyzeResult);
    }

    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze role';
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

    // Show Apply button once analysis is done
    if (!card.querySelector('.browse-apply-btn')) {
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-primary btn-sm browse-apply-btn';
      applyBtn.textContent = 'Apply →';
      applyBtn.style.marginTop = '10px';
      applyBtn.addEventListener('click', () => startAutoApply(job.url));
      resultEl.appendChild(applyBtn);
    }
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

// ── Admin tab ─────────────────────────────────────────────────────────

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

// ── Profile / user management ─────────────────────────────────────────────────

let activeUserId = null;

async function refreshUserSelect() {
  const select = document.getElementById('user-select');
  const users = await api.get('/api/users');
  select.innerHTML = users.map(u =>
    `<option value="${u.id}" ${u.id === activeUserId ? 'selected' : ''}>${esc(u.name)}</option>`
  ).join('');
  return users;
}

async function setActiveUser(id) {
  activeUserId = Number(id);
  localStorage.setItem('activeUserId', String(id));
  const user = await api.get(`/api/users/${id}`);
  if (!user || user.error) return;

  // If the Profile tab is open, refresh it so it shows the new user's data
  if (document.getElementById('tab-profile')?.classList.contains('active')) {
    loadProfileTab();
  }

  // Update feed tab user info if visible
  const info = document.getElementById('feed-user-info');
  if (info) info.textContent = `Scanning as: ${user.name}`;
}

async function checkOnboarding() {
  const users = await api.get('/api/users');
  const storedId = localStorage.getItem('activeUserId');

  if (!users.length) {
    openOnboardingWizard();
    return;
  }

  const match = storedId && users.find(u => String(u.id) === storedId);
  const target = match || users[0];
  await refreshUserSelect();
  document.getElementById('user-select').value = String(target.id);
  await setActiveUser(target.id);
}

function initProfileSection() {
  const select = document.getElementById('user-select');
  const addBtn = document.getElementById('add-user-btn');

  select.addEventListener('change', () => setActiveUser(select.value));
  addBtn.addEventListener('click', () => openOnboardingWizard());
}

// ── Onboarding wizard ─────────────────────────────────────────────────────────

const WIZARD_STEPS = 7;
let wizardStep = 1;
let wizardData = {};

function openOnboardingWizard() {
  wizardStep = 1;
  wizardData = {
    name: '', email: '', resume: '',
    work_type: 'any', work_type_mode: 'soft',
    exp_level: 'any', exp_level_mode: 'soft',
    location_pref: '', location_pref_mode: 'soft',
    departments: [], departments_mode: 'soft',
    salary_min: null, salary_mode: 'soft',
    // New step 6 fields
    street: '', city: '', state: '', zip: '',
    work_authorized: 'Yes', requires_sponsorship: 'No',
    available_start: 'Immediately',
    // New step 7 fields
    years_experience: '', ts_proficiency: '',
    llm_frameworks: [], additional_info: '',
  };
  document.getElementById('onboarding-modal').classList.remove('hidden');
  renderWizardStep();
}

function closeOnboardingWizard() {
  document.getElementById('onboarding-modal').classList.add('hidden');
}

function renderWizardDots() {
  const el = document.getElementById('wizard-dots');
  el.innerHTML = Array.from({ length: WIZARD_STEPS }, (_, i) => {
    const cls = i + 1 < wizardStep ? 'done' : i + 1 === wizardStep ? 'active' : '';
    return `<div class="wizard-step-dot ${cls}"></div>`;
  }).join('');
}

function modeToggleHTML(key, label) {
  const val = wizardData[key] || 'soft';
  return `
    <div class="mode-label">${label}</div>
    <div class="mode-toggle">
      <button class="mode-btn${val === 'soft' ? ' active' : ''}" data-mode-key="${key}" data-mode-val="soft">Suggestion</button>
      <button class="mode-btn${val === 'hard' ? ' active hard' : ''}" data-mode-key="${key}" data-mode-val="hard">Hard cutoff</button>
    </div>`;
}

function radioGroupHTML(key, options) {
  return `<div class="wizard-radio-group">` +
    options.map(o => `
      <label class="wizard-radio-opt">
        <input type="radio" name="wiz-${key}" value="${o.value}" ${wizardData[key] === o.value ? 'checked' : ''}>
        ${o.label}
      </label>`).join('') +
    `</div>`;
}

const WIZARD_CONTENT = [
  // Step 1 — Welcome
  () => `
    <div class="wizard-title">Welcome! Let's set up your profile.</div>
    <div class="wizard-sub">Your profile tells the Job Feed what to look for.</div>
    <div class="form-group">
      <label class="label">Your name <span style="color:var(--danger)">*</span></label>
      <input id="wiz-name" class="input" value="${esc(wizardData.name)}" placeholder="Carlos Martinez" />
    </div>
    <div class="form-group" style="margin-top:12px">
      <label class="label">Email <span class="label-hint">optional</span></label>
      <input id="wiz-email" class="input" type="email" value="${esc(wizardData.email)}" placeholder="you@example.com" />
    </div>`,

  // Step 2 — Resume
  () => `
    <div class="wizard-title">Your resume</div>
    <div class="wizard-sub">Paste your resume text below. The feed will score every job against it.</div>
    <textarea id="wiz-resume" class="resume-textarea" style="height:200px" placeholder="Paste your resume here…" spellcheck="false">${esc(wizardData.resume)}</textarea>`,

  // Step 3 — Work preferences
  () => `
    <div class="wizard-title">Work preferences</div>
    <div class="wizard-sub">Set filters for work type and experience level.</div>
    <div class="form-group">
      <label class="label">Work type</label>
      ${radioGroupHTML('work_type', [
        { value: 'any', label: 'Any' },
        { value: 'remote', label: 'Remote' },
        { value: 'hybrid', label: 'Hybrid' },
        { value: 'on-site', label: 'On-site' },
      ])}
      ${modeToggleHTML('work_type_mode', 'Filter mode')}
    </div>
    <div class="form-group" style="margin-top:16px">
      <label class="label">Experience level</label>
      ${radioGroupHTML('exp_level', [
        { value: 'any', label: 'Any' },
        { value: 'entry', label: 'Entry' },
        { value: 'mid', label: 'Mid' },
        { value: 'senior', label: 'Senior' },
      ])}
      ${modeToggleHTML('exp_level_mode', 'Filter mode')}
    </div>
    <div class="form-group" style="margin-top:16px">
      <label class="label">Preferred location <span class="label-hint">optional — leave blank for any</span></label>
      <input id="wiz-location" class="input" value="${esc(wizardData.location_pref)}" placeholder="Austin, TX" />
      ${modeToggleHTML('location_pref_mode', 'Filter mode')}
    </div>`,

  // Step 4 — Departments
  () => `
    <div class="wizard-title">Departments of interest</div>
    <div class="wizard-sub">Select the types of roles you want in your feed. Leave all unchecked for any department.</div>
    <div class="dept-grid">
      ${['Engineering','Product','Design','Sales','Marketing','HR','Finance','Operations','Legal','Consulting','Other']
        .map(d => `<label class="dept-check">
          <input type="checkbox" value="${d}" ${wizardData.departments.includes(d) ? 'checked' : ''}> ${d}
        </label>`).join('')}
    </div>
    ${modeToggleHTML('departments_mode', 'Filter mode')}`,

  // Step 5 — Salary
  () => `
    <div class="wizard-title">Salary expectation</div>
    <div class="wizard-sub">Set a minimum salary. Jobs with no posted salary are always shown regardless of this setting.</div>
    <div class="form-group">
      <label class="label">Minimum salary</label>
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <span style="font-size:14px;color:var(--text-dim)">$</span>
        <input id="wiz-salary" class="input" type="number" min="0" step="5"
          value="${wizardData.salary_min ?? ''}" placeholder="80" style="max-width:100px" />
        <span style="font-size:13px;color:var(--text-dim)">k / year</span>
      </div>
    </div>
    ${modeToggleHTML('salary_mode', 'Filter mode')}
    <div style="font-size:12px;color:var(--text-muted);margin-top:12px;line-height:1.6">
      <strong>Suggestion:</strong> jobs below threshold are shown with a warning badge.<br>
      <strong>Hard cutoff:</strong> jobs with a listed salary below threshold are excluded.
    </div>`,

  // Step 6 — Address & Authorization
  () => `
    <div class="wizard-title">Address & Work Authorization</div>
    <div class="wizard-sub">Used to auto-fill application forms so you don't have to type the same answers every time.</div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="label">Street address</label>
      <input id="wiz-street" class="input" value="${esc(wizardData.street)}" placeholder="123 Main St" />
    </div>
    <div class="form-grid" style="margin-bottom:16px">
      <div class="form-group">
        <label class="label">City</label>
        <input id="wiz-city" class="input" value="${esc(wizardData.city)}" placeholder="San Juan" />
      </div>
      <div class="form-group">
        <label class="label">State / Province</label>
        <input id="wiz-state" class="input" value="${esc(wizardData.state)}" placeholder="PR" />
      </div>
      <div class="form-group">
        <label class="label">ZIP / Postal code</label>
        <input id="wiz-zip" class="input" value="${esc(wizardData.zip)}" placeholder="00901" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="label">Are you authorized to work full-time in the US?</label>
      ${radioGroupHTML('work_authorized', [{ value:'Yes', label:'Yes' }, { value:'No', label:'No' }])}
    </div>
    <div class="form-group" style="margin-bottom:12px">
      <label class="label">Do you require visa sponsorship (H-1B, TN, O-1…)?</label>
      ${radioGroupHTML('requires_sponsorship', [{ value:'No', label:'No' }, { value:'Yes', label:'Yes' }])}
    </div>
    <div class="form-group">
      <label class="label">Available start date</label>
      <input id="wiz-available-start" class="input" value="${esc(wizardData.available_start)}" placeholder="Immediately or 2025-09-01" />
    </div>`,

  // Step 7 — Skills & Experience
  () => `
    <div class="wizard-title">Skills & Experience</div>
    <div class="wizard-sub">These answers auto-fill the custom screening questions on most application forms.</div>
    <div class="form-group" style="margin-bottom:16px">
      <label class="label">Years of experience as a Software Engineer</label>
      ${radioGroupHTML('years_experience', [
        { value: 'Less than 1 year', label: '< 1 yr' },
        { value: '1-2 years',        label: '1–2 yrs' },
        { value: '3-5 years',        label: '3–5 yrs' },
        { value: '5-7 years',        label: '5–7 yrs' },
        { value: '7-10 years',       label: '7–10 yrs' },
        { value: '10+ years',        label: '10+ yrs' },
      ])}
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label class="label">TypeScript / JavaScript proficiency</label>
      ${radioGroupHTML('ts_proficiency', [
        { value: 'Beginner – learning the basics',           label: 'Beginner' },
        { value: 'Intermediate – comfortable with TS/JS',   label: 'Intermediate' },
        { value: 'Advanced – strong production experience',  label: 'Advanced' },
        { value: 'Expert – I architect TS systems daily',   label: 'Expert' },
      ])}
    </div>
    <div class="form-group" style="margin-bottom:16px">
      <label class="label">LLM / AI frameworks you've used in production <span class="label-hint">select all that apply</span></label>
      <div class="dept-grid">
        ${['LangChain','LangGraph','LlamaIndex','AutoGen','CrewAI','Haystack','Semantic Kernel',
           'OpenAI SDK','Ollama','Hugging Face','DSPy','Instructor','Other']
          .map(f => `<label class="dept-check">
            <input type="checkbox" class="wiz-framework" value="${f}" ${wizardData.llm_frameworks.includes(f) ? 'checked' : ''}> ${f}
          </label>`).join('')}
      </div>
    </div>
    <div class="form-group">
      <label class="label">Anything else you'd like to share? <span class="label-hint">auto-fills open-ended application fields</span></label>
      <textarea id="wiz-additional-info" class="input" rows="3"
        placeholder="E.g. I'm based in Puerto Rico, open to relocation, currently available full-time…"
        style="resize:vertical">${esc(wizardData.additional_info)}</textarea>
    </div>`,
];

function renderWizardStep() {
  renderWizardDots();
  document.getElementById('wizard-content').innerHTML = WIZARD_CONTENT[wizardStep - 1]();

  const backBtn = document.getElementById('wizard-back-btn');
  const nextBtn = document.getElementById('wizard-next-btn');
  backBtn.style.visibility = wizardStep === 1 ? 'hidden' : 'visible';
  nextBtn.textContent = wizardStep === WIZARD_STEPS ? 'Finish ✓' : 'Next →';

  // Wire mode toggle buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.modeKey;
      const val = btn.dataset.modeVal;
      wizardData[key] = val;
      renderWizardStep();
    });
  });
}

function collectWizardStep() {
  if (wizardStep === 1) {
    wizardData.name  = (document.getElementById('wiz-name')?.value || '').trim();
    wizardData.email = (document.getElementById('wiz-email')?.value || '').trim();
  } else if (wizardStep === 2) {
    wizardData.resume = (document.getElementById('wiz-resume')?.value || '').trim();
  } else if (wizardStep === 3) {
    const wt = document.querySelector('input[name="wiz-work_type"]:checked');
    const el = document.querySelector('input[name="wiz-exp_level"]:checked');
    if (wt) wizardData.work_type = wt.value;
    if (el) wizardData.exp_level = el.value;
    wizardData.location_pref = (document.getElementById('wiz-location')?.value || '').trim();
    // location_pref_mode updated live via mode-btn click handlers
  } else if (wizardStep === 4) {
    wizardData.departments = [...document.querySelectorAll('.dept-check input:checked')].map(cb => cb.value);
    // departments_mode is updated live by the mode-btn click handlers in renderWizardStep
  } else if (wizardStep === 5) {
    const s = document.getElementById('wiz-salary')?.value;
    wizardData.salary_min = s ? Number(s) : null;
  } else if (wizardStep === 6) {
    wizardData.street  = (document.getElementById('wiz-street')?.value  || '').trim();
    wizardData.city    = (document.getElementById('wiz-city')?.value    || '').trim();
    wizardData.state   = (document.getElementById('wiz-state')?.value   || '').trim();
    wizardData.zip     = (document.getElementById('wiz-zip')?.value     || '').trim();
    wizardData.available_start = (document.getElementById('wiz-available-start')?.value || '').trim();
    const wa = document.querySelector('input[name="wiz-work_authorized"]:checked');
    const sp = document.querySelector('input[name="wiz-requires_sponsorship"]:checked');
    if (wa) wizardData.work_authorized      = wa.value;
    if (sp) wizardData.requires_sponsorship = sp.value;
  } else if (wizardStep === 7) {
    const ye = document.querySelector('input[name="wiz-years_experience"]:checked');
    const tp = document.querySelector('input[name="wiz-ts_proficiency"]:checked');
    if (ye) wizardData.years_experience = ye.value;
    if (tp) wizardData.ts_proficiency   = tp.value;
    wizardData.llm_frameworks = [...document.querySelectorAll('.wiz-framework:checked')].map(cb => cb.value);
    wizardData.additional_info = (document.getElementById('wiz-additional-info')?.value || '').trim();
  }
}

async function finishWizardFixed() {
  collectWizardStep();
  if (!wizardData.name) { toast('Name is required', 'error'); return; }

  const nextBtn = document.getElementById('wizard-next-btn');
  nextBtn.disabled = true;
  nextBtn.innerHTML = '<span class="spinner"></span> Saving…';

  try {
    const user = await api.post('/api/users', { name: wizardData.name, email: wizardData.email });
    if (user.error) throw new Error(user.error);

    await fetch(`/api/users/${user.id}/resume`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: wizardData.resume }),
    });
    await fetch(`/api/users/${user.id}/preferences`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_type:      wizardData.work_type,
        work_type_mode: wizardData.work_type_mode,
        departments:      wizardData.departments,
        departments_mode: wizardData.departments_mode,
        salary_min:     wizardData.salary_min,
        salary_mode:    wizardData.salary_mode,
        exp_level:      wizardData.exp_level,
        exp_level_mode: wizardData.exp_level_mode,
        location_pref:      wizardData.location_pref,
        location_pref_mode: wizardData.location_pref_mode,
      }),
    });
    await fetch(`/api/users/${user.id}/contact`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        street: wizardData.street, city: wizardData.city,
        state:  wizardData.state,  zip:  wizardData.zip,
        work_authorized:      wizardData.work_authorized,
        requires_sponsorship: wizardData.requires_sponsorship,
        available_start:      wizardData.available_start,
        years_experience:     wizardData.years_experience,
        ts_proficiency:       wizardData.ts_proficiency,
        llm_frameworks:       wizardData.llm_frameworks,
        additional_info:      wizardData.additional_info,
      }),
    });

    localStorage.setItem('activeUserId', String(user.id));
    await refreshUserSelect();
    await setActiveUser(user.id);
    closeOnboardingWizard();
    toast(`Welcome, ${wizardData.name}!`);
  } catch (e) {
    toast(String(e), 'error');
    nextBtn.disabled = false;
    nextBtn.textContent = 'Finish ✓';
  }
}

function initWizardButtons() {
  document.getElementById('wizard-back-btn').addEventListener('click', () => {
    collectWizardStep();
    wizardStep = Math.max(1, wizardStep - 1);
    renderWizardStep();
  });
  document.getElementById('wizard-next-btn').addEventListener('click', async () => {
    if (wizardStep < WIZARD_STEPS) {
      collectWizardStep();
      wizardStep++;
      renderWizardStep();
    } else {
      await finishWizardFixed();
    }
  });
}

// ── Job Feed tab ──────────────────────────────────────────────────────────────

let feedTabInited = false;
let feedResults   = [];   // { feedJob, fromCache } — accumulated across scans + cache loads
let feedSortBy    = 'score';

function sortedFeedResults() {
  const copy = [...feedResults];
  if (feedSortBy === 'score') {
    copy.sort((a, b) => {
      const sa = a.feedJob.analysis?.match_score ?? -1;
      const sb = b.feedJob.analysis?.match_score ?? -1;
      return sb - sa;
    });
  } else if (feedSortBy === 'recent') {
    // Keep arrival order (index) — most recently appended first
    copy.reverse();
  } else if (feedSortBy === 'title') {
    copy.sort((a, b) => (a.feedJob.job.title ?? '').localeCompare(b.feedJob.job.title ?? ''));
  }
  return copy;
}

function renderFeedResults() {
  const resultsEl  = document.getElementById('feed-results');
  const sortBar    = document.getElementById('feed-sort-bar');
  const countEl    = document.getElementById('feed-result-count');
  if (!resultsEl) return;

  const items = sortedFeedResults();
  if (!items.length) {
    sortBar?.classList.add('hidden');
    return;
  }

  sortBar?.classList.remove('hidden');
  if (countEl) countEl.textContent = `${items.length} job${items.length !== 1 ? 's' : ''}`;

  resultsEl.innerHTML = '';
  for (const { feedJob, fromCache } of items) {
    resultsEl.appendChild(buildFeedJobCard(feedJob, fromCache));
  }
}

// refreshFeedTab is called every time the tab is switched to
async function refreshFeedTab() {
  const userInfo  = document.getElementById('feed-user-info');
  const siteCount = document.getElementById('feed-site-count');
  const resultsEl = document.getElementById('feed-results');

  if (activeUserId) {
    const user = await api.get(`/api/users/${activeUserId}`);
    if (!user?.error) userInfo.textContent = `Scanning as: ${user.name}`;

    // Pre-load cached results so the user sees them immediately
    const cached = await api.get(`/api/feed/cached?userId=${activeUserId}`);
    if (Array.isArray(cached) && cached.length && !resultsEl.dataset.scanActive) {
      feedResults = cached
        .filter(e => e.analysis)
        .map(e => ({
          fromCache: true,
          feedJob: {
            job:           e.job,
            site_id:       e.site_id,
            site_name:     e.site_name ?? '',
            filter_result: e.filter_result,
            warnings:      e.warnings,
            analysis:      e.analysis,
            analyzed:      true,
          },
        }));
      renderFeedResults();
      const count = feedResults.length;
      document.getElementById('feed-summary').classList.remove('hidden');
      document.getElementById('feed-summary').innerHTML = `
        <div class="card" style="border-color:var(--border)">
          <div style="font-size:12px;color:var(--text-dim)">
            ${count} cached result${count !== 1 ? 's' : ''} — click <strong>Start Scan</strong> to refresh
          </div>
        </div>`;
    }
  }

  const sites = await api.get('/api/sites');
  const active = sites.filter(s => s.active);
  siteCount.textContent = active.length
    ? `${active.length} active site${active.length !== 1 ? 's' : ''} configured`
    : 'No active sites yet — add some in the Admin tab.';
}

function initFeedTab() {
  if (feedTabInited) return;
  feedTabInited = true;

  const scanBtn   = document.getElementById('feed-scan-btn');
  const userInfo  = document.getElementById('feed-user-info');
  const siteCount = document.getElementById('feed-site-count');

  async function refreshFeedMeta() {
    if (activeUserId) {
      const user = await api.get(`/api/users/${activeUserId}`);
      if (!user?.error) userInfo.textContent = `Scanning as: ${user.name}`;
    }
    const sites = await api.get('/api/sites');
    const active = sites.filter(s => s.active);
    siteCount.textContent = active.length
      ? `${active.length} active site${active.length !== 1 ? 's' : ''} configured`
      : 'No active sites yet — add some in the Admin tab.';
  }

  refreshFeedMeta();

  scanBtn.addEventListener('click', async () => {
    if (!activeUserId) { toast('Select a profile first', 'error'); return; }
    const sites = await api.get('/api/sites');
    if (!sites.filter(s => s.active).length) {
      toast('Add at least one active site in the Admin tab first', 'error');
      return;
    }
    await startFeedScan(activeUserId);
  });

  // Sort buttons
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      feedSortBy = btn.dataset.sort;
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderFeedResults();
    });
  });
}

async function startFeedScan(userId) {
  const scanBtn    = document.getElementById('feed-scan-btn');
  const progressEl = document.getElementById('feed-progress');
  const fillEl     = document.getElementById('feed-progress-fill');
  const labelEl    = document.getElementById('feed-progress-label');
  const resultsEl  = document.getElementById('feed-results');
  const summaryEl  = document.getElementById('feed-summary');

  scanBtn.disabled = true;
  scanBtn.innerHTML = '<span class="spinner"></span> Scanning…';
  progressEl.classList.remove('hidden');
  summaryEl.classList.add('hidden');
  resultsEl.innerHTML = '';
  resultsEl.dataset.scanActive = '1';
  fillEl.style.width = '0%';
  feedResults = [];   // reset for fresh scan

  let totalSites   = 0;
  let sitesDone    = 0;
  let analyzed     = 0;
  let fromCache    = 0;
  let skipped      = 0;
  let totalRemoved = 0;

  await api.stream('/api/feed/scan', { userId }, evt => {
    if (evt.type === 'scan_start') {
      totalSites = evt.total_sites || 0;
      labelEl.textContent = `Starting scan across ${totalSites} site${totalSites !== 1 ? 's' : ''}…`;
    } else if (evt.type === 'site_start') {
      labelEl.textContent = `[${(evt.site_index ?? 0) + 1}/${totalSites}] Scanning ${evt.site_name}…`;
      fillEl.style.width = `${Math.round(((evt.site_index ?? 0) / totalSites) * 90)}%`;
    } else if (evt.type === 'agent_step') {
      labelEl.textContent = `🤖 ${evt.site_name}: ${evt.message}`;
    } else if (evt.type === 'site_jobs_found') {
      labelEl.textContent = `${evt.site_name}: found ${evt.job_count} jobs`;
    } else if (evt.type === 'job_analyzing') {
      labelEl.textContent = `Analyzing: ${evt.job?.job?.title ?? '…'}`;
    } else if (evt.type === 'job_result') {
      if (evt.from_cache) {
        fromCache++;
        labelEl.textContent = `From cache: ${evt.job?.job?.title ?? '…'}`;
      } else {
        analyzed++;
      }
      feedResults.push({ feedJob: evt.job, fromCache: !!evt.from_cache });
      renderFeedResults();
    } else if (evt.type === 'job_filtered') {
      skipped++;
    } else if (evt.type === 'site_error') {
      const err = document.createElement('div');
      err.className = 'card';
      err.style.borderColor = 'var(--danger-border)';
      err.innerHTML = `<div style="color:var(--danger);font-size:12px">${ICON_X} <strong>${esc(evt.site_name)}</strong>: ${esc(evt.message)}</div>`;
      resultsEl.appendChild(err);
    } else if (evt.type === 'site_done') {
      sitesDone++;
      if (evt.removed?.length) {
        totalRemoved += evt.removed.length;
        const notice = document.createElement('div');
        notice.style.cssText = 'font-size:11px;color:var(--text-muted);padding:6px 2px';
        notice.innerHTML = `${ICON_X} ${evt.removed.length} job${evt.removed.length !== 1 ? 's' : ''} removed from <strong>${esc(evt.site_name)}</strong> (no longer listed): ${evt.removed.map(r => esc(r.title)).join(', ')}`;
        resultsEl.appendChild(notice);
      }
    } else if (evt.type === 'scan_done') {
      fillEl.style.width = '100%';
      labelEl.textContent = evt.message || 'Scan complete';
      setTimeout(() => progressEl.classList.add('hidden'), 2000);
      summaryEl.classList.remove('hidden');
      const removedLine = totalRemoved ? ` · ${totalRemoved} removed` : '';
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--success-border)">
          <div style="font-size:13px;font-weight:600;color:var(--success)">${ICON_CHECK} Scan complete</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:6px">
            ${analyzed} new · ${fromCache} from cache · ${skipped} filtered${removedLine} · ${totalSites} site${totalSites !== 1 ? 's' : ''}
          </div>
        </div>`;
    } else if (evt.type === 'error') {
      labelEl.textContent = `Error: ${evt.message}`;
    }
  });

  delete resultsEl.dataset.scanActive;

  scanBtn.disabled = false;
  scanBtn.textContent = 'Start Scan';
}

function buildFeedJobCard(feedJob, fromCache = false) {
  const { job, site_name, filter_result, warnings, analysis, analyzed } = feedJob;
  const card = document.createElement('div');
  card.className = `feed-job-card${warnings.length ? ' has-warnings' : ''}`;

  const score = analysis?.match_score;
  const scoreHTML = typeof score === 'number' ? `
    <div style="display:flex;align-items:center;gap:8px;margin:10px 0 6px">
      <span style="font-family:var(--mono);font-size:16px;font-weight:700;color:${scoreColor(score)}">${score}</span>
      <div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
        <div style="width:0%;height:100%;background:${scoreColor(score)};border-radius:2px;transition:width 0.6s ease" class="feed-score-bar" data-score="${score}"></div>
      </div>
      <span style="font-size:11px;color:var(--text-dim)">${scoreLabel(score)}</span>
    </div>` : '';

  const warningsHTML = warnings.map(w => `<span class="warn-badge">${esc(w)}</span>`).join('');

  const tags = [job.location, job.department].filter(Boolean)
    .map(t => `<span class="tag">${esc(t)}</span>`).join('');

  card.innerHTML = `
    <div class="feed-site-label">${esc(site_name)}${fromCache ? ' <span class="cache-badge">cached</span>' : ''}</div>
    <div class="job-card-title">${esc(job.title)}</div>
    ${tags ? `<div class="job-card-tags" style="margin-top:4px">${tags}</div>` : ''}
    ${warningsHTML ? `<div style="margin-top:8px">${warningsHTML}</div>` : ''}
    ${scoreHTML}
    ${analysis?.summary ? `<div style="font-size:12px;color:var(--text-dim);line-height:1.65;margin-top:6px">${esc(analysis.summary)}</div>` : ''}
    <div class="job-card-actions">
      ${!analyzed ? `<button class="btn btn-primary btn-sm feed-analyze-btn">Analyze</button>` : ''}
      ${analyzed  ? `<button class="btn btn-primary btn-sm feed-apply-btn">Apply →</button>` : ''}
      <button class="btn btn-secondary btn-sm feed-copy-btn">Copy URL</button>
      <a class="btn btn-ghost btn-sm" href="${esc(job.url)}" target="_blank" rel="noopener">Open →</a>
    </div>`;

  card.querySelector('.feed-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(job.url).then(() => toast('URL copied'));
  });

  card.querySelector('.feed-apply-btn')?.addEventListener('click', () => {
    startAutoApply(job.url);
  });

  card.querySelector('.feed-analyze-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    const data = await api.post('/api/analyze-job', { url: job.url, userId: activeUserId });
    btn.remove();
    if (data.analysis) {
      const s = data.analysis.match_score ?? 0;
      const el = document.createElement('div');
      el.innerHTML = `<div style="font-size:12px;color:${scoreColor(s)};font-weight:700;margin-top:6px">${s}/100 — ${scoreLabel(s)}</div>`;
      card.querySelector('.job-card-actions').before(el);
    } else {
      toast(data.error || 'Analysis failed', 'error');
    }
  });

  // Animate score bar
  requestAnimationFrame(() => {
    card.querySelectorAll('.feed-score-bar').forEach(bar => {
      requestAnimationFrame(() => { bar.style.width = bar.dataset.score + '%'; });
    });
  });

  return card;
}

// ── Sites admin (inside Admin tab) ─────────────────────────────────────

const ATS_OPTIONS = ['', 'agent', 'greenhouse', 'lever', 'ashby', 'workable'];

function atsSelectHTML(id, current) {
  return `<select id="${id}" class="input" style="max-width:120px;padding:5px 8px">
    ${ATS_OPTIONS.map(v => `<option value="${v}" ${current === v ? 'selected' : ''}>${v || '— ATS —'}</option>`).join('')}
  </select>`;
}

async function loadSitesAdmin(container) {
  const sites = await api.get('/api/sites');

  const section = document.createElement('div');
  section.innerHTML = `
    <div class="section-title">Job Sites</div>
    <div class="card" style="margin-bottom:16px">
      <div class="form-row" style="flex-wrap:wrap;gap:8px">
        <input id="site-name-input" class="input" placeholder="Name (e.g. Stripe)" style="max-width:140px" />
        <input id="site-url-input"  class="input" type="url" placeholder="https://stripe.com/jobs" style="flex:1;min-width:180px" />
        ${atsSelectHTML('site-ats-type', '')}
        <input id="site-ats-slug" class="input" placeholder="ATS slug (e.g. stripe)" style="max-width:140px" />
        <button class="btn btn-primary btn-sm" id="add-site-btn">Add</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.6">
        <strong>ATS override</strong> — bypasses the HTML scraper and calls the ATS API directly.
        Set to the platform and the company's slug (e.g. Greenhouse + <code>stripe</code>).
      </div>
    </div>
    <div id="sites-table-wrap"></div>`;

  renderSitesTable(section.querySelector('#sites-table-wrap'), sites);
  container.appendChild(section);

  section.querySelector('#add-site-btn').addEventListener('click', async () => {
    const name     = section.querySelector('#site-name-input').value.trim();
    const url      = section.querySelector('#site-url-input').value.trim();
    const ats_type = section.querySelector('#site-ats-type').value.trim();
    const ats_slug = section.querySelector('#site-ats-slug').value.trim();
    if (!name || !url) { toast('Name and URL are required', 'error'); return; }
    const result = await api.post('/api/sites', { name, url, ats_type, ats_slug });
    if (result.error) { toast(result.error, 'error'); return; }
    section.querySelector('#site-name-input').value = '';
    section.querySelector('#site-url-input').value = '';
    section.querySelector('#site-ats-slug').value = '';
    section.querySelector('#site-ats-type').value = '';
    const newSites = await api.get('/api/sites');
    renderSitesTable(section.querySelector('#sites-table-wrap'), newSites);
    toast('Site added');
  });
}

function renderSitesTable(container, sites) {
  if (!sites.length) {
    container.innerHTML = `<div class="empty-state" style="padding:12px 0">No sites yet. Add one above.</div>`;
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.innerHTML = `<table>
    <thead><tr><th>Name</th><th>URL</th><th>ATS</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${sites.map(s => `<tr data-site-id="${s.id}">
      <td style="font-weight:600;color:var(--text)">${esc(s.name)}</td>
      <td style="font-family:var(--mono);font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        <a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--primary)">${esc(s.url)}</a>
      </td>
      <td style="font-size:12px">
        ${s.ats_type
          ? `<span style="color:var(--primary);font-family:var(--mono)">${esc(s.ats_type)}</span><span style="color:var(--text-muted)">:</span><span style="font-family:var(--mono)">${esc(s.ats_slug)}</span>
             <button class="btn btn-ghost btn-sm site-ats-edit" data-id="${s.id}" data-ats-type="${esc(s.ats_type)}" data-ats-slug="${esc(s.ats_slug)}" style="margin-left:4px;font-size:10px">Edit</button>`
          : `<button class="btn btn-ghost btn-sm site-ats-edit" data-id="${s.id}" data-ats-type="" data-ats-slug="" style="font-size:10px">+ Train</button>`
        }
      </td>
      <td><button class="site-toggle${s.active ? ' active' : ''}" data-id="${s.id}" data-active="${s.active ? 1 : 0}">${s.active ? 'Active' : 'Inactive'}</button></td>
      <td><button class="btn btn-danger-ghost btn-sm site-delete-btn" data-id="${s.id}">Delete</button></td>
    </tr>`).join('')}</tbody>
  </table>`;

  // ATS edit inline
  wrap.querySelectorAll('.site-ats-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.id;
      const cell = btn.closest('td');
      cell.innerHTML = `
        ${atsSelectHTML(`ats-type-${id}`, btn.dataset.atsType)}
        <input id="ats-slug-${id}" class="input" value="${esc(btn.dataset.atsSlug)}" placeholder="company-slug" style="max-width:130px;margin:0 4px" />
        <button class="btn btn-primary btn-sm ats-save" data-id="${id}">Save</button>
        <button class="btn btn-ghost btn-sm ats-cancel" data-id="${id}">✕</button>`;

      cell.querySelector('.ats-save').addEventListener('click', async () => {
        const ats_type = document.getElementById(`ats-type-${id}`).value;
        const ats_slug = document.getElementById(`ats-slug-${id}`).value.trim();
        await fetch(`/api/sites/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ats_type, ats_slug }),
        });
        const newSites = await api.get('/api/sites');
        renderSitesTable(container, newSites);
        toast('ATS config saved');
      });

      cell.querySelector('.ats-cancel').addEventListener('click', async () => {
        const newSites = await api.get('/api/sites');
        renderSitesTable(container, newSites);
      });
    });
  });

  wrap.querySelectorAll('.site-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = Number(btn.dataset.id);
      const active = btn.dataset.active === '1';
      await fetch(`/api/sites/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      });
      const newSites = await api.get('/api/sites');
      renderSitesTable(container, newSites);
    });
  });

  wrap.querySelectorAll('.site-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this site?')) return;
      await fetch(`/api/sites/${btn.dataset.id}`, { method: 'DELETE' });
      const newSites = await api.get('/api/sites');
      renderSitesTable(container, newSites);
    });
  });

  container.innerHTML = '';
  container.appendChild(wrap);
}

// ── Profile tab ───────────────────────────────────────────────────────────────

const WORK_TYPES   = ['any','remote','hybrid','on-site'];
const EXP_LEVELS   = ['any','entry','mid','senior'];
const DEPT_LIST    = ['Engineering','Product','Design','Sales','Marketing','HR','Finance','Operations','Legal','Consulting','Other'];

function buildRadioGroup(containerId, name, options, currentValue) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = options.map(v => `
    <label class="wizard-radio-opt">
      <input type="radio" name="${name}" value="${v}" ${currentValue === v ? 'checked' : ''}>
      ${v.charAt(0).toUpperCase() + v.slice(1)}
    </label>`).join('');
}

function buildModeToggle(containerId, currentMode, dataKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `
    <button class="mode-btn${currentMode !== 'hard' ? ' active' : ''}" data-key="${dataKey}" data-val="soft">Suggestion</button>
    <button class="mode-btn${currentMode === 'hard' ? ' active hard' : ''}" data-key="${dataKey}" data-val="hard">Hard cutoff</button>`;
  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.val;
      container.querySelectorAll('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.val === val);
        b.classList.toggle('hard', b.dataset.val === 'hard' && val === 'hard');
      });
    });
  });
}

function getModeToggleValue(containerId) {
  const btn = document.querySelector(`#${containerId} .mode-btn.active`);
  return btn?.dataset.val || 'soft';
}

function buildDeptGrid(containerId, selectedDepts) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = DEPT_LIST.map(d => `
    <label class="dept-check">
      <input type="checkbox" value="${d}" ${selectedDepts.includes(d) ? 'checked' : ''}> ${d}
    </label>`).join('');
}

async function loadProfileTab() {
  if (!activeUserId) return;
  const user = await api.get(`/api/users/${activeUserId}`);
  if (!user || user.error) return;

  // Contact
  document.getElementById('profile-name').value     = user.name || '';
  document.getElementById('profile-email').value    = user.email || '';
  document.getElementById('profile-phone').value    = user.phone || '';
  document.getElementById('profile-linkedin').value = user.linkedin || '';
  document.getElementById('profile-street').value   = user.street || '';
  document.getElementById('profile-city').value     = user.city   || '';
  document.getElementById('profile-state').value    = user.state  || '';
  document.getElementById('profile-zip').value      = user.zip    || '';

  // Application info
  buildRadioGroup('profile-work-auth',    'pref-work-auth',    ['Yes','No'], user.work_authorized || 'Yes');
  buildRadioGroup('profile-sponsorship',  'pref-sponsorship',  ['No','Yes'], user.requires_sponsorship || 'No');
  document.getElementById('profile-available-start').value = user.available_start || '';
  buildRadioGroup('profile-years-exp', 'pref-years-exp', [
    'Less than 1 year','1-2 years','3-5 years','5-7 years','7-10 years','10+ years',
  ], user.years_experience || '');
  buildRadioGroup('profile-ts-proficiency', 'pref-ts-prof', [
    'Beginner – learning the basics',
    'Intermediate – comfortable with TS/JS',
    'Advanced – strong production experience',
    'Expert – I architect TS systems daily',
  ], user.ts_proficiency || '');

  // LLM frameworks checkboxes
  const fwEl = document.getElementById('profile-llm-frameworks');
  const fwList = ['LangChain','LangGraph','LlamaIndex','AutoGen','CrewAI','Haystack',
    'Semantic Kernel','OpenAI SDK','Ollama','Hugging Face','DSPy','Instructor','Other'];
  if (fwEl) {
    fwEl.innerHTML = fwList.map(f => `<label class="dept-check">
      <input type="checkbox" class="fw-check" value="${esc(f)}" ${(user.llm_frameworks||[]).includes(f) ? 'checked' : ''}> ${esc(f)}
    </label>`).join('');
  }

  document.getElementById('profile-additional-info').value = user.additional_info || '';

  // Resume
  document.getElementById('profile-resume').value = user.resume_text || '';

  // Preferences
  const p = user.preferences;
  buildRadioGroup('profile-work-type',   'pref-work-type',  WORK_TYPES, p.work_type);
  buildModeToggle('profile-work-type-mode', p.work_type_mode, 'work_type_mode');
  buildRadioGroup('profile-exp-level',   'pref-exp-level',  EXP_LEVELS, p.exp_level);
  buildModeToggle('profile-exp-level-mode', p.exp_level_mode, 'exp_level_mode');
  document.getElementById('profile-location').value = p.location_pref || '';
  buildModeToggle('profile-location-mode', p.location_pref_mode || 'soft', 'location_pref_mode');
  buildDeptGrid('profile-departments', p.departments || []);
  buildModeToggle('profile-departments-mode', p.departments_mode || 'soft', 'departments_mode');
  document.getElementById('profile-salary').value = p.salary_min ?? '';
  buildModeToggle('profile-salary-mode', p.salary_mode, 'salary_mode');
}

function initProfileTab() {
  // Save application info
  document.getElementById('profile-save-appinfo-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-appinfo-btn');
    const status = document.getElementById('profile-appinfo-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/users/${activeUserId}/contact`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_authorized:      document.querySelector('input[name="pref-work-auth"]:checked')?.value || '',
          requires_sponsorship: document.querySelector('input[name="pref-sponsorship"]:checked')?.value || '',
          available_start:      document.getElementById('profile-available-start').value.trim(),
          years_experience:     document.querySelector('input[name="pref-years-exp"]:checked')?.value || '',
          ts_proficiency:       document.querySelector('input[name="pref-ts-prof"]:checked')?.value || '',
          llm_frameworks:       [...document.querySelectorAll('.fw-check:checked')].map(cb => cb.value),
          additional_info:      document.getElementById('profile-additional-info').value.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        status.textContent = 'Saved ✓'; status.style.color = 'var(--success)';
        setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
      } else {
        status.textContent = body.error || `Error ${res.status}`; status.style.color = 'var(--danger)';
      }
    } catch (e) { status.textContent = String(e); status.style.color = 'var(--danger)'; }
    btn.disabled = false; btn.textContent = 'Save Application Info';
  });

  // Save contact
  document.getElementById('profile-save-contact-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-contact-btn');
    const status = document.getElementById('profile-contact-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await fetch(`/api/users/${activeUserId}/contact`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:     document.getElementById('profile-name').value.trim(),
          email:    document.getElementById('profile-email').value.trim(),
          phone:    document.getElementById('profile-phone').value.trim(),
          linkedin: document.getElementById('profile-linkedin').value.trim(),
          street:   document.getElementById('profile-street').value.trim(),
          city:     document.getElementById('profile-city').value.trim(),
          state:    document.getElementById('profile-state').value.trim(),
          zip:      document.getElementById('profile-zip').value.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        status.textContent = 'Saved ✓';
        status.style.color = 'var(--success)';
        setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
        await refreshUserSelect();
      } else {
        status.textContent = body.error || `Error ${res.status}`;
        status.style.color = 'var(--danger)';
      }
    } catch (e) {
      status.textContent = String(e);
      status.style.color = 'var(--danger)';
    }
    btn.disabled = false; btn.textContent = 'Save Contact';
  });

  // Save resume
  document.getElementById('profile-save-resume-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-resume-btn');
    const status = document.getElementById('profile-resume-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const content = document.getElementById('profile-resume').value;
      const res  = await fetch(`/api/users/${activeUserId}/resume`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        status.textContent = 'Saved ✓';
        status.style.color = 'var(--success)';
        setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
      } else {
        status.textContent = body.error || `Error ${res.status}`;
        status.style.color = 'var(--danger)';
      }
    } catch (e) {
      status.textContent = String(e);
      status.style.color = 'var(--danger)';
    }
    btn.disabled = false; btn.textContent = 'Save Resume';
  });

  // Save preferences
  document.getElementById('profile-save-prefs-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-prefs-btn');
    const status = document.getElementById('profile-prefs-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const work_type   = document.querySelector('input[name="pref-work-type"]:checked')?.value || 'any';
      const exp_level   = document.querySelector('input[name="pref-exp-level"]:checked')?.value || 'any';
      const departments = [...document.querySelectorAll('#profile-departments input:checked')].map(cb => cb.value);
      const salaryVal   = document.getElementById('profile-salary').value;
      const res = await fetch(`/api/users/${activeUserId}/preferences`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_type,
          work_type_mode: getModeToggleValue('profile-work-type-mode'),
          exp_level,
          exp_level_mode: getModeToggleValue('profile-exp-level-mode'),
          location_pref:      document.getElementById('profile-location').value.trim(),
          location_pref_mode: getModeToggleValue('profile-location-mode'),
          departments,
          departments_mode: getModeToggleValue('profile-departments-mode'),
          salary_min:  salaryVal ? Number(salaryVal) : null,
          salary_mode: getModeToggleValue('profile-salary-mode'),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        status.textContent = 'Saved ✓';
        status.style.color = 'var(--success)';
        setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 2000);
      } else {
        status.textContent = body.error || `Error ${res.status}`;
        status.style.color = 'var(--danger)';
      }
    } catch (e) {
      status.textContent = String(e);
      status.style.color = 'var(--danger)';
    }
    btn.disabled = false; btn.textContent = 'Save Preferences';
  });
}

// ── Auto-apply modal ──────────────────────────────────────────────────────────

function openApplyModal() {
  applyDebugExpanded = false;
  document.getElementById('apply-modal').classList.remove('hidden');
  document.getElementById('apply-progress-list').innerHTML = '';
  document.getElementById('apply-paused-msg').classList.add('hidden');
  document.getElementById('apply-error-msg').classList.add('hidden');
  document.getElementById('apply-field-count').textContent = '';
}

let applyDebugExpanded = false;

function appendApplyStep(icon, text, cls = '') {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--text-dim)';
  if (cls) el.className = cls;
  el.innerHTML = `<span style="flex-shrink:0;margin-top:1px">${icon}</span><span>${esc(text)}</span>`;
  document.getElementById('apply-progress-list').appendChild(el);
  el.scrollIntoView({ block: 'nearest' });
}

function appendApplyDebug(text) {
  // Group debug lines under a collapsible section
  let section = document.getElementById('apply-debug-section');
  if (!section) {
    section = document.createElement('div');
    section.id = 'apply-debug-section';
    section.style.cssText = 'margin-top:8px;border:1px solid var(--border);border-radius:6px;overflow:hidden';
    section.innerHTML = `
      <button id="apply-debug-toggle" style="width:100%;text-align:left;padding:6px 10px;font-size:11px;
        font-weight:600;color:var(--text-muted);background:var(--surface-dim,var(--bg));border:none;cursor:pointer;
        display:flex;justify-content:space-between;align-items:center">
        <span>Debug log</span><span id="apply-debug-chevron">›</span>
      </button>
      <div id="apply-debug-body" style="display:none;padding:8px 10px;font-family:var(--mono);font-size:11px;
        color:var(--text-muted);line-height:1.7;background:var(--bg);white-space:pre-wrap"></div>`;
    document.getElementById('apply-progress-list').appendChild(section);

    document.getElementById('apply-debug-toggle').addEventListener('click', () => {
      applyDebugExpanded = !applyDebugExpanded;
      document.getElementById('apply-debug-body').style.display = applyDebugExpanded ? 'block' : 'none';
      document.getElementById('apply-debug-chevron').textContent = applyDebugExpanded ? '∨' : '›';
    });
  }

  const body = document.getElementById('apply-debug-body');
  body.textContent += text + '\n';
  if (applyDebugExpanded) section.scrollIntoView({ block: 'nearest' });
}

async function startAutoApply(jobUrl) {
  if (!activeUserId) { toast('Select a profile first', 'error'); return; }
  applyDebugExpanded = false;
  openApplyModal();
  appendApplyStep('🔄', 'Starting auto-apply…');

  await api.stream('/api/apply', { userId: activeUserId, jobUrl }, evt => {
    if (evt.type === 'navigating') {
      appendApplyStep('🌐', evt.message);
    } else if (evt.type === 'form_found') {
      appendApplyStep('📋', evt.message || 'Form found');
    } else if (evt.type === 'filling') {
      appendApplyStep('✏️', evt.message || `Filling: ${evt.field || '…'}`);
    } else if (evt.type === 'field_filled') {
      appendApplyStep(ICON_CHECK, `Filled: ${evt.field}`);
      document.getElementById('apply-field-count').textContent =
        `${evt.filled} of ${evt.total || '?'} fields filled`;
    } else if (evt.type === 'upload_skipped') {
      appendApplyStep('⚠', evt.message || `Skipped: ${evt.field}`);
    } else if (evt.type === 'debug') {
      appendApplyDebug(evt.message || '');
    } else if (evt.type === 'paused') {
      const msg = document.getElementById('apply-paused-msg');
      msg.textContent = evt.message || 'Paused — review and submit in the browser';
      msg.classList.remove('hidden');
      appendApplyStep('⏸', 'Paused for your review');
    } else if (evt.type === 'error') {
      const err = document.getElementById('apply-error-msg');
      err.textContent = evt.message || 'An error occurred';
      err.classList.remove('hidden');
      appendApplyStep(ICON_X, evt.message || 'Error');
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initBrowseTab();
  initCoverTab();
  initDemoTab();
  initResumeTab();
  initProfileSection();
  initWizardButtons();
  initFeedTab();
  initProfileTab();
  checkOnboarding().then(() => refreshFeedTab());

  // Apply modal close button
  document.getElementById('apply-close-btn').addEventListener('click', () => {
    document.getElementById('apply-modal').classList.add('hidden');
  });
});

// Patch loadObservability to prepend sites admin
async function loadObservability() {
  const container = document.getElementById('observe-content');
  container.innerHTML = `<div class="empty-state"><span class="spinner-sm"></span></div>`;

  const [timeline, reliability, alerts, inputs] = await Promise.all([
    api.get('/api/observability/timeline'),
    api.get('/api/observability/reliability'),
    api.get('/api/observability/alerts'),
    api.get('/api/observability/inputs'),
  ]);

  container.innerHTML = '';

  // ── Sites admin first ──
  await loadSitesAdmin(container);

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

  // ── JD Inputs ──────────────────────────────────────────────────────────────
  const t3 = document.createElement('div');
  t3.className = 'section-title';
  t3.textContent = 'JD Sent to Gemma';
  container.appendChild(t3);

  if (!inputs.length) {
    container.appendChild(Object.assign(document.createElement('div'), {
      className: 'empty-state',
      textContent: 'No analyses yet. Analyze a job first.',
    }));
  } else {
    for (const entry of inputs) {
      const card = document.createElement('div');
      card.className = 'jd-input-card';
      const score = typeof entry.score === 'number'
        ? `<span class="jd-score" style="color:${scoreColor(entry.score)}">${entry.score}/100</span>` : '';
      card.innerHTML = `
        <div class="jd-input-header">
          <div>
            <div class="jd-input-title">${esc(entry.title || 'Untitled')}</div>
            <div class="jd-input-meta">${esc(entry.time)} · ${entry.jd_length} chars${entry.url ? ' · <a href="' + esc(entry.url) + '" target="_blank" rel="noopener">' + esc(entry.url.replace(/^https?:\/\//, '').slice(0, 60)) + '</a>' : ''}</div>
          </div>
          ${score}
          <button class="btn btn-ghost btn-sm jd-toggle-btn">Show JD ›</button>
        </div>
        <pre class="jd-input-body hidden">${esc(String(entry.jd_sent))}</pre>`;
      const toggleBtn = card.querySelector('.jd-toggle-btn');
      const body = card.querySelector('.jd-input-body');
      toggleBtn.addEventListener('click', () => {
        const hidden = body.classList.toggle('hidden');
        toggleBtn.textContent = hidden ? 'Show JD ›' : 'Hide JD ›';
      });
      container.appendChild(card);
    }
  }
}
