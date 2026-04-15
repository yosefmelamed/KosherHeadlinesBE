const SOURCES = [
// Trending — Fox News and NY Post
{ url: 'https://feeds.foxnews.com/foxnews/latest', name: 'Fox News', hint: 'trending' },
{ url: 'https://nypost.com/feed', name: 'New York Post', hint: 'trending' },
// US Politics — Fox Politics, Washington Examiner, Washington Times
{ url: 'https://moxie.foxnews.com/google-publisher/politics.xml', name: 'Fox Politics', hint: 'us_politics' },
{ url: 'https://www.washingtonexaminer.com/tag/politics.rss', name: 'Washington Examiner', hint: 'us_politics' },
{ url: 'https://www.washingtontimes.com/rss/headlines/news/politics', name: 'Washington Times', hint: 'us_politics' },
// World — AP and Washington Times world
{ url: 'https://moxie.foxnews.com/google-publisher/world.xml', name: 'Fox World', hint: 'world' },
{ url: 'https://www.washingtontimes.com/rss/headlines/news/world', name: 'Washington Times World', hint: 'world' },
// Financial — MarketWatch and WSJ
{ url: 'https://feeds.marketwatch.com/marketwatch/topstories/', name: 'MarketWatch', hint: 'financial' },
{ url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', name: 'WSJ Markets', hint: 'financial' },
// Jewish — Yeshiva World News
{ url: 'https://www.theyeshivaworld.com/feed', name: 'Yeshiva World News', hint: 'jewish' },
];
const CATEGORIES = ['trending', 'us_politics', 'world', 'financial', 'jewish'];
module.exports = { SOURCES, CATEGORIES };