package com.sadkinglabs.compendium.scanner.camera

import android.graphics.Bitmap
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.sadkinglabs.compendium.scanner.ocr.BarcodeReader
import com.sadkinglabs.compendium.scanner.ocr.Extraction
import com.sadkinglabs.compendium.scanner.ocr.FrameConverter
import com.sadkinglabs.compendium.scanner.ocr.StripExtractor
import com.sadkinglabs.compendium.scanner.reliability.FrameObservation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Throttled, single-in-flight frame analyzer. Admits at most one frame per
 * [intervalMs] and only when no OCR is in flight; converts the admitted frame to an
 * upright bitmap, closes the ImageProxy immediately, then runs strip OCR off-thread
 * and hands the extraction to [onResult] (called off the main thread).
 */
class TitleStripAnalyzer(
    private val scope: CoroutineScope,
    private val extractor: StripExtractor,
    private val barcodeReader: BarcodeReader,
    private val intervalMs: Long,                 // min gap between admitted frames
    private val onLink: (String) -> Unit,         // a compendium:// QR was read
    private val onResult: (Extraction) -> Unit,   // card OCR result
    private val onFrame: (FrameObservation) -> Unit = {},  // DEV capture: the full per-frame observation
    private val onCapture: (Bitmap) -> Unit = {}, // one-shot still (visual match) - receives an OWNED copy
    private val ocrPerFrame: Boolean = true,      // false (snapshot mode): QR only per frame, no strip OCR
) : ImageAnalysis.Analyzer {

    private val busy = AtomicBoolean(false)
    @Volatile private var lastTs = 0L
    private val captureNext = AtomicBoolean(false)

    /** Arm a single still capture: the next admitted upright frame is copied and handed to [onCapture]
     *  (the caller owns and must recycle it). One-shot - re-arm for another. */
    fun armCapture() = captureNext.set(true)

    override fun analyze(image: ImageProxy) {
        val now = System.currentTimeMillis()
        // Throttle-bypass: an armed shutter capture grabs the current frame ASAP (skips intervalMs),
        // but still respects the single-in-flight busy latch so the freeze lands within a frame or two.
        val throttled = now - lastTs < intervalMs && !captureNext.get()
        if (throttled || !busy.compareAndSet(false, true)) {
            image.close()
            return
        }
        lastTs = now
        val upright = try {
            FrameConverter.toUpright(image)
        } catch (t: Throwable) {
            image.close(); busy.set(false); return
        }
        image.close()                              // pixels copied - free the camera buffer now
        // One-shot still for the visual-match fallback: hand out an OWNED copy of the upright frame
        // BEFORE OCR recycles it (see the finally below). Copy so the caller's lifetime is independent.
        if (captureNext.compareAndSet(true, false)) {
            try {
                onCapture(upright.copy(upright.config ?: Bitmap.Config.ARGB_8888, false))
            } catch (_: Throwable) { /* capture is best-effort; never disrupt scanning */ }
        }
        // Off the main thread: read a QR first (unambiguous - wins if present), else fall
        // through to strip OCR + fuzzy match (crops, Levenshtein over ~1104 names).
        scope.launch(Dispatchers.Default) {
            try {
                val link = barcodeReader.scan(upright)
                if (link != null) {
                    onFrame(FrameObservation(now, emptyList(), link))   // QR short-circuits OCR (matches production)
                    onLink(link)
                } else if (ocrPerFrame) {
                    val ext = extractor.extract(upright)
                    onFrame(FrameObservation(now, ext.candidates, null))
                    onResult(ext)
                }
            } catch (_: Throwable) {
                onResult(Extraction(emptyList(), ""))
            } finally {
                upright.recycle()
                busy.set(false)
            }
        }
    }
}
