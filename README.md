# Headlines

A clean, AI-curated daily news briefing. Built with **Next.js 14**, **Express**, and **Neon (PostgreSQL)**. A daily cron job fetches RSS feeds, sends them through Claude for filtering and summarization, and stores the results in Neon. The Next.js frontend reads from the Express API.

---

## Project Structure

```
headlines/
├── api/
│   ├── server.js        ← Express API server (port 3001)
│   └── package.json
├── cron/
│   ├── fetch.js         ← Daily RSS fetch + Claude processing
│   └── package.json
├── lib/
│   ├── db.js            ← Neon PostgreSQL client + all queries
│   └── sources.js       ← RSS feed sources
├── frontend/            ← Next.js 14 app (port 3000)
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   ├── page.module.css
│   │   │   └── globals.css
│   │   ├── components/
│   │   │   ├── HeadlinesClient.tsx
│   │   │   └── HeadlinesClient.module.css
│   │   └── lib/
│   │       └── types.ts
│   ├── next.config.js
│   ├── tsconfig.json
│   └── package.json
├── .env.example
└── README.md
```

---

## Quick Start

### 1. Clone and install

```bash
# Install API + cron dependencies
cd api && npm install && cd ..
cd cron && npm install && cd ..  # only needed if running cron separately

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### 2. Set up Neon

1. Go to [neon.tech](https://neon.tech) and create a free account
2. Create a new project called `headlines`
3. Copy the **Connection string** from your dashboard
4. It looks like: `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL=postgresql://...your neon connection string...
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_API_URL=http://localhost:3001
PORT=3001
RETENTION_DAYS=7
```

> **Frontend**: copy `.env` to `frontend/.env.local` as well so Next.js picks up `NEXT_PUBLIC_API_URL`.

### 4. Initialize the database

```bash
node lib/db.js
```

This creates the `stories` and `fetch_log` tables in Neon.

### 5. Run your first fetch

```bash
node cron/fetch.js
```

Takes ~30–60 seconds. Fetches all 9 RSS feeds, sends them to Claude Haiku, stores clean results in Neon. Check your Neon dashboard to verify rows were inserted.

### 6. Start both servers

```bash
# Terminal 1 — API
cd api && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
```

Open **http://localhost:3000** 🎉

---

## How It Works

### Cron job (`cron/fetch.js`)

Runs once daily at 7 AM (built into the Express server). Can also be triggered manually:

```bash
node cron/fetch.js                # fetch today
node cron/fetch.js 2024-06-15     # force a specific date (backfill)
```

**Flow:**
1. Fetches up to 15 items from each of 9 RSS feeds
2. Batches everything into a single Claude Haiku API call
3. Claude filters sports/gossip/explicit, deduplicates, categorizes, and writes 2–3 sentence summaries
4. Clean JSON is stored in Neon
5. Stories older than `RETENTION_DAYS` are pruned

**Cost:** ~$0.01–0.03/day using Claude Haiku.

### Express API (`api/server.js`)

```
GET  /api/dates                          → last 7 days with data
GET  /api/stories?date=YYYY-MM-DD        → all stories grouped by category
GET  /api/stories?date=YYYY-MM-DD&category=world
POST /api/fetch  { secret? }             → manual trigger
GET  /health                             → health check
```

### Next.js Frontend (`frontend/`)

Server-rendered with React Server Components. The `HeadlinesClient` is a client component for interactive day/category navigation. Stories fade in with staggered animation. Full dark mode support via CSS `prefers-color-scheme`.

---

## RSS Sources

| Source | Category |
|---|---|
| AP News | Trending |
| Reuters Top News | Trending |
| Politico | US Politics |
| The Hill | US Politics |
| BBC World | World |
| Reuters World | World |
| MarketWatch | Financial |
| WSJ Markets | Financial |
| Yeshiva World News | Jewish |

To add sources, edit `lib/sources.js`.

---

## Deployment

### Recommended stack

| Layer | Service | Notes |
|---|---|---|
| Database | [Neon](https://neon.tech) | Already set up — free tier is plenty |
| API | [Railway](https://railway.app) or [Render](https://render.com) | Deploy the `api/` folder |
| Frontend | [Vercel](https://vercel.com) | Deploy the `frontend/` folder — ideal for Next.js |

### Vercel (frontend)

```bash
cd frontend
npx vercel
# Set env vars in Vercel dashboard:
#   NEXT_PUBLIC_API_URL = https://your-api.railway.app
```

### Railway (API)

1. Create a new Railway project
2. Connect your GitHub repo
3. Set root directory to `api/`
4. Add env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `PORT=3001`
5. The built-in cron runs daily at 7 AM automatically

### Cron on a VPS (alternative)

If you prefer system cron instead of the built-in node-cron:

```bash
# crontab -e
0 7 * * * cd /path/to/headlines && node cron/fetch.js >> /var/log/headlines.log 2>&1
```

---

## Customization

**Change cron time** — edit `api/server.js`:
```js
cron.schedule('0 6 * * *', ...)  // 6 AM instead of 7 AM
```

**Add a news source** — edit `lib/sources.js`:
```js
{ url: 'https://example.com/feed', name: 'Example News', hint: 'world' }
```

**Tune the AI filter** — edit the prompt in `cron/fetch.js`. You can:
- Add more filter rules ("also remove opinion pieces")
- Change summary length ("write 1 sentence only")
- Add a new category (add it to `CATEGORIES` in `lib/sources.js` and `lib/types.ts`)

**Manual fetch via API:**
```bash
curl -X POST http://localhost:3001/api/fetch \
  -H "Content-Type: application/json" \
  -d '{"secret": "your-fetch-secret"}'
```
Set `FETCH_SECRET` in `.env` to secure this endpoint.
