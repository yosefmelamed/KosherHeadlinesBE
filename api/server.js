require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
 
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const https = require('https');
const { exec } = require('child_process');
const path = require('path');
const { initDb, getAvailableDates, getStories } = require('../lib/db');
 
const app = express();
const PORT = process.env.PORT || 3001;
 
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
 
var MARKET_SYMBOLS = [
  { symbol: '^GSPC',   name: 'S&P 500',  group: 'indices'     },
  { symbol: '^DJI',    name: 'Dow',       group: 'indices'     },
  { symbol: '^IXIC',   name: 'Nasdaq',    group: 'indices'     },
  { symbol: 'AAPL',    name: 'Apple',     group: 'stocks'      },
  { symbol: 'MSFT',    name: 'Microsoft', group: 'stocks'      },
  { symbol: 'NVDA',    name: 'Nvidia',    group: 'stocks'      },
  { symbol: 'TSLA',    name: 'Tesla',     group: 'stocks'      },
  { symbol: 'META',    name: 'Meta',      group: 'stocks'      },
  { symbol: 'AMZN',    name: 'Amazon',    group: 'stocks'      },
  { symbol: 'BTC-USD', name: 'Bitcoin',   group: 'crypto'      },
  { symbol: 'ETH-USD', name: 'Ethereum',  group: 'crypto'      },
  { symbol: 'GC=F',    name: 'Gold',      group: 'commodities' },
  { symbol: 'CL=F',    name: 'Oil',       group: 'commodities' },
];
 
function fetchYahooQuote(symbol) {
  return new Promise(function(resolve) {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=1d';
    var req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          var meta = json.chart && json.chart.result && json.chart.result[0] && json.chart.result[0].meta;
          if (!meta) return resolve(null);
          var price = meta.regularMarketPrice;
          var prev = meta.chartPreviousClose || meta.previousClose || price;
          var change = price - prev;
          resolve({ symbol: symbol, price: price, change: change, changePct: prev ? (change / prev) * 100 : 0, currency: meta.currency || 'USD' });
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(8000, function() { req.destroy(); resolve(null); });
  });
}
 
var marketCache = { data: null, ts: 0 };
 
// ── Routes ────────────────────────────────────────────────────────────────────
 
app.get('/health', function(req, res) {
  res.json({ ok: true, ts: new Date().toISOString() });
});
 
app.get('/api/dates', async function(req, res) {
  try {
    var dates = await getAvailableDates();
    res.json({ dates: dates });
  } catch (err) {
    console.error('/api/dates error:', err.message);
    res.status(500).json({ error: 'Failed to fetch dates' });
  }
});
 
app.get('/api/stories', async function(req, res) {
  try {
    var date = req.query.date;
    var category = req.query.category;
    if (!date) return res.status(400).json({ error: 'date param required' });
    var stories = await getStories(date, category || null);
    var grouped = {};
    for (var i = 0; i < stories.length; i++) {
      var s = stories[i];
      if (!grouped[s.category]) grouped[s.category] = [];
      grouped[s.category].push(s);
    }
    res.json({ date: date, total: stories.length, grouped: grouped });
  } catch (err) {
    console.error('/api/stories error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stories' });
  }
});
 
app.get('/api/markets', async function(req, res) {
  try {
    var now = Date.now();
    if (marketCache.data && (now - marketCache.ts) < 5 * 60 * 1000) {
      return res.json(marketCache.data);
    }
    var results = await Promise.all(
      MARKET_SYMBOLS.map(function(s) {
        return fetchYahooQuote(s.symbol).then(function(q) {
          if (!q) return null;
          return { symbol: s.symbol, name: s.name, group: s.group, price: q.price, change: q.change, changePct: q.changePct, currency: q.currency };
        });
      })
    );
    var quotes = results.filter(function(r) { return r && r.price; });
    var payload = { quotes: quotes, updatedAt: new Date().toISOString() };
    marketCache = { data: payload, ts: now };
    res.json(payload);
  } catch (err) {
    console.error('/api/markets error:', err.message);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});
 
app.post('/api/fetch', function(req, res) {
  var body = req.body || {};
  var secret = body.secret;
  var date = body.date;
  if (process.env.FETCH_SECRET && secret !== process.env.FETCH_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ ok: true, message: 'Fetch job started' });
  var args = date ? ' ' + date : '';
  var cmd = 'node ' + path.join(__dirname, '../cron/fetch.js') + args;
  exec(cmd, function(err, stdout, stderr) {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (err) console.error('Fetch failed:', err.message);
  });
});
 
// ── Cron: daily at 7:00 AM New York time ─────────────────────────────────────
cron.schedule('0 7 * * *', function() {
  console.log('Running daily fetch...');
  exec('node ' + path.join(__dirname, '../cron/fetch.js'), function(err, stdout, stderr) {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (err) console.error('Cron failed:', err.message);
  });
}, { timezone: 'America/New_York' });
 
// ── Start — listen FIRST, init DB in background ───────────────────────────────
app.listen(PORT, '0.0.0.0',function() {
  console.log('API server running on port ' + PORT);
  console.log('   GET  /api/dates');
  console.log('   GET  /api/stories?date=YYYY-MM-DD');
  console.log('   GET  /api/markets');
  console.log('   POST /api/fetch');
 
  // Init DB after server is already listening so Render detects the port immediately
  initDb().then(function() {
    console.log('DB ready');
  }).catch(function(err) {
    console.error('DB init error:', err.message);
  });
});