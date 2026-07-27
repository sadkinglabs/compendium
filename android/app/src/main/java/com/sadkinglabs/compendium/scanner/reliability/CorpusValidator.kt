package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.match.CardRef
import java.security.MessageDigest

/**
 * Fail-closed validation + content digests for a frozen corpus, so metric runs are reproducible and
 * comparable (proposal §8, Codex review). A run must refuse to produce metrics from a malformed or
 * drifted corpus rather than silently reporting wrong numbers.
 */
object CorpusValidator {

    /** All structural problems (empty = valid). */
    fun errors(corpus: Corpus, validCardIds: Set<String>): List<String> {
        val errs = ArrayList<String>()
        if (corpus.version.isBlank()) errs.add("corpus version is blank")
        val seen = HashSet<String>()
        for (c in corpus.cases) {
            if (!seen.add(c.id)) errs.add("duplicate case id '${c.id}'")
            if (c.frames.isEmpty()) errs.add("case '${c.id}' has no frames")
            var last = Long.MIN_VALUE
            for (f in c.frames) {
                if (f.atMs < last) errs.add("case '${c.id}' has non-monotonic timestamps at ${f.atMs}")
                last = f.atMs
            }
            val e = c.expected
            if (e is Expected.Identity && e.cardId !in validCardIds) {
                errs.add("case '${c.id}' expects unknown card id '${e.cardId}'")
            }
        }
        return errs
    }

    /** Throws if the corpus is malformed (fail-closed). */
    fun validate(corpus: Corpus, validCardIds: Set<String>) {
        val errs = errors(corpus, validCardIds)
        check(errs.isEmpty()) { "corpus '${corpus.version}' invalid:\n- " + errs.joinToString("\n- ") }
    }

    /** Which categories the corpus covers (for the report; visible coverage). */
    fun coverage(corpus: Corpus): Set<Category> = corpus.cases.mapTo(HashSet()) { it.category }

    /** A stable content digest: any change to cases/frames/expected changes it, so drift without a
     *  version bump is detectable. */
    fun corpusDigest(corpus: Corpus): String {
        val sb = StringBuilder(corpus.version).append('\n')
        for (c in corpus.cases) {
            sb.append(c.id).append('|').append(c.category).append('|')
            when (val e = c.expected) {
                is Expected.Identity -> sb.append("I:").append(e.cardId)
                Expected.NoLock -> sb.append("N")
            }
            sb.append('\n')
            for (f in c.frames) {
                sb.append("  @").append(f.atMs).append(" qr=").append(f.qr ?: "")
                for (s in f.strips) sb.append(" [").append(s.source).append(':').append(s.text).append(']')
                sb.append('\n')
            }
        }
        return sha256(sb.toString())
    }

    /** A digest of the catalog identity (id + name + orientation), so ON/OFF runs prove same catalog. */
    fun catalogDigest(catalog: List<CardRef>): String =
        sha256(catalog.map { "${it.id}|${it.name}|${it.isSite}" }.sorted().joinToString("\n"))

    private fun sha256(s: String): String =
        MessageDigest.getInstance("SHA-256").digest(s.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}
