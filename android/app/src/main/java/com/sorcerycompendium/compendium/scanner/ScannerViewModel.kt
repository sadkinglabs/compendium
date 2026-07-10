package com.sorcerycompendium.compendium.scanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.sorcerycompendium.compendium.scanner.camera.TitleStripAnalyzer
import com.sorcerycompendium.compendium.scanner.match.MatchResult
import com.sorcerycompendium.compendium.scanner.match.Norm
import com.sorcerycompendium.compendium.scanner.model.Phase
import com.sorcerycompendium.compendium.scanner.model.RecognisedCard
import com.sorcerycompendium.compendium.scanner.ocr.Extraction
import com.sorcerycompendium.compendium.scanner.ocr.StripExtractor
import com.sorcerycompendium.compendium.scanner.stability.StabilityGate
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.Executors

/**
 * Owns the recognition pipeline. Exposes THREE things, deliberately decoupled:
 *  - [sheet]     : the sticky recognised card (null = no sheet). Stays until "Scan
 *                  another" ([onDismiss]) or a DIFFERENT card locks.
 *  - [phase]     : the live frame-colour driver - purple SEARCHING / gold DETECTING -
 *                  which keeps updating even while a sheet is shown, so the frame can
 *                  go back to purple to signal "scanning is allowed again".
 *  - [lockEvent] : a counter bumped on each new lock, for the green flash + haptic +
 *                  sheet reveal.
 */
class ScannerViewModel : ViewModel() {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    val analysisExecutor = Executors.newSingleThreadExecutor()

    private val matcher = ScannerChannel.matcher
    private val gate = StabilityGate(ScannerChannel.minStreak)
    private val extractor = StripExtractor(recognizer)

    private val _sheet = MutableStateFlow<RecognisedCard?>(null)
    val sheet: StateFlow<RecognisedCard?> = _sheet.asStateFlow()
    private val _phase = MutableStateFlow(Phase.SEARCHING)
    val phase: StateFlow<Phase> = _phase.asStateFlow()
    private val _lockEvent = MutableStateFlow(0)
    val lockEvent: StateFlow<Int> = _lockEvent.asStateFlow()
    private val _debug = MutableStateFlow("")
    val debug: StateFlow<String> = _debug.asStateFlow()

    @Volatile private var locked: RecognisedCard? = null

    val analyzer = TitleStripAnalyzer(
        scope = viewModelScope,
        extractor = extractor,
        intervalMs = SCAN_MS,       // keep scanning even while a card is shown (to replace it)
        onResult = ::onResult,
    )

    private fun onResult(ext: Extraction) {
        _debug.value = ext.debug
        val candidates = ext.candidates
        val m = matcher ?: return
        var best: MatchResult? = null
        var bestScore = -1.0
        for (c in candidates) {
            val r = m.match(Norm.normalize(c.text), c.isSite) ?: continue
            if (r.score > bestScore) { best = r; bestScore = r.score }
        }
        val crossed = gate.onMatch(best?.card)
        if (crossed != null) {
            val card = RecognisedCard(crossed.id, crossed.name, crossed.isSite)
            locked = card
            _sheet.value = card                       // sticky sheet
            _lockEvent.value = _lockEvent.value + 1   // green flash + haptic + reveal
        }
        // Gold only for a DIFFERENT card being confirmed; the already-shown card (or an
        // empty frame) reads purple, so the flash fades back to purple = "scan again OK".
        val newCandidate = best != null && best.card.id != locked?.id
        _phase.value = if (newCandidate) Phase.DETECTING else Phase.SEARCHING
    }

    /** "Scan another": drop the shown card and resume fresh scanning. */
    fun onDismiss() {
        gate.reset()
        locked = null
        _sheet.value = null
        _phase.value = Phase.SEARCHING
    }

    override fun onCleared() {
        recognizer.close()
        analysisExecutor.shutdown()
    }

    companion object {
        const val SCAN_MS = 350L
    }
}
