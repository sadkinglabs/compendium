package com.sadkinglabs.compendium.scanner.visual

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The prototype index ships as fp16, so every recognition score depends on this conversion being exact.
 * A previous hand-rolled implementation mis-decoded subnormals (0x0001 -> 0.015625 instead of 2^-24),
 * corrupting 577 of the shipped index's 1,145 subnormal components and quietly perturbing candidate
 * ordering. These are known-value checks across every class of half: zero, subnormal, normal, the
 * boundaries, infinities and NaN.
 */
class HalfToFloatTest {

    private fun half(h: Int) = VisualMatcher.halfToFloat(h)

    @Test
    fun zeroes() {
        assertEquals(0f, half(0x0000), 0f)
        assertEquals(0f, half(0x8000), 0f)                      // -0
        assertTrue(1f / half(0x8000) < 0f)                      // ...and it really is negative zero
    }

    @Test
    fun subnormals() {
        // The regression that motivated this test: the smallest positive half is 2^-24, not 0.015625.
        assertEquals(5.9604645E-8f, half(0x0001), 0f)
        assertEquals(-5.9604645E-8f, half(0x8001), 0f)
        assertEquals(1.1920929E-7f, half(0x0002), 0f)           // 2 * 2^-24
        // Largest subnormal: 1023 * 2^-24
        assertEquals(6.0975552E-5f, half(0x03FF), 1e-11f)
    }

    @Test
    fun normalsAndBoundary() {
        assertEquals(1f, half(0x3C00), 0f)
        assertEquals(-2f, half(0xC000), 0f)
        assertEquals(0.5f, half(0x3800), 0f)
        assertEquals(65504f, half(0x7BFF), 0f)                  // largest finite half
        // Smallest NORMAL half, 2^-14 - the boundary the old implementation straddled incorrectly.
        assertEquals(6.1035156E-5f, half(0x0400), 0f)
    }

    @Test
    fun infinitiesAndNaN() {
        assertEquals(Float.POSITIVE_INFINITY, half(0x7C00), 0f)
        assertEquals(Float.NEGATIVE_INFINITY, half(0xFC00), 0f)
        assertTrue(half(0x7E00).isNaN())
    }

    /** Exhaustive cross-check against the JDK's own conversion over all 65,536 halfs. */
    @Test
    fun matchesReferenceForEveryPossibleHalf() {
        for (h in 0..0xFFFF) {
            val expected = jdkHalfToFloat(h)
            val actual = half(h)
            if (expected.isNaN()) {
                assertTrue("0x%04X should be NaN".format(h), actual.isNaN())
            } else {
                assertEquals("0x%04X".format(h), expected, actual, 0f)
            }
        }
    }

    /** Reference conversion, written independently of the implementation under test. */
    private fun jdkHalfToFloat(h: Int): Float {
        val s = if (h and 0x8000 != 0) -1.0 else 1.0
        val e = (h shr 10) and 0x1F
        val m = h and 0x3FF
        return when (e) {
            0 -> (s * m * Math.pow(2.0, -24.0)).toFloat()
            31 -> if (m == 0) (s * Double.POSITIVE_INFINITY).toFloat() else Float.NaN
            else -> (s * Math.pow(2.0, (e - 15).toDouble()) * (1.0 + m / 1024.0)).toFloat()
        }
    }
}
