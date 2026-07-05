// Universal search - one query across the unified store: catalogue (rules +
// cards) and the active profile's decks and duels. The unification payoff:
// possible only because all three domains share one store.
import { searchCodex, searchPersonal } from './codexRepository.js';
import { listDecks } from './deckRepository.js';
import { listMatches } from './playRepository.js';

export async function searchAll(q) {
  const query = q.trim();
  if (!query) return { articles: [], cards: [], cardText: [], articleText: [], decks: [], duels: [], marginalia: [] };
  const ql = query.toLowerCase();

  // Categorised codex hits: title/name matches first, then text mentions
  // (searchCodex also understands the t:/e:/set:/has:/is: syntax).
  const { articles, cards, cardText, articleText } = await searchCodex(query);
  const marginalia = await searchPersonal(query);

  const decks = (await listDecks())
    .filter((d) => d.name.toLowerCase().includes(ql) || (d.archetype || '').toLowerCase().includes(ql))
    .map((d) => ({ id: d.id, name: d.name, meta: `${d.archetype || 'Deck'} · ${d.record}`, glyph: '◆' }));

  const duels = (await listMatches(50))
    .filter((m) => (m.opponent_name || '').toLowerCase().includes(ql) || (m.mode || '').toLowerCase().includes(ql))
    .map((m) => ({
      id: m.id, name: m.opponent_name ? `vs. ${m.opponent_name}` : (m.mode === 'quick' ? 'Quick match' : 'Match'),
      meta: `${m.player_final_life}–${m.opponent_final_life}`, glyph: '⚔',
    }));

  return { articles, cards, cardText, articleText, decks, duels, marginalia };
}
