package com.sadkinglabs.compendium.scanner

import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.sadkinglabs.compendium.scanner.visual.VisualMatcher
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Spike-R follow-up: Android accuracy parity for the PRODUCTION VisualMatcher. Loads the shipping int8 model
 * + index.f16 + card labels, runs match() on the desktop-exported crops, and writes each image's top-5 so the
 * desktop can compare against fixtures.json (same crops, same shipping index). Proves the on-device path
 * reproduces the desktop ranking before any UI depends on it.
 *
 * Setup: push dinov2_s448_int8.onnx, index.f16, index.json and the crop PNGs into recog-embed, run, pull
 * recog-embed/visual-parity.json.
 */
@RunWith(AndroidJUnit4::class)
class RecogVisualParityTest {

    @Test
    fun visualParity() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val base = File(ctx.getExternalFilesDir(null), "recog-embed")
        base.mkdirs()
        val model = File(base, "dinov2_s448_int8.onnx")
        val index = File(base, "index.f16")
        val indexJson = File(base, "index.json")
        assertTrue("push model + index.f16 + index.json + fixtures/*.png into ${base.absolutePath}",
            model.exists() && index.exists() && indexJson.exists())

        val obj = JSONObject(indexJson.readText())
        val idsArr = obj.getJSONArray("cardIds")
        val namesArr = obj.getJSONArray("displayNames")
        val ids = ArrayList<String>(idsArr.length())
        val names = ArrayList<String>(namesArr.length())
        for (i in 0 until idsArr.length()) { ids.add(idsArr.getString(i)); names.add(namesArr.getString(i)) }

        val matcher = VisualMatcher.load(model.readBytes(), index.readBytes(), ids, names)
        try {
            val crops: List<File> = base.listFiles { f -> f.name.endsWith(".png") }?.sortedBy { it.name } ?: emptyList()
            assertTrue("push fixtures/*.png into ${base.absolutePath}", crops.isNotEmpty())
            val out = JSONObject()
            for (f in crops) {
                val bmp = BitmapFactory.decodeFile(f.path) ?: continue
                val top5 = matcher.match(bmp, 5).map { it.cardId }
                bmp.recycle()
                out.put(f.nameWithoutExtension, JSONArray(top5))
            }
            File(base, "visual-parity.json").writeText(out.toString(2))
            Log.i("RecogVisualParity", "matched ${out.length()} crops -> visual-parity.json")
        } finally {
            matcher.close()
        }
    }
}
