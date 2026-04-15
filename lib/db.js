// lib/db.js — shared Neon PostgreSQL client
// Used by both the Express API and the cron job
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = neon(process.env.DATABASE_URL);

// ── Schema init ───────────────────────────────────────────────────────────────

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS stories (
      id           SERIAL PRIMARY KEY,
      fetch_date   DATE        NOT NULL,
      category     TEXT        NOT NULL CHECK (category IN ('trending','us_politics','world','financial','jewish')),
      source       TEXT        NOT NULL,
      title        TEXT        NOT NULL,
      summary      TEXT        NOT NULL,
      url          TEXT,
      published    TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_stories_date     ON stories(fetch_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_stories_date_cat ON stories(fetch_date, category)`;

  await sql`
    CREATE TABLE IF NOT EXISTS fetch_log (
      fetch_date   DATE PRIMARY KEY,
      fetched_at   TIMESTAMPTZ DEFAULT NOW(),
      story_count  INTEGER DEFAULT 0
    )
  `;

  console.log('✅ Database schema initialized');
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function getAvailableDates() {
  return await sql`
    SELECT fetch_date::text, story_count
    FROM fetch_log
    ORDER BY fetch_date DESC
    LIMIT 7
  `;
}

async function getStories(fetchDate, category = null) {
  if (category) {
    return await sql`
      SELECT id, fetch_date::text, category, source, title, summary, url, published
      FROM stories
      WHERE fetch_date = ${fetchDate} AND category = ${category}
      ORDER BY id ASC
    `;
  }
  return await sql`
    SELECT id, fetch_date::text, category, source, title, summary, url, published
    FROM stories
    WHERE fetch_date = ${fetchDate}
    ORDER BY category, id ASC
  `;
}

async function isFetched(fetchDate) {
  const rows = await sql`SELECT 1 FROM fetch_log WHERE fetch_date = ${fetchDate}`;
  return rows.length > 0;
}

async function insertStories(fetchDate, stories) {
  if (!stories.length) return;

  // Insert all stories in one transaction
  for (const s of stories) {
    await sql`
      INSERT INTO stories (fetch_date, category, source, title, summary, url, published)
      VALUES (
        ${fetchDate},
        ${s.category},
        ${s.source},
        ${s.title},
        ${s.summary},
        ${s.url || null},
        ${s.published || null}
      )
    `;
  }

  await sql`
    INSERT INTO fetch_log (fetch_date, story_count)
    VALUES (${fetchDate}, ${stories.length})
    ON CONFLICT (fetch_date) DO UPDATE SET
      fetched_at   = NOW(),
      story_count  = EXCLUDED.story_count
  `;

  console.log(`✅ Inserted ${stories.length} stories for ${fetchDate}`);
}

async function pruneOldStories(retentionDays = 7) {
  const result = await sql`
    DELETE FROM stories
    WHERE fetch_date < CURRENT_DATE - ${retentionDays}::int
  `;
  await sql`
    DELETE FROM fetch_log
    WHERE fetch_date < CURRENT_DATE - ${retentionDays}::int
  `;
  console.log(`🗑️  Pruned stories older than ${retentionDays} days`);
}

module.exports = { sql, initDb, getAvailableDates, getStories, isFetched, insertStories, pruneOldStories };

// Allow running directly: node lib/db.js
if (require.main === module) {
  initDb()
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}
