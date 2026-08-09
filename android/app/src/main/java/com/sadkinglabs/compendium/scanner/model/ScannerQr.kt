package com.sadkinglabs.compendium.scanner.model

/**
 * The SINGLE classifier for a "terminal" shared-content QR (a Compendium deck/match link). Used at
 * the analyzer boundary ([com.sadkinglabs.compendium.scanner.ocr.BarcodeReader]), by
 * `ScannerViewModel.onLink`, and by the reliability replay harness, so production's QR-vs-OCR
 * decision and replay's terminal-QR agree EXACTLY (same trim + prefixes). Lives in the leaf `model`
 * package so every layer can share it without a dependency cycle.
 */
object ScannerQr {
    fun isCompendiumLink(qr: String?): Boolean {
        val u = qr?.trim() ?: return false
        return u.startsWith("compendium://deck", ignoreCase = true) ||
            u.startsWith("compendium://match", ignoreCase = true)
    }
}
