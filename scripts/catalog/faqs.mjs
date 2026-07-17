// FAQ importer: the FAQ CSV (card name,question,answer) -> faqs.json entries
//   { id, question, answer, cards:[card_id], source:'curiosa.io' }.
//
// A blank `card name` inherits the previous row's card (another Q&A for the same
// card). The card name resolves to a card_id via the shared cardSlug (the same key
// the seed writes and FAQ links use). The id is deterministic - a content hash - so
// re-running the pipeline and unchanged entries keep stable ids (the compiled FAQ
// link data keys on them).
//
// Gates: every card name must resolve to a known card_id (checked post-merge, so a
// FAQ for one of the newly-added cards resolves); a duplicate id fails the run.
import { createHash } from 'node:crypto';
import { parseCsvWithHeader } from './csv.mjs';
import { cardSlug } from './slug.mjs';

export const FAQ_HEADER = ['card name', 'question', 'answer'];

export function faqId(cardName, question, answer) {
  return 'faq_' + createHash('sha256').update(`${cardName}\n${question}\n${answer}`).digest('hex').slice(0, 16);
}

/**
 * Compile the FAQ CSV.
 * @param csvText raw CSV
 * @param validCardIds Set<string> of card_ids present in the merged catalog
 * @returns { faqs, report }
 */
export function compileFaqs(csvText, validCardIds) {
  const { rows } = parseCsvWithHeader(csvText, FAQ_HEADER, 'FAQ CSV');
  const faqs = [];
  const byId = new Map();
  const unresolved = new Set();
  const issues = [];
  let currentCard = '';

  rows.forEach((row, i) => {
    const line = i + 2;
    const rawName = (row[0] ?? '').trim();
    const question = (row[1] ?? '').trim();
    const answer = (row[2] ?? '').trim();
    if (rawName) currentCard = rawName;
    if (!currentCard) { issues.push(`FAQ CSV line ${line}: Q&A with no preceding card name`); return; }
    if (!question && !answer) return; // nothing to record

    const cardId = cardSlug(currentCard);
    if (validCardIds && !validCardIds.has(cardId)) unresolved.add(currentCard);

    const id = faqId(currentCard, question, answer);
    if (byId.has(id)) {
      issues.push(`FAQ CSV line ${line}: duplicate id ${id} for ${JSON.stringify(currentCard)} (also matches an earlier identical Q&A)`);
      return;
    }
    const entry = { id, question, answer, cards: [cardId], source: 'curiosa.io' };
    byId.set(id, entry);
    faqs.push(entry);
  });

  if (unresolved.size) {
    issues.push(`FAQ CSV: ${unresolved.size} card name(s) do not resolve to a catalog card: ${[...unresolved].slice(0, 20).join(', ')}${unresolved.size > 20 ? ' …' : ''}`);
  }
  return { faqs, report: { faqs: faqs.length, unresolved: [...unresolved], issues } };
}
