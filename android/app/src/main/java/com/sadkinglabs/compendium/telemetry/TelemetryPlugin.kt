package com.sadkinglabs.compendium.telemetry

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.util.concurrent.Executors

/**
 * The bridge. All logic lives in [TelemetryMachine] so it can be unit-tested against a
 * fake SDK - this class only translates between Capacitor and that machine, and should
 * stay thin enough that there is nothing here worth testing.
 *
 * A failed transition REJECTS. It does not resolve with the old state and a shrug: the
 * JS side renders whatever it is told, so resolving a failure as success is precisely
 * how Settings ends up showing "off" while an SDK is still collecting.
 */
@CapacitorPlugin(name = "Telemetry")
class TelemetryPlugin : Plugin() {

    private val machine by lazy {
        TelemetryMachine(
            FirebaseTelemetrySdk(context.applicationContext),
            PrefsConsentStore(context.applicationContext),
        )
    }

    @PluginMethod
    fun getConsent(call: PluginCall) {
        call.resolve(JSObject().put("consent", machine.consent()))
    }

    @PluginMethod
    fun reconcile(call: PluginCall) = async(call) { machine.reconcile() }

    @PluginMethod
    fun grant(call: PluginCall) = async(call) { machine.grant() }

    @PluginMethod
    fun deny(call: PluginCall) = async(call) { machine.deny() }

    /**
     * ONE thread, for the life of the plugin. Not a `Thread {}` per call.
     *
     * Per-call threads let a double-tap on the Settings toggle run grant() and deny()
     * concurrently, and the two then interleave: one persists `denied` while the other
     * enables Analytics, and stored consent disagrees with SDK state permanently. A
     * single-thread executor makes the transitions a queue instead of a race, so a fast
     * double-tap becomes "off, then on" - which is what the user actually did.
     *
     * It is also why these must not run on the WebView thread: they commit() to disk and
     * block on a Firebase Task, and reconcile() sits on the boot path of an offline-first
     * app. Nothing here may ever hold up first paint.
     *
     * TelemetryMachine is @Synchronized too. Belt and braces, deliberately: the lock is
     * what makes the property provable in a unit test, the executor is what orders it.
     */
    private val transitions = Executors.newSingleThreadExecutor { r -> Thread(r, "cx-telemetry") }

    private fun async(call: PluginCall, work: () -> TelemetryResult) {
        transitions.execute {
            val r = try {
                work()
            } catch (t: Throwable) {
                TelemetryResult(machine.consent(), ok = false, error = t.message ?: "Telemetry operation failed")
            }
            if (r.ok) call.resolve(JSObject().put("consent", r.consent))
            else call.reject(r.error ?: "Telemetry operation failed", "telemetry_failed")
        }
    }
}
