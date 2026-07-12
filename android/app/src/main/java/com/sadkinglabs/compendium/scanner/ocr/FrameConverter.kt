package com.sadkinglabs.compendium.scanner.ocr

import android.graphics.Bitmap
import android.graphics.Matrix
import androidx.camera.core.ImageProxy

/** Converts a CameraX [ImageProxy] into an upright (rotation-corrected) Bitmap. */
object FrameConverter {
    /**
     * Returns an upright ARGB bitmap. Pixels are COPIED, so the caller must close the
     * [ImageProxy] immediately after this returns (frees the camera buffer while OCR
     * runs - under STRATEGY_KEEP_ONLY_LATEST a never-closed frame freezes the preview).
     */
    fun toUpright(image: ImageProxy): Bitmap {
        val raw = image.toBitmap()                        // camera-core 1.3+: RGBA_8888, unrotated
        val deg = image.imageInfo.rotationDegrees
        if (deg == 0) return raw
        val m = Matrix().apply { postRotate(deg.toFloat()) }
        val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
        if (rotated !== raw) raw.recycle()
        return rotated
    }
}
