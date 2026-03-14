import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, 'articles');
const OUTPUT = path.join(ROOT, 'index.json');
const LANGS = ['es', 'en'];
const TAXONOMY_TYPES = ['domain', 'technology', 'topic', 'context'];
const TYPE_WEIGHTS = {
  domain: 1,
  technology: 2,
  topic: 3,
  context: 1
};
const EDGE_LABEL_PRIORITY = ['topic', 'technology', 'context', 'domain'];
const GRAPH_CONFIG = {
  scoreThreshold: 2,
  maxRelated: 6,
  bonuses: {
    sharedTechnology: 0.75,
    sharedTopic: 1.25,
    multipleSpecificTags: 1
  }
};

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

function normalizeCanonicalTerm(value) {
  return normalizeCanonicalSlug(value);
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

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}

function uniquePreservingOrder(values) {
  return [...new Set(values)];
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

function createEmptyTaxonomy() {
  return {
    domain: [],
    technology: [],
    topic: [],
    context: []
  };
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
    tags_es: [],
    tags_en: [],
    taxonomy: {
      es: createEmptyTaxonomy(),
      en: createEmptyTaxonomy()
    },
    taxonomyCanonical: createEmptyTaxonomy(),
    coverImage: null,
    published: true
  };
}

function readLocalizedTaxonomy(meta) {
  const taxonomy = createEmptyTaxonomy();

  for (const type of TAXONOMY_TYPES) {
    taxonomy[type] = normalizeStringList(meta[type]);
  }

  return taxonomy;
}

function flattenTaxonomy(taxonomy) {
  return uniquePreservingOrder(
    TAXONOMY_TYPES.flatMap(type => normalizeStringList(taxonomy[type]))
  );
}

function selectLegacyTags(meta, localizedTaxonomy) {
  const explicitTags = normalizeStringList(meta.tags);
  if (explicitTags.length > 0) {
    return explicitTags;
  }

  return flattenTaxonomy(localizedTaxonomy);
}

function buildCanonicalTaxonomy(article) {
  const canonical = createEmptyTaxonomy();

  for (const type of TAXONOMY_TYPES) {
    const preferredSource = article.taxonomy.en[type].length > 0
      ? article.taxonomy.en[type]
      : article.taxonomy.es[type];

    // Similarity must ignore UI language. We canonicalize from English when it
    // exists because ES/EN variants already share the same article slug; that
    // gives us one stable internal vocabulary for graph comparisons.
    canonical[type] = uniquePreservingOrder(
      preferredSource
        .map(normalizeCanonicalTerm)
        .filter(Boolean)
    );
  }

  return canonical;
}

function finalizeArticle(article) {
  const tagsEs = uniquePreservingOrder(article.tags_es);
  const tagsEn = uniquePreservingOrder(article.tags_en);
  const legacyTags = tagsEs.length > 0 ? tagsEs : tagsEn;

  return {
    ...article,
    languages: [...article.languages].sort(),
    tags: uniquePreservingOrder(legacyTags),
    tags_es: tagsEs,
    tags_en: tagsEn,
    taxonomy: {
      es: {
        domain: uniquePreservingOrder(article.taxonomy.es.domain),
        technology: uniquePreservingOrder(article.taxonomy.es.technology),
        topic: uniquePreservingOrder(article.taxonomy.es.topic),
        context: uniquePreservingOrder(article.taxonomy.es.context)
      },
      en: {
        domain: uniquePreservingOrder(article.taxonomy.en.domain),
        technology: uniquePreservingOrder(article.taxonomy.en.technology),
        topic: uniquePreservingOrder(article.taxonomy.en.topic),
        context: uniquePreservingOrder(article.taxonomy.en.context)
      }
    },
    taxonomyCanonical: buildCanonicalTaxonomy(article)
  };
}

function createFrequencyMaps(articles) {
  const maps = {
    domain: new Map(),
    technology: new Map(),
    topic: new Map(),
    context: new Map()
  };

  for (const article of articles) {
    for (const type of TAXONOMY_TYPES) {
      for (const tag of article.taxonomyCanonical[type]) {
        maps[type].set(tag, (maps[type].get(tag) || 0) + 1);
      }
    }
  }

  return maps;
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return left.filter(value => rightSet.has(value));
}

function computeRarityFactor(totalArticles, frequency) {
  // Frequent tags should contribute less without disappearing entirely.
  return 1 + Math.log((totalArticles + 1) / (frequency + 1));
}

function roundScore(value) {
  return Number(value.toFixed(4));
}

function pickEdgeLabel(candidates) {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((left, right) => {
    const leftPriority = EDGE_LABEL_PRIORITY.indexOf(left.type);
    const rightPriority = EDGE_LABEL_PRIORITY.indexOf(right.type);

    return (
      leftPriority - rightPriority ||
      right.rarityFactor - left.rarityFactor ||
      right.contribution - left.contribution ||
      left.tag.localeCompare(right.tag)
    );
  });

  // The edge label should explain the relationship with the most specific
  // shared concept first, then prefer the rarer one if specificity ties.
  return sorted[0].tag;
}

function pickDominantType(sharedByType, contributionsByType) {
  const availableTypes = TAXONOMY_TYPES.filter(type => sharedByType[type].length > 0);
  if (availableTypes.length === 0) return null;

  return [...availableTypes].sort((left, right) => {
    const scoreDelta = (contributionsByType[right] || 0) - (contributionsByType[left] || 0);
    if (scoreDelta !== 0) return scoreDelta;

    const leftPriority = EDGE_LABEL_PRIORITY.indexOf(left);
    const rightPriority = EDGE_LABEL_PRIORITY.indexOf(right);
    return leftPriority - rightPriority;
  })[0];
}

function computeEdgeCandidate(left, right, frequencyMaps, totalArticles) {
  const shared = createEmptyTaxonomy();
  const labelCandidates = [];
  const contributionsByType = {
    domain: 0,
    technology: 0,
    topic: 0,
    context: 0
  };

  let score = 0;

  for (const type of TAXONOMY_TYPES) {
    shared[type] = intersect(left.taxonomyCanonical[type], right.taxonomyCanonical[type]);

    for (const tag of shared[type]) {
      const frequency = frequencyMaps[type].get(tag) || 1;
      const rarityFactor = computeRarityFactor(totalArticles, frequency);
      const contribution = TYPE_WEIGHTS[type] * rarityFactor;

      contributionsByType[type] += contribution;
      score += contribution;
      labelCandidates.push({ tag, type, rarityFactor, contribution });
    }
  }

  const sharedSpecificCount = shared.technology.length + shared.topic.length;

  if (shared.technology.length > 0) {
    score += GRAPH_CONFIG.bonuses.sharedTechnology;
  }

  if (shared.topic.length > 0) {
    score += GRAPH_CONFIG.bonuses.sharedTopic;
  }

  if (sharedSpecificCount >= 2) {
    score += GRAPH_CONFIG.bonuses.multipleSpecificTags;
  }

  if (score < GRAPH_CONFIG.scoreThreshold) {
    return null;
  }

  return {
    source: left.slug,
    target: right.slug,
    score: roundScore(score),
    label: pickEdgeLabel(labelCandidates),
    shared,
    dominantType: pickDominantType(shared, contributionsByType)
  };
}

function selectEdges(candidates) {
  const degrees = new Map();
  const selected = [];

  const sortedCandidates = [...candidates].sort((left, right) => {
    return (
      right.score - left.score ||
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target)
    );
  });

  for (const edge of sortedCandidates) {
    const leftDegree = degrees.get(edge.source) || 0;
    const rightDegree = degrees.get(edge.target) || 0;

    if (leftDegree >= GRAPH_CONFIG.maxRelated || rightDegree >= GRAPH_CONFIG.maxRelated) {
      continue;
    }

    selected.push(edge);
    degrees.set(edge.source, leftDegree + 1);
    degrees.set(edge.target, rightDegree + 1);
  }

  return selected;
}

function buildGraph(articles) {
  const publishedArticles = articles.filter(article => article.published !== false);
  const nodes = publishedArticles.map(article => ({
    id: article.slug,
    slug: article.slug,
    date: article.date,
    published: article.published
  }));

  const frequencyMaps = createFrequencyMaps(publishedArticles);
  const candidates = [];

  for (let index = 0; index < publishedArticles.length; index += 1) {
    for (let cursor = index + 1; cursor < publishedArticles.length; cursor += 1) {
      const edge = computeEdgeCandidate(
        publishedArticles[index],
        publishedArticles[cursor],
        frequencyMaps,
        publishedArticles.length
      );

      if (edge) {
        candidates.push(edge);
      }
    }
  }

  const edges = selectEdges(candidates);
  const relatedBySlug = Object.fromEntries(
    publishedArticles.map(article => [article.slug, []])
  );

  for (const edge of edges) {
    const leftRelation = {
      target: edge.target,
      score: edge.score,
      label: edge.label,
      dominantType: edge.dominantType,
      shared: edge.shared
    };
    const rightRelation = {
      target: edge.source,
      score: edge.score,
      label: edge.label,
      dominantType: edge.dominantType,
      shared: edge.shared
    };

    relatedBySlug[edge.source].push(leftRelation);
    relatedBySlug[edge.target].push(rightRelation);
  }

  for (const slug of Object.keys(relatedBySlug)) {
    relatedBySlug[slug].sort((left, right) => {
      return right.score - left.score || left.target.localeCompare(right.target);
    });
  }

  return {
    thresholds: {
      minScore: GRAPH_CONFIG.scoreThreshold
    },
    typeWeights: TYPE_WEIGHTS,
    maxRelated: GRAPH_CONFIG.maxRelated,
    bonuses: GRAPH_CONFIG.bonuses,
    rarity: {
      formula: '1 + ln((publishedCount + 1) / (tagFrequency + 1))',
      scope: 'published articles only'
    },
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges,
    relatedBySlug
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
    const localizedTaxonomy = readLocalizedTaxonomy(meta);

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

    item.taxonomy[lang] = localizedTaxonomy;
    item[`tags_${lang}`] = selectLegacyTags(meta, localizedTaxonomy);

    if (!item.coverImage && meta.coverImage) {
      item.coverImage = meta.coverImage;
    }

    if (meta.published === false) {
      item.published = false;
    }
  }
}

const articles = [...byCanonicalSlug.values()]
  .map(finalizeArticle)
  .sort((left, right) => {
    const leftDate = left.date || '';
    const rightDate = right.date || '';
    return rightDate.localeCompare(leftDate) || left.slug.localeCompare(right.slug);
  });

const index = {
  version: 2,
  generatedAt: new Date().toISOString(),
  articles,
  graph: buildGraph(articles)
};

fs.writeFileSync(OUTPUT, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
console.log(`Generated ${OUTPUT} with ${articles.length} articles.`);
