package com.sadkinglabs.compendium.scanner

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.FloatBuffer

/**
 * Spike R phase 2 (on-device MEASUREMENT): per-embedding latency for DINOv2-small on THIS phone at the
 * 448px deploy resolution. Benches EVERY *.onnx pushed into recog-embed/ (fp32 / fp16 / int8) on the ORT
 * default **CPU execution provider** (XNNPACK is NOT registered here - a separate session must addXnnpack()
 * to measure that path; likewise NNAPI/GPU). Writes results incrementally so a slow model still leaves data.
 * Small N and a zero input: this is a raw-inference latency probe, NOT end-to-end latency, throughput, or
 * output correctness - and NOT the approved per-frame <=30ms contract, which 660ms fails by ~22x.
 */
@RunWith(AndroidJUnit4::class)
class RecogEmbedLatencyTest {

    private val h = 448
    private val w = 448
    private val warmup = 2
    private val n = 6

    private fun bench(env: OrtEnvironment, model: File): String {
        var session: OrtSession? = null
        try {
            session = env.createSession(model.absolutePath, OrtSession.SessionOptions())
            val s: OrtSession = session
            val inName: String = s.inputNames.iterator().next()
            val buf = FloatBuffer.allocate(3 * h * w)
            val shape = longArrayOf(1, 3, h.toLong(), w.toLong())
            repeat(warmup) {
                buf.rewind()
                val t = OnnxTensor.createTensor(env, buf, shape)
                val res: OrtSession.Result = s.run(mapOf(inName to t))   // explicit type: not Kotlin's run{}
                res.close()
                t.close()
            }
            val times = LongArray(n)
            for (i in 0 until n) {
                buf.rewind()
                val t = OnnxTensor.createTensor(env, buf, shape)
                val t0 = System.nanoTime()
                val res: OrtSession.Result = s.run(mapOf(inName to t))
                times[i] = System.nanoTime() - t0
                res.close()
                t.close()
            }
            times.sort()
            return "mean %.0fms median %.0fms".format(times.average() / 1e6, times[n / 2] / 1e6)
        } catch (e: Throwable) {
            return "FAILED: ${e.message}"
        } finally {
            session?.close()
        }
    }

    @Test
    fun embedLatency() {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        val base = File(ctx.getExternalFilesDir(null), "recog-embed")
        base.mkdirs()
        val models: List<File> = base.listFiles { f -> f.name.endsWith(".onnx") }?.sortedBy { it.name } ?: emptyList()
        assertTrue("push at least one *.onnx into ${base.absolutePath} first", models.isNotEmpty())

        val env = OrtEnvironment.getEnvironment()
        val out = JSONObject().put("res", "${w}x${h}").put("runs", n)
        val results = JSONObject()
        out.put("results", results)
        val outFile = File(base, "embed-latency.json")

        for (model in models) {
            val r = bench(env, model)
            Log.i("RecogEmbedLatency", "${model.name}: $r")
            results.put(model.name, r)
            outFile.writeText(out.toString(2))   // incremental: survives a slow/killed later model
        }
        Log.i("RecogEmbedLatency", "done -> ${outFile.absolutePath}")
    }
}
