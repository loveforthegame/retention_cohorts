const Charts = (() => {
  const instances = {};

  // Brand colors — updated dynamically for dark mode
  function C() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return {
      primary: '#5B67E9',
      pink: '#EC4899',
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      purple: '#7C3AED',
      grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      text: dark ? '#8B92C4' : '#6B7280',
      tooltip_bg: dark ? '#1A1D27' : '#FFFFFF',
      tooltip_border: dark ? '#2D3148' : '#E5E7EB',
      tooltip_title: dark ? '#F0F1FF' : '#111827',
      tooltip_body: dark ? '#8B92C4' : '#6B7280',
    };
  }

  function baseOptions() {
    const c = C();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400, easing: 'easeOutQuart' },
      plugins: {
        legend: { labels: { color: c.text, font: { family: 'Inter', size: 11, weight: '500' }, padding: 14, boxWidth: 12, boxHeight: 12 } },
        tooltip: {
          backgroundColor: c.tooltip_bg,
          borderColor: c.tooltip_border,
          borderWidth: 1,
          titleColor: c.tooltip_title,
          bodyColor: c.tooltip_body,
          titleFont: { family: 'Inter', size: 12, weight: '700' },
          bodyFont: { family: 'Inter', size: 11 },
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: { ticks: { color: c.text, font: { family: 'Inter', size: 10 } }, grid: { color: c.grid } },
        y: { ticks: { color: c.text, font: { family: 'Inter', size: 10 } }, grid: { color: c.grid } }
      }
    };
  }

  function destroy(id) { if (instances[id]) { instances[id].destroy(); delete instances[id]; } }

  function create(id, config) {
    destroy(id);
    const canvas = document.getElementById(id);
    if (!canvas) return;
    instances[id] = new Chart(canvas, config);
  }

  // FIX BUG 1: Separate color functions for retention (high=good) vs churn (high=bad)
  function retentionColor(val) {
    const v = parseFloat(val);
    if (isNaN(v)) return C().text;
    if (v >= 40) return C().success;
    if (v >= 20) return C().warning;
    return C().error;
  }

  function churnColor(val) {
    const v = parseFloat(val);
    if (isNaN(v)) return C().text;
    if (v >= 70) return C().error;
    if (v >= 45) return C().warning;
    return C().success;
  }

  // ── COHORT SURVIVAL CURVES ──
  // Each line = one buy-month cohort, showing % retained at M0(100%), M1, M3, M6, M9, M12
  function renderCohortSurvival(data) {
    const c = C();
    const palette = [c.primary, c.success, c.warning, c.pink, c.purple, '#F97316', '#14B8A6', c.error];
    const datasets = data.map((cohort, i) => {
      const pts = [
        100,
        cohort.m1  != null ? parseFloat(cohort.m1)  : null,
        cohort.m3  != null ? parseFloat(cohort.m3)  : null,
        cohort.m6  != null ? parseFloat(cohort.m6)  : null,
        cohort.m9  != null ? parseFloat(cohort.m9)  : null,
        cohort.m12 != null ? parseFloat(cohort.m12) : null,
      ];
      const col = palette[i % palette.length];
      return {
        label: `${cohort.label} (n=${cohort.total})`,
        data: pts,
        borderColor: col,
        backgroundColor: col + '18',
        tension: 0.3,
        pointBackgroundColor: col,
        pointRadius: 4,
        pointHoverRadius: 7,
        fill: false,
        spanGaps: false
      };
    });
    create('chart-cohort-bar', {
      type: 'line',
      data: { labels: ['M0', 'M1', 'M3', 'M6', 'M9', 'M12'], datasets },
      options: {
        ...baseOptions(),
        plugins: {
          ...baseOptions().plugins,
          tooltip: {
            ...baseOptions().plugins.tooltip,
            callbacks: {
              label: ctx => ctx.raw !== null ? `${ctx.dataset.label}: ${ctx.raw}%` : `${ctx.dataset.label}: not yet`
            }
          }
        },
        scales: {
          ...baseOptions().scales,
          y: { ...baseOptions().scales.y, min: 0, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } }
        }
      }
    });
  }

  // ── M1-M6 LINE ──
  function renderM1M6(data) {
    const c = C();
    create('chart-m1m6', {
      type: 'line',
      data: { labels: data.labels, datasets: [
        { label: 'Active users', data: data.active, borderColor: c.success, backgroundColor: 'rgba(16,185,129,0.08)', tension: 0.4, pointBackgroundColor: c.success, pointRadius: 4, pointHoverRadius: 6, fill: true },
        { label: 'Churned users', data: data.churned, borderColor: c.error, backgroundColor: 'rgba(239,68,68,0.08)', tension: 0.4, pointBackgroundColor: c.error, pointRadius: 4, pointHoverRadius: 6, fill: true }
      ]},
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw} avg gens` } } } }
    });
  }

  // ── TRIAL DEPTH VS RETENTION ──
  function renderTrialDepth(data) {
    const valid = data.filter(d => d.retention3m !== null);
    create('chart-trial-depth', {
      type: 'bar',
      data: { labels: valid.map(d => d.bucket + (d.n < 30 ? '*' : '')), datasets: [{ label: '3M retention %', data: valid.map(d => parseFloat(d.retention3m)), backgroundColor: valid.map(d => retentionColor(d.retention3m)), borderRadius: 5, borderSkipped: false }] },
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false },
        tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: ctx => `${ctx.raw}% retained (n=${valid[ctx.dataIndex].n})` } }
      }, scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, min: 0, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } } } }
    });
  }

  // ── M0 CHURN ──
  function renderM0Churn(data) {
    const c = C();
    create('chart-m0-churn', {
      type: 'line',
      data: { labels: data.map(d => d.label), datasets: [{ label: 'M0 churn %', data: data.map(d => parseFloat(d.rate)), borderColor: c.error, backgroundColor: 'rgba(239,68,68,0.08)', tension: 0.3, pointBackgroundColor: c.error, pointRadius: 3, fill: true }] },
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false },
        tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: ctx => `${ctx.raw}% churned in M0 (n=${data[ctx.dataIndex].n})` } }
      }, scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, min: 0, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } } } }
    });
  }

  // ── CONTENT TYPES ──
  function renderContentTypes(data) {
    const c = C();
    create('chart-content-types', {
      type: 'bar',
      data: { labels: data.labels, datasets: [
        { label: '6m+ retained', data: data.retained.map(Number), backgroundColor: c.success + 'cc', borderRadius: 3 },
        { label: 'Churned', data: data.churned.map(Number), backgroundColor: c.error + 'cc', borderRadius: 3 }
      ]},
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}%` } } }, scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } } } }
    });
  }

  // ── TYPE COUNT VS RETENTION ──
  function renderTypeCountRetention(data) {
    const c = C();
    const valid = data.filter(d => d.retention3m !== null);
    create('chart-type-count', {
      type: 'bar',
      data: { labels: valid.map(d => d.bucket + ' type(s)'), datasets: [{ label: '3M retention %', data: valid.map(d => parseFloat(d.retention3m)), backgroundColor: c.primary + 'cc', borderRadius: 5, borderSkipped: false }] },
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false } }, scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, min: 0, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } } } }
    });
  }

  // ── CHANNELS VS RETENTION ──
  function renderChannelsRetention(data) {
    const c = C();
    const valid = data.filter(d => d.retention3m !== null);
    create('chart-channels', {
      type: 'bar',
      data: { labels: valid.map(d => d.bucket + ' ch'), datasets: [{ label: '3M retention %', data: valid.map(d => parseFloat(d.retention3m)), backgroundColor: c.purple + 'cc', borderRadius: 5, borderSkipped: false }] },
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false } }, scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, min: 0, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } } } }
    });
  }

  // FIX BUG 1: Use churnColor (high churn = red) not retentionColor
  function renderChurnByDimension(canvasId, data) {
    if (!data || !data.length) return;
    const sorted = [...data].sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));
    create(canvasId, {
      type: 'bar',
      data: { labels: sorted.map(d => d.label), datasets: [{ label: 'Churn rate %', data: sorted.map(d => parseFloat(d.rate)), backgroundColor: sorted.map(d => churnColor(parseFloat(d.rate))), borderRadius: 3 }] },
      options: { ...baseOptions(), indexAxis: 'y',
        plugins: { ...baseOptions().plugins, legend: { display: false }, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: ctx => `${ctx.raw}% churn (n=${sorted[ctx.dataIndex].total})` } } },
        scales: { x: { ...baseOptions().scales.x, min: 0, max: 100, ticks: { ...baseOptions().scales.x.ticks, callback: v => v + '%' } }, y: { ...baseOptions().scales.y } }
      }
    });
  }

  // ── PLAN TIER ──
  function renderPlanTier(data) {
    if (!data || !data.length) return;
    create('chart-plan-tier', {
      type: 'bar',
      data: { labels: data.map(d => d.label || 'unknown'), datasets: [{ label: 'Churn rate %', data: data.map(d => parseFloat(d.rate)), backgroundColor: data.map(d => churnColor(parseFloat(d.rate))), borderRadius: 4 }] },
      options: { ...baseOptions(), plugins: { ...baseOptions().plugins, legend: { display: false } }, scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, min: 0, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } } } }
    });
  }

  // ── BILLING RETENTION ──
  function renderBillingRetention(data) {
    const c = C();
    create('chart-billing-retention', {
      type: 'line',
      data: { labels: data.labels, datasets: [
        { label: 'Monthly plans', data: data.monthly.map(v => v !== null ? parseFloat(v) : null), borderColor: c.warning, backgroundColor: 'rgba(245,158,11,0.08)', tension: 0.3, pointBackgroundColor: c.warning, pointRadius: 4, spanGaps: false },
        { label: 'Annual plans', data: data.annual.map(v => v !== null ? parseFloat(v) : null), borderColor: c.success, backgroundColor: 'rgba(16,185,129,0.08)', tension: 0.3, pointBackgroundColor: c.success, pointRadius: 4, spanGaps: false }
      ]},
      options: { ...baseOptions(), scales: { ...baseOptions().scales, y: { ...baseOptions().scales.y, min: 0, max: 100, ticks: { ...baseOptions().scales.y.ticks, callback: v => v + '%' } } } }
    });
  }

  // ── COHORT HEATMAP ──
  function renderCohortHeatmap(data) {
    const el = document.getElementById('cohort-heatmap');
    if (!el) return;
    const months = [1, 3, 6, 9, 12];
    const cell = val => {
      if (val === null || val === undefined) return `<td class="hm-na">—</td>`;
      const v = parseFloat(val);
      const cls = v >= 40 ? 'hm-good' : v >= 20 ? 'hm-warn' : 'hm-bad';
      return `<td class="${cls}">${val}%</td>`;
    };
    const rows = data.map(d => `<tr><td class="hm-row-label">${d.label} <span style="opacity:.5">(${d.total})</span></td>${months.map(m => cell(d[`m${m}`])).join('')}</tr>`).join('');
    el.innerHTML = `<table class="hm-table"><thead><tr><th>Cohort</th>${months.map(m => `<th>M${m}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ── HIGH-LOW COMPARISON ──
  function renderHighLowComparison(data) {
    const el = document.getElementById('high-low-comparison');
    if (!el || !data) return;
    const metricRow = (lbl, val, isGood) => `
      <div class="cmp-row">
        <div class="cmp-lbl">${lbl}</div>
        <div class="${isGood ? 'cmp-val-h' : 'cmp-val-l'}">${val}</div>
      </div>`;
    el.innerHTML = `
      <div class="comparison-card" style="margin-top:14px">
        <div class="cmp-grid">
          <div class="cmp-col">
            <div class="cmp-title good">▲ Top 25% — lifetime gens</div>
            <div class="cmp-metrics">
              ${metricRow('Avg channels', data.high.avgChannels, true)}
              ${metricRow('Avg published', data.high.avgPublished, true)}
              ${metricRow('Ecom linked', data.high.pctEcom, true)}
              ${metricRow('Pre-buy gens', data.high.avgPreBuy, true)}
              ${metricRow('Avg M1 gens', data.high.avgM1, true)}
            </div>
          </div>
          <div class="cmp-divider"></div>
          <div class="cmp-col">
            <div class="cmp-title bad">▼ Bottom 25% — M1+M2 engagement</div>
            <div class="cmp-metrics">
              ${metricRow('Avg channels', data.low.avgChannels, false)}
              ${metricRow('Avg published', data.low.avgPublished, false)}
              ${metricRow('Ecom linked', data.low.pctEcom, false)}
              ${metricRow('Pre-buy gens', data.low.avgPreBuy, false)}
              ${metricRow('Avg M1 gens', data.low.avgM1, false)}
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── ZERO POST-BUY ──
  function renderZeroPostBuy(data) {
    const el = document.getElementById('zero-postbuy-cards');
    if (!el) return;
    el.innerHTML = `
      <div class="zpb-block churned"><div class="zpb-lbl">Churned users</div><div class="zpb-val">${data.churnedPct}%</div><div class="zpb-sub">Zero post-buy gens (n=${data.churnedN})</div></div>
      <div class="zpb-block active"><div class="zpb-lbl">Active users</div><div class="zpb-val">${data.activePct}%</div><div class="zpb-sub">Zero post-buy gens (n=${data.activeN})</div></div>`;
  }

  // ── FEATURE ADOPTION ──
  function renderFeatureAdoption(data) {
    const el = document.getElementById('feature-adoption-cards');
    if (!el) return;
    el.innerHTML = data.map(f => `
      <div class="fa-card">
        <div class="fa-feature">${f.label}</div>
        <div class="fa-pct">${f.pct}%</div>
        <div class="fa-n">of users (n=${f.n})</div>
        ${f.retention3m_adopters !== null ? `<div class="fa-retention-row">
          <div class="fa-ret-item"><div class="fa-ret-lbl">Adopters 3M</div><div class="fa-ret-val-good">${f.retention3m_adopters}%</div></div>
          <div class="fa-ret-item"><div class="fa-ret-lbl">Non-adopters</div><div class="fa-ret-val-bad">${f.retention3m_non}%</div></div>
        </div>` : ''}
      </div>`).join('');
  }

  // ── COUNTRY TABLE ──
  function renderCountryTable(data) {
    const section = document.getElementById('country-section');
    const el = document.getElementById('country-table-wrap');
    if (!data || !data.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = 'block';
    if (!el) return;
    const rows = data.map(d => {
      const v = parseFloat(d.rate);
      const color = v >= 70 ? '#EF4444' : v >= 45 ? '#F59E0B' : '#10B981';
      return `<tr><td>${d.label}</td><td>${d.total}</td><td>${d.churned}</td><td><div class="churn-bar-wrap"><div class="churn-bar-bg"><div class="churn-bar-fill" style="width:${Math.min(d.rate,100)}%;background:${color}"></div></div><span style="color:${color};font-weight:700;font-size:12px">${d.rate}%</span></div></td></tr>`;
    }).join('');
    el.innerHTML = `<table class="data-table"><thead><tr><th>Country</th><th>Users</th><th>Cancelled</th><th>Churn Rate</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ── SUMMARY ──
  function renderSummary(data) {
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('sc-total', Number(data.total).toLocaleString());
    set('sc-active', Number(data.active).toLocaleString());
    set('sc-churned', Number(data.churned).toLocaleString());
    set('sc-churn-rate', data.churnRate + '%');
    set('sc-avg-months', data.avgMonths + ' mo');
    set('sc-zero-postbuy', data.total > 0 ? (data.zeroPostBuy/data.total*100).toFixed(0)+'%' : '0%');
    set('sc-autopost-ever', data.total > 0 ? (data.autopostEver/data.total*100).toFixed(0)+'%' : '0%');
    set('sc-ecom', data.total > 0 ? (data.ecomUsers/data.total*100).toFixed(0)+'%' : '0%');
  }

  function renderAll(pivots, hasPlanData) {
    renderSummary(pivots.summary);
    renderCohortSurvival(pivots.cohortRetention);
    renderCohortHeatmap(pivots.cohortRetention);
    renderM1M6(pivots.m1m6);
    renderZeroPostBuy(pivots.zeroPostBuy);
    renderHighLowComparison(pivots.highLow);
    renderTrialDepth(pivots.trialDepth);
    renderM0Churn(pivots.m0Churn);
    renderFeatureAdoption(pivots.featureAdoption);
    renderContentTypes(pivots.contentTypes);
    renderTypeCountRetention(pivots.typeCountRetention);
    renderChannelsRetention(pivots.channelsRetention);
    renderChurnByDimension('chart-attribution', pivots.churnByAttribution);
    renderChurnByDimension('chart-persona', pivots.churnByPersona);
    renderChurnByDimension('chart-platform', pivots.churnByPlatform);
    renderCountryTable(pivots.countryTable);
    if (hasPlanData) {
      const ps = document.getElementById('plan-section');
      if (ps) ps.style.display = 'block';
      renderPlanTier(pivots.planTier);
      renderBillingRetention(pivots.billingRetention);
    }
  }

  // Re-render all charts when theme changes (colors need updating)
  function refreshTheme(pivots, hasPlanData) {
    if (pivots) renderAll(pivots, hasPlanData);
  }

  return { renderAll, renderCountryTable, refreshTheme };
})();
