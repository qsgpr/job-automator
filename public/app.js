// ── Supabase auth ─────────────────────────────────────────────────────────────

const SUPABASE_URL  = 'https://kpjjwqarfuanxfgklmtm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtwamp3cWFyZnVhbnhmZ2tsbXRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTc2NTAsImV4cCI6MjA5MTU3MzY1MH0.klZezIOEZwo4lWUmt8dPvU1FLPtkcHuAM8Rs5PbVWOU';
const DEMO_EMAIL = 'demo@notchup.app';
const DEMO_PASSWORD = 'Demo1234!';
const DEMO_AUTH_STORAGE_KEY = 'demoAuth';

if (!window.supabase) {
  console.error('Supabase CDN failed to load. Check network/CSP.');
}
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Global onclick handlers (called directly from HTML attributes) ─────────────

let _loginMode = 'signin';

function toggleLoginMode() {
  _loginMode = _loginMode === 'signin' ? 'signup' : 'signin';
  const btn       = document.getElementById('login-submit-btn');
  const toggleBtn = document.getElementById('login-toggle-btn');
  const toggleTxt = document.getElementById('login-toggle-text');
  if (btn)       btn.textContent       = _loginMode === 'signin' ? 'Sign In' : 'Create Account';
  if (toggleTxt) toggleTxt.textContent = _loginMode === 'signin' ? "Don't have an account?" : 'Already have an account?';
  if (toggleBtn) toggleBtn.textContent = _loginMode === 'signin' ? 'Sign up' : 'Sign in';
  _setLoginError('');
}

function _setLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function _clearDemoAuth() {
  localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
}

async function _activateDemoSession(demoUser) {
  activeUserId = demoUser.id;
  localStorage.setItem('activeUserId', String(demoUser.id));
  localStorage.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(demoUser));
  window._activeUserDbProfile = null;
  updateSidebarUser(demoUser.name || 'Demo User', demoUser.email || DEMO_EMAIL);
  showAppScreen();
  _setDashGreeting(demoUser.name || 'Demo User');
  loadDashboard();
  refreshFeedTab();
  if (window._loadResumeMaster) window._loadResumeMaster();
}

async function _tryDemoFallbackLogin(email, password) {
  const res = await fetch('/api/auth/demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.user) {
    throw new Error(data?.error || 'Demo login failed');
  }
  await _activateDemoSession(data.user);
  return data.user;
}

async function handleLoginSubmit() {
  const email = document.getElementById('login-email')?.value.trim();
  const pw    = document.getElementById('login-password')?.value;
  if (!email || !pw) { _setLoginError('Please enter your email and password.'); return; }

  const btn = document.getElementById('login-submit-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  _setLoginError('');

  try {
    let session;
    if (_loginMode === 'signin') {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pw });
      if (error) throw new Error(error.message);
      session = data.session;
    } else {
      const { data, error } = await supabaseClient.auth.signUp({ email, password: pw });
      if (error) throw new Error(error.message);
      session = data.session;
      if (!session) {
        _setLoginError('Check your email to confirm your account, then sign in.');
        if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
        return;
      }
    }
    if (session) await onSessionReady(session);
  } catch (e) {
    const wantsDemoFallback = _loginMode === 'signin'
      && email.toLowerCase() === DEMO_EMAIL
      && pw === DEMO_PASSWORD;
    if (wantsDemoFallback) {
      try {
        await _tryDemoFallbackLogin(email, pw);
        if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
        return;
      } catch (fallbackErr) {
        _setLoginError(fallbackErr.message || 'Demo login failed');
      }
    } else {
      _setLoginError(e.message || 'Authentication failed');
    }
    if (btn) { btn.disabled = false; btn.textContent = _loginMode === 'signin' ? 'Sign In' : 'Create Account'; }
  }
}

async function handleDemoLogin() {
  const btn = document.getElementById('login-demo-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Loading demo…'; }
  _setLoginError('');
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    if (error) throw new Error(error.message);
    if (data.session) await onSessionReady(data.session);
    else await _tryDemoFallbackLogin(DEMO_EMAIL, DEMO_PASSWORD);
  } catch (e) {
    try {
      await _tryDemoFallbackLogin(DEMO_EMAIL, DEMO_PASSWORD);
    } catch (fallbackErr) {
      _setLoginError('Demo unavailable: ' + (fallbackErr.message || e.message || 'unknown error'));
    }
  }
  if (btn) { btn.disabled = false; btn.innerHTML = '✨ Try Demo'; }
}

// Return the current access token (or null)
async function getAccessToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data.session?.access_token ?? null;
}

// Authenticated fetch — adds Authorization header when a session exists
async function authFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

// Auth actions
async function signIn(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

async function signUp(email, password) {
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

async function signOut() {
  await supabaseClient.auth.signOut();
  _clearDemoAuth();
  activeUserId = null;
  window._activeUserDbProfile = null;
  // Clear all rendered user data so next user starts fresh
  const kanban = document.getElementById('kanban-board');
  if (kanban) kanban.innerHTML = '';
  const feedResults = document.getElementById('feed-results');
  if (feedResults) { feedResults.innerHTML = ''; feedResults.removeAttribute('data-scan-active'); }
  const chatMsgs = document.getElementById('chat-messages');
  if (chatMsgs) { chatMsgs.innerHTML = ''; chatMsgs.removeAttribute('data-loaded'); }
  feedResults = [];
  feedTabInited = false;
  showLoginScreen();
}

async function loginAsDemo() {
  return signIn(DEMO_EMAIL, DEMO_PASSWORD);
}

// Register the Supabase user with the Job Automator backend
// Returns the full response data so callers can check is_new / user info.
async function registerWithBackend(session) {
  const user = session.user;
  const name = user.user_metadata?.full_name
             || user.email?.split('@')[0]
             || 'User';
  try {
    const res  = await authFetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ supabase_user_id: user.id, email: user.email, name }),
    });
    const data = await res.json();
    if (data.job_automator_user_id) {
      activeUserId = data.job_automator_user_id;
    }
    _clearDemoAuth();
    return data; // expose to onSessionReady for onboarding check
  } catch (e) {
    console.error('registerWithBackend failed:', e);
    return null;
  }
}

// ── Login screen logic ────────────────────────────────────────────────────────

let loginMode = 'signin'; // 'signin' | 'signup'

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app').style.display = 'none';
}

function showAppScreen() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').style.display = '';
}

function setLoginError(msg) { _setLoginError(msg); }

function initLoginScreen() {
  // Handlers are now wired via onclick attributes in HTML — nothing to do here.
  const submitBtn  = null;
  const demoBtn    = null;
  const toggleBtn  = null;
  const toggleText = null;
  const emailInput = null;
  const pwInput    = null;
  return; // skip old event-listener wiring

  toggleBtn.addEventListener('click', () => {
    loginMode = loginMode === 'signin' ? 'signup' : 'signin';
    submitBtn.textContent = loginMode === 'signin' ? 'Sign In' : 'Create Account';
    toggleText.textContent = loginMode === 'signin' ? "Don't have an account?" : 'Already have an account?';
    toggleBtn.textContent  = loginMode === 'signin' ? 'Sign up' : 'Sign in';
    setLoginError('');
  });

  async function handleSubmit() {
    const email    = emailInput.value.trim();
    const password = pwInput.value;
    if (!email || !password) { setLoginError('Please enter your email and password.'); return; }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span>';
    setLoginError('');

    try {
      let session;
      if (loginMode === 'signin') {
        const data = await signIn(email, password);
        session = data.session;
      } else {
        const data = await signUp(email, password);
        session = data.session;
        if (!session) {
          // Email confirmation required
          setLoginError('Check your email to confirm your account, then sign in.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create Account';
          return;
        }
      }
      if (session) await onSessionReady(session);
    } catch (e) {
      setLoginError(e.message || 'Authentication failed');
      submitBtn.disabled = false;
      submitBtn.textContent = loginMode === 'signin' ? 'Sign In' : 'Create Account';
    }
  }

  submitBtn.addEventListener('click', handleSubmit);
  pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });

  demoBtn.addEventListener('click', async () => {
    demoBtn.disabled = true;
    demoBtn.innerHTML = '<span class="spinner"></span> Loading demo…';
    setLoginError('');
    try {
      const data = await loginAsDemo();
      if (data.session) await onSessionReady(data.session);
      else setLoginError('Demo login failed. Please try signing in manually.');
    } catch (e) {
      setLoginError(e.message || 'Demo login failed');
    }
    demoBtn.disabled = false;
    demoBtn.innerHTML = 'Try Demo';
  });
}

async function onSessionReady(session) {
  // Register with backend — this sets activeUserId to the correct user
  const regData = await registerWithBackend(session);

  // Show logged-in user in sidebar
  const name  = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '';
  const email = session.user.email ?? '';
  updateSidebarUser(name, email);

  showAppScreen();

  // Persist activeUserId to localStorage so it survives page reloads
  if (activeUserId) localStorage.setItem('activeUserId', String(activeUserId));

  // Start on dashboard — set greeting with user name
  _setDashGreeting(name);

  // Load dashboard data
  loadDashboard();
  if (window._loadResumeMaster) window._loadResumeMaster();

  // Show registration onboarding for brand-new users (no resume yet)
  if (activeUserId) {
    try {
      const userData = await api.get(`/api/users/${activeUserId}`);
      const resumeText = userData?.resume_text || '';
      const needsOnboarding = !resumeText || resumeText.trim().length < 50;
      if (needsOnboarding) {
        // Small delay so the dashboard renders first
        setTimeout(() => showRegistrationOnboarding(name, email), 400);
      }
    } catch (e) {
      // Non-fatal — skip onboarding check on error
      console.warn('Onboarding check failed:', e);
    }
  }
}

function _setDashGreeting(name) {
  const greetEl = document.getElementById('dash-greeting');
  const titleEl = document.getElementById('dash-hero-title');
  const hour = new Date().getHours();
  const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = name ? name.split(' ')[0] : null;
  if (greetEl) greetEl.textContent = first ? `${timeGreet}, ${first}` : timeGreet;
  if (titleEl) titleEl.textContent = 'Your AI Job Search';
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  if (!activeUserId) return;

  // Update stat placeholders immediately
  ['dash-stat-total', 'dash-stat-matches', 'dash-stat-apps'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="spinner-sm" style="vertical-align:middle"></span>';
  });

  try {
    const [cached, apps, sites, resumeData] = await Promise.all([
      api.get(`/api/feed/cached?userId=${activeUserId}`).catch(() => []),
      api.get(`/api/applications?userId=${activeUserId}`).catch(() => []),
      api.get(`/api/sites?userId=${activeUserId}`).catch(() => []),
      api.get(activeUserId ? `/api/resume?userId=${activeUserId}` : '/api/resume').catch(() => ({})),
    ]);

    const cachedArr   = Array.isArray(cached) ? cached : [];
    const appsArr     = Array.isArray(apps)   ? apps   : [];
    const sitesArr    = Array.isArray(sites)  ? sites  : [];

    const total       = cachedArr.length;
    const highMatches = cachedArr.filter(j => (j.match_score ?? 0) >= 70).length;
    const appCount    = appsArr.length;
    const activeSites = sitesArr.filter(s => s.active).length;
    const hasResume   = !!(resumeData?.content?.trim());

    // Update stats
    _animateCount('dash-stat-total',   total);
    _animateCount('dash-stat-matches', highMatches);
    _animateCount('dash-stat-apps',    appCount);

    // Setup checklist
    const needsResume = !hasResume;
    const needsSites  = activeSites === 0;
    const needsScan   = total === 0;
    const showChecklist = needsResume || needsSites || needsScan;
    const checklistEl = document.getElementById('dash-checklist');
    const stepsEl     = document.getElementById('dash-steps');

    if (checklistEl && stepsEl) {
      checklistEl.style.display = showChecklist ? '' : 'none';
      if (showChecklist) {
        const steps = [
          {
            num: 1,
            name: 'Upload your resume',
            hint: 'Used to score every job match',
            done: !needsResume,
            action: !needsResume ? null : { label: 'Go to Resume', tab: 'resume' },
          },
          {
            num: 2,
            name: 'Add job sites',
            hint: 'Tell us where to scan for openings',
            done: !needsSites,
            action: !needsSites ? null : { label: 'Go to Settings', tab: 'observe' },
          },
          {
            num: 3,
            name: 'Run your first scan',
            hint: 'AI scores every job against your profile',
            done: !needsScan,
            action: !needsScan ? null : { label: 'Scan New Jobs', scan: true },
          },
        ];

        stepsEl.innerHTML = steps.map(s => `
          <div class="dash-step${s.done ? ' done' : ''}">
            <div class="dash-step-num">${s.done ? ICON_CHECK : s.num}</div>
            <div class="dash-step-info">
              <div class="dash-step-name">${esc(s.name)}</div>
              <div class="dash-step-hint">${esc(s.hint)}</div>
            </div>
            ${s.action ? `
              <div class="dash-step-action">
                ${s.action.scan
                  ? `<button class="btn btn-primary btn-sm dash-step-scan-btn">Scan New Jobs</button>`
                  : `<button class="btn btn-secondary btn-sm" data-tab="${s.action.tab}">${esc(s.action.label)}</button>`
                }
              </div>` : ''}
          </div>`).join('');

        stepsEl.querySelectorAll('.dash-step-scan-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            document.getElementById('feed-scan-btn')?.click();
          });
        });
      }
    }


  } catch (e) {
    console.error('loadDashboard error:', e);
  }
}

function _animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  if (target === 0) { el.textContent = '0'; return; }
  let cur = 0;
  const step = Math.ceil(target / 20);
  const interval = setInterval(() => {
    cur = Math.min(cur + step, target);
    el.textContent = cur;
    if (cur >= target) clearInterval(interval);
  }, 30);
}

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

function getInitials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

function updateSidebarUser(name, email) {
  const avatarEl = document.getElementById('sidebar-avatar');
  const nameEl   = document.getElementById('sidebar-user-name');
  const emailEl  = document.getElementById('sidebar-user-email');
  if (avatarEl) avatarEl.textContent = getInitials(name || email || '');
  if (nameEl)   nameEl.textContent   = name  || '';
  if (emailEl)  emailEl.textContent  = email || '';
}

// ── API ───────────────────────────────────────────────────────────────────────

const api = {
  get:    path       => authFetch(path).then(r => r.json()),
  post:   (path, b)  => authFetch(path, { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  patch:  (path, b)  => authFetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()),
  delete: path       => authFetch(path, { method: 'DELETE' }).then(r => r.json()),

  async stream(path, body, onEvent, signal) {
    let res;
    try {
      const token = await getAccessToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') return;
      throw e;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      let chunk;
      try { chunk = await reader.read(); } catch { break; }
      const { done, value } = chunk;
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

function switchTab(tab) {
  // Job Feed is merged into Dashboard — redirect any 'feed' navigation
  if (tab === 'feed') tab = 'dashboard';

  const mainEl = document.querySelector('.main');
  mainEl?.classList.toggle('assistant-mode', tab === 'assistant');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  // Sync mobile bottom nav
  document.querySelectorAll('.mobile-nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  // Close sidebar drawer on mobile after navigation
  _mobileCloseSidebar();
  if (tab === 'history')   loadHistory();
  if (tab === 'observe')   loadObservability();
  if (tab === 'profile')   loadProfileTab();
  if (tab === 'board')     loadBoard();
  if (tab === 'assistant') loadChatHistory();
  if (tab === 'dashboard') { loadDashboard(); refreshFeedTab(); }
}

function initTabs() {
  // Primary nav buttons
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Mobile bottom nav buttons
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Mobile hamburger: opens the sidebar drawer
  document.getElementById('mobile-hamburger-btn')?.addEventListener('click', () => {
    _mobileOpenSidebar();
  });

  // Tap overlay to close
  document.getElementById('mobile-sidebar-overlay')?.addEventListener('click', () => {
    _mobileCloseSidebar();
  });

  // Dashboard "View all" button and any other data-tab anchors
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn || btn.classList.contains('nav-btn')) return;
    const tab = btn.dataset.tab;
    if (tab) switchTab(tab);
  });

  // Tools flyout toggle
  const toolsBtn   = document.getElementById('nav-tools-btn');
  const toolsFlyout = document.getElementById('nav-tools-flyout');
  toolsBtn?.addEventListener('click', e => {
    e.stopPropagation();
    toolsFlyout?.classList.toggle('hidden');
  });
  document.addEventListener('click', () => toolsFlyout?.classList.add('hidden'));

  // Flyout items
  document.querySelectorAll('.nav-flyout-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      toolsFlyout?.classList.add('hidden');
      switchTab(item.dataset.tab);
    });
  });
}

// ── Analysis progress (stepper + skeleton) ────────────────────────────────────

function buildStepperHTML() {
  const steps = [
    { name: 'Load resume',    hint: 'resume.txt' },
    { name: 'Scrape page',    hint: 'Playwright Chrome' },
    { name: 'Analyze',        hint: 'AI analysis · 30–60 s' },
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

function _renderCoverLetterResult(company, role, letterText, resultEl) {
  const charCount = letterText.trim().length;
  const card = document.createElement('div');
  card.className = 'cover-preview-card';
  card.innerHTML = `
    <div class="cover-preview-header">
      <div class="cover-preview-meta">
        <div class="cover-preview-role">${esc(role)}</div>
        <div class="cover-preview-company">${esc(company)}</div>
      </div>
      <div class="cover-preview-actions">
        <span class="cover-char-count">${charCount.toLocaleString()} chars</span>
        <button class="btn btn-secondary btn-sm" id="cover-copy-btn-v2">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy
        </button>
        <button class="btn btn-secondary btn-sm" id="cover-dl-btn-v2">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download .txt
        </button>
      </div>
    </div>
    <div class="cover-letter-body" id="cover-letter-body-text"></div>`;
  card.querySelector('#cover-letter-body-text').textContent = letterText;
  resultEl.innerHTML = '';
  resultEl.appendChild(card);
  resultEl.classList.remove('hidden');
  card.querySelector('#cover-copy-btn-v2').addEventListener('click', () => {
    navigator.clipboard.writeText(letterText).then(() => toast('Copied to clipboard'));
  });
  card.querySelector('#cover-dl-btn-v2').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([letterText], { type: 'text/plain' }));
    a.download = `cover_letter_${company.toLowerCase().replace(/\s+/g, '_')}.txt`;
    a.click();
  });
}

async function _generateFullCoverLetter(jobUrl, company, role, resultEl, btn) {
  resultEl.innerHTML = `
    <div class="card" id="cover-progress-card">
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">Writing AI cover letter…</div>
      <div id="cover-progress-log" class="progress-log" style="font-size:12px"></div>
    </div>`;
  resultEl.classList.remove('hidden');

  const logEl = document.getElementById('cover-progress-log');
  const step = (msg, done = false) => {
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = 'progress-line';
    line.innerHTML = `<span style="color:${done ? 'var(--success)' : 'var(--text-dim)'}">${done ? '✓' : '…'}</span> ${esc(msg)}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };

  let letterText = '';
  try {
    const response = await authFetch('/api/letters/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId: activeUserId, jobUrl }),
    });
    if (!response.ok) throw new Error(`Server error ${response.status}`);

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'progress') step(msg.message, !!msg.done);
          else if (msg.type === 'result') letterText = msg.data?.content ?? '';
          else if (msg.type === 'error')  throw new Error(msg.message);
        } catch (e) { if (e.message && !e.message.includes('JSON')) throw e; }
      }
    }

    if (!letterText) throw new Error('No letter received — try again');
    _renderCoverLetterResult(company, role, letterText, resultEl);
  } catch (e) {
    resultEl.innerHTML = `<div class="card" style="color:var(--danger);padding:16px">⚠ ${esc(e.message)}</div>`;
  }
  btn.disabled = false;
  btn.textContent = 'Generate Cover Letter';
}

async function _generateSimpleCoverLetter(company, role, skills, resultEl, btn) {
  resultEl.innerHTML = `
    <div class="card" style="min-height:140px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px">
      <span class="spinner-sm"></span>
      <span style="font-size:12px;color:var(--text-muted)">Writing cover letter… 20–40 s</span>
    </div>`;
  resultEl.classList.remove('hidden');

  try {
    const data = await api.post('/api/cover-letter', { userId: activeUserId, company, role, skills });
    if (data.error) throw new Error(data.error);
    _renderCoverLetterResult(company, role, data.letter, resultEl);
  } catch (e) {
    toast(e.message, 'error');
    resultEl.classList.add('hidden');
  }
  btn.disabled = false;
  btn.textContent = 'Generate Cover Letter';
}

function initCoverTab() {
  const btn      = document.getElementById('cover-btn');
  const company  = document.getElementById('cover-company');
  const role     = document.getElementById('cover-role');
  const skills   = document.getElementById('cover-skills');
  const resultEl = document.getElementById('cover-result');

  // Job picker is initialised here too — no separate patch needed
  initCoverJobPicker();

  btn.addEventListener('click', async () => {
    if (!company.value.trim() || !role.value.trim()) {
      toast('Enter company and role first', 'error');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Writing…';

    const jobUrl = window._coverSelectedJobUrl || null;
    if (jobUrl && activeUserId) {
      await _generateFullCoverLetter(jobUrl, company.value.trim(), role.value.trim(), resultEl, btn);
    } else {
      await _generateSimpleCoverLetter(company.value.trim(), role.value.trim(), skills.value.trim(), resultEl, btn);
    }
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

  const history = await api.get(`/api/history${activeUserId ? '?userId=' + activeUserId : ''}`);
  const rows = [...history].reverse();

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-state-wrap">
        <div class="empty-state-icon">📅</div>
        <div class="empty-state-title">No scan history yet</div>
        <div class="empty-state-sub">Run your first scan to see results here</div>
      </div>`;
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
            let faviconDomain = '';
            try { faviconDomain = new URL(e.url ?? '').hostname; } catch {}
            const faviconSrc = faviconDomain
              ? `https://www.google.com/s2/favicons?domain=${faviconDomain}&sz=32`
              : '';
            const faviconHTML = faviconSrc
              ? `<img class="hist-logo-favicon" src="${esc(faviconSrc)}" alt="" width="20" height="20" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'hist-logo-dot'}))">`
              : `<span class="hist-logo-dot"></span>`;
            return `<tr>
              <td style="white-space:nowrap;font-family:var(--mono)">${esc(e.date ?? '')}</td>
              <td style="color:var(--text);font-family:var(--font);font-size:13px">
                <span class="hist-logo-wrap">${faviconHTML}${esc(e.title ?? '')}</span>
              </td>
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

// ── Board (kanban) ────────────────────────────────────────────────────────────

const BOARD_COLS = [
  { status: 'interested',  label: 'Interested',  color: '#6366F1' },
  { status: 'applied',     label: 'Applied',     color: '#F59E0B' },
  { status: 'interviewing',label: 'Interviewing',color: '#3B82F6' },
  { status: 'offer',       label: 'Offer',       color: '#10B981' },
  { status: 'rejected',    label: 'Rejected',    color: '#EF4444' },
];

// Columns expanded by default when in list / narrow-screen mode
const BOARD_COLS_DEFAULT_OPEN = new Set(['interested', 'applied']);

// ── Board view preference ─────────────────────────────────────────────────────

const BOARD_VIEW_KEY = 'notchup_board_view'; // 'kanban' | 'list'
const _narrowMQ = window.matchMedia('(max-width: 899px)');

function _getBoardViewPref() {
  return localStorage.getItem(BOARD_VIEW_KEY) || 'kanban';
}
function _setBoardViewPref(v) {
  localStorage.setItem(BOARD_VIEW_KEY, v);
}

/**
 * Returns true when the board should be in list mode —
 * either because the screen is narrow (forced) or the user chose list view.
 */
function _isListMode() {
  return _narrowMQ.matches || _getBoardViewPref() === 'list';
}

/**
 * Apply/remove the list-mode class on the board element and sync the
 * toggle button label to reflect the current effective mode.
 */
function _applyBoardViewMode() {
  const board  = document.getElementById('kanban-board');
  const label  = document.getElementById('board-view-toggle-label');
  const btn    = document.getElementById('board-view-toggle');
  if (!board) return;

  const listMode = _isListMode();
  board.classList.toggle('board-responsive-list-mode', listMode);

  if (label) {
    // The button switches to the opposite mode, so label says what you'll get
    label.textContent = listMode ? 'Kanban' : 'List View';
  }
  if (btn) {
    btn.title = listMode ? 'Switch to Kanban view' : 'Switch to List view';
  }
}

/**
 * Toggle collapse on a single column element (list/narrow mode only).
 */
function _toggleColCollapse(colEl) {
  colEl.classList.toggle('board-responsive-collapsed');
}

/**
 * Apply default expand/collapse state to all rendered columns.
 */
function _initCollapseStates(board) {
  board.querySelectorAll('.kanban-col').forEach(colEl => {
    const shouldExpand = BOARD_COLS_DEFAULT_OPEN.has(colEl.dataset.status);
    colEl.classList.toggle('board-responsive-collapsed', !shouldExpand);
  });
}

async function loadBoard() {
  if (!activeUserId) return;
  const apps = await api.get(`/api/applications?userId=${activeUserId}`);
  renderBoard(Array.isArray(apps) ? apps : []);
}

function renderBoard(apps) {
  const board = document.getElementById('kanban-board');
  if (!board) return;
  board.innerHTML = '';

  // Full-board empty state when there are no applications at all
  if (!apps.length) {
    board.innerHTML = `
      <div class="empty-board-wrap">
        <div class="empty-board-icon">📋</div>
        <div class="empty-board-title">No applications tracked yet</div>
        <div class="empty-board-sub">Apply to jobs from the feed to track them here</div>
        <button class="btn btn-primary empty-board-cta" data-tab="feed">Go to Feed</button>
      </div>`;
    _applyBoardViewMode();
    return;
  }

  for (const col of BOARD_COLS) {
    const colApps = apps.filter(a => a.status === col.status);
    const colEl = document.createElement('div');
    colEl.className = 'kanban-col';
    colEl.dataset.status = col.status;

    colEl.innerHTML = `
      <div class="kanban-col-header">
        <span class="kanban-col-dot" style="background:${col.color}"></span>
        <span class="kanban-col-title">${col.label}</span>
        <span class="kanban-col-count" id="col-count-${col.status}">${colApps.length}</span>
        <svg class="board-responsive-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="kanban-cards" id="col-${col.status}"></div>`;

    const cardsEl = colEl.querySelector(`#col-${col.status}`);

    if (!colApps.length) {
      cardsEl.innerHTML = `<div class="kanban-empty">No jobs here yet</div>`;
    } else {
      for (const app of colApps) {
        cardsEl.appendChild(buildKanbanCard(app, col.color));
      }
    }

    // Attach collapse/expand handler — active only in list/narrow mode
    colEl.querySelector('.kanban-col-header').addEventListener('click', () => {
      if (_isListMode()) _toggleColCollapse(colEl);
    });

    board.appendChild(colEl);
  }

  // Apply list-mode class and set initial collapsed states
  _applyBoardViewMode();
  if (_isListMode()) _initCollapseStates(board);
}

// ── Board view toggle button (wide-screen manual switch) ──────────────────────

function initBoardViewToggle() {
  const toggleBtn = document.getElementById('board-view-toggle');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const next = _getBoardViewPref() === 'list' ? 'kanban' : 'list';
    _setBoardViewPref(next);
    _applyBoardViewMode();

    const board = document.getElementById('kanban-board');
    if (board && _isListMode()) _initCollapseStates(board);
  });

  // Re-evaluate when crossing the 899 px breakpoint
  _narrowMQ.addEventListener('change', () => {
    _applyBoardViewMode();
    const board = document.getElementById('kanban-board');
    if (board && _isListMode()) _initCollapseStates(board);
  });
}

function buildKanbanCard(app, colColor) {
  const card = document.createElement('div');
  card.className = 'board-card';
  card.dataset.id = String(app.id);
  if (colColor) card.style.setProperty('--board-card-accent', colColor);

  // Score pill
  const score = app.match_score;
  let scoreClass = '';
  if (score != null) {
    scoreClass = score >= 75 ? 'board-score--green' : score >= 50 ? 'board-score--amber' : 'board-score--red';
  }
  const scorePill = score != null
    ? `<span class="board-score-pill ${scoreClass}">${score}</span>`
    : '';

  // Date formatted relative or short
  let dateStr = '';
  if (app.added_at) {
    const d = new Date(app.added_at);
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays === 0)      dateStr = 'Today';
    else if (diffDays === 1) dateStr = 'Yesterday';
    else if (diffDays < 7)   dateStr = `${diffDays}d ago`;
    else                     dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Favicon + company name from site_name or URL hostname
  let companyName = app.site_name || '';
  let faviconUrl  = '';
  try {
    const host = new URL(app.job_url).hostname;
    faviconUrl  = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
    if (!companyName) companyName = host.replace(/^www\./, '');
  } catch (_) { /* malformed URL */ }

  const displayTitle = app.job_title || 'Untitled role';

  const otherCols = BOARD_COLS.filter(c => c.status !== app.status);
  const moveOptions = otherCols.map(c =>
    `<option value="${c.status}">→ ${c.label}</option>`
  ).join('');

  card.innerHTML = `
    <div class="board-card-header">
      <div class="board-card-company">
        ${faviconUrl ? `<img class="board-card-favicon" src="${esc(faviconUrl)}" alt="" width="16" height="16" loading="lazy" onerror="this.style.display='none'">` : ''}
        <span class="board-card-company-name">${esc(companyName)}</span>
      </div>
      <a class="board-card-link" href="${esc(app.job_url)}" target="_blank" rel="noopener" title="Open job posting">🔗</a>
    </div>
    <div class="board-card-title">${esc(displayTitle)}</div>
    <div class="board-card-footer">
      ${scorePill}
      ${dateStr ? `<span class="board-card-date">${esc(dateStr)}</span>` : ''}
    </div>
    <textarea class="kanban-notes" placeholder="Add notes…" rows="2">${esc(app.notes)}</textarea>
    <div class="kanban-actions">
      <select class="kanban-move-select">
        <option value="">Move to…</option>
        ${moveOptions}
      </select>
      <button class="btn btn-danger-ghost btn-sm kanban-delete-btn" title="Remove">✕</button>
    </div>`;

  // Autosave notes
  const textarea = card.querySelector('.kanban-notes');
  let saveTimer;
  textarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await api.patch(`/api/applications/${app.id}`, { userId: activeUserId, notes: textarea.value });
      app.notes = textarea.value;
    }, 800);
  });

  // Move to another column
  const moveSelect = card.querySelector('.kanban-move-select');
  moveSelect.addEventListener('change', async () => {
    const newStatus = moveSelect.value;
    if (!newStatus) return;
    moveSelect.value = '';
    const updated = await api.patch(`/api/applications/${app.id}`, { userId: activeUserId, status: newStatus });
    if (updated && !updated.error) {
      const oldCardsEl = card.closest('.kanban-cards');
      const newCardsEl = document.getElementById(`col-${newStatus}`);
      if (newCardsEl) {
        newCardsEl.querySelector('.kanban-empty')?.remove();
        app.status = newStatus;
        const newColColor = BOARD_COLS.find(c => c.status === newStatus)?.color;
        const newCard = buildKanbanCard(updated, newColColor);
        newCardsEl.appendChild(newCard);
        card.remove();
        if (oldCardsEl && !oldCardsEl.children.length) {
          oldCardsEl.innerHTML = `<div class="kanban-empty">No jobs here yet</div>`;
        }
        BOARD_COLS.forEach(c => {
          const count = document.querySelectorAll(`#col-${c.status} .board-card`).length;
          const countEl = document.getElementById(`col-count-${c.status}`);
          if (countEl) countEl.textContent = count;
        });
      }
    }
  });

  // Delete
  card.querySelector('.kanban-delete-btn').addEventListener('click', async () => {
    if (!confirm(`Remove "${app.job_title}" from the board?`)) return;
    await api.delete(`/api/applications/${app.id}?userId=${activeUserId}`);
    const cardsEl = card.closest('.kanban-cards');
    card.remove();
    if (cardsEl && !cardsEl.querySelectorAll('.board-card').length) {
      cardsEl.innerHTML = `<div class="kanban-empty">No jobs here yet</div>`;
    }
    const countEl = document.getElementById(`col-count-${app.status}`);
    if (countEl) countEl.textContent = String(Math.max(0, Number(countEl.textContent) - 1));
  });

  return card;
}

// ── Admin tab ─────────────────────────────────────────────────────────

// ── Resume Builder tab ────────────────────────────────────────────────────────

function appendLogEntry(el, msg, state = 'active') {
  if (!el) return;
  const div = document.createElement('div');
  div.className = `log-entry log-${state}`;
  div.textContent = msg;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

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

  // Load master resume — extracted so it can be called after auth too
  function loadResumeMaster() {
    const url = activeUserId ? `/api/resume?userId=${activeUserId}` : '/api/resume';
    api.get(url).then(({ content, found }) => {
      masterText.value = content;
      setMasterMeta(metaEl, content, found);
      const badge = document.getElementById('resume-badge');
      if (badge) setResumeBadge(badge, content, found);
    });
  }
  loadResumeMaster();

  // Expose globally so onSessionReady can trigger a reload
  window._loadResumeMaster = loadResumeMaster;

  // Save master
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    const { ok } = await api.post('/api/resume', { content: masterText.value, userId: activeUserId });
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
    if (activeUserId) form.append('userId', String(activeUserId));

    let res;
    try {
      res = await authFetch('/api/resume/merge', { method: 'POST', body: form });
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
      // Reload from DB to confirm save
      loadResumeMaster();
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
          <div style="font-size:12px;color:var(--text-dim)">${updated.length.toLocaleString()} characters · Saved to your profile automatically.</div>
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
            Appended to your master resume below. Saved to your profile automatically.
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
        placeholder="E.g. Open to remote or hybrid, available immediately, US work authorized…"
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

    await authFetch(`/api/users/${user.id}/resume`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: wizardData.resume }),
    });
    await authFetch(`/api/users/${user.id}/preferences`, {
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
    await authFetch(`/api/users/${user.id}/contact`, {
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

let feedTabInited    = false;
let feedResults      = [];   // { feedJob, fromCache } — accumulated across scans + cache loads
let feedSortBy       = 'score';
let feedFilterText   = '';
let feedScanController = null;  // AbortController for active scan
let feedPage         = 1;
let feedPageSize     = Number(localStorage.getItem('feedPageSize') ?? 20);

function sortedFeedResults() {
  const copy = [...feedResults];
  if (feedSortBy === 'score') {
    copy.sort((a, b) => {
      const sa = a.feedJob.analysis?.match_score ?? -1;
      const sb = b.feedJob.analysis?.match_score ?? -1;
      return sb - sa;
    });
  } else if (feedSortBy === 'recent') {
    copy.reverse();
  } else if (feedSortBy === 'title') {
    copy.sort((a, b) => (a.feedJob.job.title ?? '').localeCompare(b.feedJob.job.title ?? ''));
  }
  return copy;
}

// ── Dynamic Filter Panel ──────────────────────────────────────────────────────

// Persisted filter state in sessionStorage
const DFILTER_KEY = 'notchup_dfilter_state';

// Active selections: { score: Set, company: Set, location: Set, department: Set, level: Set, skill: Set }
let _dfilterState = _dfilterLoadState();

function _dfilterLoadState() {
  try {
    const raw = sessionStorage.getItem(DFILTER_KEY);
    if (!raw) return _dfilterEmptyState();
    const parsed = JSON.parse(raw);
    // Revive plain arrays back into Sets
    const state = {};
    for (const k of ['score', 'company', 'location', 'department', 'level', 'skill']) {
      state[k] = new Set(Array.isArray(parsed[k]) ? parsed[k] : []);
    }
    return state;
  } catch { return _dfilterEmptyState(); }
}

function _dfilterEmptyState() {
  return { score: new Set(), company: new Set(), location: new Set(), department: new Set(), level: new Set(), skill: new Set() };
}

function _dfilterSaveState() {
  try {
    const plain = {};
    for (const k of Object.keys(_dfilterState)) plain[k] = [..._dfilterState[k]];
    sessionStorage.setItem(DFILTER_KEY, JSON.stringify(plain));
  } catch {}
}

function _dfilterTotalActive() {
  return Object.values(_dfilterState).reduce((n, s) => n + s.size, 0);
}

// Score range helper
function _dfilterScoreRange(score) {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'fair';
  return 'low';
}

// Extract job level from title
const _LEVEL_PATTERNS = [
  { key: 'VP',        re: /\bVP\b|\bVice\s+President\b/i },
  { key: 'Director',  re: /\bDirector\b/i },
  { key: 'Manager',   re: /\bManager\b/i },
  { key: 'Principal', re: /\bPrincipal\b/i },
  { key: 'Staff',     re: /\bStaff\b/i },
  { key: 'Lead',      re: /\bLead\b/i },
  { key: 'Senior',    re: /\bSenior\b|\bSr\.?\b/i },
  { key: 'Mid',       re: /\bMid[\s-]?level\b|\bMid\b/i },
  { key: 'Junior',    re: /\bJunior\b|\bJr\.?\b/i },
];

function _dfilterExtractLevel(title) {
  if (!title) return null;
  for (const p of _LEVEL_PATTERNS) {
    if (p.re.test(title)) return p.key;
  }
  return null;
}

// Normalize location to city only
function _dfilterNormalizeLocation(loc) {
  if (!loc) return null;
  // Take the part before the first comma (city)
  const city = loc.split(',')[0].trim();
  if (!city || city.length < 2) return null;
  // Collapse known remote variants
  if (/remote|anywhere|worldwide|distributed/i.test(city)) return 'Remote';
  return city;
}

/**
 * Build filter data from feedResults.
 * Returns { score, company, location, department, level, skill } maps of value → count.
 */
function _dfilterBuildData(results) {
  const score      = { excellent: 0, strong: 0, fair: 0, low: 0 };
  const companyMap = new Map();
  const locationMap= new Map();
  const deptMap    = new Map();
  const levelMap   = new Map();
  const skillMap   = new Map();

  for (const { feedJob } of results) {
    const s = feedJob.analysis?.match_score;
    if (typeof s === 'number') {
      score[_dfilterScoreRange(s)]++;
    }

    const company = (feedJob.site_name || '').trim();
    if (company) companyMap.set(company, (companyMap.get(company) || 0) + 1);

    const loc = _dfilterNormalizeLocation(feedJob.job?.location);
    if (loc) locationMap.set(loc, (locationMap.get(loc) || 0) + 1);

    const dept = (feedJob.job?.department || '').trim();
    if (dept) deptMap.set(dept, (deptMap.get(dept) || 0) + 1);

    const level = _dfilterExtractLevel(feedJob.job?.title);
    if (level) levelMap.set(level, (levelMap.get(level) || 0) + 1);

    const reqs = feedJob.analysis?.requirements || [];
    for (const req of reqs) {
      if (!req || req.length > 60) continue;
      // Keep short tokens that look like skills (no full sentences)
      const clean = req.trim();
      if (clean.split(' ').length > 5) continue;
      skillMap.set(clean, (skillMap.get(clean) || 0) + 1);
    }
  }

  // Sort company by count, keep top 10
  const company = new Map([...companyMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10));
  // Sort location, top 8
  const location = new Map([...locationMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  // All departments
  const department = new Map([...deptMap.entries()].sort((a, b) => b[1] - a[1]));
  // All levels that appear
  const level = new Map([...levelMap.entries()].sort((a, b) => b[1] - a[1]));
  // Top 12 skills
  const skill = new Map([...skillMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));

  return { score, company, location, department, level, skill };
}

/**
 * Test a single feedResult against current _dfilterState.
 * Returns true if the job passes all active dimensions.
 */
function _dfilterMatchesResult({ feedJob }) {
  const state = _dfilterState;

  // Score dimension
  if (state.score.size > 0) {
    const s = feedJob.analysis?.match_score;
    const range = typeof s === 'number' ? _dfilterScoreRange(s) : null;
    if (!range || !state.score.has(range)) return false;
  }

  // Company dimension
  if (state.company.size > 0) {
    const company = (feedJob.site_name || '').trim();
    if (!state.company.has(company)) return false;
  }

  // Location dimension
  if (state.location.size > 0) {
    const loc = _dfilterNormalizeLocation(feedJob.job?.location);
    if (!loc || !state.location.has(loc)) return false;
  }

  // Department dimension
  if (state.department.size > 0) {
    const dept = (feedJob.job?.department || '').trim();
    if (!state.department.has(dept)) return false;
  }

  // Level dimension
  if (state.level.size > 0) {
    const lvl = _dfilterExtractLevel(feedJob.job?.title);
    if (!lvl || !state.level.has(lvl)) return false;
  }

  // Skills dimension (job must have at least one matching skill)
  if (state.skill.size > 0) {
    const reqs = feedJob.analysis?.requirements || [];
    const reqSet = new Set(reqs.map(r => r?.trim()).filter(Boolean));
    const hasMatch = [...state.skill].some(sk => reqSet.has(sk));
    if (!hasMatch) return false;
  }

  return true;
}

/** Rebuild the filter panel DOM from current feedResults. */
function buildDynamicFilters(results) {
  const panel = document.getElementById('dfilter-panel');
  if (!panel) return;

  if (!results || results.length === 0) {
    panel.innerHTML = '';
    panel.classList.add('hidden');
    _updateFilterBadge();
    _renderFilterPills();
    return;
  }

  const data = _dfilterBuildData(results);

  const SCORE_META = [
    { key: 'excellent', label: 'Excellent (90–100)', dotClass: 'dfilter-dot-excellent' },
    { key: 'strong',    label: 'Strong (70–89)',     dotClass: 'dfilter-dot-strong' },
    { key: 'fair',      label: 'Fair (50–69)',       dotClass: 'dfilter-dot-fair' },
    { key: 'low',       label: 'Low (< 50)',         dotClass: 'dfilter-dot-low' },
  ];

  // Build sections config
  const sections = [
    {
      dim: 'score',
      title: 'Match Score',
      chips: SCORE_META
        .filter(m => data.score[m.key] > 0)
        .map(m => ({ value: m.key, label: m.label, count: data.score[m.key], dotClass: m.dotClass })),
    },
    {
      dim: 'company',
      title: 'Company',
      chips: [...data.company.entries()].map(([v, c]) => ({ value: v, label: v, count: c })),
    },
    {
      dim: 'location',
      title: 'Location',
      chips: [...data.location.entries()].map(([v, c]) => ({ value: v, label: v, count: c })),
    },
    {
      dim: 'department',
      title: 'Department',
      chips: [...data.department.entries()].map(([v, c]) => ({ value: v, label: v, count: c })),
    },
    {
      dim: 'level',
      title: 'Job Level',
      chips: [...data.level.entries()].map(([v, c]) => ({ value: v, label: v, count: c })),
    },
    {
      dim: 'skill',
      title: 'Skills',
      chips: [...data.skill.entries()].map(([v, c]) => ({ value: v, label: v, count: c })),
    },
  ].filter(s => s.chips.length > 0);

  panel.innerHTML = '';

  for (const sec of sections) {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'dfilter-section';
    sectionEl.dataset.dim = sec.dim;

    const totalInDim = sec.chips.reduce((n, c) => n + c.count, 0);

    sectionEl.innerHTML = `
      <div class="dfilter-section-header">
        <span class="dfilter-section-title">${esc(sec.title)}</span>
        <span class="dfilter-section-count">${totalInDim}</span>
        <svg class="dfilter-chevron" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="dfilter-section-body"></div>`;

    const body = sectionEl.querySelector('.dfilter-section-body');

    for (const chip of sec.chips) {
      const btn = document.createElement('button');
      btn.className = 'dfilter-chip' + (_dfilterState[sec.dim].has(chip.value) ? ' active' : '');
      btn.dataset.dim   = sec.dim;
      btn.dataset.value = chip.value;
      btn.innerHTML = `${chip.dotClass ? `<span class="dfilter-chip-dot ${esc(chip.dotClass)}"></span>` : ''}
        <span class="dfilter-chip-label">${esc(chip.label)}</span>
        <span class="dfilter-chip-num">${chip.count}</span>`;
      btn.addEventListener('click', () => _dfilterToggle(sec.dim, chip.value));
      body.appendChild(btn);
    }

    // Simple toggle — no animation, no max-height, just show/hide
    sectionEl.querySelector('.dfilter-section-header').addEventListener('click', () => {
      sectionEl.classList.toggle('collapsed');
    });

    // Start fully expanded — no inline styles needed
    panel.appendChild(sectionEl);
  }

  _updateFilterBadge();
  _renderFilterPills();
}

/** Toggle a filter value and re-apply. */
function _dfilterToggle(dim, value) {
  const set = _dfilterState[dim];
  if (set.has(value)) { set.delete(value); } else { set.add(value); }
  _dfilterSaveState();
  _updateFilterBadge();
  _renderFilterPills();
  _dfilterSyncChipActive();
  _dfilterUpdateAdaptiveCounts(); // ← update other dimensions' counts
  applyFeedFilter();
}

/** Sync the .active class on chips after a toggle. */
function _dfilterSyncChipActive() {
  document.querySelectorAll('#dfilter-panel .dfilter-chip').forEach(btn => {
    const active = _dfilterState[btn.dataset.dim]?.has(btn.dataset.value);
    btn.classList.toggle('active', !!active);
  });
}

/**
 * Adaptive faceted counts: for each dimension, recount using results that
 * pass ALL other active dimensions (ignoring the dimension itself).
 * Chips with 0 matching jobs are dimmed; counts update live.
 */
function _dfilterUpdateAdaptiveCounts() {
  const dims = ['score','company','location','department','level','skill'];

  dims.forEach(targetDim => {
    // Results that match every dimension EXCEPT targetDim
    const base = feedResults.filter(r => {
      const { feedJob } = r;
      for (const d of dims) {
        if (d === targetDim) continue;
        if (_dfilterState[d].size === 0) continue;
        // Must match this dimension
        if (!_dfilterMatchesDim(feedJob, d)) return false;
      }
      return true;
    });

    // Count per chip value within targetDim on that base set
    const counts = new Map();
    for (const { feedJob } of base) {
      const vals = _dfilterGetDimValues(feedJob, targetDim);
      for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
    }

    // Update chip labels + dim/available state
    document.querySelectorAll(`#dfilter-panel .dfilter-chip[data-dim="${targetDim}"]`).forEach(btn => {
      const v   = btn.dataset.value;
      const n   = counts.get(v) || 0;
      const numEl = btn.querySelector('.dfilter-chip-num');
      if (numEl) numEl.textContent = n;
      btn.classList.toggle('dfilter-chip-zero', n === 0 && !_dfilterState[targetDim].has(v));
    });
  });
}

/** Get the dimension value(s) for a single job — mirrors _dfilterBuildData logic */
function _dfilterGetDimValues(feedJob, dim) {
  switch (dim) {
    case 'score': {
      const s = feedJob.analysis?.match_score;
      return typeof s === 'number' ? [_dfilterScoreRange(s)] : [];
    }
    case 'company':    return feedJob.site_name ? [feedJob.site_name.trim()] : [];
    case 'location':   { const l = _dfilterNormalizeLocation(feedJob.job?.location); return l ? [l] : []; }
    case 'department': return feedJob.job?.department ? [feedJob.job.department.trim()] : [];
    case 'level':      { const lv = _dfilterExtractLevel(feedJob.job?.title); return lv ? [lv] : []; }
    case 'skill':      return (feedJob.analysis?.requirements || []).filter(r => r && r.split(' ').length <= 5);
    default: return [];
  }
}

/** Check if a job matches a single dimension's active filters */
function _dfilterMatchesDim(feedJob, dim) {
  const active = _dfilterState[dim];
  if (!active || active.size === 0) return true;
  const vals = _dfilterGetDimValues(feedJob, dim);
  return vals.some(v => active.has(v));
}

/** Update the Filters button badge. */
function _updateFilterBadge() {
  const n = _dfilterTotalActive();
  const badge = document.getElementById('dfilter-badge');
  const clearBtn = document.getElementById('dfilter-clear-btn');
  if (badge) {
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  }
  if (clearBtn) clearBtn.classList.toggle('hidden', n === 0);
}

/** Render active filter pills above the feed. */
function _renderFilterPills() {
  const row = document.getElementById('dfilter-pills-row');
  if (!row) return;
  row.innerHTML = '';
  const total = _dfilterTotalActive();
  if (total === 0) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');

  const DIM_LABELS = {
    score: 'Score', company: 'Company', location: 'Location',
    department: 'Dept', level: 'Level', skill: 'Skill',
  };

  for (const [dim, set] of Object.entries(_dfilterState)) {
    for (const value of set) {
      const pill = document.createElement('span');
      pill.className = 'dfilter-pill';
      pill.innerHTML = `<span>${esc(DIM_LABELS[dim] || dim)}: ${esc(value)}</span>
        <button class="dfilter-pill-remove" title="Remove filter" aria-label="Remove ${esc(value)} filter">&times;</button>`;
      pill.querySelector('.dfilter-pill-remove').addEventListener('click', () => _dfilterToggle(dim, value));
      row.appendChild(pill);
    }
  }
}

/** Clear all dynamic filters. */
function _dfilterClearAll() {
  _dfilterState = _dfilterEmptyState();
  _dfilterSaveState();
  _updateFilterBadge();
  _renderFilterPills();
  _dfilterSyncChipActive();
  applyFeedFilter();
}

/** Initialize Filters button + drawer behavior. Called from initFeedTab. */
function _initDynamicFilterPanel() {
  const openBtn   = document.getElementById('dfilter-open-btn');
  const panel     = document.getElementById('dfilter-panel');
  const backdrop  = document.getElementById('dfilter-backdrop');
  const clearBtn  = document.getElementById('dfilter-clear-btn');

  if (!openBtn || !panel) return;

  openBtn.addEventListener('click', () => {
    const isHidden = panel.classList.contains('hidden');
    if (isHidden) {
      panel.classList.remove('hidden');
      // Rebuild filters NOW that the panel is visible — grid can calculate widths
      buildDynamicFilters(feedResults);
      requestAnimationFrame(() => panel.classList.add('dfilter-panel-open'));
      if (backdrop) backdrop.classList.remove('hidden');
    } else {
      panel.classList.remove('dfilter-panel-open');
      backdrop?.classList.add('hidden');
      setTimeout(() => panel.classList.add('hidden'), 280);
    }
  });

  backdrop?.addEventListener('click', () => {
    panel.classList.remove('dfilter-panel-open');
    backdrop.classList.add('hidden');
    setTimeout(() => panel.classList.add('hidden'), 280);
  });

  clearBtn?.addEventListener('click', () => _dfilterClearAll());

  // Re-apply any persisted filters on init (e.g. after tab switch)
  _updateFilterBadge();
  _renderFilterPills();
}

// Show/hide existing cards by filter text AND dynamic filters — no DOM rebuild.
function getFilteredResults() {
  const q = feedFilterText.toLowerCase().trim();
  const hasDynFilter = _dfilterTotalActive() > 0;
  return sortedFeedResults().filter(r => {
    const card = document.querySelector(`[data-url="${CSS.escape(r.feedJob.job?.url ?? '')}"]`);
    const searchText = card?.dataset.searchText ?? (r.feedJob.job?.title + ' ' + r.feedJob.site_name + ' ' + (r.feedJob.job?.location ?? '')).toLowerCase();
    const textMatch = !q || searchText.includes(q);
    const dynMatch = !hasDynFilter || _dfilterMatchesResult(r);
    return textMatch && dynMatch;
  });
}

function applyFeedFilter() {
  const filtered = getFilteredResults();
  const total    = feedResults.length;
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / feedPageSize));
  if (feedPage > totalPages) feedPage = totalPages;

  const start = (feedPage - 1) * feedPageSize;
  const pageItems = filtered.slice(start, start + feedPageSize);
  const pageUrls  = new Set(pageItems.map(r => r.feedJob.job?.url));

  // Show/hide cards based on current page + filters
  document.querySelectorAll('#feed-results .feed-job-card-v2').forEach(card => {
    card.style.display = pageUrls.has(card.dataset.url) ? '' : 'none';
  });

  const sortBar = document.getElementById('feed-sort-bar');
  const countEl = document.getElementById('feed-result-count');
  if (sortBar) sortBar.classList.toggle('hidden', total === 0);

  if (countEl) {
    const from = totalFiltered === 0 ? 0 : start + 1;
    const to   = Math.min(start + feedPageSize, totalFiltered);
    countEl.textContent = totalFiltered < total
      ? `${from}–${to} of ${totalFiltered} filtered (${total} total)`
      : `${from}–${to} of ${total} job${total !== 1 ? 's' : ''}`;
  }

  renderPagination(totalFiltered, totalPages);
}

function renderPagination(totalFiltered, totalPages) {
  let pager = document.getElementById('feed-pagination');
  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'feed-pagination';
    document.getElementById('feed-results')?.after(pager);
  }
  if (totalFiltered === 0 || totalPages <= 1) { pager.innerHTML = ''; return; }

  const prevDisabled = feedPage <= 1;
  const nextDisabled = feedPage >= totalPages;
  const pageSizeOptions = [10, 20, 50, 100].map(n =>
    `<option value="${n}" ${n === feedPageSize ? 'selected' : ''}>${n} per page</option>`
  ).join('');

  // Page numbers: show up to 7 (with ellipsis)
  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (feedPage > 3) pages.push('…');
    for (let i = Math.max(2, feedPage - 1); i <= Math.min(totalPages - 1, feedPage + 1); i++) pages.push(i);
    if (feedPage < totalPages - 2) pages.push('…');
    pages.push(totalPages);
  }

  pager.innerHTML = `
    <div class="feed-pager">
      <button class="feed-pager-btn" id="feed-prev-btn" ${prevDisabled ? 'disabled' : ''}>← Prev</button>
      <div class="feed-pager-pages">
        ${pages.map(p => p === '…'
          ? `<span class="feed-pager-ellipsis">…</span>`
          : `<button class="feed-pager-page ${p === feedPage ? 'active' : ''}" data-page="${p}">${p}</button>`
        ).join('')}
      </div>
      <button class="feed-pager-btn" id="feed-next-btn" ${nextDisabled ? 'disabled' : ''}>Next →</button>
      <select class="feed-pager-size" id="feed-page-size-select">${pageSizeOptions}</select>
    </div>`;

  pager.querySelector('#feed-prev-btn')?.addEventListener('click', () => { feedPage--; applyFeedFilter(); pager.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  pager.querySelector('#feed-next-btn')?.addEventListener('click', () => { feedPage++; applyFeedFilter(); pager.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  pager.querySelectorAll('.feed-pager-page').forEach(btn => {
    btn.addEventListener('click', () => { feedPage = Number(btn.dataset.page); applyFeedFilter(); });
  });
  pager.querySelector('#feed-page-size-select')?.addEventListener('change', e => {
    feedPageSize = Number(e.target.value);
    localStorage.setItem('feedPageSize', feedPageSize);
    feedPage = 1;
    applyFeedFilter();
  });
}

// Append one card without rebuilding the list — used during live scans.
function appendFeedJobCard(feedJob, fromCache) {
  const resultsEl = document.getElementById('feed-results');
  if (!resultsEl) return;
  const card = buildFeedJobCard(feedJob, fromCache);
  // Animate the new card in
  card.classList.add('fc-card-new');
  if (fromCache) {
    card.classList.add('fc-card-from-cache');
    // After a brief moment, fade it up to full opacity
    setTimeout(() => card.classList.add('fc-cache-settled'), 50);
  }
  resultsEl.appendChild(card);
  // Debounce filter panel rebuilds during rapid scan events (max once per 400ms)
  clearTimeout(appendFeedJobCard._filterTimer);
  appendFeedJobCard._filterTimer = setTimeout(() => buildDynamicFilters(feedResults), 400);
  applyFeedFilter();
}

function upsertFeedScanResult(feedJob, fromCache) {
  const url = feedJob?.job?.url;
  if (!url) return;

  const idx = feedResults.findIndex(r => r.feedJob.job.url === url);
  const existingCard = document.querySelector(`#feed-results .feed-job-card-v2[data-url="${CSS.escape(url)}"]`);

  if (idx >= 0) {
    feedResults[idx] = { feedJob, fromCache };
    if (existingCard) {
      const replacement = buildFeedJobCard(feedJob, fromCache);
      replacement.classList.add('fc-card-new');
      if (fromCache) {
        replacement.classList.add('fc-card-from-cache');
        setTimeout(() => replacement.classList.add('fc-cache-settled'), 50);
      }
      existingCard.replaceWith(replacement);
      applyFeedFilter();
      clearTimeout(appendFeedJobCard._filterTimer);
      appendFeedJobCard._filterTimer = setTimeout(() => buildDynamicFilters(feedResults), 400);
    }
    return;
  }

  feedResults.push({ feedJob, fromCache });
  appendFeedJobCard(feedJob, fromCache);
}

function removeFeedUrls(urls = []) {
  if (!Array.isArray(urls) || !urls.length) return;
  const urlSet = new Set(urls);
  feedResults = feedResults.filter(r => !urlSet.has(r.feedJob?.job?.url));
  urls.forEach(url => {
    const card = document.querySelector(`#feed-results .feed-job-card-v2[data-url="${CSS.escape(url)}"]`);
    card?.remove();
  });
  applyFeedFilter();
  clearTimeout(appendFeedJobCard._filterTimer);
  appendFeedJobCard._filterTimer = setTimeout(() => buildDynamicFilters(feedResults), 200);
}

// Full rebuild — only called on sort change or initial load (not on filter/append).
function renderFeedResults() {
  const resultsEl = document.getElementById('feed-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  for (const { feedJob, fromCache } of sortedFeedResults()) {
    resultsEl.appendChild(buildFeedJobCard(feedJob, fromCache));
  }
  buildDynamicFilters(feedResults); // rebuild filter panel from current data
  applyFeedFilter(); // re-apply active filter to the freshly rendered cards
}

// refreshFeedTab is called every time the tab is switched to
async function refreshFeedTab() {
  const userInfo  = document.getElementById('feed-user-info');
  const siteCount = document.getElementById('feed-site-count');
  const resultsEl = document.getElementById('feed-results');

  if (activeUserId) {
    const user = await api.get(`/api/users/${activeUserId}`);
    if (!user?.error) {
      userInfo.textContent = `Scanning as: ${user.name}`;
      window._activeUserDbProfile = user;
      _setDashGreeting(user.name); // use real DB name, not Supabase display name
    }

    // Pre-load cached results so the user sees them immediately
    if (!resultsEl.dataset.scanActive && !feedResults.length) {
      // Show skeleton loaders while we fetch
      _showFeedSkeletons(resultsEl, 4);
    }

    const skeletonStart = Date.now();

    const cached = await api.get(`/api/feed/cached?userId=${activeUserId}`);
    if (Array.isArray(cached) && cached.length && !resultsEl.dataset.scanActive) {
      // Ensure skeleton is shown for at least 500ms (feels intentional, not glitchy)
      const elapsed = Date.now() - skeletonStart;
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed));

      _hideFeedSkeletons(resultsEl);

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
            ${count} cached result${count !== 1 ? 's' : ''} — click <strong>Scan New Jobs</strong> to refresh
          </div>
        </div>`;
    } else if (!resultsEl.dataset.scanActive && !feedResults.length) {
      _hideFeedSkeletons(resultsEl);
      // Show improved empty state
      _showFeedEmptyState(resultsEl);
    } else {
      // Scan is active or results already rendered — remove any leftover skeletons
      _hideFeedSkeletons(resultsEl);
    }
  }

  const sites = await api.get(`/api/sites?userId=${activeUserId}`);
  const active = sites.filter(s => s.active);
  siteCount.textContent = active.length
    ? `${active.length} active site${active.length !== 1 ? 's' : ''} configured`
    : 'No active sites yet — add some in Settings.';
}

function _showFeedEmptyState(container) {
  if (!container || container.dataset.scanActive) return;
  container.innerHTML = `
    <div class="empty-state-wrap">
      <div class="empty-state-icon">🔍</div>
      <div class="empty-state-title">No jobs scanned yet</div>
      <div class="empty-state-sub">Add job sites in Settings then hit Scan New Jobs</div>
      <div class="empty-state-actions">
        <button class="btn btn-primary" id="feed-empty-scan-btn">Scan New Jobs</button>
        <button class="btn btn-secondary" data-tab="observe">Open Settings</button>
      </div>
    </div>`;
  container.querySelector('#feed-empty-scan-btn')?.addEventListener('click', () => {
    document.getElementById('feed-scan-btn')?.click();
  });
}

function initFeedTab() {
  if (feedTabInited) return;
  feedTabInited = true;

  const scanBtn          = document.getElementById('feed-scan-btn');
  const stopBtn          = document.getElementById('feed-stop-btn');
  const refreshBtn       = document.getElementById('feed-refresh-btn');
  const reanalyzeAllBtn  = document.getElementById('feed-reanalyze-all-btn');
  const filterInput      = document.getElementById('feed-filter');
  const userInfo         = document.getElementById('feed-user-info');
  const siteCount        = document.getElementById('feed-site-count');

  async function refreshFeedMeta() {
    if (activeUserId) {
      const user = await api.get(`/api/users/${activeUserId}`);
      if (!user?.error) userInfo.textContent = `Scanning as: ${user.name}`;
    }
    const sites = await api.get(`/api/sites?userId=${activeUserId}`);
    const active = sites.filter(s => s.active);
    siteCount.textContent = active.length
      ? `${active.length} active site${active.length !== 1 ? 's' : ''} configured`
      : 'No active sites yet — add some in the Admin tab.';
  }

  refreshFeedMeta();

  scanBtn.addEventListener('click', async () => {
    if (!activeUserId) { toast('Select a profile first', 'error'); return; }
    const sites = await api.get(`/api/sites?userId=${activeUserId}`);
    if (!sites.filter(s => s.active).length) {
      toast('Add at least one active site in Settings first', 'error');
      return;
    }
    await startFeedScan(activeUserId);
  });

  stopBtn.addEventListener('click', () => {
    const labelEl = document.getElementById('feed-progress-label');
    if (labelEl) labelEl.textContent = 'Stopping scan…';
    stopBtn.disabled = true;
    feedScanController?.abort();
  });

  refreshBtn.addEventListener('click', () => refreshFeedTab());

  reanalyzeAllBtn.addEventListener('click', async () => {
    if (!activeUserId) { toast('Select a profile first', 'error'); return; }
    if (!feedResults.length) { toast('No jobs in feed yet — run a scan first', 'error'); return; }
    if (!confirm(`Re-score all ${feedResults.length} jobs against your current resume? This re-runs AI analysis on every cached job.`)) return;
    await startReanalyzeAll(activeUserId);
  });

  // Filter: show/hide existing cards — no rebuild
  filterInput?.addEventListener('input', () => {
    feedFilterText = filterInput.value; feedPage = 1;
    applyFeedFilter();
  });

  // Sort buttons
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      feedSortBy = btn.dataset.sort; feedPage = 1;
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      renderFeedResults();
    });
  });

  // Init dynamic filter panel
  _initDynamicFilterPanel();
}

async function startFeedScan(userId) {
  const scanBtn    = document.getElementById('feed-scan-btn');
  const stopBtn    = document.getElementById('feed-stop-btn');
  const progressEl = document.getElementById('feed-progress');
  const fillEl     = document.getElementById('feed-progress-fill');
  const labelEl    = document.getElementById('feed-progress-label');
  const resultsEl  = document.getElementById('feed-results');
  const summaryEl  = document.getElementById('feed-summary');
  const scanCardsEl = document.getElementById('feed-scan-cards');

  feedScanController = new AbortController();

  scanBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  stopBtn.disabled = false;
  progressEl.classList.remove('hidden');
  summaryEl.classList.add('hidden');
  resultsEl.dataset.scanActive = '1';
  fillEl.style.width = '0%';
  const startingCount = feedResults.length;

  // Show scan animation grid (clears previous cards)
  if (scanCardsEl) {
    scanCardsEl.innerHTML = '<div class="scan-anim-grid" id="scan-anim-grid"></div>';
    scanCardsEl.classList.remove('hidden');
  }

  let totalSites   = 0;
  let sitesDone    = 0;
  let analyzed     = 0;
  let fromCache    = 0;
  let skipped      = 0;
  let totalRemoved = 0;
  let discovered   = 0;
  let wasCancelled = false;

  try {
    await api.stream('/api/feed/scan', { userId }, evt => {
    if (evt.type === 'scan_start') {
      totalSites = evt.total_sites || 0;
      labelEl.textContent = `Starting scan across ${totalSites} site${totalSites !== 1 ? 's' : ''}…`;
    } else if (evt.type === 'site_start') {
      labelEl.textContent = `[${(evt.site_index ?? 0) + 1}/${totalSites}] Scanning ${evt.site_name}…`;
      fillEl.style.width = `${Math.round(((evt.site_index ?? 0) / totalSites) * 90)}%`;
      // Create a scanning card for this site
      _scanAnimUpsertCard(evt.site_name, evt.site_url || '', 'scanning', null, null);
    } else if (evt.type === 'agent_step') {
      labelEl.textContent = `🤖 ${evt.site_name}: ${evt.message}`;
      _scanAnimSetStatus(evt.site_name, evt.message);
    } else if (evt.type === 'site_jobs_found') {
      labelEl.textContent = `${evt.site_name}: found ${evt.job_count} jobs`;
      _scanAnimSetStatus(evt.site_name, `${evt.job_count} job${evt.job_count !== 1 ? 's' : ''} found`);
    } else if (evt.type === 'job_analyzing') {
      labelEl.textContent = `Analyzing: ${evt.job?.job?.title ?? '…'}`;
    } else if (evt.type === 'job_discovered') {
      discovered++;
      labelEl.textContent = `Found: ${evt.job?.job?.title ?? '…'}`;
      upsertFeedScanResult(evt.job, false);
      const liveCount = feedResults.length;
      summaryEl.classList.remove('hidden');
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--border-soft)">
          <div style="font-size:12px;color:var(--text-dim)">
            Showing ${liveCount} discovered job${liveCount !== 1 ? 's' : ''}${startingCount ? ` (${startingCount} already cached)` : ''} while scoring runs…
          </div>
        </div>`;
    } else if (evt.type === 'job_result') {
      if (evt.from_cache) {
        fromCache++;
        labelEl.textContent = `From cache: ${evt.job?.job?.title ?? '…'}`;
      } else if (evt.job?.analyzed) {
        analyzed++;
        labelEl.textContent = `Scored: ${evt.job?.job?.title ?? '…'}`;
      }
      upsertFeedScanResult(evt.job, !!evt.from_cache);
      // Update live summary count
      const liveCount = feedResults.length;
      summaryEl.classList.remove('hidden');
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--border-soft)">
          <div style="font-size:12px;color:var(--text-dim)">
            Showing ${liveCount} discovered job${liveCount !== 1 ? 's' : ''}${startingCount ? ` (${startingCount} already cached)` : ''} · ${analyzed} scored so far…
          </div>
        </div>`;
    } else if (evt.type === 'job_filtered') {
      skipped++;
    } else if (evt.type === 'site_error') {
      _scanAnimUpsertCard(evt.site_name, '', 'error', null, 0);
      _scanAnimSetStatus(evt.site_name, evt.message || 'Error');
      const err = document.createElement('div');
      err.className = 'card';
      err.style.borderColor = 'var(--danger-border)';
      err.innerHTML = `<div style="color:var(--danger);font-size:12px">${ICON_X} <strong>${esc(evt.site_name)}</strong>: ${esc(evt.message)}</div>`;
      resultsEl.appendChild(err);
    } else if (evt.type === 'site_done') {
      sitesDone++;
      // Mark the card done with final job count
      const jobCount = evt.job_count ?? null;
      _scanAnimUpsertCard(evt.site_name, '', 'done', jobCount, null);
      if (evt.removed?.length) {
        totalRemoved += evt.removed.length;
        removeFeedUrls(evt.removed.map(r => r.url));
        const notice = document.createElement('div');
        notice.style.cssText = 'font-size:11px;color:var(--text-muted);padding:6px 2px';
        notice.innerHTML = `${ICON_X} ${evt.removed.length} job${evt.removed.length !== 1 ? 's' : ''} removed from <strong>${esc(evt.site_name)}</strong> (no longer listed): ${evt.removed.map(r => esc(r.title)).join(', ')}`;
        resultsEl.appendChild(notice);
      }
    } else if (evt.type === 'scan_cancelled') {
      wasCancelled = true;
      fillEl.style.width = '100%';
      labelEl.textContent = evt.message || 'Scan stopped';
      summaryEl.classList.remove('hidden');
      const removedLine = totalRemoved ? ` · ${totalRemoved} removed` : '';
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--border-soft)">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${ICON_X} Scan stopped</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:6px">
            ${feedResults.length} visible · ${discovered} discovered · ${analyzed} scored · ${fromCache} from cache · ${skipped} filtered${removedLine}
          </div>
        </div>`;
    } else if (evt.type === 'scan_done') {
      fillEl.style.width = '100%';
      labelEl.textContent = evt.message || 'Scan complete';
      // Hide scan cards after a short delay
      setTimeout(() => {
        if (scanCardsEl) scanCardsEl.classList.add('hidden');
        progressEl.classList.add('hidden');
      }, 2500);
      summaryEl.classList.remove('hidden');
      const removedLine = totalRemoved ? ` · ${totalRemoved} removed` : '';
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--success-border)">
          <div style="font-size:13px;font-weight:600;color:var(--success)">${ICON_CHECK} Scan complete</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:6px">
            ${feedResults.length} visible · ${discovered} discovered · ${analyzed} scored · ${fromCache} from cache · ${skipped} filtered${removedLine} · ${totalSites} site${totalSites !== 1 ? 's' : ''}
          </div>
        </div>`;
    } else if (evt.type === 'error') {
      labelEl.textContent = `Error: ${evt.message}`;
    }
    }, feedScanController?.signal);
  } finally {
    if (feedScanController?.signal?.aborted && !wasCancelled) {
      labelEl.textContent = 'Stopping scan…';
      summaryEl.classList.remove('hidden');
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--border-soft)">
          <div style="font-size:12px;color:var(--text-dim)">Stop requested. Finishing the current step…</div>
        </div>`;
    }
  }

  delete resultsEl.dataset.scanActive;
  feedScanController = null;

  scanBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  stopBtn.disabled = false;
}

async function startReanalyzeAll(userId) {
  const scanBtn    = document.getElementById('feed-scan-btn');
  const stopBtn    = document.getElementById('feed-stop-btn');
  const progressEl = document.getElementById('feed-progress');
  const fillEl     = document.getElementById('feed-progress-fill');
  const labelEl    = document.getElementById('feed-progress-label');
  const summaryEl  = document.getElementById('feed-summary');

  feedScanController = new AbortController();

  scanBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  stopBtn.disabled = false;
  progressEl.classList.remove('hidden');
  summaryEl.classList.add('hidden');
  fillEl.style.width = '5%';
  labelEl.textContent = 'Starting re-analysis…';

  let done = 0;
  const total = feedResults.length;
  let wasCancelled = false;

  try {
    await api.stream('/api/feed/reanalyze-all', { userId }, evt => {
    if (evt.type === 'job_analyzing') {
      labelEl.textContent = `Re-analyzing: ${evt.job?.job?.title ?? '…'}`;
    } else if (evt.type === 'job_result') {
      done++;
      fillEl.style.width = `${Math.round((done / total) * 100)}%`;
      const url = evt.job?.job?.url;
      const idx = feedResults.findIndex(r => r.feedJob.job.url === url);
      if (idx >= 0) feedResults[idx] = { feedJob: evt.job, fromCache: false };
      // Replace only the affected card — no full list rebuild
      const oldCard = url && document.querySelector(`#feed-results .feed-job-card-v2[data-url="${CSS.escape(url)}"]`);
      if (oldCard) {
        const newCard = buildFeedJobCard(evt.job, false);
        oldCard.replaceWith(newCard);
        applyFeedFilter();
      }
    } else if (evt.type === 'site_error') {
      toast(`${evt.site_name}: ${evt.message}`, 'error');
    } else if (evt.type === 'scan_cancelled') {
      wasCancelled = true;
      fillEl.style.width = total ? `${Math.round((done / total) * 100)}%` : '100%';
      labelEl.textContent = evt.message || 'Re-analysis stopped';
      summaryEl.classList.remove('hidden');
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--border-soft)">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${ICON_X} Re-analysis stopped</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:6px">${evt.message}</div>
        </div>`;
    } else if (evt.type === 'scan_done') {
      fillEl.style.width = '100%';
      labelEl.textContent = evt.message || 'Re-analysis complete';
      setTimeout(() => progressEl.classList.add('hidden'), 2000);
      summaryEl.classList.remove('hidden');
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--success-border)">
          <div style="font-size:13px;font-weight:600;color:var(--success)">${ICON_CHECK} Re-analysis complete</div>
          <div style="font-size:12px;color:var(--text-dim);margin-top:6px">${evt.message}</div>
        </div>`;
    } else if (evt.type === 'error') {
      labelEl.textContent = `Error: ${evt.message}`;
    }
    }, feedScanController.signal);
  } finally {
    if (feedScanController?.signal?.aborted && !wasCancelled) {
      summaryEl.classList.remove('hidden');
      summaryEl.innerHTML = `
        <div class="card" style="border-color:var(--border-soft)">
          <div style="font-size:12px;color:var(--text-dim)">Stop requested. Finishing the current step…</div>
        </div>`;
    }
  }

  feedScanController = null;
  scanBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  stopBtn.disabled = false;
}

// ── Feed card helpers ──────────────────────────────────────────────────────────

/**
 * Extract a root domain from a job URL for Clearbit logo lookup.
 * Tries to use the company name from site_name first (converted to a guessed domain),
 * then falls back to the actual URL hostname stripped of known ATS subdomains.
 */
function fcExtractLogoDomain(jobUrl, siteName) {
  try {
    const url  = new URL(jobUrl);
    const host = url.hostname.toLowerCase(); // e.g. boards.greenhouse.io

    // Map common ATS hostnames → extract company from path
    const atsPatterns = [
      { host: 'boards.greenhouse.io',    pathIdx: 1 }, // /stripe
      { host: 'boards.eu.greenhouse.io', pathIdx: 1 },
      { host: 'jobs.lever.co',           pathIdx: 1 }, // /stripe
      { host: 'apply.workable.com',      pathIdx: 1 },
      { host: 'jobs.ashbyhq.com',        pathIdx: 1 },
    ];

    for (const p of atsPatterns) {
      if (host === p.host || host.endsWith('.' + p.host)) {
        const slug = url.pathname.split('/').filter(Boolean)[p.pathIdx - 1];
        if (slug) return slug.toLowerCase() + '.com';
      }
    }

    // If the site_name looks like a real company name, guess domain
    if (siteName && !/greenhouse|lever|ashby|workable|indeed|linkedin/i.test(siteName)) {
      const guess = siteName.trim().toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
      if (guess.length > 4) return guess;
    }

    // Fallback: strip www. and return hostname
    return host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Build an SVG score ring (52 px, strokeWidth 4).
 * Color: green ≥70, amber 50-69, red <50.
 */
function fcScoreRingSVG(score) {
  const size   = 52;
  const sw     = 4;
  const r      = (size - sw) / 2;       // 24
  const circ   = 2 * Math.PI * r;       // circumference
  const pct    = Math.max(0, Math.min(100, score)) / 100;
  const dash   = circ * pct;
  const gap    = circ - dash;
  const cx     = size / 2;
  const cy     = size / 2;

  const color  = score >= 70 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444';
  const trackC = 'rgba(255,255,255,0.07)';

  return `<svg class="fc-ring-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${trackC}" stroke-width="${sw}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
      stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      class="fc-ring-arc"/>
  </svg>
  <span class="fc-ring-num" style="color:${color}">${score}</span>`;
}

/**
 * Build the inline expandable details section (strengths / gaps / requirements).
 */
function fcBuildDetailsHTML(analysis) {
  if (!analysis) return '';

  const strengths    = (analysis.strengths    || []).slice(0, 6);
  const gaps         = (analysis.gaps         || []).slice(0, 6);
  const requirements = (analysis.requirements || []).slice(0, 8);

  if (!strengths.length && !gaps.length && !requirements.length) return '';

  const strengthsHTML = strengths.length
    ? strengths.map(s => `
        <div class="fc-detail-item fc-detail-strength">
          <svg class="fc-detail-icon" viewBox="0 0 16 16" width="14" height="14" fill="none">
            <circle cx="8" cy="8" r="7" fill="rgba(16,185,129,0.15)" stroke="rgba(16,185,129,0.4)" stroke-width="1"/>
            <path d="M5 8l2 2 4-4" stroke="#10B981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>${esc(s)}</span>
        </div>`).join('')
    : '';

  const gapsHTML = gaps.length
    ? gaps.map(g => `
        <div class="fc-detail-item fc-detail-gap">
          <svg class="fc-detail-icon" viewBox="0 0 16 16" width="14" height="14" fill="none">
            <circle cx="8" cy="8" r="7" fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.35)" stroke-width="1"/>
            <path d="M8 5v3M8 10.5v.5" stroke="#F59E0B" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <span>${esc(g)}</span>
        </div>`).join('')
    : '';

  const reqHTML = requirements.length
    ? requirements.map(r => `
        <div class="fc-detail-item fc-detail-req">
          <span class="fc-req-dot"></span>
          <span>${esc(r)}</span>
        </div>`).join('')
    : '';

  return `
    <div class="fc-details-body">
      ${strengths.length ? `
        <div class="fc-details-section">
          <div class="fc-details-section-title fc-dt-green">Strengths</div>
          ${strengthsHTML}
        </div>` : ''}
      ${gaps.length ? `
        <div class="fc-details-section">
          <div class="fc-details-section-title fc-dt-amber">Gaps</div>
          ${gapsHTML}
        </div>` : ''}
      ${requirements.length ? `
        <div class="fc-details-section">
          <div class="fc-details-section-title fc-dt-muted">Requirements</div>
          ${reqHTML}
        </div>` : ''}
    </div>`;
}

function buildFeedJobCard(feedJob, fromCache = false) {
  const { job, site_name, filter_result, warnings, analysis, analyzed } = feedJob;
  const card = document.createElement('div');
  const hasWarnings = warnings && warnings.length > 0;
  card.className = `feed-job-card-v2${hasWarnings ? ' has-warnings' : ''}`;
  card.dataset.url = job.url;
  card.dataset.searchText = `${job.title} ${site_name ?? ''} ${job.location ?? ''} ${job.department ?? ''}`.toLowerCase();

  const score    = analysis?.match_score;
  const hasScore = typeof score === 'number';

  const company = site_name || '';
  const role    = job.title || '—';

  const warningsHTML = (warnings || []).map(w => `<span class="warn-badge">${esc(w)}</span>`).join('');
  const locationMeta = [job.location, job.department].filter(Boolean).map(esc).join(' · ');

  // Score ring or pending placeholder
  const ringHTML = hasScore
    ? `<div class="fc-ring-wrap">${fcScoreRingSVG(score)}</div>`
    : `<div class="fc-ring-wrap fc-ring-pending"><span class="fc-ring-num" style="color:var(--text-muted)">—</span></div>`;

  // Details section (expand/collapse)
  const detailsHTML = analyzed ? fcBuildDetailsHTML(analysis) : '';
  const hasDetails  = analyzed && detailsHTML.trim().length > 0;

  // Company logo (built via DOM after innerHTML to attach onerror handler)
  const logoDomain = fcExtractLogoDomain(job.url, company);
  const initials   = (company || role || '?').trim().slice(0, 2).toUpperCase();

  card.innerHTML = `
    <div class="fc-top">
      <div class="fc-logo-slot"></div>
      <div class="fc-header-body">
        <div class="fc-source-row">
          <span class="fc-source-label">${esc(company)}${fromCache ? ' <span class="cache-badge">cached</span>' : ''}</span>
          ${warningsHTML}
        </div>
        <div class="fc-role-title">${esc(role)}</div>
        ${locationMeta ? `<div class="fc-location-meta">${locationMeta}</div>` : ''}
        ${analysis?.summary ? `<div class="fc-summary">${esc(analysis.summary)}</div>` : ''}
      </div>
      ${ringHTML}
    </div>
    ${hasDetails ? `
    <button class="fc-toggle-btn" aria-expanded="false">
      <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="fc-chevron-path"/>
      </svg>
      <span class="fc-toggle-label">Show details</span>
    </button>
    <div class="fc-details-drawer" aria-hidden="true">
      ${detailsHTML}
    </div>` : ''}
    <div class="fc-actions feed-card-actions">
      ${analyzed  ? `<button class="btn btn-primary btn-sm feed-apply-btn">Apply Now</button>` : ''}
      ${!analyzed ? `<button class="btn btn-primary btn-sm feed-analyze-btn">Analyze</button>` : ''}
      <a class="btn btn-secondary btn-sm" href="${esc(job.url)}" target="_blank" rel="noopener">View Details</a>
      ${analyzed  ? `<button class="btn btn-ghost btn-sm feed-reanalyze-btn" title="Re-score against your current resume">↺ Re-analyze</button>` : ''}
      <button class="btn btn-ghost btn-sm feed-track-btn" title="Add to Board">＋ Track</button>
      <button class="btn btn-ghost btn-sm feed-copy-btn">Copy URL</button>
    </div>`;

  // Inject company logo with fallback
  const logoSlot = card.querySelector('.fc-logo-slot');
  if (logoDomain) {
    const img = document.createElement('img');
    img.className = 'fc-logo-img';
    img.width  = 32;
    img.height = 32;
    img.alt    = company || 'logo';
    img.src    = `https://www.google.com/s2/favicons?domain=${logoDomain}&sz=64`;
    img.onerror = () => {
      img.replaceWith(fcInitialsCircle(initials, company));
    };
    logoSlot.appendChild(img);
  } else {
    logoSlot.appendChild(fcInitialsCircle(initials, company));
  }

  // Inline expand / collapse
  if (hasDetails) {
    const toggleBtn = card.querySelector('.fc-toggle-btn');
    const drawer    = card.querySelector('.fc-details-drawer');
    const label     = toggleBtn.querySelector('.fc-toggle-label');

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = toggleBtn.getAttribute('aria-expanded') === 'true';
      if (open) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        drawer.setAttribute('aria-hidden', 'true');
        drawer.style.maxHeight = '0';
        label.textContent = 'Show details';
        toggleBtn.classList.remove('fc-toggle-open');
      } else {
        toggleBtn.setAttribute('aria-expanded', 'true');
        drawer.setAttribute('aria-hidden', 'false');
        drawer.style.maxHeight = drawer.scrollHeight + 'px';
        label.textContent = 'Hide details';
        toggleBtn.classList.add('fc-toggle-open');
      }
    });
  }

  // Button event handlers (identical logic to original)
  card.querySelector('.feed-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(job.url).then(() => toast('URL copied'));
  });

  card.querySelector('.feed-track-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const data = await api.post('/api/applications', {
      userId: activeUserId,
      jobUrl: job.url,
      jobTitle: job.title,
      siteName: site_name ?? '',
      matchScore: analysis?.match_score ?? null,
    });
    if (data?.id) {
      btn.textContent = '✓ Tracked';
      toast('Added to Board → Interested');
    } else {
      btn.disabled = false;
      toast(data?.error || 'Already on Board', 'error');
    }
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
      card.querySelector('.fc-actions').before(el);
    } else {
      toast(data.error || 'Analysis failed', 'error');
    }
  });

  card.querySelector('.feed-reanalyze-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span>';
    const data = await api.post('/api/feed/reanalyze', { userId: activeUserId, jobUrl: job.url });
    if (data.analysis) {
      const idx = feedResults.findIndex(r => r.feedJob.job.url === job.url);
      if (idx >= 0) {
        feedResults[idx].feedJob.analysis = data.analysis;
        feedResults[idx].feedJob.analyzed = true;
        // Replace only this card — no full list rebuild
        const newCard = buildFeedJobCard(feedResults[idx].feedJob, false);
        card.replaceWith(newCard);
        applyFeedFilter();
      }
      toast('Re-analyzed');
    } else {
      btn.disabled = false;
      btn.textContent = '↺ Re-analyze';
      toast(data.error || 'Re-analysis failed', 'error');
    }
  });

  return card;
}

/** Render a colored initials fallback circle for missing logos */
function fcInitialsCircle(initials, name) {
  const colors = [
    ['#6366F1','#3730A3'],['#10B981','#065F46'],['#F59E0B','#92400E'],
    ['#EF4444','#7F1D1D'],['#8B5CF6','#4C1D95'],['#06B6D4','#164E63'],
    ['#EC4899','#831843'],['#84CC16','#365314'],
  ];
  const idx = [...(name || initials || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  const [fg, bg] = colors[idx];
  const el = document.createElement('div');
  el.className = 'fc-logo-initials';
  el.style.cssText = `background:${bg}33;border-color:${fg}44;color:${fg}`;
  el.textContent = initials || '?';
  return el;
}

// ── Sites admin (inside Admin tab) ─────────────────────────────────────

const ATS_OPTIONS = ['', 'agent', 'greenhouse', 'lever', 'ashby', 'workable'];

function atsSelectHTML(id, current) {
  return `<select id="${id}" class="input" style="max-width:120px;padding:5px 8px">
    ${ATS_OPTIONS.map(v => `<option value="${v}" ${current === v ? 'selected' : ''}>${v || '— ATS —'}</option>`).join('')}
  </select>`;
}

async function loadSitesAdmin(container) {
  const sites = await api.get(`/api/sites?userId=${activeUserId}`);

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
    const result = await api.post('/api/sites', { userId: activeUserId, name, url, ats_type, ats_slug });
    if (result.error) { toast(result.error, 'error'); return; }
    section.querySelector('#site-name-input').value = '';
    section.querySelector('#site-url-input').value = '';
    section.querySelector('#site-ats-slug').value = '';
    section.querySelector('#site-ats-type').value = '';
    const newSites = await api.get(`/api/sites?userId=${activeUserId}`);
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
        await authFetch(`/api/sites/${id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: activeUserId, ats_type, ats_slug }),
        });
        const newSites = await api.get(`/api/sites?userId=${activeUserId}`);
        renderSitesTable(container, newSites);
        toast('ATS config saved');
      });

      cell.querySelector('.ats-cancel').addEventListener('click', async () => {
        const newSites = await api.get(`/api/sites?userId=${activeUserId}`);
        renderSitesTable(container, newSites);
      });
    });
  });

  wrap.querySelectorAll('.site-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = Number(btn.dataset.id);
      const active = btn.dataset.active === '1';
      await authFetch(`/api/sites/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUserId, active: !active }),
      });
      const newSites = await api.get(`/api/sites?userId=${activeUserId}`);
      renderSitesTable(container, newSites);
    });
  });

  wrap.querySelectorAll('.site-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this site?')) return;
      await authFetch(`/api/sites/${btn.dataset.id}?userId=${activeUserId}`, { method: 'DELETE' });
      const newSites = await api.get(`/api/sites?userId=${activeUserId}`);
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

  // Hero section
  const heroAvatar = document.getElementById('profile-hero-avatar');
  const heroName   = document.getElementById('profile-hero-name');
  const heroEmail  = document.getElementById('profile-hero-email');
  if (heroAvatar) heroAvatar.textContent = getInitials(user.name || user.email || '');
  if (heroName)   heroName.textContent   = user.name  || '—';
  if (heroEmail)  heroEmail.textContent  = user.email || '';

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
  const resumeVal = user.resume_text || '';
  document.getElementById('profile-resume').value = resumeVal;
  updateResumeCharCount(resumeVal);

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

// Helper: show a green saved toast inline in profile sections
function profileSaveStatus(statusEl, ok, errMsg) {
  if (!statusEl) return;
  if (ok) {
    statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Saved`;
    statusEl.style.color = 'var(--success)';
    setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 2500);
  } else {
    statusEl.textContent = errMsg || 'Error saving';
    statusEl.style.color = 'var(--danger)';
  }
}

// Helper: update resume character count display
function updateResumeCharCount(text) {
  const el = document.getElementById('profile-resume-chars');
  if (!el) return;
  const chars = (text || '').trim().length;
  el.textContent = chars > 0 ? `${chars.toLocaleString()} chars` : '';
}

function initProfileTab() {
  // Live char count on resume textarea
  document.getElementById('profile-resume')?.addEventListener('input', function() {
    updateResumeCharCount(this.value);
  });

  // Save contact
  document.getElementById('profile-save-contact-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-contact-btn');
    const status = document.getElementById('profile-contact-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const name    = document.getElementById('profile-name').value.trim();
      const email   = document.getElementById('profile-email').value.trim();
      const res = await authFetch(`/api/users/${activeUserId}/contact`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email,
          phone:    document.getElementById('profile-phone').value.trim(),
          linkedin: document.getElementById('profile-linkedin').value.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        // Update hero
        const heroAvatar = document.getElementById('profile-hero-avatar');
        const heroName   = document.getElementById('profile-hero-name');
        const heroEmail  = document.getElementById('profile-hero-email');
        if (heroAvatar) heroAvatar.textContent = getInitials(name || email || '');
        if (heroName)   heroName.textContent   = name  || '—';
        if (heroEmail)  heroEmail.textContent  = email || '';
        await refreshUserSelect();
        profileSaveStatus(status, true);
        toast('Contact saved');
      } else {
        profileSaveStatus(status, false, body.error || `Error ${res.status}`);
      }
    } catch (e) { profileSaveStatus(status, false, String(e)); }
    btn.disabled = false; btn.textContent = 'Save Contact';
  });

  // Save location
  document.getElementById('profile-save-location-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-location-btn');
    const status = document.getElementById('profile-location-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await authFetch(`/api/users/${activeUserId}/contact`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: document.getElementById('profile-street').value.trim(),
          city:   document.getElementById('profile-city').value.trim(),
          state:  document.getElementById('profile-state').value.trim(),
          zip:    document.getElementById('profile-zip').value.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        profileSaveStatus(status, true);
        toast('Location saved');
      } else {
        profileSaveStatus(status, false, body.error || `Error ${res.status}`);
      }
    } catch (e) { profileSaveStatus(status, false, String(e)); }
    btn.disabled = false; btn.textContent = 'Save Location';
  });

  // Save resume
  document.getElementById('profile-save-resume-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-resume-btn');
    const status = document.getElementById('profile-resume-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const content = document.getElementById('profile-resume').value;
      const res  = await authFetch(`/api/users/${activeUserId}/resume`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        profileSaveStatus(status, true);
        toast('Resume saved');
      } else {
        profileSaveStatus(status, false, body.error || `Error ${res.status}`);
      }
    } catch (e) { profileSaveStatus(status, false, String(e)); }
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
      const res = await authFetch(`/api/users/${activeUserId}/preferences`, {
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
        profileSaveStatus(status, true);
        toast('Preferences saved');
      } else {
        profileSaveStatus(status, false, body.error || `Error ${res.status}`);
      }
    } catch (e) { profileSaveStatus(status, false, String(e)); }
    btn.disabled = false; btn.textContent = 'Save Preferences';
  });

  // Save application details
  document.getElementById('profile-save-appinfo-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-appinfo-btn');
    const status = document.getElementById('profile-appinfo-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await authFetch(`/api/users/${activeUserId}/contact`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_authorized:      document.querySelector('input[name="pref-work-auth"]:checked')?.value || '',
          requires_sponsorship: document.querySelector('input[name="pref-sponsorship"]:checked')?.value || '',
          available_start:      document.getElementById('profile-available-start').value.trim(),
          years_experience:     document.querySelector('input[name="pref-years-exp"]:checked')?.value || '',
          additional_info:      document.getElementById('profile-additional-info').value.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        profileSaveStatus(status, true);
        toast('Application details saved');
      } else {
        profileSaveStatus(status, false, body.error || `Error ${res.status}`);
      }
    } catch (e) { profileSaveStatus(status, false, String(e)); }
    btn.disabled = false; btn.textContent = 'Save Details';
  });

  // Save skills
  document.getElementById('profile-save-skills-btn').addEventListener('click', async () => {
    if (!activeUserId) { toast('No active profile selected', 'error'); return; }
    const btn    = document.getElementById('profile-save-skills-btn');
    const status = document.getElementById('profile-skills-status');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const res = await authFetch(`/api/users/${activeUserId}/contact`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts_proficiency: document.querySelector('input[name="pref-ts-prof"]:checked')?.value || '',
          llm_frameworks: [...document.querySelectorAll('.fw-check:checked')].map(cb => cb.value),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        profileSaveStatus(status, true);
        toast('Skills saved');
      } else {
        profileSaveStatus(status, false, body.error || `Error ${res.status}`);
      }
    } catch (e) { profileSaveStatus(status, false, String(e)); }
    btn.disabled = false; btn.textContent = 'Save Skills';
  });
}

// ── Auto-apply modal ──────────────────────────────────────────────────────────

function openApplyModal() {
  applyDebugExpanded = false;
  document.getElementById('apply-modal').classList.remove('hidden');
  document.getElementById('apply-progress-list').innerHTML = '';
  document.getElementById('apply-paused-msg').classList.add('hidden');
  document.getElementById('apply-error-msg').classList.add('hidden');
  document.getElementById('apply-captcha-panel')?.classList.add('hidden');
  document.getElementById('apply-field-count').textContent = '';
}

let applyDebugExpanded = false;

function appendApplyStep(icon, text, cls = '') {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--text-dim)';
  if (cls) el.className = cls;
  el.innerHTML = `<span style="flex-shrink:0;margin-top:1px">${icon}</span><span style="word-break:break-word">${esc(text)}</span>`;
  const list = document.getElementById('apply-progress-list');
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
}

// Generates a self-contained JS snippet that fills a form by label matching
// Safe to paste in browser console or run as a bookmarklet
function buildFillBookmarklet(filledValues) {
  const entries = Object.entries(filledValues)
    .filter(([, v]) => v && String(v).trim());

  return `(function(){
var vals=${JSON.stringify(Object.fromEntries(entries))};
var filled=0;

/* React-aware setter — works on Greenhouse, Lever, Workable React forms */
function reactSet(el,val){
  var proto=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  var setter=Object.getOwnPropertyDescriptor(proto,'value');
  if(setter&&setter.set)setter.set.call(el,val);
  else el.value=val;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
}

function tryFill(el,val){
  if(!el||!val)return false;
  var tag=el.tagName.toLowerCase();
  if(tag==='select'){
    var lv=val.toLowerCase();
    var opt=Array.from(el.options).find(o=>o.text.toLowerCase()===lv||o.value.toLowerCase()===lv||lv.includes(o.text.toLowerCase()));
    if(!opt)opt=Array.from(el.options).find(o=>o.text.toLowerCase().includes(lv));
    if(opt){el.value=opt.value;el.dispatchEvent(new Event('change',{bubbles:true}));return true;}
    return false;
  }
  if(el.type==='checkbox'||el.type==='radio'){
    var chk=/^(yes|true|1)$/i.test(val);
    if(el.type==='radio'){
      var radios=document.querySelectorAll('input[type=radio][name="'+el.name+'"]');
      var match=Array.from(radios).find(r=>{var l=document.querySelector('label[for="'+r.id+'"]');return l&&l.textContent.trim().toLowerCase()===val.toLowerCase();});
      if(match){match.checked=true;match.dispatchEvent(new Event('change',{bubbles:true}));return true;}
    }
    el.checked=chk;el.dispatchEvent(new Event('change',{bubbles:true}));return true;
  }
  reactSet(el,val);return true;
}

function findByLabel(text){
  var t=text.toLowerCase().replace(/[^a-z0-9 ]/g,'').trim();
  /* 1. aria-label */
  var el=document.querySelector('[aria-label]');
  var all=Array.from(document.querySelectorAll('[aria-label]')).find(e=>e.getAttribute('aria-label').toLowerCase().includes(t));
  if(all&&all.matches('input,select,textarea'))return all;
  /* 2. placeholder */
  all=Array.from(document.querySelectorAll('[placeholder]')).find(e=>e.getAttribute('placeholder').toLowerCase().includes(t));
  if(all)return all;
  /* 3. label element */
  var labels=Array.from(document.querySelectorAll('label,legend'));
  var lbl=labels.find(l=>l.textContent.replace(/[^a-z0-9 ]/gi,'').toLowerCase().includes(t));
  if(lbl){
    if(lbl.htmlFor)return document.getElementById(lbl.htmlFor);
    var inp=lbl.querySelector('input,select,textarea');if(inp)return inp;
    var sib=lbl.nextElementSibling;
    while(sib){inp=sib.querySelector('input,select,textarea');if(inp)return inp;sib=sib.nextElementSibling;}
  }
  /* 4. Any visible text near an input */
  var inputs=Array.from(document.querySelectorAll('input:not([type=hidden]),select,textarea'));
  return inputs.find(i=>{
    var wrap=i.closest('div,li,fieldset');
    return wrap&&wrap.textContent.replace(/[^a-z0-9 ]/gi,'').toLowerCase().includes(t);
  })||null;
}

Object.entries(vals).forEach(function(e){
  var el=findByLabel(e[0]);
  if(el&&tryFill(el,e[1]))filled++;
});
var msg='NotchUp Auto-Fill: '+filled+'/'+Object.keys(vals).length+' fields filled.';
msg+=filled>0?' Solve the captcha and submit!':' Could not find fields — try the console script.';
alert(msg);
})();`;
}

function appendApplyDebug(text) {
  const el = document.createElement('div');
  el.style.cssText = 'font-size:11px;color:var(--text-muted);font-family:var(--mono);padding:1px 0 1px 20px;word-break:break-all;line-height:1.5';
  el.textContent = text;
  const list = document.getElementById('apply-progress-list');
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
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
    } else if (evt.type === 'captcha_detected') {
      // Show the captcha panel with screenshot + open form link
      const panel = document.getElementById('apply-captcha-panel');
      const link = document.getElementById('apply-form-link');
      const shot = document.getElementById('apply-screenshot');
      const shotWrap = document.getElementById('apply-screenshot-wrap');
      panel.classList.remove('hidden');
      setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
      if (evt.form_url) { link.href = evt.form_url; link.textContent = '🌐 Open Form in Browser'; }
      if (evt.screenshot_url) {
        shot.src = evt.screenshot_url + '?t=' + Date.now();
        shotWrap.classList.remove('hidden');
      }
      appendApplyStep('🔒', `Captcha detected — ${evt.form_url ? 'open form to solve' : 'solve manually'}`);
    } else if (evt.type === 'paused') {
      const msg = document.getElementById('apply-paused-msg');
      msg.textContent = evt.message || 'Paused — review and submit in the browser';
      msg.classList.remove('hidden');
      appendApplyStep('⏸', 'Paused for your review');

      // Show copy-paste guide if we have filled values
      if (evt.filled_values && Object.keys(evt.filled_values).length) {
        const panel = document.getElementById('apply-captcha-panel');
        const link = document.getElementById('apply-form-link');
        panel.classList.remove('hidden');
        if (evt.form_url) link.href = evt.form_url;
        setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);

        // Build bookmarklet JS that fills the form in user's browser
        const fillScript = buildFillBookmarklet(evt.filled_values);
        const bookmarkletHref = 'javascript:' + encodeURIComponent(fillScript);

        // Replace the VNC button with a bookmarklet + copy-to-console option
        const existingActions = document.getElementById('apply-browser-actions');
        if (existingActions) existingActions.remove();
        const actions = document.createElement('div');
        actions.id = 'apply-browser-actions';
        actions.style.cssText = 'padding:0 14px 12px;display:flex;flex-direction:column;gap:8px';
        actions.innerHTML = `
          <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:2px">Fill in your browser:</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="${bookmarkletHref}" class="btn btn-primary btn-sm" style="text-decoration:none;flex:1;justify-content:center"
               title="Drag this to your bookmarks bar, then click it on the form page">
              🔖 Drag to Bookmarks Bar
            </a>
            <button class="btn btn-ghost btn-sm" style="flex:1" onclick="
              navigator.clipboard.writeText(${JSON.stringify(fillScript)});
              this.textContent='✅ Copied!';
              setTimeout(()=>this.textContent='📋 Copy Fill Script',1500);
            ">📋 Copy Fill Script</button>
          </div>
          <div style="font-size:11px;color:var(--text-muted);background:var(--bg);padding:8px 10px;border-radius:6px;line-height:1.6">
            <strong style="color:var(--text)">How to use:</strong><br>
            1. Click <strong>🌐 Open Form</strong> to open the form in a new tab<br>
            2. Drag the 🔖 bookmarklet to your bookmarks bar, then click it<br>
            &nbsp;&nbsp;&nbsp;<em>— or —</em> press <kbd>F12</kbd> → Console → paste the script<br>
            3. Form fills automatically · Solve captcha · Submit ✓
          </div>`;
        panel.appendChild(actions);

        // Also keep the values table as reference
        const existingGuide = document.getElementById('apply-fill-guide');
        if (existingGuide) existingGuide.remove();
      }
    } else if (evt.type === 'error') {
      const err = document.getElementById('apply-error-msg');
      err.textContent = evt.message || 'An error occurred';
      err.classList.remove('hidden');
      appendApplyStep(ICON_X, evt.message || 'Error');
    }
  });
}

// ── Mobile sidebar helpers ────────────────────────────────────────────────────

function _mobileOpenSidebar() {
  const sidebar  = document.querySelector('.sidebar');
  const overlay  = document.getElementById('mobile-sidebar-overlay');
  if (sidebar)  sidebar.classList.add('mobile-open');
  if (overlay) { overlay.classList.add('open'); overlay.removeAttribute('aria-hidden'); }
  document.body.style.overflow = 'hidden';
}

function _mobileCloseSidebar() {
  const sidebar  = document.querySelector('.sidebar');
  const overlay  = document.getElementById('mobile-sidebar-overlay');
  if (sidebar)  sidebar.classList.remove('mobile-open');
  if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); }
  document.body.style.overflow = '';
}

// ── Scan animation helpers ─────────────────────────────────────────────────────

/**
 * Create or update a site card in the scan animation grid.
 * @param {string}  siteName  - Display name of the site
 * @param {string}  siteUrl   - URL (used to extract domain for logo)
 * @param {'scanning'|'done'|'error'} state
 * @param {number|null} jobCount  - jobs found (null while scanning)
 * @param {number|null} _unused
 */
function _scanAnimUpsertCard(siteName, siteUrl, state, jobCount, _unused) {
  const grid = document.getElementById('scan-anim-grid');
  if (!grid) return;

  const cardId = 'scan-card-' + siteName.replace(/[^a-zA-Z0-9]/g, '-');
  let card = document.getElementById(cardId);

  if (!card) {
    card = document.createElement('div');
    card.id = cardId;
    card.className = 'scan-anim-card';
    grid.appendChild(card);
  }

  // Derive initials for logo fallback
  const initials = siteName.trim().slice(0, 2).toUpperCase() || '?';

  // Try to get a favicon from the site URL
  let logoHTML = '';
  if (siteUrl) {
    try {
      const domain = new URL(siteUrl).hostname;
      logoHTML = `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" width="28" height="28" alt=""
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
        <span style="display:none;align-items:center;justify-content:center;width:100%;height:100%;font-size:13px;font-weight:700">${initials}</span>`;
    } catch {
      logoHTML = `<span style="align-items:center;justify-content:center;width:100%;height:100%;font-size:13px;font-weight:700;display:flex">${initials}</span>`;
    }
  } else {
    logoHTML = `<span style="align-items:center;justify-content:center;width:100%;height:100%;font-size:13px;font-weight:700;display:flex">${initials}</span>`;
  }

  // Right-side accessory
  let rightHTML = '';
  if (state === 'scanning') {
    rightHTML = `<div class="scan-anim-right"><span class="spinner-sm"></span></div>`;
  } else if (state === 'done') {
    const countBadge = jobCount != null
      ? `<span class="scan-anim-count">${jobCount} job${jobCount !== 1 ? 's' : ''}</span>` : '';
    rightHTML = `<div class="scan-anim-right">
      ${countBadge}
      <span class="scan-anim-check">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
    </div>`;
  } else if (state === 'error') {
    rightHTML = `<div class="scan-anim-right">
      <span class="scan-anim-err-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>
    </div>`;
  }

  const statusText = state === 'scanning' ? 'Scanning…' : state === 'done' ? 'Done' : 'Failed';

  card.className = `scan-anim-card ${state}`;
  card.innerHTML = `
    <div class="scan-anim-logo">${logoHTML}</div>
    <div class="scan-anim-body">
      <div class="scan-anim-name">${esc(siteName)}</div>
      <div class="scan-anim-status" id="${cardId}-status">
        ${state === 'scanning' ? '' : ''}${esc(statusText)}
      </div>
    </div>
    ${rightHTML}`;
}

/** Update only the status text of an existing scan card (e.g. agent steps) */
function _scanAnimSetStatus(siteName, message) {
  const cardId   = 'scan-card-' + siteName.replace(/[^a-zA-Z0-9]/g, '-');
  const statusEl = document.getElementById(`${cardId}-status`);
  if (statusEl) statusEl.textContent = message;
}

// ── Skeleton loader helpers ────────────────────────────────────────────────────

/**
 * Inject N skeleton feed cards into the results container.
 * Only shown when there are no real cards and no scan is active.
 */
function _showFeedSkeletons(container, count = 4) {
  if (!container || container.dataset.scanActive) return;
  if (feedResults.length > 0) return; // real data already there
  // Don't double-inject
  if (container.querySelector('.skeleton-feed-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'skeleton-feed-wrapper';

  for (let i = 0; i < count; i++) {
    // Vary widths per card for natural look
    const w1 = 30 + (i % 3) * 12;   // source label
    const w2 = 55 + (i % 4) * 10;   // role title
    const w3 = 35 + (i % 2) * 15;   // location
    const w4 = 70 + (i % 3) * 8;    // summary line 1
    const w5 = 50 + (i % 5) * 6;    // summary line 2

    const card = document.createElement('div');
    card.className = 'skeleton-feed-card';
    card.innerHTML = `
      <div class="skeleton-card-top">
        <div class="skeleton-logo skeleton-shimmer"></div>
        <div class="skeleton-body">
          <div class="skeleton-line skeleton-shimmer" style="width:${w1}%;height:9px"></div>
          <div class="skeleton-line skeleton-shimmer" style="width:${w2}%;height:13px"></div>
          <div class="skeleton-line skeleton-shimmer" style="width:${w3}%;height:10px"></div>
          <div class="skeleton-line skeleton-shimmer" style="width:${w4}%;height:10px;margin-top:3px"></div>
          <div class="skeleton-line skeleton-shimmer" style="width:${w5}%;height:10px"></div>
        </div>
        <div class="skeleton-score skeleton-shimmer"></div>
      </div>
      <div class="skeleton-actions">
        <div class="skeleton-btn skeleton-shimmer" style="width:88px"></div>
        <div class="skeleton-btn skeleton-shimmer" style="width:96px"></div>
        <div class="skeleton-btn skeleton-shimmer" style="width:72px"></div>
      </div>`;
    wrapper.appendChild(card);
  }

  container.appendChild(wrapper);
}

/**
 * Remove skeleton wrapper from container.
 * Plays a fade-out if cards are still present, then removes.
 */
function _hideFeedSkeletons(container) {
  if (!container) return;
  const wrapper = container.querySelector('.skeleton-feed-wrapper');
  if (!wrapper) return;
  wrapper.classList.add('skeleton-hiding');
  wrapper.addEventListener('animationend', () => wrapper.remove(), { once: true });
  // Fallback in case animationend doesn't fire
  setTimeout(() => wrapper.remove(), 400);
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize login screen first — must work even if rest of app fails
  try { initLoginScreen(); } catch(e) { console.error('initLoginScreen failed:', e); }

  // Hide the main app until auth is confirmed
  document.getElementById('app').style.display = 'none';

  // Wire sign-out button
  document.getElementById('signout-btn')?.addEventListener('click', () => signOut());

  // Initialize app UI (tabs, forms, etc.) — each wrapped so one crash doesn't kill the rest
  try { initTabs(); } catch(e) { console.error('initTabs:', e); }
  try { initBrowseTab(); } catch(e) { console.error('initBrowseTab:', e); }
  try { initCoverTab(); } catch(e) { console.error('initCoverTab:', e); }
  try { initDemoTab(); } catch(e) { console.error('initDemoTab:', e); }
  try { initResumeTab(); } catch(e) { console.error('initResumeTab:', e); }
  try { initProfileSection(); } catch(e) { console.error('initProfileSection:', e); }
  try { initWizardButtons(); } catch(e) { console.error('initWizardButtons:', e); }
  try { initFeedTab(); } catch(e) { console.error('initFeedTab:', e); }
  try { initProfileTab(); } catch(e) { console.error('initProfileTab:', e); }
  try { initBoardViewToggle(); } catch(e) { console.error('initBoardViewToggle:', e); }
  try { initChatTab(); } catch(e) { console.error('initChatTab:', e); }

  // Apply modal close button
  document.getElementById('apply-close-btn').addEventListener('click', () => {
    document.getElementById('apply-modal').classList.add('hidden');
  });

  // Check for an existing Supabase session (page reload)
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    const name  = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '';
    const email = session.user.email ?? '';
    updateSidebarUser(name, email);
    _setDashGreeting(name);
    await registerWithBackend(session); // sets activeUserId
    if (activeUserId) localStorage.setItem('activeUserId', String(activeUserId));
    showAppScreen();
    loadDashboard();
    refreshFeedTab();
    if (window._loadResumeMaster) window._loadResumeMaster();
  } else {
    const demoAuthRaw = localStorage.getItem(DEMO_AUTH_STORAGE_KEY);
    if (demoAuthRaw) {
      try {
        const demoUser = JSON.parse(demoAuthRaw);
        if (demoUser?.id) {
          await _activateDemoSession(demoUser);
        } else {
          _clearDemoAuth();
          showLoginScreen();
        }
      } catch {
        _clearDemoAuth();
        showLoginScreen();
      }
    } else {
      showLoginScreen();
    }
  }

  // Listen for future auth state changes (e.g. token refresh, sign-out from another tab)
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
      _clearDemoAuth();
      activeUserId = null;
      window._activeUserDbProfile = null;
      showLoginScreen();
    }
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
  t3.textContent = 'JD sent to AI';
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

  // ── Auto-scan & Notifications settings ─────────────────────────────────────
  const settings = await api.get('/api/settings');
  const users = await api.get('/api/users');

  const settingsSection = document.createElement('div');
  settingsSection.innerHTML = `
    <div class="section-title" style="margin-top:28px">Automation Schedule</div>
    <div class="card" style="margin-bottom:14px">
      <div style="font-size:13px;color:var(--text-dim);line-height:1.6;margin-bottom:14px">
        Discovery finds and refreshes jobs quickly. Analyze scores the jobs already in your feed against the selected profile.
      </div>
      <div class="settings-grid">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px">1. Job Discovery</div>
          <div style="font-size:12px;color:var(--text-dim)">Crawls active sites, adds new listings, and removes listings that disappeared.</div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:6px">2. Job Analyze</div>
          <div style="font-size:12px;color:var(--text-dim)">Scores the current feed against a profile’s resume and preferences.</div>
        </div>
      </div>
    </div>

    <div class="section-title">Job Discovery Schedule</div>
    <div class="card" style="margin-bottom:14px">
      <div class="settings-grid">
        <div class="form-group">
          <label class="label">Enabled</label>
          <div class="mode-toggle">
            <button class="mode-btn ${(settings.discovery_enabled || settings.scan_enabled) === '1' ? 'active' : ''}" id="discovery-toggle-on" data-val="1">On</button>
            <button class="mode-btn ${(settings.discovery_enabled || settings.scan_enabled) !== '1' ? 'active' : ''}" id="discovery-toggle-off" data-val="0">Off</button>
          </div>
        </div>
      </div>
      <div class="form-group" style="margin-top:14px">
        <label class="label">Schedule <span class="label-hint">cron expression — e.g. <code style="font-family:var(--mono)">0 9 * * *</code> = daily at 9am</span></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn btn-secondary btn-sm discovery-preset" data-cron="0 9 * * *">Daily 9am</button>
          <button class="btn btn-secondary btn-sm discovery-preset" data-cron="0 9 * * 1-5">Weekdays 9am</button>
          <button class="btn btn-secondary btn-sm discovery-preset" data-cron="0 */6 * * *">Every 6 h</button>
        </div>
        <input id="discovery-cron-input" class="input" style="margin-top:8px;font-family:var(--mono)"
          value="${esc(settings.discovery_cron || settings.scan_cron || '0 9 * * *')}" placeholder="0 9 * * *" />
      </div>
      <div style="margin-top:14px">
        <button class="btn btn-primary btn-sm" id="save-discovery-schedule-btn">Save Discovery Schedule</button>
        <span id="discovery-schedule-save-status" style="font-size:12px;color:var(--text-dim);margin-left:10px"></span>
      </div>
    </div>

    <div class="section-title">Job Analyze Schedule</div>
    <div class="card" style="margin-bottom:14px">
      <div style="font-size:12px;color:var(--text-dim);line-height:1.6;margin-bottom:12px">
        This runs a scoring pass across the jobs already in the feed. A common pattern is frequent discovery and less frequent analysis.
      </div>
      <div class="settings-grid">
        <div class="form-group">
          <label class="label">Enabled</label>
          <div class="mode-toggle">
            <button class="mode-btn ${(settings.analyze_enabled || settings.scan_enabled) === '1' ? 'active' : ''}" id="analyze-toggle-on" data-val="1">On</button>
            <button class="mode-btn ${(settings.analyze_enabled || settings.scan_enabled) !== '1' ? 'active' : ''}" id="analyze-toggle-off" data-val="0">Off</button>
          </div>
        </div>
      </div>
      <div class="form-group" style="margin-top:14px">
        <label class="label">Schedule</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <button class="btn btn-secondary btn-sm analyze-preset" data-cron="30 9 * * *">Daily 9:30am</button>
          <button class="btn btn-secondary btn-sm analyze-preset" data-cron="30 9 * * 1-5">Weekdays 9:30am</button>
          <button class="btn btn-secondary btn-sm analyze-preset" data-cron="0 */12 * * *">Every 12 h</button>
        </div>
        <input id="analyze-cron-input" class="input" style="margin-top:8px;font-family:var(--mono)"
          value="${esc(settings.analyze_cron || '30 9 * * *')}" placeholder="30 9 * * *" />
      </div>
      <div style="margin-top:14px">
        <button class="btn btn-primary btn-sm" id="save-analyze-schedule-btn">Save Analyze Schedule</button>
        <span id="analyze-schedule-save-status" style="font-size:12px;color:var(--text-dim);margin-left:10px"></span>
      </div>
    </div>

    <div class="section-title">Notifications (ntfy)</div>
    <div class="card">
      <div class="settings-grid">
        <div class="form-group">
          <label class="label">Alerts enabled</label>
          <div class="mode-toggle">
            <button class="mode-btn ${settings.alert_enabled === '1' ? 'active' : ''}" id="alert-toggle-on">On</button>
            <button class="mode-btn ${settings.alert_enabled !== '1' ? 'active' : ''}" id="alert-toggle-off">Off</button>
          </div>
        </div>
        <div class="form-group">
          <label class="label">Min score to alert</label>
          <input id="alert-threshold" class="input" type="number" min="0" max="100"
            value="${esc(settings.alert_threshold || '80')}" style="max-width:90px" />
        </div>
      </div>
      <div class="form-group" style="margin-top:14px">
        <label class="label">Notification cooldown <span class="label-hint">minimum time between alerts — prevents notification spam during large scans</span></label>
        <select id="alert-cooldown" class="input" style="max-width:180px;margin-top:4px">
          <option value="0"    ${(settings.alert_cooldown_minutes || '0') === '0'    ? 'selected' : ''}>None</option>
          <option value="30"   ${settings.alert_cooldown_minutes === '30'   ? 'selected' : ''}>30 minutes</option>
          <option value="60"   ${settings.alert_cooldown_minutes === '60'   ? 'selected' : ''}>1 hour</option>
          <option value="240"  ${settings.alert_cooldown_minutes === '240'  ? 'selected' : ''}>4 hours</option>
          <option value="720"  ${settings.alert_cooldown_minutes === '720'  ? 'selected' : ''}>12 hours</option>
          <option value="1440" ${settings.alert_cooldown_minutes === '1440' ? 'selected' : ''}>24 hours</option>
        </select>
      </div>
      <div class="form-group" style="margin-top:14px">
        <label class="label">ntfy topic <span class="label-hint">just the topic name, e.g. <code style="font-family:var(--mono)">my-jobs</code></span></label>
        <input id="ntfy-topic" class="input" value="${esc(settings.ntfy_topic || '')}" placeholder="my-jobs" />
      </div>
      <div class="form-group" style="margin-top:12px">
        <label class="label">ntfy server <span class="label-hint">leave blank for ntfy.sh</span></label>
        <input id="ntfy-server" class="input" value="${esc(settings.ntfy_server || '')}" placeholder="https://ntfy.sh" />
      </div>
      <div style="margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="save-ntfy-btn">Save</button>
        <button class="btn btn-secondary btn-sm" id="test-ntfy-btn">Send Test</button>
        <span id="ntfy-save-status" style="font-size:12px;color:var(--text-dim)"></span>
      </div>
    </div>`;

  container.appendChild(settingsSection);

  // Schedule enabled toggle
  let discoveryEnabled = (settings.discovery_enabled || settings.scan_enabled) === '1';
  settingsSection.querySelectorAll('[id^="discovery-toggle-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      discoveryEnabled = btn.dataset.val === '1';
      settingsSection.querySelector('#discovery-toggle-on').classList.toggle('active', discoveryEnabled);
      settingsSection.querySelector('#discovery-toggle-off').classList.toggle('active', !discoveryEnabled);
    });
  });

  let analyzeEnabled = (settings.analyze_enabled || settings.scan_enabled) === '1';
  settingsSection.querySelectorAll('[id^="analyze-toggle-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      analyzeEnabled = btn.dataset.val === '1';
      settingsSection.querySelector('#analyze-toggle-on').classList.toggle('active', analyzeEnabled);
      settingsSection.querySelector('#analyze-toggle-off').classList.toggle('active', !analyzeEnabled);
    });
  });

  // Alert enabled toggle
  let alertEnabled = settings.alert_enabled === '1';
  settingsSection.querySelectorAll('[id^="alert-toggle-"]').forEach(btn => {
    btn.addEventListener('click', () => {
      alertEnabled = btn.id === 'alert-toggle-on';
      settingsSection.querySelector('#alert-toggle-on').classList.toggle('active', alertEnabled);
      settingsSection.querySelector('#alert-toggle-off').classList.toggle('active', !alertEnabled);
    });
  });

  // Cron presets
  settingsSection.querySelectorAll('.discovery-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      settingsSection.querySelector('#discovery-cron-input').value = btn.dataset.cron;
    });
  });

  settingsSection.querySelectorAll('.analyze-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      settingsSection.querySelector('#analyze-cron-input').value = btn.dataset.cron;
    });
  });

  settingsSection.querySelector('#save-discovery-schedule-btn').addEventListener('click', async () => {
    const status = settingsSection.querySelector('#discovery-schedule-save-status');
    status.textContent = 'Saving…';
    await api.post('/api/settings', {
      discovery_enabled: discoveryEnabled ? '1' : '0',
      discovery_cron: settingsSection.querySelector('#discovery-cron-input').value.trim(),
      discovery_user_id: String(activeUserId),
    });
    status.textContent = '✓ Saved';
    setTimeout(() => { status.textContent = ''; }, 2500);
  });

  settingsSection.querySelector('#save-analyze-schedule-btn').addEventListener('click', async () => {
    const status = settingsSection.querySelector('#analyze-schedule-save-status');
    status.textContent = 'Saving…';
    await api.post('/api/settings', {
      analyze_enabled: analyzeEnabled ? '1' : '0',
      analyze_cron: settingsSection.querySelector('#analyze-cron-input').value.trim(),
      analyze_user_id: String(activeUserId),
    });
    status.textContent = '✓ Saved';
    setTimeout(() => { status.textContent = ''; }, 2500);
  });

  // Save ntfy
  settingsSection.querySelector('#save-ntfy-btn').addEventListener('click', async () => {
    const status = settingsSection.querySelector('#ntfy-save-status');
    status.textContent = 'Saving…';
    await api.post('/api/settings', {
      alert_enabled:           alertEnabled ? '1' : '0',
      alert_threshold:         settingsSection.querySelector('#alert-threshold').value,
      alert_cooldown_minutes:  settingsSection.querySelector('#alert-cooldown').value,
      ntfy_topic:              settingsSection.querySelector('#ntfy-topic').value.trim(),
      ntfy_server:             settingsSection.querySelector('#ntfy-server').value.trim(),
    });
    status.textContent = '✓ Saved';
    setTimeout(() => { status.textContent = ''; }, 2500);
  });

  // Test ntfy
  settingsSection.querySelector('#test-ntfy-btn').addEventListener('click', async () => {
    const status = settingsSection.querySelector('#ntfy-save-status');
    const topic  = settingsSection.querySelector('#ntfy-topic').value.trim();
    const server = settingsSection.querySelector('#ntfy-server').value.trim();
    if (!topic) { toast('Enter a topic first', 'error'); return; }
    status.textContent = 'Sending…';
    const res = await api.post('/api/settings/test-ntfy', { topic, server });
    status.textContent = res.ok ? '✓ Sent!' : `Error: ${res.error}`;
    setTimeout(() => { status.textContent = ''; }, 3000);
  });
}

// ── Profile hero live update ──────────────────────────────────────────────────

// Track when the profile was last synced
let _profileLastSyncedAt = null;

/**
 * Update the new profile hero card (profile-hero-card) with current data.
 * Reads from DOM values already populated by loadProfileTab, plus live resume text.
 * Safe to call multiple times — only updates elements that exist.
 */
function updateProfileHero(opts = {}) {
  const {
    name       = document.getElementById('profile-name')?.value.trim()  || '',
    email      = document.getElementById('profile-email')?.value.trim() || '',
    resumeText = document.getElementById('profile-resume')?.value       || '',
  } = opts;

  // Avatar initials
  const avatarEl = document.getElementById('profile-hero-avatar');
  if (avatarEl) avatarEl.textContent = getInitials(name || email || '');

  // Name + email
  const nameEl  = document.getElementById('profile-hero-name');
  const emailEl = document.getElementById('profile-hero-email');
  if (nameEl)  nameEl.textContent  = name  || '—';
  if (emailEl) emailEl.textContent = email || '';

  // Resume pill
  const resumePill = document.getElementById('profile-hero-resume-pill');
  if (resumePill) {
    const chars = resumeText.trim().length;
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
    if (chars > 0) {
      resumePill.innerHTML = `${svgIcon} Resume: ${chars.toLocaleString()} chars`;
      resumePill.className = 'profile-hero-pill profile-hero-pill--resume' + (chars >= 1000 ? ' has-resume' : ' no-resume');
    } else {
      resumePill.innerHTML = `${svgIcon} Resume: empty`;
      resumePill.className = 'profile-hero-pill profile-hero-pill--resume no-resume';
    }
  }

  // Automator connection pill — check if server is reachable
  const automatorPill = document.getElementById('profile-hero-automator-pill');
  if (automatorPill) {
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>`;
    // Use a cached check or kick one off
    _checkAutomatorConnection().then(connected => {
      if (!automatorPill) return;
      if (connected) {
        automatorPill.innerHTML = `${svgIcon} Job Automator: Connected`;
        automatorPill.className = 'profile-hero-pill profile-hero-pill--automator connected';
      } else {
        automatorPill.innerHTML = `${svgIcon} Job Automator: Offline`;
        automatorPill.className = 'profile-hero-pill profile-hero-pill--automator offline';
      }
    });
  }

  // Last synced text
  const syncEl = document.getElementById('profile-hero-sync');
  if (syncEl) {
    if (_profileLastSyncedAt) {
      const diffMs  = Date.now() - _profileLastSyncedAt;
      const diffMin = Math.floor(diffMs / 60000);
      const dotHTML = `<span class="profile-hero-sync-dot"></span>`;
      if (diffMin < 1) {
        syncEl.innerHTML = `${dotHTML} Synced just now`;
      } else if (diffMin === 1) {
        syncEl.innerHTML = `${dotHTML} Last synced 1 min ago`;
      } else if (diffMin < 60) {
        syncEl.innerHTML = `${dotHTML} Last synced ${diffMin} min ago`;
      } else {
        const hrs = Math.floor(diffMin / 60);
        syncEl.innerHTML = `${dotHTML} Last synced ${hrs}h ago`;
      }
    } else {
      syncEl.innerHTML = '';
    }
  }
}

let _automatorConnected = null;
let _lastConnectionCheck = 0;

async function _checkAutomatorConnection() {
  const now = Date.now();
  // Cache the result for 60 seconds
  if (_automatorConnected !== null && now - _lastConnectionCheck < 60000) {
    return _automatorConnected;
  }
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
    _automatorConnected = r.ok;
  } catch {
    _automatorConnected = false;
  }
  _lastConnectionCheck = Date.now();
  return _automatorConnected;
}

// Patch loadProfileTab to also call updateProfileHero after data loads
const _origLoadProfileTab = loadProfileTab;
loadProfileTab = async function(...args) {
  await _origLoadProfileTab.apply(this, args);
  // Derive from loaded form values
  const resumeText = document.getElementById('profile-resume')?.value || '';
  updateProfileHero({ resumeText });
  _profileLastSyncedAt = Date.now();
  // Update sync text 1 second later (so it shows "just now")
  setTimeout(() => updateProfileHero({ resumeText }), 1000);
};

// ── Cover Letter: job picker from feed ───────────────────────────────────────

let _coverFeedJobs = [];   // cached feed jobs for picker
let _coverFeedLoaded = false;

async function loadCoverFeedJobs() {
  if (!activeUserId) return;
  const selectEl    = document.getElementById('cover-job-select');
  const statusEl    = document.getElementById('cover-job-picker-status');
  if (!selectEl) return;

  if (statusEl) statusEl.innerHTML = `<span class="spinner-sm"></span> Loading jobs from feed…`;

  try {
    const cached = await api.get(`/api/feed/cached?userId=${activeUserId}`);
    const jobs = Array.isArray(cached) ? cached.filter(j => j.job && (j.site_name || j.job.title)) : [];
    _coverFeedJobs = jobs;
    _coverFeedLoaded = true;

    // Rebuild select options
    if (!jobs.length) {
      selectEl.innerHTML = `<option value="">— No scanned jobs yet. Run a scan first. —</option>`;
      if (statusEl) statusEl.textContent = '0 jobs in feed';
      return;
    }

    selectEl.innerHTML = `<option value="">— Select a scanned job to auto-fill —</option>` +
      jobs.map((j, i) => {
        const company = j.site_name || '';
        const role    = j.job?.title || '—';
        const score   = j.match_score != null ? ` · ${j.match_score}%` : '';
        const label   = company ? `${company} — ${role}${score}` : `${role}${score}`;
        return `<option value="${i}">${esc(label.length > 80 ? label.slice(0,80)+'…' : label)}</option>`;
      }).join('');

    if (statusEl) statusEl.textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''} available`;
  } catch (e) {
    if (statusEl) statusEl.textContent = 'Failed to load feed jobs';
    console.error('loadCoverFeedJobs:', e);
  }
}

function initCoverJobPicker() {
  const selectEl  = document.getElementById('cover-job-select');
  const refreshEl = document.getElementById('cover-job-refresh-btn');

  if (!selectEl) return;

  // Load jobs when user switches to cover tab
  selectEl.addEventListener('focus', () => {
    if (!_coverFeedLoaded && activeUserId) loadCoverFeedJobs();
  });

  // Auto-fill company + role when a job is picked
  selectEl.addEventListener('change', () => {
    const idx = parseInt(selectEl.value, 10);
    if (isNaN(idx) || idx < 0) {
      window._coverSelectedJobUrl = null;
      return;
    }
    const j = _coverFeedJobs[idx];
    if (!j) { window._coverSelectedJobUrl = null; return; }

    const companyInput = document.getElementById('cover-company');
    const roleInput    = document.getElementById('cover-role');
    if (companyInput) companyInput.value = j.site_name || '';
    if (roleInput)    roleInput.value    = j.job?.title || '';
    window._coverSelectedJobUrl = j.job?.url || null;

    // Visual confirmation
    const statusEl = document.getElementById('cover-job-picker-status');
    if (statusEl) {
      statusEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Auto-filled from job feed`;
      statusEl.style.color = 'var(--success)';
      setTimeout(() => { if (statusEl) { statusEl.textContent = `${_coverFeedJobs.length} jobs available`; statusEl.style.color = ''; } }, 2500);
    }
  });

  // Refresh button
  refreshEl?.addEventListener('click', () => {
    _coverFeedLoaded = false;
    loadCoverFeedJobs();
  });
}


// Load cover feed jobs whenever the cover tab becomes active
const _origSwitchTab = switchTab;
switchTab = function(tab) {
  _origSwitchTab(tab);
  if (tab === 'cover' && activeUserId && !_coverFeedLoaded) {
    loadCoverFeedJobs();
  }
};

// ── Registration Onboarding Wizard ────────────────────────────────────────────
// Fires once for brand-new users (no resume) after their first login.
// Modal ID: #registration-onboard-modal   CSS prefix: .onboard-
// Does NOT interfere with the existing #onboarding-modal (profile-creation wizard).
// ─────────────────────────────────────────────────────────────────────────────

const REG_ONBOARD_STEPS = 3;

const _regOnboard = {
  step: 1,
  // Step 1 state
  resumeUploaded: false,
  resumeFile: null,
  // Step 2 state
  prefs: {
    workType:   null,   // 'remote'|'hybrid'|'on-site'|'any'
    expLevel:   null,   // 'junior'|'mid'|'senior'|'lead'
    relocation: null,   // 'yes'|'no'
    salary:     null,   // '0'|'80k'|'100k'|'120k'|'150k+'
  },
  // Step 3 state
  selectedSites: new Set(),   // set of preset site keys
  linkedinUrl: '',
  customUrl: '',
  // Preset companies for step 3
  presets: [
    { key: 'stripe',  name: 'Stripe',  ats: 'greenhouse', slug: 'stripe',  domain: 'stripe.com' },
    { key: 'linear',  name: 'Linear',  ats: 'ashby',      slug: 'linear',  domain: 'linear.app' },
    { key: 'vercel',  name: 'Vercel',  ats: 'greenhouse', slug: 'vercel',  domain: 'vercel.com' },
    { key: 'bold',    name: 'BOLD',    ats: 'greenhouse', slug: 'bold',    domain: 'bold.com' },
  ],
};

function showRegistrationOnboarding(userName, userEmail) {
  const modal = document.getElementById('registration-onboard-modal');
  if (!modal) return;
  _regOnboard.step = 1;
  _regOnboard.resumeUploaded = false;
  _regOnboard.resumeFile = null;
  _regOnboard.prefs = { workType: null, expLevel: null, relocation: null, salary: null };
  _regOnboard.selectedSites = new Set();
  _regOnboard.linkedinUrl = '';
  _regOnboard.customUrl = '';
  modal.style.display = 'flex';
  _regOnboardRender();
  _regOnboardInitNav();
}

function _closeRegistrationOnboarding() {
  const modal = document.getElementById('registration-onboard-modal');
  if (modal) modal.style.display = 'none';
}

function _regOnboardRender() {
  _regOnboardRenderDots();
  _regOnboardRenderBody();
  _regOnboardUpdateNav();
}

function _regOnboardRenderDots() {
  const el = document.getElementById('onboard-dots');
  if (!el) return;
  el.innerHTML = Array.from({ length: REG_ONBOARD_STEPS }, (_, i) => {
    const n = i + 1;
    const cls = n < _regOnboard.step ? 'onboard-dot done' : n === _regOnboard.step ? 'onboard-dot active' : 'onboard-dot';
    return `<div class="${cls}" aria-label="Step ${n}${n < _regOnboard.step ? ' complete' : n === _regOnboard.step ? ' current' : ''}"></div>`;
  }).join('');
}

function _regOnboardRenderBody() {
  const body = document.getElementById('onboard-body');
  if (!body) return;
  if (_regOnboard.step === 1) body.innerHTML = _regOnboardStep1HTML();
  if (_regOnboard.step === 2) body.innerHTML = _regOnboardStep2HTML();
  if (_regOnboard.step === 3) body.innerHTML = _regOnboardStep3HTML();
  // Wire interactive elements after render
  if (_regOnboard.step === 1) _regOnboardWireStep1();
  if (_regOnboard.step === 2) _regOnboardWireStep2();
  if (_regOnboard.step === 3) _regOnboardWireStep3();
}

function _regOnboardUpdateNav() {
  const backBtn = document.getElementById('onboard-back-btn');
  const nextBtn = document.getElementById('onboard-next-btn');
  const skipBtn = document.getElementById('onboard-skip-all-btn');
  if (!backBtn || !nextBtn) return;

  backBtn.style.visibility = _regOnboard.step === 1 ? 'hidden' : '';

  const isLast = _regOnboard.step === REG_ONBOARD_STEPS;
  nextBtn.textContent = isLast ? 'Start Scanning' : 'Next →';
  if (skipBtn) skipBtn.textContent = isLast ? 'Skip & finish' : 'Skip step';

  // Next is always enabled — every step is optional
  nextBtn.disabled = false;
}

function _regOnboardInitNav() {
  const backBtn = document.getElementById('onboard-back-btn');
  const nextBtn = document.getElementById('onboard-next-btn');
  const skipAll = document.getElementById('onboard-skip-all-btn');

  if (backBtn) {
    backBtn.onclick = () => {
      if (_regOnboard.step > 1) {
        _regOnboard.step--;
        _regOnboardRender();
      }
    };
  }

  if (nextBtn) {
    nextBtn.onclick = async () => {
      await _regOnboardNext();
    };
  }

  if (skipAll) {
    skipAll.onclick = async () => {
      // Skip = advance to next step; on last step = close wizard
      if (_regOnboard.step < REG_ONBOARD_STEPS) {
        _regOnboard.step++;
        _regOnboardRender();
      } else {
        _closeRegistrationOnboarding();
      }
    };
  }
}

async function _regOnboardNext() {
  const nextBtn = document.getElementById('onboard-next-btn');
  if (!nextBtn) return;

  if (_regOnboard.step < REG_ONBOARD_STEPS) {
    // Save current step data then advance
    if (_regOnboard.step === 2) await _regOnboardSavePrefs();
    _regOnboard.step++;
    _regOnboardRender();
  } else {
    // Final step — save and close
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<span class="spinner"></span>';
    try {
      await _regOnboardFinish();
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Start Scanning';
    }
  }
}

// ── Step 1: Resume Upload ────────────────────────────────────────────────────

function _regOnboardStep1HTML() {
  const uploaded = _regOnboard.resumeUploaded;
  return `
    <div class="onboard-title" id="onboard-modal-title">Let's start with your resume</div>
    <div class="onboard-sub">Upload your resume so we can score every job against your profile. PDF, DOCX, or TXT — up to 10 MB.</div>
    <div class="onboard-drop-zone${uploaded ? ' onboard-uploaded' : ''}" id="onboard-drop-zone" tabindex="0" role="button" aria-label="Upload resume file">
      <div class="onboard-drop-icon">
        ${uploaded
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`
        }
      </div>
      <div class="onboard-drop-title">${uploaded ? 'Resume uploaded!' : 'Drop your resume here'}</div>
      <div class="onboard-drop-hint">${uploaded
        ? (typeof _regOnboard.resumeFile?.name === 'string' ? esc(_regOnboard.resumeFile.name) : 'File ready')
        : 'PDF &middot; DOCX &middot; TXT'}</div>
      ${!uploaded ? `<button class="btn btn-secondary btn-sm" id="onboard-browse-btn" style="margin-top:12px" type="button">Browse files</button>` : ''}
    </div>
    <input type="file" id="onboard-file-input" accept=".pdf,.docx,.txt" hidden />
    <div class="onboard-upload-status" id="onboard-upload-status"></div>
    <button class="onboard-skip-link" id="onboard-step1-skip" type="button">Skip for now</button>`;
}

function _regOnboardWireStep1() {
  const dropZone  = document.getElementById('onboard-drop-zone');
  const fileInput = document.getElementById('onboard-file-input');
  const browseBtn = document.getElementById('onboard-browse-btn');
  const skipLink  = document.getElementById('onboard-step1-skip');
  const statusEl  = document.getElementById('onboard-upload-status');

  if (browseBtn) browseBtn.addEventListener('click', e => { e.stopPropagation(); fileInput?.click(); });
  if (dropZone)  dropZone.addEventListener('click', () => { if (!_regOnboard.resumeUploaded) fileInput?.click(); });
  if (dropZone)  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput?.click(); });

  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('onboard-drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('onboard-drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('onboard-drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) _regOnboardHandleResumeFile(file, statusEl);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) _regOnboardHandleResumeFile(file, statusEl);
    });
  }

  if (skipLink) {
    skipLink.addEventListener('click', () => {
      _regOnboard.step++;
      _regOnboardRender();
    });
  }
}

async function _regOnboardHandleResumeFile(file, statusEl) {
  if (!file) return;
  const allowed = ['.pdf', '.docx', '.txt'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    if (statusEl) statusEl.textContent = 'Only PDF, DOCX, or TXT files are accepted.';
    return;
  }

  _regOnboard.resumeFile = file;
  if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Uploading…';

  try {
    const form = new FormData();
    form.append('file', file);
    if (activeUserId) form.append('userId', String(activeUserId));

    const token = await getAccessToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res  = await fetch('/api/resume/merge', { method: 'POST', headers, body: form });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    _regOnboard.resumeUploaded = true;
    if (statusEl) statusEl.textContent = '';

    // Re-render the drop zone in-place without full step re-render
    _regOnboardRenderBody();

  } catch (e) {
    if (statusEl) statusEl.textContent = 'Upload failed: ' + (e.message || 'unknown error');
  }
}

// ── Step 2: Preferences ──────────────────────────────────────────────────────

function _regOnboardPillGroupHTML(groupKey, options) {
  return `<div class="onboard-pills" data-group="${groupKey}">` +
    options.map(o => {
      const selected = _regOnboard.prefs[groupKey] === o.value;
      return `<button class="onboard-pill${selected ? ' selected' : ''}" data-group="${groupKey}" data-value="${esc(o.value)}" type="button">${esc(o.label)}</button>`;
    }).join('') +
    `</div>`;
}

function _regOnboardStep2HTML() {
  return `
    <div class="onboard-title">What are you looking for?</div>
    <div class="onboard-sub">These preferences filter your job feed. All optional — you can change them later in Profile.</div>

    <div class="onboard-pref-group">
      <div class="onboard-pref-label">Work type</div>
      ${_regOnboardPillGroupHTML('workType', [
        { value: 'remote',   label: 'Remote'   },
        { value: 'hybrid',   label: 'Hybrid'   },
        { value: 'on-site',  label: 'On-site'  },
        { value: 'any',      label: 'Any'       },
      ])}
    </div>

    <div class="onboard-pref-group">
      <div class="onboard-pref-label">Experience level</div>
      ${_regOnboardPillGroupHTML('expLevel', [
        { value: 'junior', label: 'Junior' },
        { value: 'mid',    label: 'Mid'    },
        { value: 'senior', label: 'Senior' },
        { value: 'lead',   label: 'Lead'   },
      ])}
    </div>

    <div class="onboard-pref-group">
      <div class="onboard-pref-label">Open to relocation?</div>
      ${_regOnboardPillGroupHTML('relocation', [
        { value: 'yes', label: 'Yes' },
        { value: 'no',  label: 'No'  },
      ])}
    </div>

    <div class="onboard-pref-group">
      <div class="onboard-pref-label">Minimum salary</div>
      ${_regOnboardPillGroupHTML('salary', [
        { value: '0',    label: 'Any'   },
        { value: '80',   label: '$80k'  },
        { value: '100',  label: '$100k' },
        { value: '120',  label: '$120k' },
        { value: '150',  label: '$150k+' },
      ])}
    </div>`;
}

function _regOnboardWireStep2() {
  document.querySelectorAll('#onboard-body .onboard-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      const value = btn.dataset.value;
      _regOnboard.prefs[group] = value;
      // Update UI
      document.querySelectorAll(`#onboard-body .onboard-pill[data-group="${group}"]`).forEach(b => {
        b.classList.toggle('selected', b.dataset.value === value);
      });
    });
  });
}

async function _regOnboardSavePrefs() {
  if (!activeUserId) return;
  const { workType, expLevel, salary } = _regOnboard.prefs;
  const prefs = {};
  if (workType) prefs.work_type = workType;
  if (expLevel) prefs.exp_level = expLevel;
  if (salary !== null) prefs.salary_min = salary === '0' ? 0 : parseInt(salary, 10);

  try {
    await authFetch(`/api/users/${activeUserId}/preferences`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(prefs),
    });
  } catch (e) {
    console.warn('Failed to save preferences:', e);
  }
}

// ── Step 3: Job Sources ──────────────────────────────────────────────────────

function _regOnboardSourceCardHTML(preset) {
  const sel = _regOnboard.selectedSites.has(preset.key);
  return `
    <button class="onboard-source-card${sel ? ' selected' : ''}" data-preset-key="${preset.key}" type="button">
      <img class="onboard-source-logo"
           src="https://www.google.com/s2/favicons?domain=${preset.domain}&sz=64"
           alt="${esc(preset.name)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
      />
      <div class="onboard-source-logo-fallback" style="display:none">${esc(preset.name.slice(0,2).toUpperCase())}</div>
      <div class="onboard-source-info">
        <div class="onboard-source-name">${esc(preset.name)}</div>
        <div class="onboard-source-type">${esc(preset.ats)}</div>
      </div>
      <svg class="onboard-check-mark" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
    </button>`;
}

function _regOnboardStep3HTML() {
  return `
    <div class="onboard-title">Where should we look for jobs?</div>
    <div class="onboard-sub">Pick popular companies or add your own sources. You can always add more in Settings.</div>

    <div class="onboard-source-grid" id="onboard-source-grid">
      ${_regOnboard.presets.map(_regOnboardSourceCardHTML).join('')}
    </div>

    <div class="onboard-url-inputs">
      <div>
        <div class="onboard-url-label">Paste a LinkedIn job search URL</div>
        <input class="input" id="onboard-linkedin-url" type="url"
               placeholder="https://www.linkedin.com/jobs/search/?keywords=…"
               value="${esc(_regOnboard.linkedinUrl)}" />
      </div>
      <div>
        <div class="onboard-url-label">Custom company careers URL</div>
        <input class="input" id="onboard-custom-url" type="url"
               placeholder="https://company.com/careers"
               value="${esc(_regOnboard.customUrl)}" />
      </div>
    </div>`;
}

function _regOnboardWireStep3() {
  document.querySelectorAll('#onboard-body .onboard-source-card').forEach(card => {
    card.addEventListener('click', () => {
      const key = card.dataset.presetKey;
      if (_regOnboard.selectedSites.has(key)) {
        _regOnboard.selectedSites.delete(key);
        card.classList.remove('selected');
      } else {
        _regOnboard.selectedSites.add(key);
        card.classList.add('selected');
      }
    });
  });

  const liInput = document.getElementById('onboard-linkedin-url');
  const cuInput = document.getElementById('onboard-custom-url');
  if (liInput) liInput.addEventListener('input', () => { _regOnboard.linkedinUrl = liInput.value; });
  if (cuInput) cuInput.addEventListener('input', () => { _regOnboard.customUrl = cuInput.value; });
}

// ── Finish ────────────────────────────────────────────────────────────────────

async function _regOnboardFinish() {
  // Snapshot URL inputs before closing
  const liUrl = document.getElementById('onboard-linkedin-url')?.value?.trim() || _regOnboard.linkedinUrl;
  const cuUrl = document.getElementById('onboard-custom-url')?.value?.trim()  || _regOnboard.customUrl;

  const addedSites = [];

  // Save preset sites
  for (const key of _regOnboard.selectedSites) {
    const preset = _regOnboard.presets.find(p => p.key === key);
    if (!preset) continue;
    try {
      await api.post('/api/sites', {
        userId:   activeUserId,
        name:     preset.name,
        url:      `https://${preset.domain}/careers`,
        ats_type: preset.ats,
        ats_slug: preset.slug,
      });
      addedSites.push(preset.name);
    } catch (e) {
      console.warn('Failed to add site:', preset.name, e);
    }
  }

  // Save LinkedIn URL
  if (liUrl) {
    try {
      await api.post('/api/sites', {
        userId: activeUserId,
        name: 'LinkedIn Search',
        url:  liUrl,
      });
      addedSites.push('LinkedIn');
    } catch (e) {
      console.warn('Failed to add LinkedIn URL:', e);
    }
  }

  // Save custom URL
  if (cuUrl) {
    try {
      const hostname = (() => { try { return new URL(cuUrl).hostname; } catch { return cuUrl; } })();
      await api.post('/api/sites', {
        userId: activeUserId,
        name: hostname,
        url:  cuUrl,
      });
      addedSites.push(hostname);
    } catch (e) {
      console.warn('Failed to add custom URL:', e);
    }
  }

  // Close the wizard
  _closeRegistrationOnboarding();

  // Confetti + toast
  _regOnboardConfetti();
  toast('You\'re all set! Welcome to NotchUp.');

  // Reload dashboard to reflect new data
  loadDashboard();
  if (window._loadResumeMaster) window._loadResumeMaster();

  // If sites were added, auto-trigger a scan after a short delay
  if (addedSites.length > 0) {
    setTimeout(() => {
      switchTab('feed');
      setTimeout(() => document.getElementById('feed-scan-btn')?.click(), 300);
    }, 1200);
  }
}

// ── Confetti ──────────────────────────────────────────────────────────────────

function _regOnboardConfetti() {
  const colors = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#A5B4FC', '#34D399'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'onboard-confetti-piece';
    piece.style.cssText = [
      `left:${Math.random() * 100}vw`,
      `background:${colors[Math.floor(Math.random() * colors.length)]}`,
      `width:${6 + Math.random() * 6}px`,
      `height:${6 + Math.random() * 6}px`,
      `animation-duration:${1.8 + Math.random() * 1.6}s`,
      `animation-delay:${Math.random() * 0.6}s`,
      `border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`,
    ].join(';');
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 3500);
  }
}

// ── AI Assistant Chat ─────────────────────────────────────────────────────────

const CHAT_SUGGESTIONS = [
  'How can I improve my resume?',
  'What interview questions should I prepare for?',
  'Help me negotiate salary for my top match',
  'Write a cover letter for my best match',
];

function _chatMd(text) {
  return esc(text)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code style="background:var(--surface-2);padding:1px 5px;border-radius:4px;font-size:0.88em;font-family:var(--mono)">$1</code>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<div style="padding-left:14px;margin:2px 0">• $1</div>')
    .replace(/^\d+\. (.+)$/gm, '<div style="padding-left:14px;margin:2px 0">$1</div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function _chatTimeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (isNaN(s) || s < 5)  return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function _chatUserInitials() {
  const name = window._activeUserDbProfile?.name || '';
  if (name) return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  // Fallback: sidebar may show Supabase display name — skip if it looks like an email username
  const sidebar = document.getElementById('sidebar-user-name')?.textContent?.trim() || '';
  const clean = sidebar.replace(/\d+/g, '').trim(); // strip numbers (e.g. "carlos199730" → "carlos")
  return clean.slice(0, 2).toUpperCase() || '?';
}

function _chatUserFirstName() {
  const name = window._activeUserDbProfile?.name || '';
  return name.split(' ')[0] || 'You';
}

function _chatRenderMsg(role, content, time) {
  const isUser = role === 'user';
  const firstName = _chatUserFirstName();
  const avatar = isUser
    ? `<div class="chat-avatar" title="${esc(firstName)}">${_chatUserInitials()}</div>`
    : `<div class="chat-avatar" title="AI Assistant">✦</div>`;
  const bubbleContent = isUser ? esc(content) : _chatMd(content);
  const timeStr = time ? `<div class="chat-msg-time">${_chatTimeAgo(time)}</div>` : '';
  return `
    ${avatar}
    <div class="chat-msg-content">
      <div class="chat-msg-bubble">${bubbleContent}</div>
      ${timeStr}
    </div>`;
}

function _chatShowEmpty(msgsEl) {
  const chips = CHAT_SUGGESTIONS.map(s =>
    `<button class="chat-chip" data-suggestion="${esc(s)}">${esc(s)}</button>`
  ).join('');
  msgsEl.innerHTML = `
    <div class="chat-empty-state">
      <div class="chat-empty-icon">✦</div>
      <div class="chat-empty-title">Your AI Career Coach</div>
      <div class="chat-empty-hint">Ask about your resume, job matches, interviews, or salary negotiation.</div>
      <div class="chat-suggestions">${chips}</div>
    </div>`;
  msgsEl.querySelectorAll('.chat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const input = document.getElementById('chat-input');
      if (input) { input.value = chip.dataset.suggestion; input.focus(); }
    });
  });
}

function _chatUpdateQuota(quota) {
  if (!quota) return;
  const pct    = Math.round((quota.remaining / quota.limit) * 100);
  const fill   = document.getElementById('chat-quota-fill');
  const label  = document.getElementById('chat-quota-label');
  const count  = document.getElementById('chat-quota-count');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.className = 'chat-quota-fill' + (pct < 20 ? ' red' : pct < 50 ? ' amber' : '');
  }
  if (label) {
    const used = quota.used.toLocaleString();
    const lim  = quota.limit.toLocaleString();
    label.textContent = `${used} / ${lim} tokens used`;
  }
  if (count) {
    const rem = quota.remaining.toLocaleString();
    count.textContent = `${rem} remaining`;
    count.style.color = pct < 20 ? 'var(--danger)' : pct < 50 ? 'var(--warning)' : '';
  }
}

async function loadChatHistory() {
  if (!activeUserId) return;
  const msgsEl = document.getElementById('chat-messages');
  if (!msgsEl) return;

  // Ensure DB profile is cached so the avatar shows the real name
  if (!window._activeUserDbProfile) {
    api.get(`/api/users/${activeUserId}`).then(u => { if (!u?.error) window._activeUserDbProfile = u; }).catch(() => {});
  }

  // Load quota
  api.get(`/api/chat/quota?userId=${activeUserId}`).then(_chatUpdateQuota).catch(() => {});

  if (msgsEl.dataset.loaded === '1') return;
  msgsEl.dataset.loaded = '1';

  try {
    const data = await api.get(`/api/chat/history?userId=${activeUserId}`);
    const messages = data?.messages || [];
    msgsEl.innerHTML = '';
    if (!messages.length) {
      _chatShowEmpty(msgsEl);
      return;
    }
    messages.forEach(m => {
      const div = document.createElement('div');
      div.className = `chat-msg chat-msg--${m.role}`;
      div.innerHTML = _chatRenderMsg(m.role, m.content, m.created_at);
      msgsEl.appendChild(div);
    });
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } catch (e) {
    console.error('loadChatHistory:', e);
  }
}

function initChatTab() {
  const sendBtn  = document.getElementById('chat-send-btn');
  const input    = document.getElementById('chat-input');
  const clearBtn = document.getElementById('chat-clear-btn');
  const msgsEl   = document.getElementById('chat-messages');
  if (!sendBtn || !input || !msgsEl) return;

  // Auto-resize textarea as user types
  function _resizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  }
  input.addEventListener('input', _resizeInput);

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    if (!activeUserId) { toast('Sign in first', 'error'); return; }

    input.value = '';
    _resizeInput();
    input.disabled = true;
    sendBtn.disabled = true;

    // Remove empty state
    msgsEl.querySelector('.chat-empty-state')?.remove();
    msgsEl.dataset.loaded = '1';

    // Append user message
    const userDiv = document.createElement('div');
    userDiv.className = 'chat-msg chat-msg--user';
    userDiv.innerHTML = _chatRenderMsg('user', text, null);
    msgsEl.appendChild(userDiv);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-msg chat-msg--assistant chat-typing';
    typingDiv.innerHTML = `
      <div class="chat-avatar">✦</div>
      <div class="chat-msg-content">
        <div class="chat-msg-bubble">
          <div class="chat-dots">
            <div class="chat-dot"></div>
            <div class="chat-dot"></div>
            <div class="chat-dot"></div>
          </div>
        </div>
      </div>`;
    msgsEl.appendChild(typingDiv);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    let fullText = '';
    let bubble = null;

    try {
      const response = await authFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeUserId, message: text }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      // Replace typing indicator with real assistant bubble
      typingDiv.className = 'chat-msg chat-msg--assistant';
      typingDiv.innerHTML = `
        <div class="chat-avatar">✦</div>
        <div class="chat-msg-content">
          <div class="chat-msg-bubble"></div>
          <div class="chat-msg-time">just now</div>
        </div>`;
      bubble = typingDiv.querySelector('.chat-msg-bubble');

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              fullText += data.text;
              bubble.innerHTML = _chatMd(fullText);
              msgsEl.scrollTop = msgsEl.scrollHeight;
            }
            if (data.quota) _chatUpdateQuota(data.quota);
            if (data.error) throw new Error(data.error);
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        }
      }
    } catch (e) {
      typingDiv.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'chat-msg chat-msg--assistant';
      const errMsg = e.message || 'Failed to get a response.';
      errDiv.innerHTML = `
        <div class="chat-avatar">✦</div>
        <div class="chat-msg-content">
          <div class="chat-msg-bubble" style="border-color:var(--danger-soft,#f87171);color:var(--danger)">⚠ ${esc(errMsg)}</div>
        </div>`;
      msgsEl.appendChild(errDiv);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  clearBtn?.addEventListener('click', async () => {
    if (!activeUserId || !confirm('Clear chat history? This cannot be undone.')) return;
    await api.delete(`/api/chat/history?userId=${activeUserId}`);
    msgsEl.innerHTML = '';
    msgsEl.dataset.loaded = '1';
    _chatShowEmpty(msgsEl);
  });
}
