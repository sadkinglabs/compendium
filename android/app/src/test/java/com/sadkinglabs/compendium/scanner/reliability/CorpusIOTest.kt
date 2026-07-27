package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.model.Source
import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate
import org.junit.Assert.assertEquals
import org.junit.Test

class CorpusIOTest {

    private val corpus = SeedCorpus.corpus()

    @Test fun round_trips_losslessly() {
        val decoded = CorpusIO.decode(CorpusIO.encode(corpus))
        assertEquals(corpus, decoded)   // data classes: structural equality across every case/frame/strip
    }

    @Test fun tolerates_crlf_line_endings() {
        val crlf = CorpusIO.encode(corpus).replace("\n", "\r\n")   // e.g. a file pulled/edited on Windows
        assertEquals(corpus, CorpusIO.decode(crlf))
    }

    @Test fun round_trip_preserves_the_content_digest() {
        val decoded = CorpusIO.decode(CorpusIO.encode(corpus))
        assertEquals(CorpusValidator.corpusDigest(corpus), CorpusValidator.corpusDigest(decoded))
    }

    @Test fun preserves_qr_multi_strip_exact_source_and_negatives() {
        val tricky = Corpus(
            "io-test",
            listOf(
                CorpusCase(
                    "multi", Category.SITE_RIGHT,
                    listOf(
                        FrameObservation(0, listOf(OcrCandidate("Art © Drew: Haystack", Source.RIGHT_90), OcrCandidate("noisy top", Source.TOP))),
                        FrameObservation(150, emptyList(), qr = "compendium://deck/xY_z-1"),
                        FrameObservation(300, listOf(OcrCandidate("Left\tedge", Source.LEFT_270))),
                    ),
                    Expected.Identity("haystack"),
                ),
                CorpusCase("neg", Category.EMPTY, listOf(FrameObservation(0, emptyList())), Expected.NoLock),
            ),
        )
        val decoded = CorpusIO.decode(CorpusIO.encode(tricky))
        assertEquals(tricky, decoded)   // punctuation, spaces, a tab, QR, empty strips, both Expected variants
    }
}
