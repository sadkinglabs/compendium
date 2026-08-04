package com.sadkinglabs.compendium.scanner

import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.sadkinglabs.compendium.scanner.match.CardIndex
import com.sadkinglabs.compendium.scanner.match.CardRef
import com.sadkinglabs.compendium.scanner.match.MatchResult
import com.sadkinglabs.compendium.scanner.match.Matcher
import com.sadkinglabs.compendium.scanner.match.Norm
import com.sadkinglabs.compendium.scanner.ocr.StripExtractor
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Gate-0 on-device OCR baseline harness. NOT a pass/fail test - a MEASUREMENT that runs the REAL OCR
 * recognition over the governed physical images and writes per-image results for scripts/recog/score.mjs.
 *
 * Two measurements per image:
 *   - strip : the EXACT production path - StripExtractor.extract(bitmap) + FrameSelector.selectCard,
 *             i.e. what the live scanner does treating the photo as one camera frame. This carries the
 *             scanner's framing/orientation assumptions (top banner for spells, side edges for sites).
 *   - full  : whole-image ML Kit OCR, every recognised line run through the SAME Matcher in both
 *             orientations; best match. A framing-independent upper bound on what OCR can read at all.
 *
 * `ocrCardId` (the field score.mjs reads) = the FULL-image result - the generous OCR baseline for the
 * off-ramp: if even whole-image OCR cannot read the card, the encoder is justified. `strip` is the
 * diagnostic that separates "OCR cannot read it" from "the scanner's strip-cropping is the bottleneck".
 *
 * Setup (see scripts/recog/ocr-baseline.md): push the governed store images + full-catalog.tsv into the
 * app external files dir under recog-ocr/, run this test, pull recog-ocr/ocr-results.json.
 */
@RunWith(AndroidJUnit4::class)
class RecogOcrBaselineTest {

    @Test
    fun ocrBaseline() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val base = File(ctx.getExternalFilesDir(null), "recog-ocr")
        base.mkdirs()   // create app-owned so adb-pushed (world-readable) files are traversable/readable
        val catalogFile = File(base, "full-catalog.tsv")
        assertTrue("push full-catalog.tsv + <imageId>.jpg into ${base.absolutePath} first", catalogFile.exists())

        val catalog = catalogFile.readLines().filter { it.isNotBlank() }.map { line ->
            val t = line.split('\t'); CardRef(id = t[0], name = t[0], isSite = t.getOrNull(1) == "1")
        }
        val matcher = Matcher(CardIndex(catalog))
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val extractor = StripExtractor(recognizer)

        val images: List<File> = base.listFiles { f -> f.name.endsWith(".jpg") }?.sortedBy { it.name } ?: emptyList()
        val results = JSONArray()
        for (f in images) {
            val imageId = f.nameWithoutExtension
            var stripId: String? = null
            var full: MatchResult? = null
            try {
                val bmp = BitmapFactory.decodeFile(f.path) ?: continue
                // Production strip path: treat the photo as a camera frame.
                stripId = runBlocking { FrameSelector.selectCard(extractor.extract(bmp).candidates, matcher)?.match?.card?.id }
                // Full-image OCR: best line match across both orientations.
                val text = Tasks.await(recognizer.process(InputImage.fromBitmap(bmp, 0)))
                for (block in text.textBlocks) for (l in block.lines) {
                    val norm = Norm.normalize(l.text)
                    for (site in booleanArrayOf(false, true)) {
                        val m = matcher.match(norm, site) ?: continue
                        if (full == null || m.score > full!!.score) full = m
                    }
                }
                bmp.recycle()
            } catch (e: Throwable) {
                Log.w("RecogOcrBaseline", "image $imageId failed: ${e.message}")
            }
            val obj = JSONObject()
            obj.put("imageId", imageId)
            obj.put("ocrCardId", (full?.card?.id ?: JSONObject.NULL) as Any)
            obj.put("strip", (stripId ?: JSONObject.NULL) as Any)
            full?.let { obj.put("fullScore", it.score as Any) }
            results.put(obj)
        }
        val out = File(base, "ocr-results.json")
        out.writeText(JSONObject().put("results", results).toString(2))
        Log.i("RecogOcrBaseline", "scored ${results.length()} images -> ${out.absolutePath}")
    }
}
