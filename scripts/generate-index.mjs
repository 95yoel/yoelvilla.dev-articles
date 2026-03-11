import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, 'articles');
const OUTPUT = path.join(ROOT, 'index.json');
const LANGS = ['es', 'en'];

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) {
    return { meta: {}, content: raw };
  }

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { meta: {}, content: raw };
  }

  const fm = match[1];
  const content = raw.slice(match[0].length);
  const meta = {};

  for (const line of fm.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;

    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(item => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }

    meta[key] = value;
  }

  return { meta, content };
}

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name);
}

function normalizeCanonicalSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stripMarkdownForSummary(content) {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTitleFromContent(content, fallback) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const title = line.replace(/^#{1,6}\s*/, '').trim();
    if (title) return title;
  }

  return fallback;
}

function makeSummary(content, title, fallback, max = 160) {
  const lines = content.split(/\r?\n/);
  let skippedTitle = false;
  const bodyLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!skippedTitle) {
      const normalizedLine = line.replace(/^#{1,6}\s*/, '').trim();
      if (normalizedLine && normalizedLine === title) {
        skippedTitle = true;
        continue;
      }

      skippedTitle = true;
    }

    bodyLines.push(rawLine);
  }

  const plain = stripMarkdownForSummary(bodyLines.join('\n')) || fallback;
  return plain.length > max ? `${plain.slice(0, max).trim()}...` : plain;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return tags
    .map(tag => String(tag).trim())
    .filter(Boolean);
}

function parseDateValue(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function getFileDate(fullPath) {
  try {
    const stats = fs.statSync(fullPath);
    const candidates = [stats.birthtime, stats.mtime, stats.ctime];

    for (const candidate of candidates) {
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate.toISOString();
      }
    }
  } catch {
    return null;
  }

  return null;
}

function createEmptyArticle(slug) {
  return {
    slug,
    sourceSlug: {},
    languages: [],
    title: {},
    summary: {},
    date: null,
    tags: [],
    coverImage: null,
    published: true
  };
}

const byCanonicalSlug = new Map();
const sourceSlugOwners = new Map();

for (const lang of LANGS) {
  const langDir = path.join(ARTICLES_DIR, lang);
  const files = listMarkdownFiles(langDir);

  for (const file of files) {
    const sourceSlug = file.replace(/\.md$/i, '');
    const fullPath = path.join(langDir, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const { meta, content } = parseFrontmatter(raw);

    const slugBase = String(meta.slug || sourceSlug).trim();
    const canonicalSlug = normalizeCanonicalSlug(slugBase) || normalizeCanonicalSlug(sourceSlug);

    if (!canonicalSlug) {
      console.warn(`[generate-index] Skipping "${lang}/${file}" because no canonical slug could be derived.`);
      continue;
    }

    const ownerKey = `${lang}:${canonicalSlug}`;
    const previousOwner = sourceSlugOwners.get(ownerKey);
    if (previousOwner && previousOwner !== sourceSlug) {
      console.warn(
        `[generate-index] Slug collision for "${canonicalSlug}" in "${lang}": "${previousOwner}" and "${sourceSlug}".`
      );
    } else {
      sourceSlugOwners.set(ownerKey, sourceSlug);
    }

    if (!byCanonicalSlug.has(canonicalSlug)) {
      byCanonicalSlug.set(canonicalSlug, createEmptyArticle(canonicalSlug));
    }

    const item = byCanonicalSlug.get(canonicalSlug);
    if (!item.languages.includes(lang)) {
      item.languages.push(lang);
    }

    item.sourceSlug[lang] = sourceSlug;

    const title = getTitleFromContent(content, canonicalSlug);
    item.title[lang] = title;
    item.summary[lang] = meta.summary || meta.description || makeSummary(content, title, canonicalSlug);

    const resolvedDate = parseDateValue(meta.date) || getFileDate(fullPath);
    if (resolvedDate && (!item.date || resolvedDate > item.date)) {
      item.date = resolvedDate;
    }

    const tags = normalizeTags(meta.tags);
    if (tags.length > 0 && item.tags.length === 0) {
      item.tags = tags;
    }

    if (!item.coverImage && meta.coverImage) {
      item.coverImage = meta.coverImage;
    }

    if (meta.published === false) {
      item.published = false;
    }
  }
}

const articles = [...byCanonicalSlug.values()]
  .map(article => ({
    ...article,
    languages: [...article.languages].sort()
  }))
  .sort((a, b) => {
    const left = a.date || '';
    const right = b.date || '';
    return right.localeCompare(left) || a.slug.localeCompare(b.slug);
  });

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  articles
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`Generated ${OUTPUT} with ${articles.length} articles.`);
