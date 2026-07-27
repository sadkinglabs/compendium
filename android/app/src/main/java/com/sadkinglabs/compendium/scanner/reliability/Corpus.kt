package com.sadkinglabs.compendium.scanner.reliability

import com.sadkinglabs.compendium.scanner.ocr.OcrCandidate

/**
 * The frozen, versioned recognition corpus (proposal §8, reworked after Codex review). A case is a
 * sequence of per-frame ANALYZER OBSERVATIONS - the full set of strip readings the extractor would
 * emit that frame (each an [OcrCandidate] with its EXACT Source) plus an optional QR - exactly the
 * evidence production hands the selector. This lets the harness reproduce the on-device path (a noisy
 * TOP reading competing with a good site edge; QR-only; QR-near-card) instead of a single collapsed
 * reading. Synthetic seeds and real device captures share this shape; only capturing is device-gated.
 *
 * FROZEN: changing/removing cases must bump [Corpus.version]; a content digest ([CorpusValidator])
 * makes silent drift detectable.
 */

/** Case category, so metrics can be sliced and coverage is visible/validated. */
enum class Category {
    SPELL, SITE_LEFT, SITE_RIGHT, SIMILAR_NAME, MULTI_SET,
    EMPTY, NON_CARD_TEXT, QR_ONLY, QR_NEAR_CARD,
    SLEEVE_FOIL_GLARE, PARTIAL_STRIP, DROPOUT_WHILE_PRESENT, REMOVAL_REINSERTION,
}

enum class CardClass { SITE, SPELL }

/** One frame's full observation at [atMs]: every strip reading the extractor produced (empty = no
 *  confident text this frame, i.e. empty frame OR OCR dropout) plus an optional QR payload. */
data class FrameObservation(val atMs: Long, val strips: List<OcrCandidate>, val qr: String? = null)

sealed interface Expected {
    data class Identity(val cardId: String) : Expected
    /** A negative: the scanner must NOT lock a card (empty, non-card text, bare type word,
     *  QR-only, QR-near-card where the QR wins, …). */
    data object NoLock : Expected
}

data class CorpusCase(
    val id: String,
    val category: Category,
    val frames: List<FrameObservation>,
    val expected: Expected,
)

data class Corpus(val version: String, val cases: List<CorpusCase>)
