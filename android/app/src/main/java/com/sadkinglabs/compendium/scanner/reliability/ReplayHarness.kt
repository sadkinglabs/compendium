package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.match.Norm
import com.sadkinglabs.compendium.scanner.session.Candidate
import com.sadkinglabs.compendium.scanner.session.ScanConfig
import com.sadkinglabs.compendium.scanner.session.ScanEvent
import com.sadkinglabs.compendium.scanner.session.ScanState
import com.sadkinglabs.compendium.scanner.session.Source
import com.sadkinglabs.compendium.scanner.session.reduce

/** What a single case did: whether/what it locked, and how long the lock took. */
data class CaseOutcome(
    val caseId: String,
    val category: Category,
    val expected: Expected,
    val lockedId: String?,
    val lockLatencyMs: Long?,
)

/** Per-class precision/recall over the corpus. NaN when there is no support / no locks of that class. */
data class ClassMetrics(val support: Int, val truePositives: Int, val locksResolvedHere: Int) {
    val recall: Double get() = if (support == 0) Double.NaN else truePositives.toDouble() / support
    val precision: Double get() = if (locksResolvedHere == 0) Double.NaN else truePositives.toDouble() / locksResolvedHere
}

/** The metrics Codex requires: per-class precision/recall, false-lock rate on negatives, latency p50/p95. */
data class Report(
    val version: String,
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
 * Replays a reading-level corpus through the REAL matcher + the session reducer (both pure), so the
 * whole text -> match -> confirm -> lock path is measured off-device. On device the same harness runs
 * with the live catalog over device-captured readings; only the capturing differs.
 */
object ReplayHarness {

    fun replay(case: CorpusCase, matcher: Matcher, cfg: ScanConfig = ScanConfig()): CaseOutcome {
        var state: ScanState = ScanState.Searching
        val t0 = case.frames.firstOrNull()?.atMs ?: 0L
        var lockedId: String? = null
        var lockedLatency: Long? = null
        for (f in case.frames) {
            val cand: Candidate? = f.reading?.let { r ->
                matcher.match(Norm.normalize(r.text), r.siteDetected)?.let { m ->
                    Candidate(m.card.id, m.card.name, m.score, 0.0, if (r.siteDetected) Source.RIGHT_90 else Source.TOP)
                }
            }
            state = reduce(state, ScanEvent.Observed(cand, f.atMs), cfg)
            val s = state
            if (lockedId == null && s is ScanState.Result) {
                lockedId = s.snapshot.cardId
                lockedLatency = f.atMs - t0
            }
        }
        return CaseOutcome(case.id, case.category, case.expected, lockedId, lockedLatency)
    }

    fun report(
        corpus: Corpus,
        matcher: Matcher,
        classOf: (String) -> CardClass?,
        cfg: ScanConfig = ScanConfig(),
    ): Report {
        val outcomes = corpus.cases.map { replay(it, matcher, cfg) }
        var correct = 0; var misses = 0; var falseLocks = 0
        var negativeCount = 0; var negativeFalseLocks = 0
        val support = HashMap<CardClass, Int>()
        val tp = HashMap<CardClass, Int>()
        val resolvedHere = HashMap<CardClass, Int>()
        val latencies = ArrayList<Long>()

        fun bumpResolved(id: String?) { id?.let { cid -> classOf(cid)?.let { resolvedHere.merge(it, 1, Int::plus) } } }

        for (o in outcomes) when (val e = o.expected) {
            is Expected.Identity -> {
                classOf(e.cardId)?.let { support.merge(it, 1, Int::plus) }
                when (o.lockedId) {
                    e.cardId -> { correct++; classOf(e.cardId)?.let { tp.merge(it, 1, Int::plus) }; o.lockLatencyMs?.let { latencies.add(it) } }
                    null -> misses++
                    else -> falseLocks++
                }
                bumpResolved(o.lockedId)
            }
            Expected.NoLock -> {
                negativeCount++
                if (o.lockedId != null) { falseLocks++; negativeFalseLocks++; bumpResolved(o.lockedId) } else correct++
            }
        }

        val perClass = CardClass.entries.associateWith {
            ClassMetrics(support[it] ?: 0, tp[it] ?: 0, resolvedHere[it] ?: 0)
        }
        latencies.sort()
        return Report(
            version = corpus.version, total = outcomes.size, correct = correct, misses = misses,
            falseLocks = falseLocks, negativeCount = negativeCount, negativeFalseLocks = negativeFalseLocks,
            perClass = perClass, latencyP50Ms = percentile(latencies, 0.50), latencyP95Ms = percentile(latencies, 0.95),
            outcomes = outcomes,
        )
    }

    /** Nearest-rank percentile over an already-sorted list; null if empty. */
    private fun percentile(sorted: List<Long>, p: Double): Long? {
        if (sorted.isEmpty()) return null
        val idx = Math.ceil(p * sorted.size).toInt().coerceIn(1, sorted.size) - 1
        return sorted[idx]
    }
}
