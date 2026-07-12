package com.sadkinglabs.compendium.scanner

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Native haptics for the scanner: a light tick when a card is first detected, and a
 *  GROWING pulse (soft build to a firm finish) on lock, to accompany the reveal. */
object ScannerHaptics {

    fun tick(context: Context) {
        val v = vibrator(context) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createOneShot(18, 60))
        } else {
            legacy(v, 18)
        }
    }

    fun lockPulse(context: Context) {
        val v = vibrator(context) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // rising amplitude -> "a growing long pulse as we get there"
            val timings = longArrayOf(0, 40, 40, 40, 40, 40, 40, 40, 150)
            val amps = intArrayOf(0, 45, 75, 110, 145, 180, 215, 240, 255)
            v.vibrate(VibrationEffect.createWaveform(timings, amps, -1))
        } else {
            legacy(v, 300)
        }
    }

    @Suppress("DEPRECATION")
    private fun legacy(v: Vibrator, ms: Long) = v.vibrate(ms)

    private fun vibrator(context: Context): Vibrator? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    } catch (_: Throwable) {
        null
    }
}
