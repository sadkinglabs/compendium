package com.sadkinglabs.compendium.scanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.sadkinglabs.compendium.scanner.camera.TitleStripAnalyzer
import com.sadkinglabs.compendium.scanner.match.MatchResult
import com.sadkinglabs.compendium.scanner.model.Phase
import com.sadkinglabs.compendium.scanner.model.GuideGeometry
import com.sadkinglabs.compendium.scanner.model.Recognition
import com.sadkinglabs.compendium.scanner.model.ScannerQr
import com.sadkinglabs.compendium.scanner.model.ScanKind
import com.sadkinglabs.compendium.scanner.reliability.CorpusRecorder
import com.sadkinglabs.compendium.scanner.ocr.BarcodeReader
import com.sadkinglabs.compendium.scanner.ocr.Extraction
import com.sadkinglabs.compendium.scanner.ocr.StripExtractor
import com.sadkinglabs.compendium.scanner.stability.StabilityGate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.Executors

/**
 * Owns the universal recognition pipeline (a card, OR a shared deck / match QR). Exposes
 * THREE things, deliberately decoupled:
 *  - [sheet]     : the sticky [Recognition] (null = no sheet). Stays until "Scan another"
 *                  ([onDismiss]) or a DIFFERENT thing locks.
 *  - [phase]     : the live frame-colour driver - purple SEARCHING / gold DETECTING -
 *                  which keeps updating even while a sheet is shown, so the frame can go
 *                  back to purple to signal "scanning is allowed again".
 *  - [lockEvent] : a counter bumped on each new lock, for the (type-coloured) flash +
 *                  haptic + sheet reveal.
 *
 * Each admitted frame is checked for a `compendium://` QR FIRST ([onLink]) - unambiguous,
 * so it wins - and only falls through to card OCR ([onResult]) when no QR is present.
 */
class ScannerViewModel : ViewModel() {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val barcodeClient = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
    val analysisExecutor = Executors.newSingleThreadExecutor()

    private val matcher = ScannerChannel.matcher
    private val gate = StabilityGate(ScannerChannel.minStreak)
    private val extractor = StripExtractor(recognizer)
    private val barcodeReader = BarcodeReader(barcodeClient)

    private val _sheet = MutableStateFlow<Recognition?>(null)
    val sheet: StateFlow<Recognition?> = _sheet.asStateFlow()
    private val _phase = MutableStateFlow(Phase.SEARCHING)
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _lockEvent = MutableStateFlow(0)
    val lockEvent: StateFlow<Int> = _lockEvent.asStateFlow()
    private val _debug = MutableStateFlow("")
    val debug: StateFlow<String> = _debug.asStateFlow()

    @Volatile private var locked: Recognition? = null

    // DEV capture (GuideGeometry.captureCorpus): buffer every frame's observation for the reliability
    // harness; the Activity persists it on close. Inert otherwise.
    private val recorder = CorpusRecorder("capture")

    val analyzer = TitleStripAnalyzer(
        scope = viewModelScope,
        extractor = extractor,
        barcodeReader = barcodeReader,
        intervalMs = SCAN_MS,       // keep scanning even while a sheet is shown (to replace it)
        onLink = ::onLink,
        onResult = ::onResult,
        onFrame = { if (GuideGeometry.captureCorpus) recorder.record(it) },
    )

    /** Capture-only: everything recorded so far as text (idempotent - safe to call repeatedly, e.g.
     *  on background AND on close), or null if nothing was recorded yet. */
    fun captureEncoded(): String? = if (recorder.isEmpty()) null else recorder.encodedNow("live-session")

    private fun onResult(ext: Extraction) {
        // FROZEN while a result is shown: the recognised identity is immutable until the user
        // dismisses ("Scan another") or an action completes, so a card can never change out from
        // under a user reaching for "Add". Ignore all further OCR matches until then.
        if (locked != null) return
        _debug.value = ext.debug
        val m = matcher ?: return
        // Selection is shared with the reliability harness via FrameSelector, so the two can't diverge.
        val best: MatchResult? = FrameSelector.selectCard(ext.candidates, m)?.match
        val crossed = gate.onMatch(best?.card)
        if (crossed != null) {
            // Snapshot the deck headroom at lock time: limit from the catalog, inDeck
            // from the live session count (deck mode; 0/unlimited otherwise).
            val rec = Recognition(
                ScanKind.CARD, crossed.name, cardId = crossed.id, sets = crossed.sets,
                limit = crossed.limit, inDeck = ScannerChannel.deckCounts[crossed.id] ?: 0,
            )
            locked = rec
            _sheet.value = rec                        // sticky sheet
            _lockEvent.value = _lockEvent.value + 1   // gold flash + haptic + reveal
        }
        // Gold only for a DIFFERENT card being confirmed; the already-shown thing (or an
        // empty frame) reads purple, so the flash fades back to purple = "scan again OK".
        val newCandidate = best != null && best.card.id != locked?.cardId
        _phase.value = if (newCandidate) Phase.DETECTING else Phase.SEARCHING
    }

    /** A `compendium://` QR was read - an instant, unambiguous lock (deck or match). */
    private fun onLink(url: String) {
        if (locked != null) return   // frozen while a result is shown (see onResult)
        val u = url.trim()
        // Same terminal-QR classifier the analyzer boundary + the reliability harness use, so they
        // can't diverge (BarcodeReader has already filtered, but this stays authoritative).
        if (!ScannerQr.isCompendiumLink(u)) return
        val kind = if (u.startsWith("compendium://deck", ignoreCase = true)) ScanKind.DECK else ScanKind.MATCH
        val rec = Recognition(kind, if (kind == ScanKind.DECK) "Shared deck" else "Shared match", url = u)
        gate.reset()                     // drop any half-built card streak
        locked = rec
        _sheet.value = rec
        _phase.value = Phase.SEARCHING   // QR is instant; skip the gold "detecting" ramp
        _lockEvent.value = _lockEvent.value + 1
    }

    /** "Scan another": drop the shown result and resume fresh scanning. */
    fun onDismiss() {
        gate.reset()
        locked = null
        _sheet.value = null
        _phase.value = Phase.SEARCHING
    }

    override fun onCleared() {
        recognizer.close()
        barcodeClient.close()
        analysisExecutor.shutdown()
    }

    companion object {
        const val SCAN_MS = 350L
    }
}
