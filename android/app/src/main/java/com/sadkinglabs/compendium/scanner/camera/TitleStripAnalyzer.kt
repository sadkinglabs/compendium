package com.sadkinglabs.compendium.scanner.camera

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.sadkinglabs.compendium.scanner.ocr.BarcodeReader
import com.sadkinglabs.compendium.scanner.ocr.Extraction
import com.sadkinglabs.compendium.scanner.ocr.FrameConverter
import com.sadkinglabs.compendium.scanner.ocr.StripExtractor
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
) : ImageAnalysis.Analyzer {

    private val busy = AtomicBoolean(false)
    @Volatile private var lastTs = 0L

    override fun analyze(image: ImageProxy) {
        val now = System.currentTimeMillis()
        if (now - lastTs < intervalMs || !busy.compareAndSet(false, true)) {
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
        // Off the main thread: read a QR first (unambiguous - wins if present), else fall
        // through to strip OCR + fuzzy match (crops, Levenshtein over ~1104 names).
        scope.launch(Dispatchers.Default) {
            try {
                val link = barcodeReader.scan(upright)
                if (link != null) onLink(link)
                else onResult(extractor.extract(upright))
            } catch (_: Throwable) {
                onResult(Extraction(emptyList(), ""))
            } finally {
                upright.recycle()
                busy.set(false)
            }
        }
    }
}
