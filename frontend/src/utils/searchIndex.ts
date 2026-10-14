/**
 * Offline search over a downloaded index.
 *
 * This is the same algorithm as the API's search (backend/documents/search.py),
 * so a pilot gets the same results, in the same order, with or without a
 * connection. The rules are documented there; change both together. The
 * shared fixture in searchIndex.test.ts and backend/documents/test_search.py
 * checks that they agree.
 */
import type {
  SearchContentType,
  SearchFilters,
  SearchIndexDocument,
  SearchResponse,
  SearchResult,
  SearchableDocument,
} from "../types/api";

const WORD = /[\p{L}\p{N}]+/gu;

/** Block types each content filter keeps. The sample data has no warnings, so cautions count. */
export const CONTENT_TYPES: Record<SearchContentType, string[]> = {
  warnings: ["warning", "caution"],
  procedures: ["checklist"],
};

export function words(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

/** Words joined by single spaces, with a space at each end. */
export function wordKey(text: string): string {
  return ` ${words(text).join(" ")} `;
}

/** A query word matches a word it starts; a one-character query word only itself. */
export function wordMatches(word: string, term: string): boolean {
  const lower = word.toLowerCase();
  return lower === term || (term.length > 1 && lower.startsWith(term));
}

export function appliesToAll(applicability: string): boolean {
  return applicability.trim().toUpperCase() === "ALL";
}

export interface Entry {
  docId: string;
  revision: number;
  topicId: string;
  nodeId: string;
  nodeType: string;
  number: string;
  title: string;
  sectionNumber: string;
  sectionTitle: string;
  text: string;
  titleKey: string;
  textKey: string;
}

export interface PreparedDocument {
  summary: SearchableDocument;
  entries: Entry[];
}

/** Expand a downloaded document into searchable entries, in document order. */
export function prepareDocument(document: SearchIndexDocument): PreparedDocument {
  const { topics, ...summary } = document;
  const entries: Entry[] = [];
  for (const topic of topics) {
    const common = {
      docId: summary.docId,
      revision: summary.revision,
      topicId: topic.id,
      number: topic.number,
      title: topic.title,
      sectionNumber: topic.sectionNumber,
      sectionTitle: topic.sectionTitle,
      titleKey: wordKey(`${topic.number} ${topic.title}`),
    };
    entries.push({ ...common, nodeId: topic.id, nodeType: "topic", text: "", textKey: " " });
    for (const [nodeId, nodeType, text] of topic.blocks) {
      entries.push({ ...common, nodeId, nodeType, text, textKey: wordKey(text) });
    }
  }
  return { summary, entries };
}

/** [match, whole-word match] keys; one-character words match whole words only. */
function termKeys(term: string): [string, string] {
  const whole = ` ${term} `;
  return [term.length > 1 ? ` ${term}` : whole, whole];
}

export function textMatchesAll(terms: string[], entry: Entry): boolean {
  return terms.every((term) => entry.textKey.includes(termKeys(term)[0]));
}

export function scoreEntry(terms: string[], entry: Entry): number | undefined {
  let score = 0;
  for (const term of terms) {
    const [prefix, whole] = termKeys(term);
    const inTitle = entry.titleKey.includes(prefix);
    const inText = entry.textKey.includes(prefix);
    if (!inTitle && !inText) return undefined;
    score += (inTitle ? 3 : 0) + (inText ? 1 : 0);
    if (entry.titleKey.includes(whole) || entry.textKey.includes(whole)) score += 1;
  }
  if (terms.length > 1) {
    const phrase = ` ${terms.join(" ")} `;
    if (entry.titleKey.includes(phrase) || entry.textKey.includes(phrase)) score += 5;
  }
  return score;
}

/** Start and end of the sentence or line around ``position``. */
function sentenceBounds(text: string, position: number): [number, number] {
  const stop = text.lastIndexOf(". ", position - 1);
  const line = text.lastIndexOf("\n", position - 1);
  const start = stop >= 0 ? Math.max(stop + 2, line + 1) : line + 1;
  const ends: number[] = [];
  const nextStop = text.indexOf(". ", position);
  if (nextStop >= 0) ends.push(nextStop + 1);
  const nextLine = text.indexOf("\n", position);
  if (nextLine >= 0) ends.push(nextLine);
  return [start, ends.length ? Math.min(...ends) : text.length];
}

/**
 * The sentence holding the first matching word, or a window around it when
 * that sentence (or list item, or table row) is longer than ``sentenceLimit``.
 */
export function snippet(
  text: string,
  terms: string[],
  sentenceLimit = 220,
  before = 70,
  after = 160,
): string {
  if (!text) return "";
  let first: number | undefined;
  for (const match of text.matchAll(WORD)) {
    if (terms.some((term) => wordMatches(match[0], term))) {
      first = match.index;
      break;
    }
  }
  first ??= 0;
  const [sentenceStart, sentenceEnd] = sentenceBounds(text, first);
  if (sentenceEnd - sentenceStart <= sentenceLimit) {
    return text.slice(sentenceStart, sentenceEnd).split(/\s+/).filter(Boolean).join(" ");
  }

  let start = Math.max(0, first - before);
  let end = Math.min(text.length, first + after);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space >= 0 && space < first) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end - 1);
    if (space > first) end = space;
  }
  const excerpt = text.slice(start, end).split(/\s+/).filter(Boolean).join(" ");
  return `${start > 0 ? "… " : ""}${excerpt}${end < text.length ? " …" : ""}`;
}

export function searchLocal(
  query: string,
  documents: PreparedDocument[],
  filters: SearchFilters = {},
  limit = 50,
): Omit<SearchResponse, "documents"> {
  const terms = [...new Set(words(query))];
  const blockTypes = filters.contentTypes?.length
    ? new Set(filters.contentTypes.flatMap((name) => CONTENT_TYPES[name]))
    : undefined;
  const included = (document: SearchableDocument) => {
    if (filters.docTypes?.length && !filters.docTypes.includes(document.docType)) return false;
    if (filters.categories?.length && !filters.categories.includes(document.category)) return false;
    // A fleet filter keeps that fleet's documents and those for all fleets.
    if (filters.fleet && !appliesToAll(document.applicability) && document.applicability !== filters.fleet) {
      return false;
    }
    return true;
  };

  const best = new Map<string, { score: number; order: number; entry: Entry; document: SearchableDocument }>();
  const counts = new Map<string, number>();
  const firstText = new Map<string, string>();
  let order = 0;
  for (const document of documents) {
    if (!included(document.summary)) continue;
    for (const entry of document.entries) {
      order += 1;
      const key = `${entry.docId}\u0000${entry.topicId}`;
      if (entry.nodeType !== "topic" && !firstText.has(key)) firstText.set(key, entry.text);
      if (blockTypes && (!blockTypes.has(entry.nodeType) || !textMatchesAll(terms, entry))) continue;
      const score = scoreEntry(terms, entry);
      if (score === undefined) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const current = best.get(key);
      if (!current || score > current.score) {
        best.set(key, { score, order, entry, document: document.summary });
      }
    }
  }

  const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.order - b.order);
  const byDocument: Record<string, number> = {};
  for (const { entry } of ranked) byDocument[entry.docId] = (byDocument[entry.docId] ?? 0) + 1;
  const results: SearchResult[] = ranked.slice(0, limit).map(({ score, entry, document }) => ({
    docId: entry.docId,
    docTitle: document.title,
    docType: document.docType,
    revision: entry.revision,
    topicId: entry.topicId,
    nodeId: entry.nodeId,
    nodeType: entry.nodeType,
    number: entry.number,
    title: entry.title,
    section: { number: entry.sectionNumber, title: entry.sectionTitle },
    snippet: snippet(entry.text || (firstText.get(`${entry.docId}\u0000${entry.topicId}`) ?? ""), terms),
    score,
    matchCount: counts.get(`${entry.docId}\u0000${entry.topicId}`) ?? 0,
  }));
  return { query, terms, total: ranked.length, byDocument, results };
}
