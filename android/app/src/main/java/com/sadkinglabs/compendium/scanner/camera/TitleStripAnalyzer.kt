package com.sadkinglabs.compendium.scanner.camera

import android.graphics.Bitmap
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.sadkinglabs.compendium.scanner.ocr.BarcodeReader
import com.sadkinglabs.compendium.scanner.ocr.FrameConverter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The live-feed analyzer for the snapshot scanner. It does only two things:
 *
 *  - watches for a `compendium://` QR (shared decks / matches), which is cheap and unambiguous;
 *  - hands out ONE still when the shutter arms a capture.
 *
 * Card recognition itself is NOT here - it runs once per shutter press on the captured still
 * (see ScannerViewModel). Frames are throttled to [intervalMs] and single-in-flight, except that an
 * armed capture bypasses the throttle so the freeze lands on the frame the user meant to take.
 */
class TitleStripAnalyzer(
    private val scope: CoroutineScope,
    private val barcodeReader: BarcodeReader,
    private val intervalMs: Long,                 // min gap between admitted frames
    private val onLink: (String) -> Unit,         // a compendium:// QR was read
    private val onCapture: (Bitmap) -> Unit = {}, // one-shot still - the caller OWNS and recycles it
) : ImageAnalysis.Analyzer {

    private val busy = AtomicBoolean(false)
    @Volatile private var lastTs = 0L
    private val captureNext = AtomicBoolean(false)

    /** Arm a single still capture: the next admitted upright frame is copied and handed to [onCapture].
     *  One-shot - re-arm for another. */
    fun armCapture() = captureNext.set(true)

    override fun analyze(image: ImageProxy) {
        val now = System.currentTimeMillis()
        // Throttle-bypass: an armed shutter capture grabs the current frame ASAP (skips intervalMs),
        // but still respects the single-in-flight latch so the freeze lands within a frame or two.
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
        // Hand out an OWNED copy of the upright frame BEFORE it is recycled below.
        if (captureNext.compareAndSet(true, false)) {
            try {
                onCapture(upright.copy(upright.config ?: Bitmap.Config.ARGB_8888, false))
            } catch (_: Throwable) { /* capture is best-effort; never disrupt scanning */ }
        }
        scope.launch(Dispatchers.Default) {
            try {
                barcodeReader.scan(upright)?.let(onLink)
            } catch (_: Throwable) {
                // a bad frame is not worth reporting; the next one is milliseconds away
            } finally {
                upright.recycle()
                busy.set(false)
            }
        }
    }
}
