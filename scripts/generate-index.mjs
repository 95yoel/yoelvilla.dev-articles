import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, 'articles');
const OUTPUT = path.join(ROOT, 'index.json');
const LANGS = ['es', 'en'];

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, content: raw };

  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, content: raw };

  const fm = raw.slice(3, end).trim();
  const content = raw.slice(end + 4).trim();

  const meta = {};
  for (const line of fm.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(v => v.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }

    meta[key] = value;
  }

  return { meta, content };
}

function listMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.endsWith('.md'));
}

function makeSummary(content, max = 160) {
  const plain = content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`.*?`/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\((.*?)\)/g, '$1')
    .replace(/[#>*_-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length > max ? plain.slice(0, max).trim() + '…' : plain;
}

const bySlug = new Map();

for (const lang of LANGS) {
  const langDir = path.join(ARTICLES_DIR, lang);
  const files = listMarkdownFiles(langDir);

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const fullPath = path.join(langDir, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    const { meta, content } = parseFrontmatter(raw);

    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        slug,
        date: meta.date || null,
        languages: [],
        title: {},
        summary: {},
        coverImage: meta.coverImage || null,
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        published: meta.published !== false
      });
    }

    const item = bySlug.get(slug);
    if (!item.languages.includes(lang)) item.languages.push(lang);

    item.title[lang] = meta.title || slug;
    item.summary[lang] = meta.description || makeSummary(content);

    if (!item.date && meta.date) item.date = meta.date;
    if (!item.coverImage && meta.coverImage) item.coverImage = meta.coverImage;
    if ((!item.tags || item.tags.length === 0) && Array.isArray(meta.tags)) {
      item.tags = meta.tags;
    }
    if (meta.published === false) item.published = false;
  }
}

const articles = [...bySlug.values()]
  .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  articles
};

fs.writeFileSync(OUTPUT, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`Generated ${OUTPUT} with ${articles.length} articles.`);