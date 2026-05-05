# vega-usage

Personal Anthropic token usage dashboard. Phone-optimized, dark, deployed to Vercel.

## What it shows

- **Tokens this period** — total input, output, cached
- **Cost so far** — live USD cost + remaining budget
- **Billing resets in** — countdown to next period start
- **Budget bar** — visual spend vs. limit
- **By model** — cost breakdown per model (Sonnet, Haiku, Opus)

## Architecture

The Admin API key never touches the browser. A Vercel Edge Function (`/api/usage`) holds the key as a server-side environment variable and proxies requests to Anthropic. The frontend just calls `/api/usage` — no key input, no localStorage.

```
Phone → /api/usage (Vercel Edge) → Anthropic Admin API
```

## Deploy

### 1. Push to GitHub

```bash
git init && git add . && git commit -m "init"
gh repo create derekpcollins/vega-usage --public --push
```

### 2. Set environment variables on Colossus

```bash
# Required: your Admin API key (sk-ant-admin...) from console.anthropic.com/settings/keys
vercel env add ANTHROPIC_ADMIN_KEY production

# Required: your monthly budget in USD
vercel env add VEGA_BUDGET_USD production
# enter: 100

# Optional: lock CORS to your Vercel domain after first deploy
# vercel env add ALLOWED_ORIGIN production
# enter: https://vega-usage.vercel.app
```

### 3. Deploy

```bash
vercel --prod
```

Or connect the repo in the Vercel dashboard for auto-deploy on push.

No build step. Pure HTML/JS/CSS + one Edge Function, zero npm dependencies.

## Notes

- Uses `/v1/organizations/usage_report/messages` + `/v1/organizations/cost_report`
- Requires an Admin API key — different from your standard `sk-ant-api-...` key
- Billing period assumed to be calendar month (1st → last day)
- If the cost endpoint returns zero, cost is computed from token counts × current model pricing
