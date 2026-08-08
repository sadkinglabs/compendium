package com.sadkinglabs.compendium.scanner.visual

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.RandomAccessFile

/**
 * The correction store decides what the scanner has learned, so a silent failure here is a scanner that
 * quietly forgets - or worse, one that reinterprets old vectors in a new embedding space. These cover the
 * cases that matter: round-trip, wrong artifacts, torn writes, corruption, bad vectors and the cap.
 */
class CorrectionStoreTest {

    @get:Rule val tmp = TemporaryFolder()

    private val dim = 4
    private val artifact = "v1|modelsha|indexsha"
    private fun store(max: Long = 700_000L) = CorrectionStore(tmp.newFile().also { it.delete() }, dim, max)
    private fun vec(vararg v: Float) = floatArrayOf(*v)

    @Test
    fun `round trips what it wrote`() {
        val f = tmp.newFile().also { it.delete() }
        val s = CorrectionStore(f, dim)
        assertTrue(s.append(artifact, "simple_village", "Simple Village", vec(1f, 2f, 3f, 4f)))
        assertTrue(s.append(artifact, "vast_desert", "Vast Desert", vec(-1f, 0f, 0.5f, 9f)))

        val back = CorrectionStore(f, dim).load(artifact)
        assertEquals(2, back.size)
        assertEquals("simple_village", back[0].cardId)
        assertEquals("Simple Village", back[0].displayName)
        assertEquals(4f, back[0].embedding[3], 0f)
        assertEquals("vast_desert", back[1].cardId)
    }

    @Test
    fun `empty when the store does not exist`() {
        assertTrue(store().load(artifact).isEmpty())
    }

    @Test
    fun `a different artifact set resets the store`() {
        val f = tmp.newFile().also { it.delete() }
        CorrectionStore(f, dim).append(artifact, "a", "A", vec(1f, 1f, 1f, 1f))
        // The model or index was regenerated: old vectors describe a space that no longer exists.
        val loaded = CorrectionStore(f, dim).load("v1|DIFFERENT|indexsha")
        assertTrue(loaded.isEmpty())
        assertFalse("stale store should be removed, not left to confuse a later load", f.exists())
    }

    @Test
    fun `a torn tail keeps the records before it`() {
        val f = tmp.newFile().also { it.delete() }
        val s = CorrectionStore(f, dim)
        s.append(artifact, "a", "A", vec(1f, 1f, 1f, 1f))
        s.append(artifact, "b", "B", vec(2f, 2f, 2f, 2f))
        val full = f.length()
        // Simulate the process dying mid-append: chop the final record in half.
        RandomAccessFile(f, "rw").use { it.setLength(full - 12) }

        val back = CorrectionStore(f, dim).load(artifact)
        assertEquals("the intact first record must survive", 1, back.size)
        assertEquals("a", back[0].cardId)
        assertTrue("the torn tail should have been truncated away", f.length() < full - 11)
    }

    @Test
    fun `a corrupt record stops the read without losing the prefix`() {
        val f = tmp.newFile().also { it.delete() }
        val s = CorrectionStore(f, dim)
        s.append(artifact, "a", "A", vec(1f, 1f, 1f, 1f))
        s.append(artifact, "b", "B", vec(2f, 2f, 2f, 2f))
        // Flip a byte inside the SECOND record's payload so its checksum no longer matches.
        RandomAccessFile(f, "rw").use { raf ->
            val pos = f.length() - 8
            raf.seek(pos)
            val b = raf.readByte()
            raf.seek(pos)
            raf.writeByte(b.toInt() xor 0xFF)
        }
        val back = CorrectionStore(f, dim).load(artifact)
        assertEquals(1, back.size)
        assertEquals("a", back[0].cardId)
    }

    @Test
    fun `a damaged header discards the store rather than misreading it`() {
        val f = tmp.newFile().also { it.delete() }
        CorrectionStore(f, dim).append(artifact, "a", "A", vec(1f, 1f, 1f, 1f))
        RandomAccessFile(f, "rw").use { it.seek(0); it.writeInt(0xDEADBEEF.toInt()) }
        assertTrue(CorrectionStore(f, dim).load(artifact).isEmpty())
    }

    @Test
    fun `refuses vectors that are the wrong size or not finite`() {
        val f = tmp.newFile().also { it.delete() }
        val s = CorrectionStore(f, dim)
        assertFalse(s.append(artifact, "a", "A", vec(1f, 2f)))                       // wrong dimension
        assertFalse(s.append(artifact, "b", "B", vec(1f, Float.NaN, 3f, 4f)))         // NaN
        assertFalse(s.append(artifact, "c", "C", vec(1f, Float.POSITIVE_INFINITY, 3f, 4f)))
        assertTrue(CorrectionStore(f, dim).load(artifact).isEmpty())
    }

    @Test
    fun `stops appending once the cap is reached`() {
        val f = tmp.newFile().also { it.delete() }
        val s = CorrectionStore(f, dim, maxBytes = 120L)
        var written = 0
        repeat(50) { i -> if (s.append(artifact, "c$i", "C$i", vec(1f, 1f, 1f, 1f))) written++ }
        assertTrue("the cap must stop growth", written in 1 until 50)
        // Everything written before the cap is still readable.
        assertEquals(written, CorrectionStore(f, dim).load(artifact).size)
    }
}
