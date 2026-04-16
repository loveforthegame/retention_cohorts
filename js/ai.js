const AI = (() => {
  // Set your Cloudflare Worker URL here after deploying worker/index.js
  const WORKER_URL = 'https://predis-retention-worker.masti.workers.dev';

  let chatHistory = [];
  let currentPivots = null;

  function setPivots(p) { currentPivots = p; }

  function buildPivotSummary(pivots) {
    if (!pivots) return {};
    const s = pivots.summary;
    return {
      summary: { total_users: s.total, churned: s.churned, active: s.active, churn_rate_pct: s.churnRate, avg_months_active: s.avgMonths, zero_post_buy_pct: s.total > 0 ? (s.zeroPostBuy/s.total*100).toFixed(1) : 0, autopost_ever_pct: s.total > 0 ? (s.autopostEver/s.total*100).toFixed(1) : 0, ecom_users_pct: s.total > 0 ? (s.ecomUsers/s.total*100).toFixed(1) : 0 },
      m1m6_activity: { active_avg: pivots.m1m6.active, churned_avg: pivots.m1m6.churned },
      cohort_sample: pivots.cohortRetention.slice(-8).map(c => ({ cohort: c.label, n: c.total, m1: c.m1, m3: c.m3, m6: c.m6 })),
      zero_post_buy: pivots.zeroPostBuy,
      trial_depth_vs_retention: pivots.trialDepth,
      m0_churn: pivots.m0Churn.map(c => ({ cohort: c.label, rate: c.rate, n: c.n })),
      feature_adoption: pivots.featureAdoption,
      churn_by_attribution: pivots.churnByAttribution,
      churn_by_persona: pivots.churnByPersona,
      churn_by_platform: pivots.churnByPlatform,
      content_type_adoption: pivots.contentTypes,
      type_count_vs_retention: pivots.typeCountRetention,
      channels_vs_retention: pivots.channelsRetention,
      top_countries: pivots.countryTable ? pivots.countryTable.slice(0, 8) : null,
      high_value_vs_low: pivots.highLow,
      plan_tier_churn: pivots.planTier && pivots.planTier.length ? pivots.planTier : null
    };
  }

  async function generateInsights() {
    if (!currentPivots) return;
    const btn = document.getElementById('generate-insights-btn');
    const output = document.getElementById('insights-output');
    btn.disabled = true;
    output.innerHTML = `<div class="insights-loading"><div class="processing-ring"></div> Analyzing — only aggregated pivots sent, no raw data...</div>`;

    try {
      const resp = await fetch(`${WORKER_URL}/insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pivots: buildPivotSummary(currentPivots) })
      });
      if (!resp.ok) throw new Error(`Worker error ${resp.status}`);
      const data = await resp.json();
      renderInsights(data.insights);
    } catch (err) {
      output.innerHTML = `<div class="insights-error">Error: ${err.message}. Set WORKER_URL in js/ai.js first.</div>`;
    } finally {
      btn.disabled = false;
    }
  }

  function renderInsights(raw) {
    const output = document.getElementById('insights-output');
    if (!raw) { output.innerHTML = '<div class="insights-error">No insights returned.</div>'; return; }
    let insights;
    try { insights = typeof raw === 'string' ? JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()) : raw; }
    catch { output.innerHTML = `<div class="insights-loading" style="display:block;padding:12px 0">${raw}</div>`; return; }
    if (!Array.isArray(insights)) { output.innerHTML = `<div style="font-size:12px;color:var(--text3);line-height:1.7">${raw}</div>`; return; }

    const cards = insights.map((ins, i) => `
      <div class="insight-card ${ins.impact || 'MEDIUM'}" style="animation-delay:${i*0.07}s">
        <div class="insight-impact">${ins.impact || 'MEDIUM'} IMPACT</div>
        <div class="insight-finding">${ins.finding}</div>
        <div class="insight-root">${ins.root_cause}</div>
        <div class="insight-action-lbl">Action</div>
        <div class="insight-action">${ins.action}</div>
      </div>`).join('');
    output.innerHTML = `<div class="insights-grid">${cards}</div>`;
  }

  // FIX BUG 4: Snapshot history BEFORE pushing current question to avoid duplicate
  async function sendMessage(question) {
    if (!question.trim() || !currentPivots) return;

    const pivotSummary = buildPivotSummary(currentPivots);

    // FIX: capture history state BEFORE pushing current message
    const historySnapshot = [...chatHistory].slice(-8);

    // Now push current message
    chatHistory.push({ role: 'user', content: question });
    renderChatMsg('user', question);

    const sendBtn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');
    sendBtn.disabled = true;
    input.disabled = true;

    const typingEl = document.createElement('div');
    typingEl.className = 'chat-typing';
    typingEl.textContent = 'Thinking...';
    document.getElementById('chat-messages').appendChild(typingEl);
    scrollChat();

    try {
      const resp = await fetch(`${WORKER_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, pivots: pivotSummary, history: historySnapshot })
      });
      if (!resp.ok) throw new Error(`Worker error ${resp.status}`);
      const data = await resp.json();
      typingEl.remove();
      const answer = data.answer || 'No response received.';
      chatHistory.push({ role: 'assistant', content: answer });
      renderChatMsg('assistant', answer);
    } catch (err) {
      typingEl.remove();
      chatHistory.pop(); // remove failed user message from history
      renderChatMsg('assistant', `Error: ${err.message}`);
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.value = '';
      input.focus();
    }
  }

  function renderChatMsg(role, text) {
    const msgs = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.innerHTML = `<div class="chat-bubble">${escHtml(text).replace(/\n/g,'<br>')}</div>`;
    msgs.appendChild(el);
    scrollChat();
  }

  function scrollChat() { const e = document.getElementById('chat-messages'); if (e) e.scrollTop = e.scrollHeight; }
  function escHtml(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function clearHistory() { chatHistory = []; }

  return { setPivots, generateInsights, sendMessage, clearHistory };
})();
