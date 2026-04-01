import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_STYLE_TRANSCRIPTS_DIR } from "./podcastStyleProfile.js";

const DEFAULT_SOURCE_URL = "https://podcasts.happyscribe.com/fantasy-footballers-fantasy-football-podcast";
const DEFAULT_LIMIT = 6;

function stripTags(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n");
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2019;/gi, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&#8230;/g, "...");
}

function normalizeText(value) {
  return decodeHtmlEntities(stripTags(value))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Referer: "https://podcasts.happyscribe.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseEpisodeLinks(indexHtml, baseUrl) {
  const matches = [...indexHtml.matchAll(/href="([^"]+\/fantasy-football-podcast\/[^"]+)"/gi)];
  const seen = new Set();
  const links = [];

  for (const match of matches) {
    const url = new URL(match[1], baseUrl).toString();
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    links.push(url);
  }

  return links;
}

function extractTitle(html) {
  const match = html.match(/<h1[^>]*>\s*Transcript of\s*([^<]+?)\s*<\/h1>/i);
  if (match?.[1]) {
    return normalizeText(match[1]);
  }

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch?.[1]?.trim() || "podcast-transcript";
}

function extractTranscriptBody(html) {
  const marker = html.indexOf("Transcription of");
  const section = marker >= 0 ? html.slice(marker) : html;
  const text = normalizeText(section);
  const lines = text.split("\n");
  const transcriptLines = [];

  for (const line of lines) {
    if (/^Transcript of /i.test(line) || /^Fantasy Footballers - Fantasy Football Podcast$/i.test(line)) {
      continue;
    }

    if (/^Published /i.test(line) || /^Copy link to transcript$/i.test(line)) {
      continue;
    }

    transcriptLines.push(line);
  }

  const startIndex = transcriptLines.findIndex((line) => /^\d{2}:\d{2}:\d{2}$/.test(line));
  return (startIndex >= 0 ? transcriptLines.slice(startIndex) : transcriptLines).join("\n").trim();
}

async function importEpisode(url, outputDir, index) {
  const html = await fetchText(url);
  const title = extractTitle(html);
  const transcript = extractTranscriptBody(html);
  if (!transcript) {
    return null;
  }

  const filename = `${String(index + 1).padStart(2, "0")}-${slugify(title)}.txt`;
  const outputPath = path.join(outputDir, filename);
  const fileBody = [`Source: ${url}`, `Title: ${title}`, "", transcript].join("\n");
  await writeFile(outputPath, fileBody, "utf8");
  return outputPath;
}

function getArgValue(name, fallback = null) {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = args.indexOf(`--${name}`);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }

  return fallback;
}

async function main() {
  const sourceUrl = getArgValue("url", DEFAULT_SOURCE_URL);
  const outputDir = path.resolve(getArgValue("out", DEFAULT_STYLE_TRANSCRIPTS_DIR));
  const limit = Number.parseInt(getArgValue("limit", String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT;

  await mkdir(outputDir, { recursive: true });
  const indexHtml = await fetchText(sourceUrl);
  const episodeLinks = parseEpisodeLinks(indexHtml, sourceUrl).slice(0, Math.max(limit, 1));

  if (!episodeLinks.length) {
    throw new Error("No episode transcript links were found on the source page.");
  }

  const saved = [];
  for (const [index, episodeUrl] of episodeLinks.entries()) {
    const outputPath = await importEpisode(episodeUrl, outputDir, index);
    if (outputPath) {
      saved.push(outputPath);
    }
  }

  console.log(`Imported ${saved.length} transcript file(s) into ${outputDir}`);
  for (const filePath of saved) {
    console.log(filePath);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
