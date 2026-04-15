// lib/markets.js
// Fetches real-time market data from Yahoo Finance (no API key needed)
// and formats it as a special story card for the financial category

const https = require('https');

const SYMBOLS = {
  indices: [
    { symbol: '^GSPC',  name: 'S&P 500'    },
    { symbol: '^DJI',   name: 'Dow Jones'  },
    { symbol: '^IXIC',  name: 'Nasdaq'     },
    { symbol: '^RUT',   name: 'Russell 2000'},
  ],
  stocks: [
    { symbol: 'AAPL',  name: 'Apple'     },
    { symbol: 'MSFT',  name: 'Microsoft' },
    { symbol: 'GOOGL', name: 'Google'    },
    { symbol: 'AMZN',  name: 'Amazon'    },
    { symbol: 'TSLA',  name: 'Tesla'     },
    { symbol: 'NVDA',  name: 'Nvidia'    },
    { symbol: 'META',  name: 'Meta'      },
  ],
  crypto: [
    { symbol: 'BTC-USD', name: 'Bitcoin'  },
    { symbol: 'ETH-USD', name: 'Ethereum' },
  ],
  commodities: [
    { symbol: 'GC=F',  name: 'Gold'         },
    { symbol: 'CL=F',  name: 'Crude Oil'    },
  ],
};

function fetchQuote(symbol) {
  return new Promise(function(resolve) {
    var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=1d';
    var req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
          var prev  = meta.chartPreviousClose || meta.previousClose;
          var change = price - prev;
          var changePct = (change / prev) * 100;
          resolve({
            symbol: symbol,
            price: price,
            change: change,
            changePct: changePct,
            currency: meta.currency || 'USD',
          });
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', function() { resolve(null); });
    req.setTimeout(8000, function() { req.destroy(); resolve(null); });
  });
}

function fmt(num, decimals) {
  decimals = decimals !== undefined ? decimals : 2;
  return Number(num).toFixed(decimals);
}

function fmtPrice(price, currency) {
  if (currency === 'USD') return '$' + Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Number(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function arrow(change) {
  return change >= 0 ? 'up' : 'down';
}

async function fetchAllMarkets() {
  var allSymbols = []
    .concat(SYMBOLS.indices)
    .concat(SYMBOLS.stocks)
    .concat(SYMBOLS.crypto)
    .concat(SYMBOLS.commodities);

  console.log('Fetching market data for ' + allSymbols.length + ' symbols...');

  var results = await Promise.all(allSymbols.map(function(s) {
    return fetchQuote(s.symbol).then(function(q) {
      return q ? Object.assign({}, s, q) : null;
    });
  }));

  var valid = results.filter(function(r) { return r && r.price; });
  console.log('   Got data for ' + valid.length + ' of ' + allSymbols.length + ' symbols');
  return valid;
}

function buildMarketStory(quotes, date) {
  if (!quotes || !quotes.length) return null;

  function section(items, symbols) {
    return items
      .filter(function(q) { return symbols.some(function(s) { return s.symbol === q.symbol; }); })
      .map(function(q) {
        var sign = q.change >= 0 ? '+' : '';
        return q.name + ' ' + fmtPrice(q.price, q.currency) + ' (' + sign + fmt(q.changePct) + '%)';
      })
      .join(', ');
  }

  var indicesStr    = section(quotes, SYMBOLS.indices);
  var stocksStr     = section(quotes, SYMBOLS.stocks);
  var cryptoStr     = section(quotes, SYMBOLS.crypto);
  var commoditiesStr = section(quotes, SYMBOLS.commodities);

  // Find biggest movers
  var movers = quotes
    .filter(function(q) { return SYMBOLS.stocks.some(function(s) { return s.symbol === q.symbol; }); })
    .sort(function(a, b) { return Math.abs(b.changePct) - Math.abs(a.changePct); })
    .slice(0, 3);

  var moversStr = movers.map(function(q) {
    var sign = q.change >= 0 ? '+' : '';
    return q.name + ' ' + sign + fmt(q.changePct) + '%';
  }).join(', ');

  var sp = quotes.find(function(q) { return q.symbol === '^GSPC'; });
  var trend = sp ? (sp.change >= 0 ? 'higher' : 'lower') : 'mixed';

  var summary = 'Markets are trading ' + trend + ' today. ';
  if (indicesStr) summary += 'Major indices: ' + indicesStr + '. ';
  if (moversStr)  summary += 'Top movers: ' + moversStr + '. ';
  if (cryptoStr)  summary += 'Crypto: ' + cryptoStr + '. ';
  if (commoditiesStr) summary += 'Commodities: ' + commoditiesStr + '.';

  return {
    category: 'financial',
    source: 'Market Data',
    title: 'Markets Today: Live Snapshot',
    summary: summary.trim(),
    url: 'https://finance.yahoo.com',
    published: date || new Date().toISOString().slice(0, 10),
    isMarketSnapshot: true,
  };
}

module.exports = { fetchAllMarkets, buildMarketStory };
