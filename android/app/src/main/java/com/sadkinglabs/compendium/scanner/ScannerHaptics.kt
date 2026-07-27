package com.sadkinglabs.compendium.scanner

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Native haptics for the scanner. A light [tick] signals the scanner has ENGAGED a card
 *  (recognising), then [culminate] is a GROWING pulse that builds to a firm finish on final
 *  recognition - the "it felt like an achievement" climax from 1.0.2. */
object ScannerHaptics {

    /** A light, brief tick - the scanner has engaged a candidate and is reading it. */
    fun tick(context: Context) {
        val v = vibrator(context) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createOneShot(14, 70))
        } else {
            legacy(v, 14)
        }
    }

    /** The recognition climax: amplitude ramps from soft to strong and lands on a firm, sustained
     *  finish, so it reads as a build culminating in an achievement (not a flat single tick). */
    fun culminate(context: Context) {
        val v = vibrator(context) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Ramps quickly then lands on a firm ~140ms finish so the peak coincides with the gold
            // bloom (~150-230ms into the reveal), not after it.
            val timings = longArrayOf(0, 30, 30, 30, 140)
            val amps = intArrayOf(0, 90, 160, 220, 255)
            v.vibrate(VibrationEffect.createWaveform(timings, amps, -1))
        } else {
            legacy(v, 320)
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
