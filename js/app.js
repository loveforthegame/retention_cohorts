const appController = (() => {
  const MAX_RUNS = 5;
  const STORAGE_KEY = 'rd_runs_v2';

  let state = {
    allRows: [], filteredRows: [], pivots: null,
    hasPlanData: false, negTenureCount: 0, inTrialCount: 0
  };
  let datePicker = null; // initialised in init()

  // ── PAST RUNS ──
  function loadPastRuns() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }

  function savePastRun(filename, pivots) {
    const runs = loadPastRuns();
    runs.unshift({
      id: Date.now(), filename,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      summary: pivots.summary,
      pivotsJson: JSON.stringify(pivots)
    });
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, MAX_RUNS))); }
    catch { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(runs.slice(0, 2))); } catch {} }
  }

  function renderPastRuns() {
    const runs = loadPastRuns();
    const section = document.getElementById('past-runs-section');
    const list = document.getElementById('past-runs-list');
    if (!runs.length || !section) return;
    section.style.display = 'block';
    list.innerHTML = runs.map(r => `
      <div class="past-run-card" onclick="appController.loadCachedRun('${r.id}')">
        <div>
          <div class="past-run-name">${r.filename}</div>
          <div class="past-run-meta">${r.date}</div>
        </div>
        <div class="past-run-stats">${(r.summary || {}).total || '—'} users · ${(r.summary || {}).churnRate || '—'}% churn</div>
      </div>`).join('');
  }

  function loadCachedRun(id) {
    const runs = loadPastRuns();
    const run = runs.find(r => String(r.id) === String(id));
    if (!run) return;
    showProcessing('Loading cached run...');
    try {
      const pivots = JSON.parse(run.pivotsJson);
      state.pivots = pivots;
      AI.setPivots(pivots);
      // FIX: detect plan data from cached pivots instead of always passing false
      const hasPlan = !!(pivots.planTier && pivots.planTier.some(p => p.label && p.label !== 'unknown'));
      showDashboard(run.filename);
      Charts.renderAll(pivots, hasPlan);
      if (hasPlan) {
        const bf = document.getElementById('billing-filter-section');
        if (bf) bf.style.display = 'block';
      }
      animateDashboard();
    } catch {
      hideProcessing();
      alert('Could not load run. Please re-upload the file.');
    }
  }

  // FIX: dynamically populate attribution + platform filters from actual data
  // so hardcoded HTML checkbox values don't silently exclude real rows on Apply
  function buildDynamicFilters(rows) {
    function escVal(v) { return String(v).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    const attrs = [...new Set(rows.map(r => r['Attribution Source']).filter(Boolean))].sort();
    const attrEl = document.getElementById('filter-attribution');
    if (attrEl && attrs.length) {
      attrEl.innerHTML = attrs.map(v =>
        `<label class="check-item"><input type="checkbox" value="${escVal(v)}" checked /><span>${escVal(v)}</span></label>`
      ).join('');
    }
    const plats = [...new Set(rows.map(r => r['payment_platform']).filter(Boolean))].sort();
    const platEl = document.getElementById('filter-platform');
    if (platEl && plats.length) {
      platEl.innerHTML = plats.map(v => {
        const isDefault = v.toLowerCase() === 'chargebee';
        return `<label class="check-item"><input type="checkbox" value="${escVal(v)}" ${isDefault ? 'checked' : ''} /><span>${escVal(v)}</span></label>`;
      }).join('');
    }
  }

  // ── FILTERS ──
  function getFilters() {
    const dateFrom = document.getElementById('filter-date-from').value;
    const dateTo = document.getElementById('filter-date-to').value;

    // Safe version — returns [] if element not found
    const checked = id => {
      const el = document.getElementById(id);
      return el ? [...el.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value) : [];
    };

    const activeToggle = id => {
      const el = document.getElementById(id);
      if (!el) return 'all';
      const a = el.querySelector('.pill.active');
      return a ? a.dataset.val : 'all';
    };

    return {
      dateFrom: dateFrom ? new Date(dateFrom + '-01') : null,
      dateTo: dateTo ? new Date(dateTo + '-01') : null,
      ecom: activeToggle('filter-ecom'),
      statuses: checked('filter-status'),
      attributions: checked('filter-attribution'),
      tenureBucket: activeToggle('filter-tenure'),
      platforms: checked('filter-platform'),
      billingCycle: activeToggle('filter-billing'),
      includeTrialUsers: false
    };
  }

  function applyFilters() {
    const filters = getFilters();
    state.filteredRows = DataProcessor.applyFilters(state.allRows, filters);
    state.pivots = DataProcessor.computeAllPivots(state.filteredRows);
    AI.setPivots(state.pivots);
    AI.clearHistory();
    Charts.renderAll(state.pivots, state.hasPlanData);
    showDataQualityNotice();
  }

  function resetFilters() {
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    if (datePicker) datePicker.updateLabel();
    document.querySelectorAll('#filter-status input, #filter-attribution input, #filter-platform input').forEach(cb => {
      cb.checked = true;
    });
    const trial = document.querySelector('#filter-status input[value="in_trial"]');
    if (trial) trial.checked = false;
    document.querySelectorAll('.pill-group').forEach(g => {
      g.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
      const first = g.querySelector('.pill[data-val="all"]');
      if (first) first.classList.add('active');
    });
    applyFilters();
  }

  // ── FILE UPLOAD ──
  async function handleMainUpload(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      const err = document.getElementById('upload-error');
      if (err) { err.style.display = 'block'; err.textContent = 'Only .xlsx files are supported — please check your file format'; }
      return;
    }

    showProcessing('Reading your Excel...');
    try {
      const buffer = await file.arrayBuffer();
      setProcessingText('Parsing data...');
      const rawRows = DataProcessor.parseExcel(buffer);

      setProcessingText('Computing helper columns...');
      const { rows, negTenureCount, inTrialCount } = DataProcessor.computeHelperColumns(rawRows);

      // FIX: build attribution + platform checkboxes from actual data values
      buildDynamicFilters(rows);

      setProcessingText('Building pivots...');
      const pivots = DataProcessor.computeAllPivots(rows);

      state.allRows = rows;
      state.filteredRows = rows;
      state.pivots = pivots;
      state.negTenureCount = negTenureCount;
      state.inTrialCount = inTrialCount;
      state.hasPlanData = false;

      // Seed date range filters from actual data range
      const dates = rows.filter(r => r._buy_date).map(r => r._buy_date);
      if (dates.length) {
        const min = new Date(Math.min(...dates));
        const max = new Date(Math.max(...dates));
        document.getElementById('filter-date-from').value = min.toISOString().slice(0, 7);
        document.getElementById('filter-date-to').value = max.toISOString().slice(0, 7);
        if (datePicker) datePicker.updateLabel();
      }

      AI.setPivots(pivots);
      savePastRun(file.name, pivots);
      showDashboard(file.name);
      Charts.renderAll(pivots, false);
      showDataQualityNotice();
      animateDashboard();
    } catch (err) {
      hideProcessing();
      // Restore upload screen so the error message is actually visible
      document.getElementById('upload-screen').style.display = 'flex';
      const errEl = document.getElementById('upload-error');
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Error: ' + err.message; }
      console.error('Upload error:', err);
    }
  }

  // ── PLAN SPLIT ──
  let pendingPlanBuffer = null;

  async function handlePlanUpload(file) {
    if (!file) return;
    const status = document.getElementById('plan-upload-status');
    status.textContent = 'Processing...';
    status.style.color = 'var(--text3)';
    try {
      pendingPlanBuffer = await file.arrayBuffer();
      const wb = XLSX.read(pendingPlanBuffer, { type: 'array', raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const planData = XLSX.utils.sheet_to_json(ws, { defval: null });
      status.textContent = `${planData.length} rows found. Click Apply to merge.`;
      status.style.color = 'var(--success)';
      document.getElementById('modal-confirm').disabled = false;
    } catch (err) {
      status.textContent = 'Error: ' + err.message;
      status.style.color = 'var(--error)';
    }
  }

  // ── UI HELPERS ──
  function showDashboard(filename) {
    hideProcessing();
    document.getElementById('upload-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    const chip = document.getElementById('dash-file-chip');
    if (chip && filename) { chip.style.display = 'block'; chip.textContent = filename; }
  }

  function showUploadScreen() {
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('upload-screen').style.display = 'flex';
    const err = document.getElementById('upload-error');
    if (err) err.style.display = 'none';
    renderPastRuns();
  }

  function showProcessing(msg) {
    document.getElementById('upload-screen').style.display = 'none';
    document.getElementById('processing-overlay').style.display = 'flex';
    setProcessingText(msg);
  }

  function setProcessingText(msg) {
    const e = document.getElementById('processing-text');
    if (e) e.textContent = msg;
  }

  function hideProcessing() {
    const e = document.getElementById('processing-overlay');
    if (e) e.style.display = 'none';
  }

  function showDataQualityNotice() {
    const el = document.getElementById('data-quality-notice');
    if (!el) return;
    const msgs = [];
    if (state.negTenureCount > 0) msgs.push(`${state.negTenureCount} users excluded (cancellation before purchase — prior subscription artifact)`);
    if (state.inTrialCount > 0) msgs.push(`${state.inTrialCount} in-trial users excluded from churn rate (within 7-day window)`);
    el.style.display = msgs.length ? 'block' : 'none';
    if (msgs.length) el.textContent = '⚠ ' + msgs.join(' · ');
  }

  function sendSuggestion(btn) {
    const input = document.getElementById('chat-input');
    if (input) input.value = btn.textContent;
    AI.sendMessage(btn.textContent);
  }

  // ── THEME ──
  function initTheme() {
    const saved = localStorage.getItem('rd_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    const curr = document.documentElement.getAttribute('data-theme');
    const next = curr === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('rd_theme', next);
    if (state.pivots) Charts.refreshTheme(state.pivots, state.hasPlanData);
  }

  // ── GSAP ──
  function animateDashboard() {
    if (typeof gsap === 'undefined') return;
    gsap.registerPlugin(ScrollTrigger);
    gsap.from('.stat-card', { y: 18, opacity: 0, stagger: 0.05, duration: 0.45, ease: 'power2.out', delay: 0.1 });
    gsap.utils.toArray('.section').forEach(section => {
      gsap.from(section, {
        y: 24, opacity: 0, duration: 0.5, ease: 'power2.out',
        scrollTrigger: { trigger: section, start: 'top 88%', once: true }
      });
    });
    gsap.from('.sidebar', { x: -20, opacity: 0, duration: 0.5, ease: 'power2.out' });
  }

  // ── DATE RANGE PICKER ──
  function initDatePicker() {
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let fromYear = new Date().getFullYear();
    let toYear   = new Date().getFullYear();
    let pendingFrom = null;
    let pendingTo   = null;

    function updateLabel() {
      const f = (document.getElementById('filter-date-from') || {}).value;
      const t = (document.getElementById('filter-date-to')   || {}).value;
      const el = document.getElementById('drp-label');
      if (!el) return;
      const fmt = v => { const [y,m] = v.split('-'); return MONTHS[+m-1]+' '+y; };
      el.textContent = (!f && !t) ? 'All time' : (f ? fmt(f) : '…') + ' — ' + (t ? fmt(t) : '…');
    }

    function renderPanels() {
      const wrap = document.querySelector('#drp-dropdown .drp-panels');
      if (!wrap) return;
      const panel = (side, year, sel) => `
        <div class="drp-panel">
          <div class="drp-panel-lbl">${side === 'from' ? 'From' : 'To'}</div>
          <div class="drp-year-nav">
            <button class="drp-yr-btn" data-side="${side}" data-dir="-1">‹</button>
            <span class="drp-yr-val">${year}</span>
            <button class="drp-yr-btn" data-side="${side}" data-dir="1">›</button>
          </div>
          <div class="drp-month-grid">
            ${MONTHS.map((m,i) => {
              const val = year + '-' + String(i+1).padStart(2,'0');
              return `<button class="drp-month-btn${sel===val?' selected':''}" data-side="${side}" data-val="${val}">${m}</button>`;
            }).join('')}
          </div>
        </div>`;
      wrap.innerHTML = panel('from', fromYear, pendingFrom) + panel('to', toYear, pendingTo);
    }

    function open() {
      pendingFrom = (document.getElementById('filter-date-from')||{}).value || null;
      pendingTo   = (document.getElementById('filter-date-to')  ||{}).value || null;
      if (pendingFrom) fromYear = +pendingFrom.split('-')[0];
      if (pendingTo)   toYear   = +pendingTo.split('-')[0];
      renderPanels();
      const dd = document.getElementById('drp-dropdown');
      const btn = document.getElementById('drp-trigger');
      if (!dd || !btn) return;
      const r = btn.getBoundingClientRect();
      const ddW = 440;
      dd.style.top  = (r.bottom + 6) + 'px';
      dd.style.left = Math.min(r.left, window.innerWidth - ddW - 12) + 'px';
      dd.classList.add('open');
      btn.classList.add('open');
    }

    function close() {
      const dd = document.getElementById('drp-dropdown');
      const btn = document.getElementById('drp-trigger');
      if (dd)  dd.classList.remove('open');
      if (btn) btn.classList.remove('open');
    }

    function apply() {
      const fEl = document.getElementById('filter-date-from');
      const tEl = document.getElementById('filter-date-to');
      if (fEl) fEl.value = pendingFrom || '';
      if (tEl) tEl.value = pendingTo   || '';
      updateLabel();
      close();
      applyFilters();
    }

    // Dropdown delegation
    const dd = document.getElementById('drp-dropdown');
    if (dd) {
      dd.addEventListener('click', e => {
        e.stopPropagation();
        const mb = e.target.closest('.drp-month-btn');
        if (mb) {
          if (mb.dataset.side === 'from') pendingFrom = mb.dataset.val;
          else pendingTo = mb.dataset.val;
          renderPanels(); return;
        }
        const yb = e.target.closest('.drp-yr-btn');
        if (yb) {
          if (yb.dataset.side === 'from') fromYear += +yb.dataset.dir;
          else toYear += +yb.dataset.dir;
          renderPanels(); return;
        }
        if (e.target.id === 'drp-apply') { apply(); return; }
        if (e.target.id === 'drp-clear') {
          pendingFrom = null; pendingTo = null; renderPanels(); return;
        }
      });
    }

    const trigger = document.getElementById('drp-trigger');
    if (trigger) {
      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const dd = document.getElementById('drp-dropdown');
        if (dd && dd.classList.contains('open')) close(); else open();
      });
    }

    document.addEventListener('click', e => {
      const dd = document.getElementById('drp-dropdown');
      if (dd && dd.classList.contains('open') && !dd.contains(e.target) && e.target.id !== 'drp-trigger') close();
    });

    updateLabel();
    return { updateLabel };
  }

  // ── DEFINITIONS DRAWER CONTENT ──
  function populateDefinitions() {
    const body = document.getElementById('def-body');
    if (!body || body.dataset.populated) return;
    body.dataset.populated = 'true';
    body.innerHTML = `
      <div class="def-section">
        <div class="def-section-label">Summary Cards</div>
        <div class="def-item">
          <div class="def-item-name">Total Users</div>
          <div class="def-item-formula">COUNT(all paid users in current filter)</div>
          <div class="def-item-body">Every user who has paid at least once. Trial-only users are excluded. This is the base denominator for all other metrics on the dashboard.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Active</div>
          <div class="def-item-formula">subscription_status = active OR non_renewing</div>
          <div class="def-item-body"><strong>Non-renewing</strong> means the subscription runs to the end of the current billing period but won't auto-renew — they're still paying. Both are counted as active because revenue is still coming in.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Churned</div>
          <div class="def-item-formula">subscription_status = cancelled</div>
          <div class="def-item-body">Users who explicitly cancelled. Does not include paused or non-renewing users. <strong>Churn Rate = Churned ÷ Total non-trial users.</strong></div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Avg Months Active</div>
          <div class="def-item-formula">AVERAGE(active subscription month column)</div>
          <div class="def-item-body">Uses the <em>active subscription month</em> column from your export, which counts only months the subscription was genuinely active — pauses are excluded. A higher avg = longer-lived customers overall.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Zero Post-Buy Gens</div>
          <div class="def-item-formula">total_generation_after_BUY = 0 (column must exist)</div>
          <div class="def-item-body">% of paid users who never created a single post after buying. <strong>This is the strongest predictor of churn.</strong> If you pay and never use the product, you will cancel. Missing data in that column is treated as unknown, not zero.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Used Autopost</div>
          <div class="def-item-formula">Autoposting Status = "Active" OR "Stopped AP"</div>
          <div class="def-item-body">Users who turned on autopost at any point — currently running or previously stopped. "Never started" = never used. Case-insensitive match on the column value.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Ecom Users</div>
          <div class="def-item-formula">ecom_flag_used = yes</div>
          <div class="def-item-body">Users who both connected an ecom store AND actually generated content using the ecom flow. Linking a store without creating content doesn't count.</div>
        </div>
      </div>

      <div class="def-section">
        <div class="def-section-label">Cohort Retention</div>
        <div class="def-item">
          <div class="def-item-name">Cohort Survival Curves</div>
          <div class="def-item-formula">% of cohort with months_active ≥ M, at each milestone</div>
          <div class="def-item-body">Users are grouped by the month they first bought. Each line shows what % of that group were still active at M0 (100%), M1, M3, M6, M9, M12. <strong>Declining lines are expected</strong> — steeper drops = faster churn. Lines that hold steady late mean you've built habit. A user is counted at milestone M only if their <em>active subscription months ≥ M</em>.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Cohort Heatmap (M1 → M12)</div>
          <div class="def-item-formula">Same data as survival curves, table format</div>
          <div class="def-item-body">Each row = one buy-month cohort. Each column = a retention milestone. <span class="def-good">Green ≥ 40%</span>, <span class="def-warn">Amber 20–40%</span>, <span style="color:var(--error);font-weight:600">Red &lt; 20%</span>. Grey (—) = the cohort hasn't been around long enough to reach that milestone yet.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Month-0 Churn by Cohort</div>
          <div class="def-item-formula">months_active &lt; 1 AND cancelled, per buy-month cohort</div>
          <div class="def-item-body">% of each cohort who cancelled within 30 days of buying. <strong>Trending up = the product is failing new users harder than before.</strong> This is the sharpest signal of first-impression quality.</div>
        </div>
      </div>

      <div class="def-section">
        <div class="def-section-label">Behavioral Signals</div>
        <div class="def-item">
          <div class="def-item-name">Generation Activity M1–M6</div>
          <div class="def-item-formula">AVG(M1..M6 Total Generations) split by active vs churned</div>
          <div class="def-item-body">Average content pieces generated per user per month, comparing users who are now active vs those who churned. The <strong>gap between the two lines</strong> is the engagement signal — if active users generate consistently more from M1, that's the behaviour you want to drive.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Zero Post-Buy (Side by Side)</div>
          <div class="def-item-formula">% with post-buy gens = 0, for churned vs active users</div>
          <div class="def-item-body">Shows the zero post-buy rate separately for churned and active users. A large gap (churned users have much higher zero post-buy rate) confirms that non-usage directly causes churn.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">High vs Low Engagement</div>
          <div class="def-item-formula">Top 25% vs Bottom 25% by total lifetime generations</div>
          <div class="def-item-body">Compares power users against low-engagement users across channels connected, posts published, ecom usage, and trial gens. <strong>The gap in these metrics tells you what behaviours to push new users toward.</strong></div>
        </div>
      </div>

      <div class="def-section">
        <div class="def-section-label">Activation Signals</div>
        <div class="def-item">
          <div class="def-item-name">Trial Depth → 3M Retention</div>
          <div class="def-item-formula">eligible = churned OR months_active ≥ 3 · retained = months_active ≥ 3</div>
          <div class="def-item-body">Groups users by how many times they generated during the free trial (0, 1–5, 6–20, 21–50, 50+). Shows what % of each group reached 3 paid months. <strong>In-flight users (still active but &lt;3 months in) are excluded</strong> from both numerator and denominator — they haven't resolved yet. This finds the trial usage threshold that predicts paid retention.</div>
        </div>
      </div>

      <div class="def-section">
        <div class="def-section-label">Feature Adoption vs Retention</div>
        <div class="def-item">
          <div class="def-item-name">Feature Adoption Cards</div>
          <div class="def-item-formula">adoption % + 3M retention for users who used vs didn't</div>
          <div class="def-item-body">For each feature (autopost, ecom, image, video, UGC, 4.0 pipeline): how many users ever used it, and what % of adopters reached 3M vs non-adopters. <strong>A large gap = that feature is a retention lever</strong> — drive more users toward it.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Content Types: 6M+ Retained vs Churned</div>
          <div class="def-item-formula">6M+ retained = months_active ≥ 6 · churned = cancelled AND months_active &lt; 6</div>
          <div class="def-item-body">For each content type, compares usage between users who stayed 6+ months and users who churned early. If retained users use a content type more, it correlates with staying. This is correlation, not causation — but it's a strong signal for onboarding focus.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Content Type Count → 3M Retention</div>
          <div class="def-item-formula">eligible = churned OR months_active ≥ 3 · groups by distinct types used</div>
          <div class="def-item-body">Groups users by how many distinct content types they've ever tried (image, video, UGC, carousel, ecom). Shows if using more types = higher 3M retention. <strong>Breadth of usage usually signals that the user has found real workflow value.</strong></div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Channels Connected → 3M Retention</div>
          <div class="def-item-formula">grouped by Total Social Channels Connected (null values excluded)</div>
          <div class="def-item-body">Users grouped by how many social accounts they linked (0, 1, 2–3, 4+). More connections usually means deeper product investment. Users with missing channel data are excluded from this chart to avoid false 0-channel inflation.</div>
        </div>
      </div>

      <div class="def-section">
        <div class="def-section-label">Churn Segmentation</div>
        <div class="def-item">
          <div class="def-item-name">Churn by Attribution Source</div>
          <div class="def-item-formula">churned ÷ total, per Attribution Source value</div>
          <div class="def-item-body">Which traffic channel brings users who stay vs leave. <strong>High churn from a channel = messaging or targeting misalignment</strong> — those users expect something the product doesn't deliver.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Churn by Persona</div>
          <div class="def-item-formula">churned ÷ total, per user_persona_cleaned value</div>
          <div class="def-item-body">Which user type (Agency Owner, Small Business Owner, etc.) churns most. Informs product priority and sales targeting. If one persona retains dramatically better, they're your ICP.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Churn by Payment Platform</div>
          <div class="def-item-formula">churned ÷ total, per payment_platform value</div>
          <div class="def-item-body">Whether payment method correlates with churn. Sometimes indicates geographic patterns (Razorpay = India, Apple Pay = iOS users) or plan-type differences worth investigating.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Country Table</div>
          <div class="def-item-formula">churned ÷ total, per country — min N slider filters small samples</div>
          <div class="def-item-body">Top countries by churn rate, filtered to only show countries with enough users (use the slider). "Unknown / Non-Chargebee" = payment was not through Chargebee, so country is unavailable.</div>
        </div>
      </div>

      <div class="def-section">
        <div class="def-section-label">Plan Analysis (requires plan split upload)</div>
        <div class="def-item">
          <div class="def-item-name">Churn by Plan Tier</div>
          <div class="def-item-formula">churned ÷ total, per plan (Core / Rise / Enterprise+)</div>
          <div class="def-item-body">Core churns faster? Likely hitting credit limits before finding value. Rise/Enterprise users have more credits to experiment with. <strong>Use this to decide if credit tiers need adjusting.</strong></div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Monthly vs Annual Retention Curve</div>
          <div class="def-item-formula">eligible = churned OR months_active ≥ M, per billing cycle</div>
          <div class="def-item-body">Compares M1/M3/M6/M9/M12 retention for monthly vs annual plans. Annual plans almost always retain far better — the upfront commitment creates a different user mindset. This quantifies the revenue impact of annual pricing.</div>
        </div>
      </div>

      <div class="def-section">
        <div class="def-section-label">Filters Explained</div>
        <div class="def-item">
          <div class="def-item-name">Tenure (paid months)</div>
          <div class="def-item-formula">Based on active subscription month column</div>
          <div class="def-item-body">Single-select. Filters the entire dashboard to only show users in one lifecycle stage. Use this to answer: "how do 1–3 month users behave differently to 6–12 month users?" Select All to see everyone.</div>
        </div>
        <div class="def-item">
          <div class="def-item-name">Date Range</div>
          <div class="def-item-formula">Filters by BUY_DATE (month of first purchase)</div>
          <div class="def-item-body">Shows only users who bought within the selected date range. Useful for comparing cohorts from different periods — e.g., post-product-change vs before.</div>
        </div>
      </div>
    `;
  }

  // ── INIT ──
  function init() {
    initTheme();
    renderPastRuns();

    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');

    if (zone && fileInput) {
      // Clicking anywhere on the zone opens the file dialog.
      // Skip if the click was on the <label for="file-input"> — that already handles itself natively.
      zone.addEventListener('click', e => {
        if (e.target.tagName === 'LABEL' || e.target.closest('label')) return;
        fileInput.click();
      });

      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleMainUpload(file);
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const sel = document.getElementById('file-selected-state');
        if (sel) { sel.style.display = 'block'; sel.textContent = '✓ ' + file.name + ' — loading...'; }
        handleMainUpload(file);
        e.target.value = '';
      });
    }

    // Filters
    const applyBtn = document.getElementById('apply-filters-btn');
    const resetBtn = document.getElementById('reset-filters-btn');
    if (applyBtn) applyBtn.addEventListener('click', applyFilters);
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);

    // Pill toggle groups
    document.querySelectorAll('.pill-group').forEach(g => {
      g.querySelectorAll('.pill').forEach(btn => {
        btn.addEventListener('click', () => {
          g.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    });

    // Date range picker
    datePicker = initDatePicker();

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // New upload
    const newUploadBtn = document.getElementById('new-upload-btn');
    if (newUploadBtn) newUploadBtn.addEventListener('click', showUploadScreen);

    // Plan modal
    const addPlanBtn = document.getElementById('add-plan-btn');
    if (addPlanBtn) addPlanBtn.addEventListener('click', () => {
      pendingPlanBuffer = null;
      document.getElementById('plan-modal').style.display = 'flex';
      document.getElementById('plan-upload-status').textContent = '';
      document.getElementById('plan-file-name').textContent = 'No file selected';
      document.getElementById('modal-confirm').disabled = true;
    });

    ['modal-cancel', 'modal-close-x'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => { document.getElementById('plan-modal').style.display = 'none'; });
    });

    const planFileInput = document.getElementById('plan-file-input');
    if (planFileInput) {
      planFileInput.addEventListener('change', e => {
        const f = e.target.files[0];
        if (!f) return;
        document.getElementById('plan-file-name').textContent = f.name;
        handlePlanUpload(f);
      });
    }

    const confirmBtn = document.getElementById('modal-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (!pendingPlanBuffer) return;
        DataProcessor.mergePlanSplit(state.allRows, pendingPlanBuffer);
        state.hasPlanData = true;
        document.getElementById('plan-modal').style.display = 'none';
        document.getElementById('billing-filter-section').style.display = 'block';
        applyFilters();
      });
    }

    const planModal = document.getElementById('plan-modal');
    if (planModal) planModal.addEventListener('click', e => { if (e.target === planModal) planModal.style.display = 'none'; });

    // Definitions drawer
    const defBtn = document.getElementById('definitions-btn');
    const defOverlay = document.getElementById('definitions-overlay');
    const defPanel = document.getElementById('definitions-panel');
    const defClose = document.getElementById('def-close-btn');

    function openDefinitions() {
      populateDefinitions();
      defOverlay.classList.add('open');
      defPanel.classList.add('open');
    }
    function closeDefinitions() {
      defOverlay.classList.remove('open');
      defPanel.classList.remove('open');
    }
    if (defBtn) defBtn.addEventListener('click', openDefinitions);
    if (defClose) defClose.addEventListener('click', closeDefinitions);
    if (defOverlay) defOverlay.addEventListener('click', closeDefinitions);

    // AI insights
    const genBtn = document.getElementById('generate-insights-btn');
    if (genBtn) genBtn.addEventListener('click', AI.generateInsights);

    // Chat
    const chatSend = document.getElementById('chat-send-btn');
    const chatInput = document.getElementById('chat-input');
    if (chatSend) chatSend.addEventListener('click', () => {
      if (chatInput && chatInput.value.trim()) AI.sendMessage(chatInput.value.trim());
    });
    if (chatInput) chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatInput.value.trim()) AI.sendMessage(chatInput.value.trim());
      }
    });

    // Country N slider
    const slider = document.getElementById('country-n-slider');
    if (slider) slider.addEventListener('input', e => {
      const n = parseInt(e.target.value);
      document.getElementById('country-n-display').textContent = n;
      if (state.filteredRows.length) {
        Charts.renderCountryTable(DataProcessor.pivotCountryTable(state.filteredRows, n));
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function toggleFilterGroup(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('collapsed');
  }

  return { loadCachedRun, sendSuggestion, toggleFilterGroup };
})();

// Expose for inline HTML onclick handlers
window.toggleFilterGroup = appController.toggleFilterGroup;
