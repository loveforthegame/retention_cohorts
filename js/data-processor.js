const DataProcessor = (() => {

  const AP_COLS = ['carousel_with_ap','ecom_carousel_with_ap','ecom_single_image_with_ap','ecom_ugc_voiceover_video_with_ap','ecom_video_with_ap','predis_4_0_carousel_with_ap','predis_4_0_ecom_carousel_with_ap','predis_4_0_ecom_single_image_with_ap','predis_4_0_single_image_with_ap','single_image_with_ap','ugc_voiceover_video_with_ap','video_with_ap','voiceover_video_with_ap'];
  const MANUAL_COLS = ['carousel_without_ap','ecom_carousel_without_ap','ecom_single_image_without_ap','ecom_ugc_voiceover_video_without_ap','ecom_video_without_ap','predis_4_0_carousel_without_ap','predis_4_0_ecom_carousel_without_ap','predis_4_0_ecom_single_image_without_ap','predis_4_0_ecom_ugc_voiceover_video_without_ap','predis_4_0_ecom_video_without_ap','predis_4_0_single_image_without_ap','predis_4_0_ugc_voiceover_video_without_ap','predis_4_0_video_without_ap','single_image_without_ap','ugc_voiceover_video_without_ap','unknown_without_ap','video_without_ap','voiceover_video_without_ap','ai_without_ap'];
  const IMAGE_COLS = ['single_image_with_ap','single_image_without_ap','ecom_single_image_with_ap','ecom_single_image_without_ap','predis_4_0_single_image_with_ap','predis_4_0_single_image_without_ap','predis_4_0_ecom_single_image_with_ap','predis_4_0_ecom_single_image_without_ap'];
  const VIDEO_COLS = ['video_with_ap','video_without_ap','voiceover_video_with_ap','voiceover_video_without_ap','ecom_video_with_ap','ecom_video_without_ap','predis_4_0_video_without_ap','predis_4_0_ecom_video_without_ap'];
  const UGC_COLS = ['ugc_voiceover_video_with_ap','ugc_voiceover_video_without_ap','predis_4_0_ugc_voiceover_video_without_ap','predis_4_0_ecom_ugc_voiceover_video_without_ap','ecom_ugc_voiceover_video_with_ap','ecom_ugc_voiceover_video_without_ap'];
  const CAROUSEL_COLS = ['carousel_with_ap','carousel_without_ap','ecom_carousel_with_ap','ecom_carousel_without_ap','predis_4_0_carousel_with_ap','predis_4_0_carousel_without_ap','predis_4_0_ecom_carousel_with_ap','predis_4_0_ecom_carousel_without_ap'];
  const FO_COLS = ['predis_4_0_carousel_with_ap','predis_4_0_carousel_without_ap','predis_4_0_ecom_carousel_with_ap','predis_4_0_ecom_carousel_without_ap','predis_4_0_ecom_single_image_with_ap','predis_4_0_ecom_single_image_without_ap','predis_4_0_ecom_ugc_voiceover_video_without_ap','predis_4_0_ecom_video_without_ap','predis_4_0_single_image_with_ap','predis_4_0_single_image_without_ap','predis_4_0_ugc_voiceover_video_without_ap','predis_4_0_video_without_ap'];
  const ECOM_CONTENT_COLS = ['ecom_carousel_with_ap','ecom_carousel_without_ap','ecom_single_image_with_ap','ecom_single_image_without_ap','ecom_ugc_voiceover_video_with_ap','ecom_ugc_voiceover_video_without_ap','ecom_video_with_ap','ecom_video_without_ap','predis_4_0_ecom_carousel_with_ap','predis_4_0_ecom_carousel_without_ap','predis_4_0_ecom_single_image_with_ap','predis_4_0_ecom_single_image_without_ap','predis_4_0_ecom_ugc_voiceover_video_without_ap','predis_4_0_ecom_video_without_ap'];

  function parseDate(val) {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val === 'number') {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // Case-insensitive column lookup — handles whatever casing the Excel uses
  function findColCI(row, target) {
    const lower = target.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === lower) return row[key];
    }
    return null;
  }

  function monthsDiff(d1, d2) {
    if (!d1 || !d2) return null;
    const months = (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
    return months + (d2.getDate() >= d1.getDate() ? 0 : -1);
  }

  function cohortLabel(date) {
    if (!date) return 'unknown';
    return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
  }

  function n(val) { const v = parseFloat(val); return isNaN(v) ? 0 : v; }
  function colSum(row, cols) { return cols.reduce((a, c) => a + n(row[c]), 0); }

  function tenureBucket(m) {
    if (m === null) return 'unknown';
    if (m < 1) return '<1m';
    if (m < 3) return '1-3m';
    if (m < 6) return '3-6m';
    if (m < 12) return '6-12m';
    return '12m+';
  }

  function trialDepthBucket(g) {
    if (g === 0) return '0';
    if (g <= 5) return '1–5';
    if (g <= 20) return '6–20';
    if (g <= 50) return '21–50';
    return '50+';
  }

  function contentTypeCount(row) {
    let c = 0;
    if (row.image_user) c++;
    if (row.video_user) c++;
    if (row.ugc_user) c++;
    if (row.carousel_user) c++;
    if (row.is_ecom_user && colSum(row, ECOM_CONTENT_COLS) > 0) c++;
    return c;
  }

  function parseExcel(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: null });
  }

  function computeHelperColumns(rawRows) {
    const today = new Date();
    const rows = [];
    let negTenureCount = 0, inTrialCount = 0;

    for (const raw of rawRows) {
      const r = Object.assign({}, raw);
      const buyDate = parseDate(r['BUY_DATE']);
      const cancelDate = parseDate(r['cancellation_date']);
      r._buy_date = buyDate;
      r._cancel_date = cancelDate;

      // FIX: exclude negative tenure (prior subscription artifacts)
      r.is_negative_tenure = (buyDate && cancelDate && cancelDate < buyDate) ? 1 : 0;
      if (r.is_negative_tenure) { negTenureCount++; continue; }

      r.is_in_trial = (r['subscription_status'] === 'in_trial') ? 1 : 0;
      if (r.is_in_trial) inTrialCount++;

      const endDate = cancelDate || today;

      // Use the pre-computed helper column from the sheet (total months paid, excludes pauses).
      // Fallback 1: derive from Active subscription Days. Fallback 2: raw date diff.
      const activeMonthRaw = findColCI(r, 'active subscription month');
      const activeDaysRaw  = findColCI(r, 'active subscription days');
      if (activeMonthRaw !== null && activeMonthRaw !== undefined && String(activeMonthRaw).trim() !== '') {
        r.months_active = n(activeMonthRaw);
      } else if (activeDaysRaw !== null && activeDaysRaw !== undefined && n(activeDaysRaw) > 0) {
        r.months_active = Math.floor(n(activeDaysRaw) / 30.44);
      } else {
        r.months_active = buyDate ? Math.max(0, monthsDiff(buyDate, endDate) || 0) : null;
      }
      r.tenure_bucket = tenureBucket(r.months_active);
      r.cohort_month = cohortLabel(buyDate);
      r.cohort_month_date = buyDate ? new Date(buyDate.getFullYear(), buyDate.getMonth(), 1) : null;
      r.is_churned = (r['subscription_status'] === 'cancelled') ? 1 : 0;
      r.month0_churned = (r.is_churned && r.months_active !== null && r.months_active < 1) ? 1 : 0;

      const efUsed = String(r['ecom_flag_used'] || '').toLowerCase();
      r.is_ecom_user = (efUsed === 'yes' || efUsed === 'true' || efUsed === '1') ? 1 : 0;

      const preBuy = n(r['total_generation_before_BUY']);
      const postBuyRaw = r['total_generation_after_BUY'];
      const postBuy = n(postBuyRaw);
      r._pre_buy = preBuy;
      r._post_buy = postBuy;
      r.total_gens_all = preBuy + postBuy;
      r.trial_depth_bucket = trialDepthBucket(preBuy);
      // Only flag zero post-buy if the column exists AND equals 0 — null = unknown, not zero
      r.is_zero_post_buy = (postBuyRaw !== null && postBuyRaw !== undefined && postBuy === 0) ? 1 : 0;
      r.post_buy_gen_rate = (r.months_active && r.months_active > 0) ? postBuy / r.months_active : null;

      r.total_ap_content = colSum(r, AP_COLS);
      r.total_manual_content = colSum(r, MANUAL_COLS);
      // autopost_ever: use Autoposting Status column. Values: 'Active' or 'Stopped AP' = used autopost.
      // 'never started' = never used. Case-insensitive.
      const apStatus = String(findColCI(r, 'autoposting status') ?? '').toLowerCase().trim();
      r.autopost_ever = (apStatus === 'active' || apStatus === 'stopped ap') ? 1 : 0;

      // FIX BUG 3+8: Add image_user helper column (was missing, caused labels mismatch)
      r.image_user = colSum(r, IMAGE_COLS) > 0 ? 1 : 0;
      r.video_user = colSum(r, VIDEO_COLS) > 0 ? 1 : 0;
      r.ugc_user = colSum(r, UGC_COLS) > 0 ? 1 : 0;
      r.carousel_user = colSum(r, CAROUSEL_COLS) > 0 ? 1 : 0;
      r.uses_4_0 = colSum(r, FO_COLS) > 0 ? 1 : 0;
      r.content_type_count = contentTypeCount(r);

      const pub = n(r['Total Published']);
      const dl = n(r['Total Downloads']);
      const failures = n(r['Total generation failures']);
      r.publish_rate = postBuy > 0 ? pub / postBuy : null;
      r.download_rate = postBuy > 0 ? dl / postBuy : null;
      r.failure_rate = (postBuy + failures) > 0 ? failures / (postBuy + failures) : null;

      r.plan_tier = r.plan_tier || null;
      r.billing_cycle = r.billing_cycle || null;

      const country = r['country'] || r['Country'] || null;
      r._country = (!country || country === '0') ? (country === '0' ? 'Unknown (App/Other)' : null) : country;

      rows.push(r);
    }

    return { rows, negTenureCount, inTrialCount };
  }

  function applyFilters(rows, filters) {
    return rows.filter(r => {
      if (r.is_in_trial && !filters.includeTrialUsers) return false;
      if (filters.dateFrom && r._buy_date && r._buy_date < filters.dateFrom) return false;
      if (filters.dateTo && r._buy_date) {
        const toEnd = new Date(filters.dateTo.getFullYear(), filters.dateTo.getMonth() + 1, 0);
        if (r._buy_date > toEnd) return false;
      }
      if (filters.ecom === 'ecom' && !r.is_ecom_user) return false;
      if (filters.ecom === 'non-ecom' && r.is_ecom_user) return false;
      if (filters.statuses.length && !filters.statuses.includes(r['subscription_status'])) return false;
      // null-safe: rows with no attribution / platform value always pass through
      if (filters.attributions.length && r['Attribution Source'] && !filters.attributions.includes(r['Attribution Source'])) return false;
      if (filters.tenureBucket && filters.tenureBucket !== 'all' && r.tenure_bucket !== filters.tenureBucket) return false;
      if (filters.platforms.length && r['payment_platform'] && !filters.platforms.includes(r['payment_platform'])) return false;
      if (filters.billingCycle && filters.billingCycle !== 'all' && r.billing_cycle !== filters.billingCycle) return false;
      return true;
    });
  }

  function pivotSummary(rows) {
    const total = rows.length;
    const nonTrialRows = rows.filter(r => !r.is_in_trial);
    const churned = nonTrialRows.filter(r => r.is_churned).length;
    const active = rows.filter(r => r['subscription_status'] === 'active' || r['subscription_status'] === 'non_renewing').length;
    const zeroPostBuy = rows.filter(r => r.is_zero_post_buy).length;
    const autopostEver = rows.filter(r => r.autopost_ever).length;
    const ecomUsers = rows.filter(r => r.is_ecom_user).length;
    const mVals = rows.filter(r => r.months_active !== null).map(r => r.months_active);
    const avgMonths = mVals.length ? (mVals.reduce((a, b) => a + b, 0) / mVals.length).toFixed(1) : 0;
    const churnRate = nonTrialRows.length > 0 ? (churned / nonTrialRows.length * 100).toFixed(1) : 0;
    return { total, churned, active, zeroPostBuy, autopostEver, ecomUsers, avgMonths, churnRate };
  }

  function pivotCohortRetention(rows) {
    const today = new Date();
    const cohorts = {};
    for (const r of rows) {
      if (!r.cohort_month || !r._buy_date) continue;
      if (!cohorts[r.cohort_month]) cohorts[r.cohort_month] = { users: [], date: r.cohort_month_date };
      cohorts[r.cohort_month].users.push(r);
    }
    const months = [1, 3, 6, 9, 12];
    return Object.entries(cohorts).map(([label, { users, date }]) => {
      const row = { label, date, total: users.length };
      for (const m of months) {
        const monthsSinceCohort = monthsDiff(date, today);
        if (monthsSinceCohort === null || monthsSinceCohort < m) {
          row[`m${m}`] = null;
        } else {
          // Retained at milestone M = user was actually active for M months.
          // No !is_churned shortcut — active users must also have months_active >= m.
          const retained = users.filter(u => u.months_active !== null && u.months_active >= m);
          row[`m${m}`] = (retained.length / users.length * 100).toFixed(1);
        }
      }
      return row;
    }).sort((a, b) => a.date - b.date);
  }

  function pivotM1M6(rows) {
    const active = rows.filter(r => !r.is_churned);
    const churned = rows.filter(r => r.is_churned);
    const avg = (arr, col) => {
      const vals = arr.map(r => n(r[col]));
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
    };
    return {
      labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
      active: [1,2,3,4,5,6].map(i => avg(active, `M${i} Total Generations`)),
      churned: [1,2,3,4,5,6].map(i => avg(churned, `M${i} Total Generations`))
    };
  }

  function pivotHighLowComparison(rows) {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => b.total_gens_all - a.total_gens_all);
    const q = Math.max(1, Math.floor(sorted.length / 4));
    const hi = sorted.slice(0, q);
    const lo = sorted.slice(-q);
    const avg = (arr, key) => { const v = arr.map(r => n(r[key])); return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1); };
    const pct = (arr, key) => (arr.filter(r => r[key]).length / arr.length * 100).toFixed(0) + '%';
    return {
      high: { avgChannels: avg(hi,'Total Social Channels Connected'), avgPublished: avg(hi,'Total Published'), pctEcom: pct(hi,'is_ecom_user'), avgPreBuy: avg(hi,'_pre_buy'), avgM1: avg(hi,'M1 Total Generations') },
      low:  { avgChannels: avg(lo,'Total Social Channels Connected'), avgPublished: avg(lo,'Total Published'), pctEcom: pct(lo,'is_ecom_user'), avgPreBuy: avg(lo,'_pre_buy'), avgM1: avg(lo,'M1 Total Generations') }
    };
  }

  function pivotTrialDepthRetention(rows) {
    return ['0','1–5','6–20','21–50','50+'].map(b => {
      const g = rows.filter(r => r.trial_depth_bucket === b);
      const eligible = g.filter(r => r.is_churned || (r.months_active !== null && r.months_active >= 3));
      if (eligible.length < 5) return { bucket: b, retention3m: null, n: g.length };
      const ret = eligible.filter(r => r.months_active !== null && r.months_active >= 3);
      return { bucket: b, retention3m: (ret.length / eligible.length * 100).toFixed(1), n: g.length };
    });
  }

  function pivotM0ChurnByCohort(rows) {
    const cohorts = {};
    for (const r of rows) {
      if (!r.cohort_month) continue;
      if (!cohorts[r.cohort_month]) cohorts[r.cohort_month] = { total:0, m0:0, date: r.cohort_month_date };
      cohorts[r.cohort_month].total++;
      if (r.month0_churned) cohorts[r.cohort_month].m0++;
    }
    return Object.entries(cohorts)
      .map(([label, d]) => ({ label, date: d.date, rate: d.total > 0 ? (d.m0/d.total*100).toFixed(1) : 0, n: d.total }))
      .sort((a, b) => a.date - b.date);
  }

  function pivotZeroPostBuy(rows) {
    const ch = rows.filter(r => r.is_churned);
    const ac = rows.filter(r => !r.is_churned);
    const chZ = ch.filter(r => r.is_zero_post_buy).length;
    const acZ = ac.filter(r => r.is_zero_post_buy).length;
    return {
      churnedPct: ch.length ? (chZ/ch.length*100).toFixed(1) : 0,
      activePct:  ac.length ? (acZ/ac.length*100).toFixed(1) : 0,
      churnedN: chZ, activeN: acZ
    };
  }

  // FIX BUG 3: Labels now match data arrays (6 labels, 6 data points including Image)
  function pivotContentTypeAdoption(rows) {
    // 6m+ retained = anyone who was active for 6+ paid months (active or churned after 6M)
    const ret6m = rows.filter(r => r.months_active !== null && r.months_active >= 6);
    // churned = users who cancelled AND didn't reach 6M (true early churn)
    const ch = rows.filter(r => r.is_churned && (r.months_active === null || r.months_active < 6));
    const pct = (arr, key) => arr.length ? (arr.filter(r => r[key]).length/arr.length*100).toFixed(1) : 0;
    return {
      labels: ['Image', 'Video', 'UGC', 'Carousel', 'Ecom Flow', '4.0 Pipeline'],
      retained: [pct(ret6m,'image_user'), pct(ret6m,'video_user'), pct(ret6m,'ugc_user'), pct(ret6m,'carousel_user'), pct(ret6m,'is_ecom_user'), pct(ret6m,'uses_4_0')],
      churned:  [pct(ch,'image_user'),   pct(ch,'video_user'),   pct(ch,'ugc_user'),   pct(ch,'carousel_user'),   pct(ch,'is_ecom_user'),   pct(ch,'uses_4_0')]
    };
  }

  function pivotTypeCountRetention(rows) {
    return ['1','2','3','4–5'].map(b => {
      const g = rows.filter(r => b==='1'?r.content_type_count===1:b==='2'?r.content_type_count===2:b==='3'?r.content_type_count===3:r.content_type_count>=4);
      // Eligible = users who have definitively passed or failed 3M (exclude in-flight actives)
      const eligible = g.filter(r => r.is_churned || (r.months_active !== null && r.months_active >= 3));
      if (eligible.length < 5) return { bucket: b, retention3m: null, n: g.length };
      const ret = eligible.filter(r => r.months_active !== null && r.months_active >= 3);
      return { bucket: b, retention3m: (ret.length/eligible.length*100).toFixed(1), n: g.length };
    });
  }

  function pivotChannelsRetention(rows) {
    // hasVal: exclude rows where channel count column is missing/null (n(null)=0 would falsely bucket them into '0 ch')
    const hasVal = r => {
      const v = r['Total Social Channels Connected'];
      return v !== null && v !== undefined && String(v).trim() !== '';
    };
    return [
      { label:'0', fn: r => hasVal(r) && n(r['Total Social Channels Connected'])===0 },
      { label:'1', fn: r => hasVal(r) && n(r['Total Social Channels Connected'])===1 },
      { label:'2–3', fn: r => { const c=n(r['Total Social Channels Connected']); return hasVal(r) && c>=2&&c<=3; } },
      { label:'4+', fn: r => hasVal(r) && n(r['Total Social Channels Connected'])>=4 }
    ].map(({label, fn}) => {
      const g = rows.filter(fn);
      const eligible = g.filter(r => r.is_churned || (r.months_active !== null && r.months_active >= 3));
      if (eligible.length < 5) return { bucket: label, retention3m: null, n: g.length };
      const ret = eligible.filter(r => r.months_active !== null && r.months_active >= 3);
      return { bucket: label, retention3m: (ret.length/eligible.length*100).toFixed(1), n: g.length };
    });
  }

  function pivotChurnByDimension(rows, key, topN=10) {
    const groups = {};
    for (const r of rows) {
      const val = r[key] || 'unknown';
      if (!groups[val]) groups[val] = { total:0, churned:0 };
      groups[val].total++;
      if (r.is_churned) groups[val].churned++;
    }
    return Object.entries(groups)
      .map(([label, d]) => ({ label, total: d.total, churned: d.churned, rate: d.total>0?(d.churned/d.total*100).toFixed(1):0 }))
      .sort((a,b) => b.rate-a.rate).slice(0, topN);
  }

  function pivotCountryTable(rows, minN=30) {
    if (!rows.some(r => r._country)) return null;
    const mapped = rows.map(r => Object.assign({}, r, { _ctry: r._country || 'Unknown' }));
    return pivotChurnByDimension(mapped, '_ctry', 999).filter(r => r.total >= minN).sort((a,b) => b.rate-a.rate);
  }

  function pivotFeatureAdoption(rows) {
    const total = rows.length;
    if (!total) return [];
    return [
      { label: 'autopost ever', key: 'autopost_ever' },
      { label: 'ecom user', key: 'is_ecom_user' },
      { label: 'image user', key: 'image_user' },
      { label: 'video user', key: 'video_user' },
      { label: 'ugc user', key: 'ugc_user' },
      { label: '4.0 pipeline', key: 'uses_4_0' }
    ].map(f => {
      const adopters = rows.filter(r => r[f.key]);
      const nonAdopters = rows.filter(r => !r[f.key]);
      const ret3m = arr => {
        const eligible = arr.filter(r => r.is_churned || (r.months_active !== null && r.months_active >= 3));
        if (!eligible.length) return null;
        return (eligible.filter(r => r.months_active !== null && r.months_active >= 3).length / eligible.length * 100).toFixed(1);
      };
      return { label: f.label, pct: (adopters.length/total*100).toFixed(0), n: adopters.length, retention3m_adopters: ret3m(adopters), retention3m_non: ret3m(nonAdopters) };
    });
  }

  function pivotPlanTier(rows) { return pivotChurnByDimension(rows, 'plan_tier'); }

  function pivotBillingRetention(rows) {
    const monthly = rows.filter(r => r.billing_cycle === 'monthly');
    const annual  = rows.filter(r => r.billing_cycle === 'annual');
    const retAtM = (arr, m) => {
      const eligible = arr.filter(r => r.is_churned || (r.months_active !== null && r.months_active >= m));
      if (!eligible.length) return null;
      const retained = eligible.filter(r => r.months_active !== null && r.months_active >= m);
      return (retained.length / eligible.length * 100).toFixed(1);
    };
    return {
      labels: ['M1', 'M3', 'M6', 'M9', 'M12'],
      monthly: [1,3,6,9,12].map(m => retAtM(monthly, m)),
      annual:  [1,3,6,9,12].map(m => retAtM(annual, m))
    };
  }

  function computeAllPivots(rows) {
    return {
      summary: pivotSummary(rows),
      cohortRetention: pivotCohortRetention(rows),
      m1m6: pivotM1M6(rows),
      highLow: pivotHighLowComparison(rows),
      trialDepth: pivotTrialDepthRetention(rows),
      m0Churn: pivotM0ChurnByCohort(rows),
      zeroPostBuy: pivotZeroPostBuy(rows),
      contentTypes: pivotContentTypeAdoption(rows),
      typeCountRetention: pivotTypeCountRetention(rows),
      channelsRetention: pivotChannelsRetention(rows),
      featureAdoption: pivotFeatureAdoption(rows),
      churnByAttribution: pivotChurnByDimension(rows, 'Attribution Source'),
      churnByPersona: pivotChurnByDimension(rows, 'user_persona_cleaned'),
      churnByPlatform: pivotChurnByDimension(rows, 'payment_platform'),
      countryTable: pivotCountryTable(rows, 30),
      planTier: pivotPlanTier(rows),
      billingRetention: pivotBillingRetention(rows)
    };
  }

  function mergePlanSplit(mainRows, planArrayBuffer) {
    const wb = XLSX.read(planArrayBuffer, { type: 'array', raw: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const planData = XLSX.utils.sheet_to_json(ws, { defval: null });
    const planMap = {};
    for (const p of planData) {
      const email = String(p['email'] || p['Email'] || '').toLowerCase().trim();
      if (email) planMap[email] = { plan_tier: p['plan_name'] || p['plan_tier'] || null, billing_cycle: p['billing_cycle'] || null };
    }
    let matched = 0;
    for (const r of mainRows) {
      const email = String(r['username'] || '').toLowerCase().trim();
      if (planMap[email]) {
        r.plan_tier = planMap[email].plan_tier;
        r.billing_cycle = String(planMap[email].billing_cycle || '').toLowerCase();
        matched++;
      }
    }
    return { mainRows, matched, planTotal: planData.length };
  }

  return { parseExcel, computeHelperColumns, applyFilters, computeAllPivots, mergePlanSplit, pivotCountryTable };
})();
