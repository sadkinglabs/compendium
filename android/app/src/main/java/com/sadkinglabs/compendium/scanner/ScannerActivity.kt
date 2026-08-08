package com.sadkinglabs.compendium.scanner

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.getcapacitor.JSObject
import com.sadkinglabs.compendium.scanner.model.Recognition
import com.sadkinglabs.compendium.scanner.ui.CompendiumScannerTheme
import com.sadkinglabs.compendium.scanner.ui.ScannerScreen
import com.sadkinglabs.compendium.scanner.visual.VisualMatcher

/**
 * The full-screen scanner. A plain ComponentActivity hosting Compose; it requests the
 * CAMERA permission, renders [ScannerScreen], and reports outcomes back to the plugin
 * through [ScannerChannel] (add-actions stream; codex / cancelled / permission_denied
 * are terminal). Never touches the app DB - JS owns every write.
 */
class ScannerActivity : ComponentActivity() {

    private val vm: ScannerViewModel by viewModels()
    private var terminalSent = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Launched without a built matcher (process death / bad launch) - bail cleanly.
        if (ScannerChannel.matcher == null) {
            finish()
            return
        }

        // Snapshot once - the mode + motion preference are fixed for this scan session.
        val collectionMode = ScannerChannel.mode == "collection"
        val deckMode = ScannerChannel.mode == "deck"
        val reduceMotion = ScannerChannel.reduceMotion

        // Lazy visual-match loader: the Activity owns the AssetManager; the ViewModel invokes this ONCE,
        // off-thread, only if the user taps "Try visual match" - so the ~27MB model/index never load
        // during a normal OCR session.
        val appCtx = applicationContext
        var artifactId = "unversioned"      // set when the index loads; binds the correction store to it
        ScannerChannel.visualLoader = {
            val model = appCtx.assets.open("recog/dinov2_s448_int8.onnx").use { it.readBytes() }
            val index = appCtx.assets.open("recog/index.f16").use { it.readBytes() }
            val json = appCtx.assets.open("recog/index.json").use { it.readBytes() }.toString(Charsets.UTF_8)
            val obj = org.json.JSONObject(json)
            val idsArr = obj.getJSONArray("cardIds")
            val namesArr = obj.getJSONArray("displayNames")
            val ids = ArrayList<String>(idsArr.length())
            val names = ArrayList<String>(namesArr.length())
            for (i in 0 until idsArr.length()) { ids.add(idsArr.getString(i)); names.add(namesArr.getString(i)) }
            // The manifest describes the index; hold the index to it, so a mismatched pair fails loudly
            // instead of attaching valid vectors to the wrong card ids.
            val matcher = VisualMatcher.load(
                modelBytes = model,
                indexBytes = index,
                cardIds = ids,
                displayNames = names,
                expectDim = obj.optInt("dim", VisualMatcher.DIM),
                expectCount = obj.optInt("count", ids.size),
                expectIndexSha256 = obj.optString("sha256_f16").ifEmpty { null },
            )
            // Corrections are only meaningful in the embedding space that produced them, so the store is
            // keyed to the FORMAT, the MODEL and the INDEX together; changing any of the three resets the
            // learned history rather than reinterpreting old vectors in a new space.
            val modelSha = java.security.MessageDigest.getInstance("SHA-256").digest(model)
                .joinToString("") { "%02x".format(it) }
            artifactId = "v1|$modelSha|${obj.optString("sha256_f16").ifEmpty { "noindexsha" }}"
            correctionStore().load(artifactId).forEach {
                matcher.addUserPrototype(it.cardId, it.displayName, it.embedding)
            }
            matcher
        }
        ScannerChannel.userProtoSink = { id, name, emb ->
            val ok = correctionStore().append(artifactId, id, name, emb)
            android.util.Log.i("ScannerVisual", "persist correction $id -> $ok")
        }

        setContent {
            CompendiumScannerTheme {
                var granted by remember {
                    mutableStateOf(
                        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                            PackageManager.PERMISSION_GRANTED,
                    )
                }
                // On deny (incl. permanent), leave granted=false so PermissionPrompt shows
                // its rationale + Close, rather than dead-ending on a black screen; the
                // Activity reports 'cancelled' when the user closes it (onDestroy).
                val launcher = rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestPermission(),
                ) { ok -> granted = ok }
                LaunchedEffect(Unit) { if (!granted) launcher.launch(Manifest.permission.CAMERA) }

                val lockEvent by vm.lockEvent.collectAsStateWithLifecycle()
                // The climax: a pulse when an identity is confirmed (a pick or a QR lock).
                LaunchedEffect(lockEvent) {
                    if (lockEvent > 0) ScannerHaptics.culminate(this@ScannerActivity)
                }
                ScannerScreen(
                    granted = granted,
                    viewModel = vm,
                    collectionMode = collectionMode,
                    deckMode = deckMode,
                    reduceMotion = reduceMotion,
                    onSearchCodex = { rec -> onSearchCodex(rec) },
                    onAdd = { rec, action, set -> onAdd(rec, action, set) },
                    onSaveCollection = { rec, qty, set -> onSaveCollection(rec, qty, set) },
                    onAddToDeck = { rec, qty -> onAddToDeck(rec, qty) },
                    onSaveDeck = { rec -> onShareLink(rec, "deckUrl") },
                    onImportMatch = { rec -> onShareLink(rec, "matchUrl") },
                    onDismissSheet = { vm.onDismiss() },
                    onClose = { finish() },
                )
            }
        }
    }

    private fun onSearchCodex(rec: Recognition) {
        sendTerminal(
            JSObject().put("action", "codex").put("cardId", rec.cardId).put("name", rec.title),
        )
        finish()
    }

    private fun onAdd(rec: Recognition, action: String, set: String? = null) {
        // Emit the add to JS; the sheet stays up (sticky) so both actions can be used.
        // `set` carries the chosen printing for wishlist adds - a want names a collector item
        // under schema v11, and dropping the selection here would make the picker decorative.
        val js = JSObject().put("action", action).put("cardId", rec.cardId).put("name", rec.title)
        if (set != null) js.put("set", set)
        ScannerChannel.onEvent?.invoke(js)
    }

    /** Collection mode: emit +qty owned for the recognised card, onto the chosen
     *  printing (set code) when one was picked/auto-selected. The scanner stays open
     *  (the screen dismisses the sheet) so the build-your-collection loop keeps going. */
    private fun onSaveCollection(rec: Recognition, qty: Int, set: String?) {
        val js = JSObject().put("action", "collection").put("cardId", rec.cardId).put("name", rec.title).put("qty", qty)
        if (set != null) js.put("set", set)
        ScannerChannel.onEvent?.invoke(js)
    }

    /** Deck mode: emit +qty of the recognised card to the open deck (JS files it in
     *  its home zone, rarity-capped). Set is irrelevant to a deck (name-level). The
     *  sheet already capped qty at the remaining headroom; bump the live session
     *  count so re-scanning the same card offers the reduced remainder. */
    private fun onAddToDeck(rec: Recognition, qty: Int) {
        val id = rec.cardId ?: return
        ScannerChannel.deckCounts[id] = (ScannerChannel.deckCounts[id] ?: 0) + qty
        ScannerChannel.onEvent?.invoke(
            JSObject().put("action", "deck").put("cardId", id).put("name", rec.title).put("qty", qty),
        )
    }

    /** A shared deck / match QR: hand the url to JS (which decodes + imports) and exit. */
    private fun onShareLink(rec: Recognition, action: String) {
        sendTerminal(JSObject().put("action", action).put("url", rec.url))
        finish()
    }

    private fun sendTerminal(js: JSObject) {
        if (terminalSent) return
        terminalSent = true
        ScannerChannel.onTerminal?.invoke(js)
    }

    /** The tested correction-store codec (artifact binding, checksums, torn-tail repair, cap). */
    private fun correctionStore() =
        com.sadkinglabs.compendium.scanner.visual.CorrectionStore(
            java.io.File(applicationContext.filesDir, "recog-user-protos.dat"),
        )

    private companion object {
        const val USER_PROTO_MAGIC = 0x43524331          // "CRC1" - correction store, format 1
        const val USER_PROTO_MAX_BYTES = 700_000L        // ~400 corrections; bounded growth
    }
}
