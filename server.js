const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const path = require('path');

const app = express();
const parser = new Parser({ timeout: 15000 });
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const FEEDS = [
  { name: 'The Jason Jones Show', writer: 'Jason Jones', countryHint: 'Multiple', url: 'https://substack.com/@thejasonjonesshow/feed' },
  { name: 'Persecuted Church Alerts', writer: 'Persecuted Church Alerts', countryHint: 'Multiple', url: 'https://persecutedchurchalerts.substack.com/feed' }
];

// Alexandra/Lex is kept as a writer/person filter instead of a direct feed,
// because https://substack.com/@lexpouliot is a profile page and does not reliably
// expose a publication RSS feed. If her name appears in post metadata or text,
// those posts will be labeled under her in the dashboard.
const WRITER_ALIASES = [
  { writer: 'Alexandrya Pouliot', keys: ['alexandrya pouliot', 'alexandra pouliot', 'lex pouliot', '@lexpouliot'] }
];

const COUNTRY_KEYWORDS = {
  'Israel–Palestine': ['gaza','palestine','palestinian','israel','israeli','west bank','jerusalem','hamas'],
  'Lebanon': ['lebanon','hezbollah','beirut'],
  'Syria': ['syria','syrian','damascus','assad'],
  'Jordan': ['jordan','amman'],
  'Iraq': ['iraq','baghdad'],
  'Iran': ['iran','tehran'],
  'Turkey': ['turkey','türkiye','istanbul','ankara'],
  'Nigeria': ['nigeria','nigerian','abuja','bokoharam','boko haram'],
  'Sudan': ['sudan','darfur','khartoum'],
  'DR Congo': ['congo','drc','kinshasa'],
  'Ukraine': ['ukraine','ukrainian','kyiv','russia','russian'],
  'China': ['china','chinese','beijing','uyghur'],
  'India': ['india','indian','delhi'],
  'Pakistan': ['pakistan','pakistani'],
  'Afghanistan': ['afghanistan','afghan','taliban'],
  'Armenia': ['armenia','armenian','artsakh'],
  'United States': ['united states','u.s.','usa','america','american','washington','trump'],
  'Canada': ['canada','canadian','ottawa'],
  'United Kingdom': ['united kingdom','uk','britain','british','london']
};

const TOPIC_KEYWORDS = {
  'Religious persecution': ['persecution','church','christian','bishop','priest','pastor','believer','religious freedom'],
  'Humanitarian aid': ['aid','humanitarian','food','water','medicine','relief','convoy'],
  'Displacement': ['displaced','refugee','evacuation','shelter','camp'],
  'Ceasefire / negotiations': ['ceasefire','negotiation','deal','talks','truce'],
  'Conflict / security': ['attack','airstrike','war','military','soldiers','hostage','rocket','missile'],
  'Politics / policy': ['bill','senate','congress','policy','government','minister','president'],
  'Human rights': ['human rights','detained','arrested','abuse','freedom']
};

const WEEKLY_PATTERNS = ['weekly situation report','situation report','sitrep','weekly report','weekly update','weekly briefing','this week','weekly'];

function strip(html = '') {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
function detectFromText(text, dictionary, fallback = 'Multiple') {
  const t = text.toLowerCase();
  const found = [];
  for (const [label, keys] of Object.entries(dictionary)) if (keys.some(k => t.includes(k))) found.push(label);
  return found.length ? found.slice(0, 4) : [fallback];
}
function detectWriter(text, fallback) {
  const t = String(text || '').toLowerCase();
  for (const alias of WRITER_ALIASES) {
    if (alias.keys.some(k => t.includes(k))) return alias.writer;
  }
  return fallback;
}
function makeSummary(text) {
  const cleaned = strip(text);
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  return sentences.slice(0, 3).map(s => s.trim()).filter(Boolean);
}
function isWeekly(item) {
  const title = (item.title || '').toLowerCase();
  const body = strip(item.contentSnippet || item.content || '').toLowerCase();
  return WEEKLY_PATTERNS.some(p => title.includes(p) || body.slice(0, 400).includes(p));
}
async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    const items = (parsed.items || []).slice(0, 30).map(item => {
      const text = `${item.title || ''} ${item.contentSnippet || ''} ${strip(item.content || '')}`;
      return {
        id: Buffer.from(`${feed.name}-${item.link || item.guid || item.title}`).toString('base64'),
        title: item.title || 'Untitled',
        link: item.link,
        date: item.pubDate || item.isoDate || null,
        publication: feed.name,
        writer: detectWriter(`${item.creator || ''} ${item.author || ''} ${text}`, item.creator || item.author || feed.writer),
        excerpt: strip(item.contentSnippet || item.content || '').slice(0, 500),
        countries: detectFromText(text, COUNTRY_KEYWORDS, feed.countryHint),
        topics: detectFromText(text, TOPIC_KEYWORDS, 'General'),
        isWeeklyReport: isWeekly(item),
        summary: makeSummary(item.contentSnippet || item.content || item.title).slice(0, 3)
      };
    });
    items.push({ feedStatus: true, ok: true, publication: feed.name, url: feed.url, count: items.length });
    return items;
  } catch (e) {
    return [{ feedStatus: true, ok: false, publication: feed.name, writer: feed.writer, url: feed.url, message: e.message || 'Unknown feed error' }];
  }
}
app.get('/api/posts', async (req, res) => {
  const batches = await Promise.all(FEEDS.map(fetchFeed));
  const flat = batches.flat();
  const feedStatus = flat.filter(x => x.feedStatus);
  const posts = flat.filter(x => !x.feedStatus && !x.error).sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0));
  const errors = feedStatus.filter(x => !x.ok);
  const weekAgo = Date.now() - 7*24*60*60*1000;
  const thisWeek = posts.filter(p => new Date(p.date || 0).getTime() >= weekAgo);
  const weeklyReports = posts.filter(p => p.isWeeklyReport).slice(0, 12);
  const countries = [...new Set(posts.flatMap(p => p.countries))].sort();
  const writers = [...new Set([...posts.map(p => p.writer).filter(Boolean), ...WRITER_ALIASES.map(a => a.writer)])].sort();
  const topics = [...new Set(thisWeek.flatMap(p => p.topics))].sort();
  res.json({ updatedAt: new Date().toISOString(), posts, weeklyReports, meta: { totalPosts: posts.length, thisWeek: thisWeek.length, weeklyReportCount: weeklyReports.length, countries, writers, topics, errors, feedStatus } });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Substack dashboard running on ${PORT}`));
