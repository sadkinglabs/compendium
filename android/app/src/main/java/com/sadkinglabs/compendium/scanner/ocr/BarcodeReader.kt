package com.sadkinglabs.compendium.scanner.ocr

import android.graphics.Bitmap
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.common.InputImage
import com.sadkinglabs.compendium.scanner.model.ScannerQr
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Reads a QR off the full frame and returns a TERMINAL shared-content link (deck/match) if present.
 * The scanner runs this BEFORE the card OCR each frame, so a terminal QR wins; otherwise the pipeline
 * falls through to name recognition. Uses the SHARED [ScannerQr.isCompendiumLink] classifier (same
 * trim + prefixes the harness and onLink use), so a `compendium://foo` or whitespace-prefixed link
 * is classified identically here and in replay.
 */
class BarcodeReader(private val scanner: BarcodeScanner) {
    suspend fun scan(frame: Bitmap): String? = suspendCancellableCoroutine { cont ->
        scanner.process(InputImage.fromBitmap(frame, 0))
            .addOnSuccessListener { barcodes ->
                if (!cont.isActive) return@addOnSuccessListener
                val url = barcodes.asSequence()
                    .mapNotNull { it.rawValue }
                    .firstOrNull { ScannerQr.isCompendiumLink(it) }
                cont.resume(url)
            }
            .addOnFailureListener { if (cont.isActive) cont.resume(null) }
    }
}
