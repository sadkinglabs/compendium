package com.sadkinglabs.compendium.scanner

import android.graphics.Bitmap
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.sadkinglabs.compendium.scanner.camera.TitleStripAnalyzer
import com.sadkinglabs.compendium.scanner.match.CardRef
import com.sadkinglabs.compendium.scanner.match.Norm
import com.sadkinglabs.compendium.scanner.model.Recognition
import com.sadkinglabs.compendium.scanner.model.ScanKind
import com.sadkinglabs.compendium.scanner.model.ScannerQr
import com.sadkinglabs.compendium.scanner.model.SnapCandidate
import com.sadkinglabs.compendium.scanner.model.SnapState
import com.sadkinglabs.compendium.scanner.ocr.BarcodeReader
import com.sadkinglabs.compendium.scanner.visual.CorrectionStore
import com.sadkinglabs.compendium.scanner.visual.VisualMatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.Executors

/**
 * Pure-snapshot scanner (Rev 6). One deliberate shutter press captures a still; image recognition
 * ([VisualMatcher]) identifies it once. Shortlist-first: candidates are presented for the user to confirm;
 * no automatic single Result and no write happens without an explicit tap. `compendium://` QR is still
 * detected passively on the live feed and wins from Ready. OCR does NO per-frame work here.
 *
 * Fail-closed: if the visual model/index cannot load, the state is Empty(unavailable) - never a fallback to
 * unrestricted OCR (which would recreate the site mis-identification this redesign fixes).
 *
 * Bitmap discipline: the captured pixels are memory-only, owned by one snapshot [token]; a late inference
 * from a superseded capture can never update a newer scan, and every still is recycled on transition.
 */
class ScannerViewModel : ViewModel() {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val barcodeClient = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
    val analysisExecutor = Executors.newSingleThreadExecutor()

    private val matcher = ScannerChannel.matcher
    private val barcodeReader = BarcodeReader(barcodeClient)

    private val _snap = MutableStateFlow<SnapState>(SnapState.Ready)
    val snap: StateFlow<SnapState> = _snap.asStateFlow()
    private val _still = MutableStateFlow<Bitmap?>(null)     // frozen capture, for the UI (memory-only)
    val still: StateFlow<Bitmap?> = _still.asStateFlow()
    private val _sheet = MutableStateFlow<Recognition?>(null)
    val sheet: StateFlow<Recognition?> = _sheet.asStateFlow()
    private val _lockEvent = MutableStateFlow(0)
    val lockEvent: StateFlow<Int> = _lockEvent.asStateFlow()
    private val _searching = MutableStateFlow(false)
    val searching: StateFlow<Boolean> = _searching.asStateFlow()

    @Volatile private var token = 0
    private var job: Job? = null
    @Volatile private var vmatcher: VisualMatcher? = null
    @Volatile private var locked = false     // a result sheet (picked card or QR) is showing
    @Volatile private var startMs = 0L       // shutter -> suggestions timing (dev log)
    // The last capture's query embedding + what the visual index ranked first. If the user confirms a
    // DIFFERENT card, that is a correction: the embedding becomes a user prototype for the right card, so
    // this device recognises it next time. The VECTOR is kept, never the photo.
    @Volatile private var lastEmb: FloatArray? = null
    @Volatile private var lastTop: String? = null
    private val nativeClosed = java.util.concurrent.atomic.AtomicBoolean(false)
    // The correction just recorded, if any - the UI offers an explicit undo for it, because replacing on
    // similarity only repairs a RETAKE of the same photograph, not a fresh photo of the same card.
    private val _lastLearned = MutableStateFlow<CorrectionStore.Entry?>(null)
    val lastLearned: StateFlow<CorrectionStore.Entry?> = _lastLearned.asStateFlow()

    val analyzer = TitleStripAnalyzer(
        scope = viewModelScope,
        barcodeReader = barcodeReader,
        intervalMs = SCAN_MS,
        onLink = ::onLink,
        onCapture = ::onSnapFrame,
    )

    /** A `compendium://` QR - an instant, unambiguous lock. Only from a Ready viewfinder. */
    private fun onLink(url: String) {
        if (locked || _snap.value !is SnapState.Ready) return
        val u = url.trim()
        if (!ScannerQr.isCompendiumLink(u)) return
        val kind = if (u.startsWith("compendium://deck", ignoreCase = true)) ScanKind.DECK else ScanKind.MATCH
        val rec = Recognition(kind, if (kind == ScanKind.DECK) "Shared deck" else "Shared match", url = u)
        lockTo(rec)
    }

    /** Shutter press: arm a single throttle-bypassed capture. */
    fun onShutter() {
        if (locked || _snap.value is SnapState.Capturing || _snap.value is SnapState.Identifying) return
        token++
        startMs = System.currentTimeMillis()
        clearStill()
        _snap.value = SnapState.Capturing
        analyzer.armCapture()
    }

    /** The captured still (an owned copy). Display it and run ONE inference on a private copy. */
    private fun onSnapFrame(bmp: Bitmap) {
        val t = token
        if (locked || _snap.value !is SnapState.Capturing) {
            bmp.recycle()
            return
        }
        // Card-aware crop: to the card's bounds/aspect (handles loose framing + landscape sites). What we
        // show IS what we match. The original full frame is then dropped.
        val crop = runCatching { VisualMatcher.cardCrop(bmp) }.getOrDefault(bmp)
        if (crop !== bmp) bmp.recycle()
        clearStill()
        _still.value = crop
        _snap.value = SnapState.Identifying
        val work = runCatching { crop.copy(crop.config ?: Bitmap.Config.ARGB_8888, false) }.getOrNull()
        job?.cancel()
        job = viewModelScope.launch(Dispatchers.Default) {
          // The job OWNS `work`: it is recycled here on every exit - success, supersession, cancellation
          // or failure - so a Back/retake/background mid-inference cannot retain it.
          try {
            val m = ensureMatcher()
            // Wide visual pool (still only cards the model ranked) so OCR can rescue bland-art cards that
            // sit outside the shown top-5; display stays 5. OCR PROMOTES a pool member whose printed name
            // it confirms - never introduces a card the model did not rank (the site-quotes-card safeguard).
            // OCR and the embedding are independent reads of the same still, so run them CONCURRENTLY:
            // a scan then costs about the slower of the two instead of their sum.
            val ocrJob = if (work != null) async { runCatching { ocrLines(work) }.getOrNull().orEmpty() } else null
            // Embed once, keep the vector: it powers the match AND becomes the user prototype on a correction.
            val emb = if (m != null && work != null) runCatching { m.embed(work) }.getOrNull() else null
            val pool = if (m != null && emb != null) runCatching { m.matchEmbedding(emb, POOL) }.getOrNull() else null
            var display = pool?.take(5)
            var promoted = false
            var agreed: CardRef? = null             // both signals named the SAME card
            val lines = ocrJob?.await().orEmpty()
            if (pool != null && work != null) {
                val ocr = ocrCard(pool, lines)          // a card OCR confidently read (in pool or not)
                if (ocr != null) {
                    val inPool = pool.any { it.cardId == ocr.id }
                    val head = VisualMatcher.Candidate(ocr.id, ocr.name, pool.firstOrNull { it.cardId == ocr.id }?.score ?: 0f)
                    display = (listOf(head) + pool.filter { it.cardId != ocr.id }).take(5)
                    promoted = true
                    // Auto-confirm requires GENUINE agreement, not merely "OCR named something the model
                    // ranked somewhere". The review's failure case - a quoted or incidental name that
                    // happens to sit anywhere in a 50-card pool - is excluded by demanding the named card
                    // also be one of the visual TOP FEW and clear a similarity floor. A card the player is
                    // not holding would have to be both visually among the closest matches to the photo
                    // AND have its name legible on that photo.
                    val rank = pool.indexOfFirst { it.cardId == ocr.id }
                    val strong = rank in 0 until AGREE_RANK && pool[rank].score >= AGREE_SCORE
                    if (AUTO_CONFIRM && strong) agreed = ocr
                    if (inPool && !strong) {
                        Log.i(TAG, "OCR named ${ocr.id} at rank $rank score " +
                            "%.2f - below the agreement bar, shortlisting".format(pool.getOrNull(rank)?.score ?: 0f))
                    }
                }
            }
            if (t != token) return@launch        // superseded: publish nothing, learn nothing
            // Learning evidence is published ONLY past the token check, so a late result from a cancelled
            // scan can never be attributed to a newer capture's confirmation.
            lastEmb = emb
            lastTop = pool?.firstOrNull()?.cardId
            Log.i(TAG, "shutter->result ${System.currentTimeMillis() - startMs}ms  " +
                (if (m == null) "UNAVAILABLE" else display?.joinToString { "${it.cardId}=%.2f".format(it.score) } ?: "none"))
            val confirmed = agreed
            when {
                m == null -> _snap.value = SnapState.Empty(unavailable = true)   // fail-closed
                display.isNullOrEmpty() || (!promoted && display[0].score < FLOOR) ->
                    _snap.value = SnapState.Empty(unavailable = false)
                confirmed != null -> {
                    lastTop = confirmed.id      // agreed identity: nothing to learn from confirming it
                    lockTo(
                        Recognition(
                            ScanKind.CARD, confirmed.name, cardId = confirmed.id, sets = confirmed.sets,
                            limit = confirmed.limit, inDeck = ScannerChannel.deckCounts[confirmed.id] ?: 0,
                        ),
                    )
                }
                else -> _snap.value = SnapState.Shortlist(display.map { SnapCandidate(it.cardId, it.displayName, it.score) })
            }
          } finally {
            work?.let { if (!it.isRecycled) it.recycle() }
          }
        }
    }

    /** Full-image OCR of the still at three orientations (sites read vertically), normalised lines.
     *  Downscaled first - the name is large, and it roughly thirds the per-pass cost. */
    private suspend fun ocrLines(bmp: Bitmap): List<String> = coroutineScope {
        val big = maxOf(bmp.width, bmp.height)
        val src = if (big > 1000) {
            val sc = 1000f / big
            Bitmap.createScaledBitmap(bmp, (bmp.width * sc).toInt(), (bmp.height * sc).toInt(), true)
        } else {
            bmp
        }
        // The three orientations are independent - dispatch them together (ML Kit queues internally) so a
        // rotated site costs one pass of wall-clock rather than three.
        try {
            intArrayOf(0, 90, 270).map { rot ->
                async(Dispatchers.IO) {
                    try {
                        val text = Tasks.await(recognizer.process(InputImage.fromBitmap(src, rot)))
                        text.textBlocks.flatMap { b -> b.lines.map { Norm.normalize(it.text) } }.filter { it.length >= 3 }
                    } catch (_: Throwable) {
                        emptyList()
                    }
                }
            }.awaitAll().flatten()
        } finally {
            if (src !== bmp && !src.isRecycled) src.recycle()   // also on cancellation
        }
    }

    /** The card OCR confidently read from the still. PREFERS a visual-pool member (promote); otherwise
     *  returns the confidently-read card so it can be OFFERED even though the embedding missed it
     *  (shortlist-only - the user still confirms, so it is never an auto-lock). Null if OCR read nothing
     *  the catalog matcher accepts. */
    private fun ocrCard(pool: List<VisualMatcher.Candidate>, lines: List<String>): CardRef? {
        val mm = matcher ?: return null
        if (lines.isEmpty()) return null
        val ids = pool.mapTo(HashSet()) { it.cardId }
        var outside: CardRef? = null
        for (line in lines) {
            for (site in booleanArrayOf(true, false)) {
                val res = mm.match(line, site) ?: continue
                if (res.card.id in ids) {
                    Log.i(TAG, "OCR promoted ${res.card.id}")
                    return res.card
                }
                if (outside == null) outside = res.card
            }
        }
        if (outside != null) Log.i(TAG, "OCR offered ${outside.id} (not in visual pool)")
        return outside
    }

    /** Lazily load the ~27MB model + index once, off-thread, only on first shutter use. */
    private fun ensureMatcher(): VisualMatcher? {
        vmatcher?.let { return it }
        val loader = ScannerChannel.visualLoader ?: return null
        // Retry on each capture rather than latching the first failure: "Try another photo" would
        // otherwise be a lie after a transient load failure (low memory, interrupted read).
        return runCatching { loader().also { vmatcher = it } }
            .onFailure { Log.w(TAG, "visual matcher unavailable: ${it.message}") }
            .getOrNull()
    }

    /** User confirmed an identity (by card_id): build the same Recognition and enter the existing sheet flow. */
    fun onPickCandidate(cardId: String) {
        if (locked) return
        val ref = matcher?.cardById(cardId)
        token++
        if (ref == null) {
            _snap.value = SnapState.Empty(unavailable = false)
            return
        }
        learnCorrection(ref.id, ref.name)
        lockTo(
            Recognition(
                ScanKind.CARD, ref.name, cardId = ref.id, sets = ref.sets,
                limit = ref.limit, inDeck = ScannerChannel.deckCounts[ref.id] ?: 0,
            ),
        )
    }

    /** "Try another photo": capture again without leaving the flow. */
    fun onRetake() {
        if (locked) return
        token++
        startMs = System.currentTimeMillis()
        job?.cancel()
        clearStill()
        _snap.value = SnapState.Capturing
        analyzer.armCapture()
    }

    /**
     * On-device hardening: if the user confirmed a card the visual index did NOT rank first, keep that
     * capture's embedding as an extra prototype for the right card - so this device recognises it next
     * time ("correct it once, it remembers"). Stores the VECTOR only, never the photo. No-op when the
     * top-1 was already right (nothing to learn) or there is no capture (search opened cold).
     */
    private fun learnCorrection(cardId: String, displayName: String) {
        val emb = lastEmb ?: return
        if (lastTop == cardId) { lastEmb = null; return }
        lastEmb = null
        if (emb.isEmpty() || emb.any { !it.isFinite() }) return   // never learn from a degenerate vector
        // The pick IS the identification - the user looked at the card and named it, which is the whole
        // signal. A mistaken pick is not permanent: addUserPrototype replaces any earlier correction
        // describing the same capture, so correcting again repairs it rather than leaving two rivals.
        runCatching {
            val m = vmatcher ?: return@runCatching
            m.addUserPrototype(cardId, displayName, emb)
            _lastLearned.value = m.userPrototypes().lastOrNull()
            if (PERSIST_CORRECTIONS) ScannerChannel.userProtoSink?.invoke(m.userPrototypes())
            Log.i(TAG, "learned correction: $cardId (was ${lastTop ?: "none"})")
        }
    }

    /** Undo the correction just recorded: remove it from the live index and rewrite the store without it. */
    fun undoLastCorrection() {
        val entry = _lastLearned.value ?: return
        _lastLearned.value = null
        runCatching {
            val m = vmatcher ?: return@runCatching
            if (m.removeUserPrototype(entry)) {
                if (PERSIST_CORRECTIONS) ScannerChannel.userProtoSink?.invoke(m.userPrototypes())
                Log.i(TAG, "undid correction: ${entry.cardId}")
            }
        }
    }

    fun clearLastLearned() { _lastLearned.value = null }

    /** Manual recovery: open the catalog name search (when the scan did not offer the right card). */
    fun openSearch() {
        if (!locked) _searching.value = true
    }

    fun closeSearch() {
        _searching.value = false
    }

    /** Substring catalog name search -> pickable candidates (card_id identity, name for display). */
    fun search(query: String): List<SnapCandidate> =
        matcher?.search(query)?.map { SnapCandidate(it.id, it.name, 0f) } ?: emptyList()

    /** "None of these" / Back out of the snapshot flow: cancel and return to a live viewfinder. */
    fun onCancelSnap() {
        token++
        job?.cancel()
        clearStill()
        _snap.value = SnapState.Ready
    }

    /** "Scan another" from the result sheet. */
    fun onDismiss() {
        locked = false
        token++
        job?.cancel()
        clearStill()
        _sheet.value = null
        _snap.value = SnapState.Ready
    }

    /** Present a confirmed identity. The captured still is KEPT on screen so the reveal can stamp it -
     *  it is the evidence the user just took; [onDismiss] clears it when they move on. */
    private fun lockTo(rec: Recognition) {
        locked = true
        job?.cancel()
        _searching.value = false
        _snap.value = SnapState.Ready
        _sheet.value = rec
        _lockEvent.value = _lockEvent.value + 1
    }

    /** Drop the displayed still. Do NOT recycle here - Compose may still be drawing it this frame; the ART
     *  heap reclaims it. The matching copy (owned by the inference job) IS recycled; teardown recycles any
     *  survivor. This keeps stills memory-only and bounded (one live at a time) without a render-recycle race. */
    private fun clearStill() {
        _still.value = null
    }

    /**
     * Teardown. A cancelled coroutine does NOT interrupt a synchronous native call already inside ORT or
     * ML Kit, so closing those sessions immediately could free a session mid-run and crash in native code.
     * Wait (briefly, bounded) for any in-flight inference to leave before closing.
     */
    override fun onCleared() {
        token++
        _still.value?.let { if (!it.isRecycled) it.recycle() }
        _still.value = null
        val j = job
        if (j != null && j.isActive) {
            // Cancelling does not interrupt a synchronous native call already inside ORT or ML Kit, so
            // close only once the job has actually left - driven by its completion, never by blocking the
            // main thread on a poll loop.
            j.invokeOnCompletion { closeNative() }
            j.cancel()
        } else {
            closeNative()
        }
        analysisExecutor.shutdown()
    }

    /** Idempotent: completion may fire from either the cancel path or a normal finish. */
    private fun closeNative() {
        if (!nativeClosed.compareAndSet(false, true)) return
        runCatching { vmatcher?.close() }
        runCatching { recognizer.close() }
        runCatching { barcodeClient.close() }
    }

    companion object {
        private const val TAG = "ScannerVisual"
        const val SCAN_MS = 350L
        private const val FLOOR = 0.35f     // provisional T_floor; below this -> Empty (calibrate on corpus)
        private const val POOL = 50         // visual candidates OCR may promote from (display stays 5)
        // Present a single identity when the two signals genuinely agree. This is the feature: a scan that
        // resolves in one tap instead of three. It is bounded, not blind - see AGREE_RANK / AGREE_SCORE.
        private const val AUTO_CONFIRM = true
        // For OCR's reading to count as CONFIRMATION rather than a hint, the named card must also be among
        // the visual top few AND clear a similarity floor. Deliberately much tighter than the 50-card pool
        // OCR may merely OFFER from.
        private const val AGREE_RANK = 5
        private const val AGREE_SCORE = 0.45f
        // Persist corrections so the scanner stays hardened across sessions - the point of learning at all.
        private const val PERSIST_CORRECTIONS = true
    }
}
