package com.sadkinglabs.compendium.scanner.visual

import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/**
 * The on-device correction store: user-confirmed embeddings that harden recognition across sessions.
 *
 * It holds VECTORS, never photographs. Three properties matter and each is enforced here rather than
 * assumed:
 *
 *  - **Artifact binding.** A header records the format version + model + index the corrections were learned
 *    against. An embedding is meaningless outside the space that produced it, so a different artifact set
 *    resets the store instead of reinterpreting old vectors.
 *  - **Torn-write repair.** Each record is length-prefixed and checksummed. A process killed mid-append
 *    truncates to the last verified record rather than poisoning the index or discarding all history.
 *  - **Bounded growth.** Appends stop at [maxBytes].
 *
 * Pure file I/O with no Android dependencies, so it is unit-testable.
 */
class CorrectionStore(
    private val file: File,
    private val dim: Int = VisualMatcher.DIM,
    private val maxBytes: Long = 700_000L,
) {
    data class Entry(val cardId: String, val displayName: String, val embedding: FloatArray)

    /**
     * Read every intact record. Returns empty when the store is absent, was written against different
     * artifacts, or its header is damaged. Any trailing damage is truncated so the good prefix survives.
     */
    fun load(artifactId: String): List<Entry> {
        if (!file.exists() || file.length() == 0L) return emptyList()
        val out = ArrayList<Entry>()
        var good = -1L
        var unusable = false          // decided inside, acted on AFTER the handle is closed
        try {
            RandomAccessFile(file, "r").use { raf ->
                if (raf.length() < 4 || raf.readInt() != MAGIC) { unusable = true; return@use }
                val storedId = try { raf.readUTF() } catch (_: Throwable) { unusable = true; return@use }
                if (storedId != artifactId) { unusable = true; return@use }   // learned in a different space
                good = raf.filePointer
                while (raf.filePointer < raf.length()) {
                    if (raf.length() - raf.filePointer < 4) break
                    val len = raf.readInt()
                    if (len <= 0 || len > MAX_RECORD || raf.filePointer + len + 4 > raf.length()) break
                    val rec = ByteArray(len)
                    raf.readFully(rec)
                    if (raf.readInt() != checksum(rec)) break      // corrupt record: stop, keep the prefix
                    val entry = decode(rec) ?: break
                    out.add(entry)
                    good = raf.filePointer
                }
            }
        } catch (_: Throwable) {
            // fall through: keep whatever was verified, truncate the rest
        }
        // Deleting or truncating happens only once the read handle is closed - an open file cannot be
        // removed on every platform, so doing it inside the block would silently leave a stale store.
        if (unusable) return discard()
        truncateTo(good)
        return out
    }

    /** Append one correction. Writes the header on first use. Refuses malformed vectors and over-cap files. */
    fun append(artifactId: String, cardId: String, displayName: String, embedding: FloatArray): Boolean {
        if (embedding.size != dim || embedding.any { !it.isFinite() }) return false
        if (file.exists() && file.length() > maxBytes) return false
        return try {
            val body = ByteArrayOutputStream().also { bos ->
                DataOutputStream(bos).use { d ->
                    d.writeUTF(cardId); d.writeUTF(displayName)
                    for (v in embedding) d.writeFloat(v)
                }
            }.toByteArray()
            val fresh = !file.exists() || file.length() == 0L
            DataOutputStream(FileOutputStream(file, true).buffered()).use { dout ->
                if (fresh) { dout.writeInt(MAGIC); dout.writeUTF(artifactId) }
                dout.writeInt(body.size)
                dout.write(body)
                dout.writeInt(checksum(body))
            }
            true
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Replace the whole store with [entries] - used when a correction REPLACES an earlier one, which an
     * append-only log cannot express. Written to a temp file and renamed, so an interrupted rewrite leaves
     * the previous store intact rather than a half-written one.
     */
    fun rewrite(artifactId: String, entries: List<Entry>): Boolean {
        val tmp = File(file.parentFile, file.name + ".tmp")
        return try {
            tmp.delete()
            var wroteHeader = false
            DataOutputStream(FileOutputStream(tmp).buffered()).use { dout ->
                dout.writeInt(MAGIC); dout.writeUTF(artifactId); wroteHeader = true
                for (e in entries) {
                    if (e.embedding.size != dim || e.embedding.any { !it.isFinite() }) continue
                    val body = ByteArrayOutputStream().also { bos ->
                        DataOutputStream(bos).use { d ->
                            d.writeUTF(e.cardId); d.writeUTF(e.displayName)
                            for (v in e.embedding) d.writeFloat(v)
                        }
                    }.toByteArray()
                    dout.writeInt(body.size); dout.write(body); dout.writeInt(checksum(body))
                }
            }
            wroteHeader && run {
                file.delete()                      // rename onto an existing file fails on some platforms
                tmp.renameTo(file)
            }
        } catch (_: Throwable) {
            tmp.delete()
            false
        }
    }

    private fun decode(rec: ByteArray): Entry? = try {
        DataInputStream(rec.inputStream()).use { din ->
            val id = din.readUTF()
            val name = din.readUTF()
            val emb = FloatArray(dim) { din.readFloat() }
            if (emb.all { it.isFinite() }) Entry(id, name, emb) else null
        }
    } catch (_: Throwable) {
        null
    }

    private fun discard(): List<Entry> {
        runCatching { file.delete() }
        return emptyList()
    }

    private fun truncateTo(good: Long) {
        runCatching {
            if (good > 0 && file.exists() && good < file.length()) {
                RandomAccessFile(file, "rw").use { it.setLength(good) }
            }
        }
    }

    private companion object {
        const val MAGIC = 0x43524331          // "CRC1" - correction store, format 1
        const val MAX_RECORD = 1 shl 16       // a record is id + name + dim floats; far under this
        fun checksum(b: ByteArray): Int = b.fold(17) { a, x -> a * 31 + x }
    }
}
