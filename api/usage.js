export const config = { runtime: 'edge' };

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

const MODEL_PRICES = {
  'claude-opus-4-7':           { input: 5.00,  output: 25.00, label: 'Opus 4.7'   },
  'claude-opus-4-6':           { input: 5.00,  output: 25.00, label: 'Opus 4.6'   },
  'claude-sonnet-4-6':         { input: 3.00,  output: 15.00, label: 'Sonnet 4.6' },
  'claude-haiku-4-5-20251001': { input: 1.00,  output: 5.00,  label: 'Haiku 4.5'  },
  'claude-haiku-4-5':          { input: 1.00,  output: 5.00,  label: 'Haiku 4.5'  },
};

function getPrice(modelId) {
  if (MODEL_PRICES[modelId]) return MODEL_PRICES[modelId];
  const key = Object.keys(MODEL_PRICES).find(k => modelId.startsWith(k));
  return key ? MODEL_PRICES[key] : { input: 3.00, output: 15.00, label: modelId };
}

function billingPeriod() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString();
  const end   = new Date(Date.UTC(y, m + 1, 1)).toISOString();
  return { start, end };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(ALLOWED_ORIGIN ? { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN } : {}),
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN || '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const ADMIN_KEY = process.env.ANTHROPIC_ADMIN_KEY;
  if (!ADMIN_KEY) return json({ error: 'ANTHROPIC_ADMIN_KEY not configured' }, 500);

  const BUDGET = parseFloat(process.env.VEGA_BUDGET_USD || '100');

  const { start, end } = billingPeriod();

  const headers = {
    'x-api-key': ADMIN_KEY,
    'anthropic-version': '2023-06-01',
  };

  const usageParams = new URLSearchParams({ starting_at: start, ending_at: end, bucket_width: '1d' });
  usageParams.append('group_by[]', 'model');

  const costParams = new URLSearchParams({ starting_at: start, ending_at: end, bucket_width: '1d' });

  try {
    const [usageRes, costRes] = await Promise.all([
      fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${usageParams}`, { headers }),
      fetch(`https://api.anthropic.com/v1/organizations/cost_report?${costParams}`, { headers }),
    ]);

    if (!usageRes.ok) {
      const err = await usageRes.json().catch(() => ({}));
      return json({ error: err.error?.message || `Anthropic API error ${usageRes.status}` }, 502);
    }

    const usageData = await usageRes.json();

    // Aggregate token counts by model
    const byModel = {};
    let totalInput = 0, totalOutput = 0, totalCached = 0;

    (usageData.data || []).forEach(bucket => {
      (bucket.breakdown || []).forEach(entry => {
        const m = entry.model || 'unknown';
        if (!byModel[m]) byModel[m] = { input: 0, output: 0, cached: 0, cacheWrite: 0 };
        byModel[m].input     += (entry.input_tokens || 0);
        byModel[m].output    += (entry.output_tokens || 0);
        byModel[m].cached    += (entry.cache_read_input_tokens || 0);
        byModel[m].cacheWrite+= (entry.cache_creation_input_tokens || 0);
        totalInput  += (entry.input_tokens || 0);
        totalOutput += (entry.output_tokens || 0);
        totalCached += (entry.cache_read_input_tokens || 0);
      });
    });

    // Try cost API first; fall back to computed cost from token counts
    let totalCostCents = 0;

    if (costRes.ok) {
      const costData = await costRes.json();
      (costData.data || []).forEach(bucket => {
        (bucket.line_items || []).forEach(item => {
          totalCostCents += parseFloat(item.cost || 0);
        });
      });
    }

    if (totalCostCents === 0) {
      Object.entries(byModel).forEach(([model, t]) => {
        const p = getPrice(model);
        totalCostCents += (t.input  / 1e6) * p.input  * 100;
        totalCostCents += (t.output / 1e6) * p.output * 100;
        totalCostCents += (t.cached / 1e6) * (p.input * 0.1) * 100;
      });
    }

    // Attach labels to model keys
    const models = Object.entries(byModel).map(([id, tokens]) => {
      const price = getPrice(id);
      const cost = ((tokens.input / 1e6) * price.input * 100) + ((tokens.output / 1e6) * price.output * 100);
      return { id, label: price.label, ...tokens, cost };
    }).sort((a, b) => b.cost - a.cost);

    return json({
      period: { start, end },
      budget: BUDGET,
      totalInput,
      totalOutput,
      totalCached,
      totalCostCents: Math.round(totalCostCents),
      models,
    });

  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
