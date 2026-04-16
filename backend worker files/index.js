/**
 * RETENTION DASHBOARD — CLOUDFLARE WORKER
 * Claude API proxy. API key via Worker Secret only — never in code.
 * Deploy: wrangler deploy && wrangler secret put CLAUDE_API_KEY
 */

const ALLOWED_ORIGINS = [
  'http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500',
  // Add your Netlify URL after deploying: 'https://your-site.netlify.app'
];

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2000;

const PREDIS_CONTEXT = `You are a senior SaaS product analyst for a B2B AI content creation platform. The product generates AI images, videos, carousels, and UGC-style avatar videos for social media marketing — used by SMBs, ecom brands, agencies, and startup founders.

Key business context:
- Users are typically low on AI knowledge, low patience, judge product in first 2-3 generations
- Trial: user adds credit card, gets 7-day free trial with ~500 credits
- Autoposting = scheduling content automatically to social platforms (strong retention signal hypothesis)
- Ecom users = connected a product store or uploaded product CSV
- ~60% of paid users churn
- Primary activation: first usable output within first session
- Known issues: AI hallucinations in output, video quality inconsistency, long generation times
- Key funnel: signup → brand details → CC mandatory → 7-day trial → content creation → paid`;

const INSIGHTS_SYSTEM = `${PREDIS_CONTEXT}

You receive pre-computed pivot data (aggregated summaries — NOT raw user data).

Return a JSON array of 5-7 insight objects. Each must have:
- "impact": "HIGH" | "MEDIUM" | "LOW"
- "finding": 1-2 sentences with specific numbers from the data
- "root_cause": 1-2 sentences on WHY this happens in this product context
- "action": a complete, system-level solution — not a generic tip. Include the mechanism, trigger, workflow. Think in terms of: email sequences, product gates, feature nudges, pricing changes, lifecycle interventions.

Sort by impact (HIGH first). Return ONLY valid JSON array — no markdown, no preamble, nothing outside the array.
Format: [{"impact":"HIGH","finding":"...","root_cause":"...","action":"..."}]

Rules:
- Every "finding" must cite at least one specific number from the data provided
- "action" must be a real, complete solution (e.g. "trigger a 3-part email sequence at day 2, 5, and 7 with X, Y, Z content" not "improve onboarding")
- Never invent numbers not present in the data
- Keep language simple and direct — no corporate jargon`;

const CHAT_SYSTEM = `${PREDIS_CONTEXT}

You receive aggregated pivot data and a question from the product team.

Rules:
- Answer using specific numbers from the data — quote actual values
- If the data doesn't have enough info to answer, say so clearly
- Keep answers concise: 2-4 sentences unless a breakdown genuinely helps
- Think like a product analyst: interpret the data, don't just repeat it
- When asked "why", connect data signals to product context
- Flag low confidence answers (small n, limited data)
- Simple language — avoid jargon, be direct`;

function corsHeaders(origin) {
  // 'null' (string) = browser Origin header for file:// requests — must allow for local testing
  const ok = !origin || origin === 'null' || ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin.includes('netlify.app') || origin.includes('localhost');
  return {
    'Access-Control-Allow-Origin': ok ? (origin === 'null' ? '*' : (origin || '*')) : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

async function callClaude(apiKey, system, messages) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages })
  });
  if (!resp.ok) { const e = await resp.text(); throw new Error(`Anthropic API ${resp.status}: ${e}`); }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });

    const apiKey = env.CLAUDE_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY not set. Run: wrangler secret put CLAUDE_API_KEY' }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }); }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/insights') {
        const { pivots } = body;
        if (!pivots) throw new Error('Missing pivots');
        const text = await callClaude(apiKey, INSIGHTS_SYSTEM, [{ role: 'user', content: `Retention pivot data:\n\n${JSON.stringify(pivots, null, 2)}\n\nGenerate insights as specified.` }]);
        let insights;
        try { insights = JSON.parse(text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim()); }
        catch { insights = text; }
        return new Response(JSON.stringify({ insights }), { headers: { ...headers, 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/chat') {
        const { question, pivots, history = [] } = body;
        if (!question) throw new Error('Missing question');

        // FIX BUG 4 in worker: history comes WITHOUT current question (fixed in ai.js)
        // Just append current question with pivot context at the end
        const messages = [];
        for (const turn of history) {
          if (turn.role === 'user' || turn.role === 'assistant') {
            messages.push({ role: turn.role, content: String(turn.content) });
          }
        }
        messages.push({ role: 'user', content: `Pivot data:\n${JSON.stringify(pivots, null, 2)}\n\nQuestion: ${question}` });

        const answer = await callClaude(apiKey, CHAT_SYSTEM, messages);
        return new Response(JSON.stringify({ answer }), { headers: { ...headers, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: 'Unknown endpoint' }), { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } });
    }
  }
};
