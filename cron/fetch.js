require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Parser = require('rss-parser');
const { Anthropic } = require('@anthropic-ai/sdk');
const https = require('https');
const { SOURCES, CATEGORIES } = require('../lib/sources');
const { initDb, isFetched, insertStories, pruneOldStories } = require('../lib/db');
const { fetchAllMarkets, buildMarketStory } = require('../lib/markets');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});

function stripHtml(str) {
  str = str || '';
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function checkForFilterPage(data, url) {
  if (data.trim().startsWith('<')) {
    var titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i);
    var title = titleMatch ? titleMatch[1] : 'Unknown Filter Page';
    var hrefMatches = data.match(/href="([^"]{10,})"/g) || [];
    var hrefs = hrefMatches.slice(0, 3).map(function(h) { return h.replace(/href="|"/g, ''); });
    console.warn('BLOCKED - Filter page detected');
    console.warn('Blocked URL -> ' + url);
    console.warn('Page title  -> ' + title);
    console.warn('Links found -> ' + hrefs.join(' | '));
    return true;
  }
  return false;
}

function fetchViaProxy(url) {
  return new Promise(function(resolve, reject) {
    var proxyUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(url);
    https.get(proxyUrl, { headers: { 'User-Agent': 'Headlines/1.0' } }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          if (checkForFilterPage(data, url)) return reject(new Error('Blocked by filter page'));
          var json = JSON.parse(data);
          if (json.status !== 'ok') return reject(new Error('Proxy error: ' + json.message));
          resolve(json.items || []);
        } catch (e) {
          reject(new Error('Proxy bad JSON: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

function preCheckUrl(url) {
  return new Promise(function(resolve) {
    var req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      }
    }, function(res) {
      var chunk = '';
      res.on('data', function(c) {
        chunk += c;
        if (chunk.length > 1000) req.destroy();
      });
      res.on('close', function() { resolve(chunk); });
    });
    req.on('error', function() { resolve(''); });
  });
}

async function fetchAllFeeds() {
  var results = [];
  for (var i = 0; i < SOURCES.length; i++) {
    var source = SOURCES[i];
    try {
      console.log('Fetching ' + source.name + '...');
      var items = [];
      try {
        var preview = await preCheckUrl(source.url);
        if (checkForFilterPage(preview, source.url)) throw new Error('Filter page on pre-check');
        var feed = await parser.parseURL(source.url);
        items = (feed.items || []).slice(0, 15).map(function(item) {
          return {
            source: source.name, hint: source.hint,
            title: (item.title || '').trim(),
            url: item.link || item.guid || '',
            published: item.isoDate || item.pubDate || '',
            snippet: stripHtml(item.contentSnippet || item.content || '').slice(0, 300),
          };
        });
        console.log('   OK ' + items.length + ' items (direct)');
      } catch (directErr) {
        console.log('   Direct failed (' + directErr.message.slice(0, 60) + '), trying proxy...');
        var proxyItems = await fetchViaProxy(source.url);
        items = proxyItems.map(function(item) {
          return {
            source: source.name, hint: source.hint,
            title: (item.title || '').trim(),
            url: item.link || '',
            published: item.pubDate || '',
            snippet: stripHtml(item.description || '').slice(0, 300),
          };
        });
        console.log('   OK ' + items.length + ' items (proxy)');
      }
      results = results.concat(items.filter(function(i) { return i.title; }));
    } catch (err) {
      console.warn('   FAILED ' + source.name + ' -> ' + err.message);
    }
  }
  return results;
}

async function processWithClaude(rawItems) {
  var inputJson = JSON.stringify(
    rawItems.map(function(item, i) {
      return { i: i, source: item.source, hint: item.hint, title: item.title, snippet: item.snippet, url: item.url, published: item.published };
    })
  );

  var prompt = 'You are a professional news editor building a clean daily briefing for a conservative-leaning Jewish audience.\n\nGiven these raw RSS items, return a JSON array of the best stories.\n\nFILTER OUT - remove any story that falls into these categories, no exceptions:\n- Sports of any kind\n- Entertainment gossip, celebrity news, Hollywood, music industry\n- Sexual content of any kind - this includes same-sex marriage, gender transitioning, LGBTQ policy or rulings, sexual abuse cases including Epstein and Weinstein, pornography, sex trafficking details, sexual harrasment, sexual abuse, or any story containg the word sex, sexual\n- Religion other than Judaism - no stories about Christianity, Islam, Hinduism, or other faiths unless directly impacting Jewish community\n- Clickbait, listicles, sponsored content, product reviews\n- Duplicate or near-duplicate stories - keep only the single best version\n\nCATEGORIZE each kept story into exactly one of:\n- trending: major breaking news, science, health, technology, society\n- us_politics: US government, Congress, elections, domestic policy\n- world: international news, foreign policy, global events\n- financial: markets, economy, business, real estate, crypto\n- jewish: Jewish community, Israel, Torah, halacha, Jewish organizations\n\nIMPORTANT: Aim for 4-5 strong stories per category. Do not return fewer than 3 per category if the source material supports it, but no more than 6 stories and try to keep in to 5 max.\n\nFor each story write a 2-3 sentence plain neutral English summary with enough context to understand the story without clicking.\n\nReturn ONLY a valid JSON array, nothing else, no markdown, starting with [ and ending with ]:\n[{"category":"...","source":"...","title":"...","summary":"...","url":"...","published":"..."}]\n\nRaw items: ' + inputJson;

  console.log('Sending ' + rawItems.length + ' items to Claude...');

  var response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });

  var text = '';
  if (response && response.content && Array.isArray(response.content)) {
    text = response.content.filter(function(b) { return b && b.type === 'text'; }).map(function(b) { return b.text || ''; }).join('');
  } else if (typeof response === 'string') {
    text = response;
  }

  console.log('Response length -> ' + text.length + ' chars');

  if (!text.trim()) {
    console.error('Raw API response: ' + JSON.stringify(response, null, 2).slice(0, 500));
    throw new Error('Empty text in Claude response');
  }

  var start = text.indexOf('[');
  var end = text.lastIndexOf(']');
  if (start === -1 || end === -1) {
    console.error('Response preview: ' + text.slice(0, 400));
    throw new Error('No JSON array found in response');
  }

  var stories;
  try {
    stories = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error('JSON parse failed: ' + e.message);
  }

  var valid = (Array.isArray(stories) ? stories : []).filter(function(s) {
    return s && s.category && CATEGORIES.includes(s.category) && s.title && s.summary && s.source;
  });

  console.log('Valid stories -> ' + valid.length);
  return valid;
}

async function run(forceDate) {
  forceDate = forceDate || null;
  var today = forceDate || new Date().toISOString().slice(0, 10);
  console.log('\nHeadlines fetch -> ' + today);
  console.log('--------------------------------------------------');

  await initDb();

  if (!forceDate && await isFetched(today)) {
    console.log('Already fetched for ' + today + '. To re-run: node cron/fetch.js ' + today);
    return;
  }

  // Fetch RSS and market data in parallel
  var raw, quotes;
  try {
    var both = await Promise.all([fetchAllFeeds(), fetchAllMarkets()]);
    raw    = both[0];
    quotes = both[1];
  } catch (e) {
    raw    = await fetchAllFeeds();
    quotes = [];
  }

  console.log('\nTotal raw items -> ' + raw.length);
  if (!raw.length) { console.error('No items. Aborting.'); process.exit(1); }

  var stories = await processWithClaude(raw);
  if (!stories.length) { console.error('No valid stories. Aborting.'); process.exit(1); }

  // Inject market snapshot as first financial story
  if (quotes && quotes.length) {
    var marketStory = buildMarketStory(quotes, today);
    if (marketStory) {
      stories.unshift(marketStory);
      console.log('Market snapshot injected into financial category');
    }
  }

  await insertStories(today, stories);
  await pruneOldStories(parseInt(process.env.RETENTION_DAYS || '7', 10));
  console.log('\nDone!\n');
}

run(process.argv[2] || null).catch(function(err) {
  console.error('ERROR: ' + err.message);
  process.exit(1);
});
