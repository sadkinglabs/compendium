package com.sadkinglabs.compendium.scanner.visual

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.Bitmap
import java.nio.FloatBuffer

/**
 * Card recogniser visual match (Rev 6 snapshot). Embeds ONE captured still with DINOv2-small int8 (ORT)
 * and returns the top-k distinct card candidates by cosine against a precomputed prototype index. Run ONCE
 * per shutter press - never per frame. Owns its ORT session + index for the scanner Activity lifetime.
 *
 * Identity is the catalog card_id (never the display name - Codex contract). Preprocessing is the selected
 * frameless path: a fixed CENTRE-SQUARE crop then 448, ImageNet mean/std, NCHW (matches the offline index).
 */
class VisualMatcher private constructor(
    private val env: OrtEnvironment,
    private val session: OrtSession,
    private val proto: Array<FloatArray>,   // N x DIM, L2-normalised fp16-decoded prototypes
    private val protoIds: List<String>,     // N parallel card_ids (multi-prototype; best score per id)
    private val names: Map<String, String>, // card_id -> display name
) {
    /** [cardId] is the catalog identity (keys every lookup/write); [displayName] is display only. */
    data class Candidate(val cardId: String, val displayName: String, val score: Float)

    private val inputName = session.inputNames.iterator().next()

    /** L2-normalised embedding of one card crop (already cropped to the card via [cardCrop]); resized to
     *  448 square - the same square-resize the offline index applies, so aspect distorts identically. */
    fun embed(bmp: Bitmap): FloatArray {
        val scaled = Bitmap.createScaledBitmap(bmp, SIZE, SIZE, true)
        val area = SIZE * SIZE
        val chw = FloatArray(3 * area)
        val px = IntArray(area)
        scaled.getPixels(px, 0, SIZE, 0, 0, SIZE, SIZE)
        if (scaled !== bmp) scaled.recycle()
        for (i in 0 until area) {
            val p = px[i]
            chw[i] = (((p shr 16) and 0xFF) / 255f - MEAN[0]) / STD[0]
            chw[area + i] = (((p shr 8) and 0xFF) / 255f - MEAN[1]) / STD[1]
            chw[2 * area + i] = ((p and 0xFF) / 255f - MEAN[2]) / STD[2]
        }
        val tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(chw), longArrayOf(1, 3, SIZE.toLong(), SIZE.toLong()))
        try {
            val res: OrtSession.Result = session.run(mapOf(inputName to tensor))
            @Suppress("UNCHECKED_CAST")
            val out = (res.get(0).value as Array<FloatArray>)[0]
            res.close()
            var n = 0f
            for (v in out) n += v * v
            n = Math.sqrt(n.toDouble()).toFloat()
            if (n > 0f) for (i in out.indices) out[i] /= n
            return out
        } finally {
            tensor.close()
        }
    }

    /** Up to [topK] distinct card candidates, highest cosine first. */
    fun match(bmp: Bitmap, topK: Int = 5): List<Candidate> {
        val q = embed(bmp)
        val best = HashMap<String, Float>(protoIds.size)
        for (j in proto.indices) {
            val p = proto[j]
            var s = 0f
            for (d in q.indices) s += q[d] * p[d]
            val id = protoIds[j]
            val cur = best[id]
            if (cur == null || s > cur) best[id] = s
        }
        return best.entries.sortedByDescending { it.value }.take(topK)
            .map { Candidate(it.key, names[it.key] ?: it.key, it.value) }
    }

    fun close() = session.close()

    companion object {
        const val SIZE = 448
        const val DIM = 384
        private val MEAN = floatArrayOf(0.485f, 0.456f, 0.406f)
        private val STD = floatArrayOf(0.229f, 0.224f, 0.225f)

        /**
         * Card-aware crop (aspect-preserving): trims rows/columns of low edge-activity (uniform background)
         * to the busy central region - the card - so loose framing and landscape sites are handled without
         * a guide frame or a learned detector. Validated offline vs centre-square under simulated loose
         * framing (bbox_check.py: sites 40->67 top-1 / 67->87 top-5). Returns a NEW bitmap, or [bmp] itself
         * if detection is degenerate (caller checks identity before recycling the input).
         */
        fun cardCrop(bmp: Bitmap): Bitmap {
            val sc = 256f / maxOf(bmp.width, bmp.height)
            val sw = (bmp.width * sc).toInt().coerceAtLeast(8)
            val sh = (bmp.height * sc).toInt().coerceAtLeast(8)
            val small = Bitmap.createScaledBitmap(bmp, sw, sh, true)
            val px = IntArray(sw * sh)
            small.getPixels(px, 0, sw, 0, 0, sw, sh)
            if (small !== bmp) small.recycle()
            val gray = FloatArray(sw * sh)
            for (i in px.indices) {
                val p = px[i]
                gray[i] = 0.299f * ((p shr 16) and 0xFF) + 0.587f * ((p shr 8) and 0xFF) + 0.114f * (p and 0xFF)
            }
            val col = FloatArray(sw)
            val row = FloatArray(sh)
            for (y in 0 until sh) for (x in 1 until sw) col[x] += Math.abs(gray[y * sw + x] - gray[y * sw + x - 1])
            for (y in 1 until sh) for (x in 0 until sw) row[y] += Math.abs(gray[y * sw + x] - gray[(y - 1) * sw + x])

            fun span(act: FloatArray): IntArray {
                var t = 0f
                for (a in act) t += a
                if (t <= 0f) return intArrayOf(0, act.size - 1)
                var c = 0f; var lo = 0; var hi = act.size - 1
                var i = 0
                while (i < act.size) { c += act[i]; if (c >= 0.04f * t) { lo = i; break }; i++ }
                c = 0f; i = act.size - 1
                while (i >= 0) { c += act[i]; if (c >= 0.04f * t) { hi = i; break }; i-- }
                return intArrayOf(lo, hi)
            }

            val (x0, x1) = span(col)
            val (y0, y1) = span(row)
            val mx = (x1 - x0) * 0.03f
            val my = (y1 - y0) * 0.03f
            val cx0 = ((x0 - mx) / sc).toInt().coerceIn(0, bmp.width - 1)
            val cx1 = ((x1 + mx) / sc).toInt().coerceIn(cx0 + 1, bmp.width)
            val cy0 = ((y0 - my) / sc).toInt().coerceIn(0, bmp.height - 1)
            val cy1 = ((y1 + my) / sc).toInt().coerceIn(cy0 + 1, bmp.height)
            if (cx1 - cx0 < 20 || cy1 - cy0 < 20) return bmp
            return Bitmap.createBitmap(bmp, cx0, cy0, cx1 - cx0, cy1 - cy0)
        }

        /** Load from model + fp16 index bytes and the parallel card_id / display-name lists (from index.json). */
        fun load(modelBytes: ByteArray, indexBytes: ByteArray, cardIds: List<String>, displayNames: List<String>): VisualMatcher {
            require(cardIds.size == displayNames.size) { "cardIds/displayNames length mismatch" }
            val env = OrtEnvironment.getEnvironment()
            val session = env.createSession(modelBytes, OrtSession.SessionOptions())
            val n = indexBytes.size / 2 / DIM
            require(n == cardIds.size) { "index/cards mismatch: $n vectors vs ${cardIds.size} ids" }
            val proto = Array(n) { FloatArray(DIM) }
            var bi = 0
            for (i in 0 until n) {
                val row = proto[i]
                for (d in 0 until DIM) {
                    val lo = indexBytes[bi].toInt() and 0xFF
                    val hi = indexBytes[bi + 1].toInt() and 0xFF
                    bi += 2
                    row[d] = halfToFloat((hi shl 8) or lo)
                }
            }
            val names = HashMap<String, String>(cardIds.size)
            for (i in cardIds.indices) names.putIfAbsent(cardIds[i], displayNames[i])
            return VisualMatcher(env, session, proto, cardIds, names)
        }

        /** IEEE-754 half -> float, covering subnormals and inf/nan. */
        fun halfToFloat(h: Int): Float {
            val s = (h ushr 15) and 0x1
            val e = (h ushr 10) and 0x1F
            val m = h and 0x3FF
            val bits: Int = when (e) {
                0 -> if (m == 0) s shl 31 else {
                    var mant = m
                    var exp = -1
                    do {
                        exp++
                        mant = mant shl 1
                    } while (mant and 0x400 == 0)
                    (s shl 31) or ((exp + 112) shl 23) or ((mant and 0x3FF) shl 13)
                }
                0x1F -> (s shl 31) or (0xFF shl 23) or (m shl 13)
                else -> (s shl 31) or ((e + 112) shl 23) or (m shl 13)
            }
            return Float.fromBits(bits)
        }
    }
}
