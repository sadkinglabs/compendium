package com.sadkinglabs.compendium.scanner.reliability

/**
 * Accumulates the live analyzer's per-frame observations into a corpus during capture. A pure buffer
 * (no Android/I-O): the analyzer feeds [record] each frame, [endCase] closes the current scan as one
 * case, and the Activity persists [encoded] via [CorpusIO]. `expected` defaults to `NoLock`; the human
 * sets the TRUE expected identity during off-device curation (the app can't know ground truth). Only
 * exercised when the capture debug flag is on, so it never touches release scanning.
 */
class CorpusRecorder(private val version: String) {
    // Synchronized: [record] is called on the analysis thread, [endCase]/[snapshot] on the UI thread.
    private val cases = ArrayList<CorpusCase>()
    private var frames = ArrayList<FrameObservation>()

    @Synchronized fun record(frame: FrameObservation) { frames.add(frame) }

    /** Close the current scan session as one case. No-op if no frames were seen. */
    @Synchronized fun endCase(id: String, category: Category = Category.NON_CARD_TEXT, expected: Expected = Expected.NoLock) {
        if (frames.isEmpty()) return
        cases.add(CorpusCase(id, category, frames.toList(), expected))
        frames = ArrayList()
    }

    @Synchronized fun snapshot(): Corpus = Corpus(version, cases.toList())
    @Synchronized fun encoded(): String = CorpusIO.encode(snapshot())
    @Synchronized fun isEmpty(): Boolean = cases.isEmpty() && frames.isEmpty()

    /** Encode everything captured SO FAR - closed cases plus the in-progress frames as a trailing
     *  case - WITHOUT clearing. Idempotent, so the Activity can persist it on both background and
     *  close (overwriting one session file) and never lose data if onDestroy doesn't run. */
    @Synchronized fun encodedNow(pendingCaseId: String): String {
        val all = ArrayList(cases)
        if (frames.isNotEmpty()) all.add(CorpusCase(pendingCaseId, Category.NON_CARD_TEXT, frames.toList(), Expected.NoLock))
        return CorpusIO.encode(Corpus(version, all))
    }
}
