package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.model.Source
import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate

/**
 * The on-disk format for a frozen corpus: a deterministic, line-based text encoding that round-trips
 * losslessly, so device captures can be written, pulled (adb), reviewed as text, and re-loaded by the
 * [ReplayHarness]. Free-text (OCR strings, QR urls) is percent-escaped for the delimiters (`%`, `\t`,
 * `\n`, `:`) so the `\t` / `:` field separators are always unambiguous. Pure Kotlin - no API-level
 * dependency (works on minSdk 22 and in JVM unit tests).
 *
 * Grammar:
 * ```
 * CORPUS\t<version>
 * C\t<id>\t<CATEGORY>\t<expected>            expected = "N" | "I:"<esc cardId>
 * F\t<atMs>\t<qr>\t<strip>\t<strip>...       qr = "-" | <esc url>;  strip = <SOURCE>":"<esc text>
 * ```
 */
object CorpusIO {
    // Escape % first (so its escape isn't re-escaped); unescape it last.
    private fun b(s: String) = s.replace("%", "%25").replace("\t", "%09").replace("\n", "%0A").replace(":", "%3A")
    private fun u(s: String) = s.replace("%3A", ":").replace("%0A", "\n").replace("%09", "\t").replace("%25", "%")

    fun encode(corpus: Corpus): String {
        val sb = StringBuilder()
        sb.append("CORPUS\t").append(corpus.version).append('\n')
        for (c in corpus.cases) {
            sb.append("C\t").append(c.id).append('\t').append(c.category.name).append('\t')
            when (val e = c.expected) {
                is Expected.Identity -> sb.append("I:").append(b(e.cardId))
                Expected.NoLock -> sb.append('N')
            }
            sb.append('\n')
            for (f in c.frames) {
                sb.append("F\t").append(f.atMs).append('\t').append(f.qr?.let { b(it) } ?: "-")
                for (s in f.strips) sb.append('\t').append(s.source.name).append(':').append(b(s.text))
                sb.append('\n')
            }
        }
        return sb.toString()
    }

    fun decode(text: String): Corpus {
        var version = ""
        val cases = ArrayList<CorpusCase>()
        var id: String? = null
        var cat: Category? = null
        var exp: Expected? = null
        var frames = ArrayList<FrameObservation>()
        fun flush() { if (id != null) cases.add(CorpusCase(id!!, cat!!, frames.toList(), exp!!)) }
        for (line in text.split('\n')) {
            val raw = line.removeSuffix("\r")   // tolerate CRLF (files pulled/edited on Windows)
            if (raw.isBlank()) continue
            val p = raw.split('\t')
            when (p[0]) {
                "CORPUS" -> version = p.getOrElse(1) { "" }
                "C" -> { flush(); id = p[1]; cat = Category.valueOf(p[2]); exp = parseExpected(p[3]); frames = ArrayList() }
                "F" -> {
                    val qr = if (p[2] == "-") null else u(p[2])
                    val strips = p.drop(3).map { field ->
                        val i = field.indexOf(':')
                        OcrCandidate(u(field.substring(i + 1)), Source.valueOf(field.substring(0, i)))
                    }
                    frames.add(FrameObservation(p[1].toLong(), strips, qr))
                }
                else -> error("corpus decode: unknown line tag '${p[0]}'")
            }
        }
        flush()
        return Corpus(version, cases)
    }

    private fun parseExpected(s: String): Expected =
        if (s == "N") Expected.NoLock else Expected.Identity(u(s.removePrefix("I:")))
}
