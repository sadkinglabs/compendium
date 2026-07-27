package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.NameLevelPolicy
import com.sadkinglabs.compendium.scanner.match.CardRef
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Step-3 baseline: replays the real device capture (`device-capture-v1.corpus`) against the FULL
 * 1,109-card catalog (`full-catalog.tsv`, id = name) under the current name-level policy, and writes
 * the report to `build/scanner-baseline.txt`. This is the evidence that gates the Step-4 hard-
 * exclusion decision. Not an assertion of quality - a measurement (it only asserts it ran).
 */
class FullCatalogBaselineTest {

    // Read committed test data by module-relative path (unit-test working dir is android/app).
    private fun res(name: String): String {
        val f = File("src/test/resources/scanner/$name")
        check(f.exists()) { "missing test resource ${f.absolutePath}" }
        return f.readText()
    }

    private fun catalog(): List<CardRef> =
        res("full-catalog.tsv").lineSequence().filter { it.isNotBlank() }.map { line ->
            val t = line.split('\t'); CardRef(id = t[0], name = t[0], isSite = t.getOrNull(1) == "1")
        }.toList()

    @Test fun baseline_device_capture_full_catalog() = runBaseline("device-capture-v1.corpus", minCorrect = 13)

    /** v2 (2026-07-27, overlay session): 11 sites + Ghoul + Drowned - the pip fix's end-to-end
     *  proof, since Ghoul/Drowned/Beacon/Gothic Tower all failed before it and are here. */
    @Test fun baseline_device_capture_v2() = runBaseline("device-capture-v2.corpus", minCorrect = 12)

    // Fail-closed floors (Codex follow-up): asserting the CURRENT measured outcome so a later
    // regression cannot leave a green test. Raise these only alongside fresh evidence.
    private fun runBaseline(corpusFile: String, minCorrect: Int) {
        val catalog = catalog()
        val corpus = CorpusIO.decode(res(corpusFile))
        val report = ReplayHarness.report(corpus, RunSpec(catalog, NameLevelPolicy))

        fun cm(c: CardClass) = report.perClass[c]!!
        val sb = StringBuilder()
        sb.appendLine("=== SCANNER BASELINE ${report.corpusVersion} ===")
        sb.appendLine("catalog=${report.catalogSize} (digest ${report.catalogDigest.take(12)}) policy=${report.policyMode}")
        sb.appendLine("cases=${report.total}  correct=${report.correct}  misses=${report.misses}  falseLocks=${report.falseLocks}")
        sb.appendLine("SITE : support=${cm(CardClass.SITE).support} recall=${"%.2f".format(cm(CardClass.SITE).recall)} precision=${"%.2f".format(cm(CardClass.SITE).precision)}")
        sb.appendLine("SPELL: support=${cm(CardClass.SPELL).support} recall=${"%.2f".format(cm(CardClass.SPELL).recall)} precision=${"%.2f".format(cm(CardClass.SPELL).precision)}")
        sb.appendLine("lock latency: p50=${report.latencyP50Ms}ms p95=${report.latencyP95Ms}ms")
        sb.appendLine("--- per case (expected -> locked) ---")
        report.outcomes.forEach { o ->
            val exp = (o.expected as? Expected.Identity)?.cardId ?: "NoLock"
            val verdict = when { o.lockedId == exp -> "OK  "; o.lockedId == null -> "MISS"; else -> "WRONG" }
            sb.appendLine("  [$verdict] ${exp.padEnd(20)} -> ${o.lockedId ?: "-"}${o.lockLatencyMs?.let { " (${it}ms)" } ?: ""}")
        }
        val out = sb.toString()
        println(out)
        val stem = corpusFile.removeSuffix(".corpus")
        File("build/scanner-baseline-$stem.txt").apply { parentFile?.mkdirs() }.writeText(out)
        assertTrue("every case must run", report.total == corpus.cases.size)
        assertTrue("fail-closed: no false locks (got ${report.falseLocks})", report.falseLocks == 0)
        assertTrue("fail-closed: correct ${report.correct} < floor $minCorrect", report.correct >= minCorrect)
        assertTrue("fail-closed: SPELL recall regressed (${cm(CardClass.SPELL).recall})", cm(CardClass.SPELL).recall >= 1.0)
    }
}
