package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.model.Source
import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CorpusRecorderTest {

    private fun frame(at: Long, text: String) =
        FrameObservation(at, listOf(OcrCandidate(text, Source.TOP)))

    @Test fun groups_recorded_frames_into_cases_and_round_trips() {
        val r = CorpusRecorder("capture-1")
        assertTrue(r.isEmpty())
        r.record(frame(0, "Smite")); r.record(frame(150, "Smite"))
        r.endCase("case-a", Category.SPELL, Expected.Identity("smite"))
        r.record(frame(0, "Flame"))
        r.endCase("case-b")   // default category/expected (curated later)

        val corpus = r.snapshot()
        assertEquals("capture-1", corpus.version)
        assertEquals(2, corpus.cases.size)
        assertEquals(2, corpus.cases[0].frames.size)
        assertEquals(Expected.Identity("smite"), corpus.cases[0].expected)
        assertEquals(Expected.NoLock, corpus.cases[1].expected)
        // The buffer's encoding is loadable by the harness.
        assertEquals(corpus, CorpusIO.decode(r.encoded()))
    }

    @Test fun end_case_with_no_frames_is_a_no_op() {
        val r = CorpusRecorder("capture-2")
        r.endCase("empty")
        assertTrue(r.isEmpty())
        assertEquals(0, r.snapshot().cases.size)
    }
}
