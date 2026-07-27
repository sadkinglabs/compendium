package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.FrameSelector
import com.sadkinglabs.compendium.scanner.match.CardRef
import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.session.Candidate
import com.sadkinglabs.compendium.scanner.session.ScanConfig
import com.sadkinglabs.compendium.scanner.session.ScanEvent
import com.sadkinglabs.compendium.scanner.session.ScanState
import com.sadkinglabs.compendium.scanner.session.reduce

/** Metadata pinned into every report so ON/OFF policy runs are provably comparable. */
data class RunMeta(
    val policyMode: String,
    val matcherThreshold: Double,
    val matcherMargin: Double,
    val deviceBuild: String? = null,   // null = off-device (JVM) run
)

data class CaseOutcome(
    val caseId: String,
    val category: Category,
    val expected: Expected,
    val lockedId: String?,
    val lockLatencyMs: Long?,
)

/** Per-class precision/recall. NaN when there is no support / no locks of that class. */
data class ClassMetrics(val support: Int, val truePositives: Int, val locksResolvedHere: Int) {
    val recall: Double get() = if (support == 0) Double.NaN else truePositives.toDouble() / support
    val precision: Double get() = if (locksResolvedHere == 0) Double.NaN else truePositives.toDouble() / locksResolvedHere
}

/** A reproducible metrics report: identity + config metadata, then the metrics + their denominators. */
data class Report(
    val corpusVersion: String,
    val corpusDigest: String,
    val catalogDigest: String,
    val catalogSize: Int,
    val coverage: Set<Category>,
    val policyMode: String,
    val matcherThreshold: Double,
    val matcherMargin: Double,
    val reducerConfig: ScanConfig,
    val deviceBuild: String?,
    val total: Int,
    val correct: Int,
    val misses: Int,
    val falseLocks: Int,
    val negativeCount: Int,
    val negativeFalseLocks: Int,
    val perClass: Map<CardClass, ClassMetrics>,
    val latencyP50Ms: Long?,
    val latencyP95Ms: Long?,
    val outcomes: List<CaseOutcome>,
) {
    val negativeFalseLockRate: Double get() = if (negativeCount == 0) Double.NaN else negativeFalseLocks.toDouble() / negativeCount
}

/**
 * Replays a corpus through the REAL selection ([FrameSelector], shared with production) + the session
 * reducer (both pure), so the whole observation -> select -> confirm -> lock path is measured
 * off-device. On device the same harness runs with the live catalog over device-captured observations.
 */
object ReplayHarness {

    fun replay(case: CorpusCase, matcher: Matcher, cfg: ScanConfig = ScanConfig()): CaseOutcome {
        var state: ScanState = ScanState.Searching
        val t0 = case.frames.firstOrNull()?.atMs ?: 0L
        var lockedId: String? = null
        var lockLatency: Long? = null
        for (f in case.frames) {
            // QR precedes OCR: a compendium:// link is handled by the QR path, so no card candidate
            // is produced from this frame (mirrors production onLink-before-onResult).
            val cand: Candidate? = if (FrameSelector.isCompendiumLink(f.qr)) {
                null
            } else {
                FrameSelector.selectCard(f.strips, matcher)?.let {
                    Candidate(it.match.card.id, it.match.card.name, it.match.score, 0.0, it.source)
                }
            }
            state = reduce(state, ScanEvent.Observed(cand, f.atMs), cfg)
            val s = state
            if (lockedId == null && s is ScanState.Result) { lockedId = s.snapshot.cardId; lockLatency = f.atMs - t0 }
        }
        return CaseOutcome(case.id, case.category, case.expected, lockedId, lockLatency)
    }

    /**
     * Fail-closed: validates the corpus, and refuses to score if a predicted lock resolves to a card
     * outside [catalog] (unknown predicted class). Records full run metadata for comparability.
     */
    fun report(corpus: Corpus, matcher: Matcher, catalog: List<CardRef>, meta: RunMeta, cfg: ScanConfig = ScanConfig()): Report {
        val ids = catalog.mapTo(HashSet()) { it.id }
        CorpusValidator.validate(corpus, ids)
        val classOf: Map<String, CardClass> = catalog.associate { it.id to if (it.isSite) CardClass.SITE else CardClass.SPELL }
        fun classOfOrFail(id: String): CardClass =
            classOf[id] ?: error("run aborted: locked/expected card '$id' is not in the catalog (unknown class)")

        val outcomes = corpus.cases.map { replay(it, matcher, cfg) }
        var correct = 0; var misses = 0; var falseLocks = 0
        var negativeCount = 0; var negativeFalseLocks = 0
        val support = HashMap<CardClass, Int>(); val tp = HashMap<CardClass, Int>(); val resolvedHere = HashMap<CardClass, Int>()
        val latencies = ArrayList<Long>()

        for (o in outcomes) {
            o.lockedId?.let { resolvedHere.merge(classOfOrFail(it), 1, Int::plus) }
            when (val e = o.expected) {
                is Expected.Identity -> {
                    support.merge(classOfOrFail(e.cardId), 1, Int::plus)
                    when (o.lockedId) {
                        e.cardId -> { correct++; tp.merge(classOfOrFail(e.cardId), 1, Int::plus); o.lockLatencyMs?.let { latencies.add(it) } }
                        null -> misses++
                        else -> falseLocks++
                    }
                }
                Expected.NoLock -> {
                    negativeCount++
                    if (o.lockedId != null) { falseLocks++; negativeFalseLocks++ } else correct++
                }
            }
        }
        latencies.sort()
        return Report(
            corpusVersion = corpus.version,
            corpusDigest = CorpusValidator.corpusDigest(corpus),
            catalogDigest = CorpusValidator.catalogDigest(catalog),
            catalogSize = catalog.size,
            coverage = CorpusValidator.coverage(corpus),
            policyMode = meta.policyMode,
            matcherThreshold = meta.matcherThreshold,
            matcherMargin = meta.matcherMargin,
            reducerConfig = cfg,
            deviceBuild = meta.deviceBuild,
            total = outcomes.size, correct = correct, misses = misses, falseLocks = falseLocks,
            negativeCount = negativeCount, negativeFalseLocks = negativeFalseLocks,
            perClass = CardClass.entries.associateWith { ClassMetrics(support[it] ?: 0, tp[it] ?: 0, resolvedHere[it] ?: 0) },
            latencyP50Ms = percentile(latencies, 0.50), latencyP95Ms = percentile(latencies, 0.95),
            outcomes = outcomes,
        )
    }

    private fun percentile(sorted: List<Long>, p: Double): Long? {
        if (sorted.isEmpty()) return null
        val idx = Math.ceil(p * sorted.size).toInt().coerceIn(1, sorted.size) - 1
        return sorted[idx]
    }
}
