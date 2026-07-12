package com.sorcerycompendium.compendium.scanner.match

import com.sorcerycompendium.compendium.scanner.model.SetRef
import java.text.Normalizer
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** A catalog card as supplied by JS. `id` is opaque - never numeric-coerce it.
 *  `sets` is the printings the card exists in, for the collection-mode set picker. */
data class CardRef(val id: String, val name: String, val isSite: Boolean, val sets: List<SetRef> = emptyList())

/** A catalog card pre-normalized for scoring. */
data class IndexedCard(val ref: CardRef, val norm: String, val tokens: String)

/** The outcome of a match attempt. */
data class MatchResult(val card: CardRef, val score: Double)

/**
 * Text normalization: the SAME rules applied to the OCR text AND the catalog names
 * so they compare on equal footing. NFD-strip diacritics, lowercase, punctuation to
 * spaces, collapse whitespace, and drop stray 1-2 digit tokens (mana / threshold
 * pips the OCR grabs). "Firebal" -> "firebal"; "Drgon Mage" -> "drgon mage".
 */
object Norm {
    private val diacritics = Regex("\\p{Mn}+")
    private val punct = Regex("[^a-z0-9 ]")
    private val ws = Regex("\\s+")
    private val digitsOnly = Regex("^[0-9]{1,2}$")

    fun normalize(raw: String): String {
        val decomposed = Normalizer.normalize(raw, Normalizer.Form.NFD).replace(diacritics, "")
        val cleaned = punct.replace(decomposed.lowercase(Locale.ROOT), " ")
        return ws.split(cleaned)
            .filter { it.isNotBlank() && !digitsOnly.matches(it) }
            .joinToString(" ")
            .trim()
    }

    /** Token-sorted form, so word-order and split errors ("drgon mage") still align. */
    fun tokenSort(norm: String): String =
        norm.split(' ').filter { it.isNotBlank() }.sorted().joinToString(" ")
}

/** Fuzzy string similarity via space-optimized Levenshtein. */
object Fuzzy {
    fun distance(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            val ac = a[i - 1]
            for (j in 1..b.length) {
                val cost = if (ac == b[j - 1]) 0 else 1
                cur[j] = min(min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }

    /** Similarity in [0,1]: 1 - distance / maxLen. */
    fun ratio(a: String, b: String): Double {
        val m = max(a.length, b.length)
        if (m == 0) return 1.0
        return 1.0 - distance(a, b).toDouble() / m
    }
}

/**
 * The normalized catalog, split into portrait (standard) and landscape (site)
 * pools. Reprints that share a normalized name within a pool are de-duped so
 * identical names can never deadlock the matcher's ambiguity margin.
 */
class CardIndex(cards: List<CardRef>) {
    val portrait: List<IndexedCard>
    val landscape: List<IndexedCard>

    init {
        val seen = HashSet<String>(cards.size * 2)
        val p = ArrayList<IndexedCard>()
        val l = ArrayList<IndexedCard>()
        for (c in cards) {
            val norm = Norm.normalize(c.name)
            if (norm.isEmpty()) continue
            val key = (if (c.isSite) "S|" else "P|") + norm
            if (!seen.add(key)) continue
            val idx = IndexedCard(c, norm, Norm.tokenSort(norm))
            if (c.isSite) l.add(idx) else p.add(idx)
        }
        portrait = p
        landscape = l
    }
}

/**
 * Fuzzy-matches a normalized OCR string against the catalog. Primes the pool for
 * the detected orientation but ranks across both, so a mis-detected orientation
 * still resolves. Accepts only a clear winner (>= [threshold] AND >= [margin]
 * ahead of the runner-up) to suppress Flame/Flare-style guessing.
 */
class Matcher(
    private val index: CardIndex,
    private val threshold: Double = 0.80,
    private val margin: Double = 0.05,
) {
    /**
     * Match the OCR text against the catalog. Tries the WHOLE string plus leading token
     * prefixes: a standard card's OCR IS the name (whole wins), while a site's strip is
     * "Name + rules text", so the name is a leading prefix. Whole is tried first, so it
     * wins ties - standard cards prefer their full name; sites fall back to the prefix.
     */
    fun match(ocrNorm: String, siteDetected: Boolean): MatchResult? {
        if (ocrNorm.length < 3) return null
        val queries = LinkedHashSet<String>()
        queries.add(ocrNorm)   // a standard card's top-banner OCR IS the name - match whole
        if (siteDetected) {
            // Sites ONLY: the name is embedded mid-strip between the artist credit and the
            // rules text, so slide 1..4-token windows to find it anywhere. Restricting this
            // to sites keeps a standard card's OCR noise from letting a shorter card name win.
            val tokens = ocrNorm.split(' ').filter { it.isNotBlank() }.take(16)
            for (len in minOf(4, tokens.size) downTo 1) {
                for (start in 0..(tokens.size - len)) {
                    queries.add(tokens.subList(start, start + len).joinToString(" "))
                }
            }
        }
        var best: MatchResult? = null
        var bestScore = -1.0
        for (q in queries) {
            if (q.length < 3) continue
            val r = matchOne(q, siteDetected) ?: continue
            if (r.score > bestScore) { best = r; bestScore = r.score }
        }
        return best
    }

    private fun matchOne(ocrNorm: String, siteDetected: Boolean): MatchResult? {
        val primary = if (siteDetected) index.landscape else index.portrait
        val secondary = if (siteDetected) index.portrait else index.landscape
        val ocrTokens = Norm.tokenSort(ocrNorm)

        var best: MatchResult? = null
        var bestScore = -1.0
        var secondScore = -1.0
        for (c in primary) scoreInto(ocrNorm, ocrTokens, c) { r ->
            if (r > bestScore) { secondScore = bestScore; bestScore = r; best = MatchResult(c.ref, r) }
            else if (r > secondScore) secondScore = r
        }
        for (c in secondary) scoreInto(ocrNorm, ocrTokens, c) { r ->
            if (r > bestScore) { secondScore = bestScore; bestScore = r; best = MatchResult(c.ref, r) }
            else if (r > secondScore) secondScore = r
        }

        val top = best ?: return null
        if (top.score < threshold) return null
        // ambiguity guard - unless the winner is essentially exact
        if (top.score < 0.999 && top.score - secondScore < margin) return null
        return top
    }

    private inline fun scoreInto(ocrNorm: String, ocrTokens: String, c: IndexedCard, sink: (Double) -> Unit) {
        // length-band prefilter: skip wildly mismatched lengths (cheap cutoff)
        if (abs(c.norm.length - ocrNorm.length) > c.norm.length / 2 + 4) return
        val r = max(Fuzzy.ratio(ocrNorm, c.norm), Fuzzy.ratio(ocrTokens, c.tokens))
        sink(r)
    }
}
