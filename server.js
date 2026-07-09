const express = require("express");
const Parser = require("rss-parser");
const cors = require("cors");
const path = require("path");

const app = express();
const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: [
      ["dc:creator", "dcCreator"],
      ["content:encoded", "contentEncoded"]
    ]
  },
  headers: { "User-Agent": "Mozilla/5.0 Substack Dashboard" }
});

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const SUBSTACKS = [
  {
    name: "The Jason Jones Show",
    profile: "https://substack.com/@thejasonjonesshow/posts",
    feeds: [
      "https://substack.com/@thejasonjonesshow/feed",
      "https://thejasonjonesshow.substack.com/feed"
    ]
  },
  {
    name: "Lex Pouliot",
    profile: "https://substack.com/@lexpouliot",
    feeds: [
      "https://substack.com/@lexpouliot/feed",
      "https://lexpouliot.substack.com/feed"
    ]
  },
  {
    name: "Persecuted Church Alerts",
    profile: "https://persecutedchurchalerts.substack.com/",
    feeds: [
      "https://persecutedchurchalerts.substack.com/feed",
      "https://substack.com/@persecutedchurchalerts/feed"
    ]
  }
];

const COUNTRY_KEYWORDS = [
  { country: "United States", terms: ["united states", "u.s.", "u.s", "usa", "america", "american", "washington", "new york", "texas", "california", "florida", "congress", "white house"] },
  { country: "Israel-Palestine", terms: ["israel", "israeli", "palestine", "palestinian", "gaza", "west bank", "jerusalem", "netanyahu", "hamas", "zionism", "zionist"] },
  { country: "Lebanon", terms: ["lebanon", "lebanese", "hezbollah", "beirut"] },
  { country: "Syria", terms: ["syria", "syrian", "damascus"] },
  { country: "Iraq", terms: ["iraq", "iraqi", "baghdad"] },
  { country: "Iran", terms: ["iran", "iranian", "tehran"] },
  { country: "Ukraine", terms: ["ukraine", "ukrainian", "kyiv", "zelensky"] },
  { country: "Russia", terms: ["russia", "russian", "moscow", "putin"] },
  { country: "China", terms: ["china", "chinese", "beijing", "xi jinping"] },
  { country: "India", terms: ["india", "indian", "modi", "new delhi"] },
  { country: "Pakistan", terms: ["pakistan", "pakistani", "islamabad"] },
  { country: "Nigeria", terms: ["nigeria", "nigerian", "abuja", "lagos"] },
  { country: "Sudan", terms: ["sudan", "sudanese", "khartoum"] },
  { country: "Egypt", terms: ["egypt", "egyptian", "cairo"] },
  { country: "United Kingdom", terms: ["united kingdom", "u.k.", "uk", "britain", "british", "london"] },
  { country: "France", terms: ["france", "french", "paris"] },
  { country: "Canada", terms: ["canada", "canadian", "ottawa", "toronto"] },
  { country: "Mexico", terms: ["mexico", "mexican", "mexico city"] },
  { country: "Multiple/Global", terms: ["world", "global", "international", "worldwide", "foreign policy", "human rights", "christians", "persecution", "church"] }
];

function cleanHtml(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&rsquo;/g, "’")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthor(author, fallback) {
  const cleaned = cleanHtml(author || "").replace(/^by\s+/i, "").trim();
  return cleaned || fallback;
}

function detectCountry(text) {
  const lower = (text || "").toLowerCase();
  const matches = [];
  for (const entry of COUNTRY_KEYWORDS) {
    const score = entry.terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0);
    if (score > 0) matches.push({ country: entry.country, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.country || "Uncategorized";
}

async function loadOneSubstack(substack) {
  let lastError = null;

  for (const feedUrl of substack.feeds) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const posts = (feed.items || []).slice(0, 80).map((item) => {
        const excerpt = cleanHtml(item.contentSnippet || item.summary || item.content || item.contentEncoded || "").slice(0, 350);
        const title = item.title || "Untitled";
        const author = normalizeAuthor(item.creator || item.author || item.dcCreator, substack.name);
        const country = detectCountry(`${title} ${excerpt}`);
        return {
          title,
          link: item.link || substack.profile,
          date: item.isoDate || item.pubDate || null,
          author,
          country,
          source: substack.name,
          sourceUrl: substack.profile,
          excerpt
        };
      });
      return { ok: true, feedUrl, posts };
    } catch (err) {
      lastError = err.message;
    }
  }

  return { ok: false, feedUrl: null, posts: [], error: lastError || "Feed unavailable" };
}

app.get("/api/posts", async (req, res) => {
  const results = {};
  await Promise.all(
    SUBSTACKS.map(async (substack) => {
      results[substack.name] = await loadOneSubstack(substack);
    })
  );

  const allPosts = Object.values(results).flatMap((r) => r.posts || []);
  const authors = [...new Set(allPosts.map((p) => p.author).filter(Boolean))].sort();
  const countries = [...new Set(allPosts.map((p) => p.country).filter(Boolean))].sort();

  res.json({
    updatedAt: new Date().toISOString(),
    substacks: SUBSTACKS.map(({ name, profile }) => ({ name, profile })),
    authors,
    countries,
    results
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, updatedAt: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Substack dashboard running on port ${PORT}`));
