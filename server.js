const express = require("express");
const Parser = require("rss-parser");
const cors = require("cors");
const path = require("path");

const app = express();
const parser = new Parser({
  timeout: 15000,
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

function cleanHtml(html = "") {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function loadOneSubstack(substack) {
  let lastError = null;

  for (const feedUrl of substack.feeds) {
    try {
      const feed = await parser.parseURL(feedUrl);
      const posts = (feed.items || []).slice(0, 20).map((item) => ({
        title: item.title || "Untitled",
        link: item.link || substack.profile,
        date: item.isoDate || item.pubDate || null,
        author: item.creator || item.author || substack.name,
        source: substack.name,
        sourceUrl: substack.profile,
        excerpt: cleanHtml(item.contentSnippet || item.summary || item.content || "").slice(0, 300)
      }));
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

  res.json({
    updatedAt: new Date().toISOString(),
    substacks: SUBSTACKS.map(({ name, profile }) => ({ name, profile })),
    results
  });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, updatedAt: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Substack dashboard running on port ${PORT}`));
