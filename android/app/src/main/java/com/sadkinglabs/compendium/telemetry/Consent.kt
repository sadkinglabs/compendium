package com.sadkinglabs.compendium.telemetry

/**
 * The telemetry consent machine. Pure logic over [TelemetrySdk] + [ConsentStore] so
 * that every failure path is testable without a device - see TelemetryMachineTest.
 *
 * WHY CONSENT IS DEVICE-GLOBAL AND NOT A `settings` ROW
 *
 * It is a property of THIS INSTALL ON THIS DEVICE, not of a profile - the reasoning
 * src/store/changelog.js records for the update stamp. In the per-profile `settings`
 * table it would cost a migration and buy two defects: telemetry would flip as you
 * switch profiles (incoherent - the Firebase app-instance id is per-device), and worse,
 * a profile EXPORTED FROM ANOTHER DEVICE would carry that device's consent decision to
 * this one. A privacy bug wearing a data-model costume.
 *
 * WHAT THE MANIFEST FLAGS DO AND DO NOT DO
 *
 * firebase_*_collection_enabled=false is the INITIAL DEFAULT, not a standing floor.
 * Measured: a virgin install with the flags set transmits 0 bytes over 3 minutes,
 * against 13,666 for build 37. But the moment setXCollectionEnabled runs, that override
 * persists and beats the manifest forever after. A granted-then-denied install whose
 * disable was interrupted would boot with a live `true` override and no manifest to
 * save it. That is why [reconcile] ASSERTS on every boot instead of trusting a default.
 *
 * THE TWO RULES THAT SHAPE EVERY ORDERING BELOW
 *
 *  1. Order each transition so an INTERRUPTION leaves the more private state.
 *  2. Never persist a decision the SDKs did not actually honour. A `denied` written
 *     while an SDK kept collecting is a privacy LIE; a transition that visibly failed
 *     is merely a failure. Failure is always the better of the two.
 */
object Consent {
    const val UNSET = "unset"

    /**
     * The user said yes, but the pre-consent cleanup is NOT YET PROVEN COMPLETE.
     * Crashlytics stays off in this state.
     *
     * This exists because deleteUnsentReports() is asynchronous and unobservable at the
     * point of request. An earlier design skipped this state and simply enabled
     * Crashlytics on the next boot, reasoning the deletion "had a whole process" to land.
     * That is elapsed time, not evidence: kill the process fast enough and the deletion
     * never happens, and the next boot enables collection over a pre-consent crash still
     * sitting on disk. `granting` converges by EVIDENCE instead - see [finishGranting].
     */
    const val GRANTING = "granting"
    const val GRANTED = "granted"
    const val DENIED = "denied"

    /** Anything unrecognised collapses to `unset`: a corrupt write degrades to "ask
     *  again, collect nothing" rather than to silent collection. Fail-safe is OFF. */
    fun normalise(raw: String?): String =
        if (raw == GRANTED || raw == DENIED || raw == GRANTING) raw else UNSET

    /** What the UI shows. `granting` reads as ON because the user DID consent and
     *  Analytics is already running - only the Crashlytics half is still settling, which
     *  the disclosure already describes as "takes full effect next time you open the app". */
    fun isOn(state: String): Boolean = state == GRANTED || state == GRANTING
}

/** What a transition did. `ok=false` means the caller must NOT report success. */
data class TelemetryResult(val consent: String, val ok: Boolean, val error: String? = null)

/**
 * EVERY PUBLIC METHOD IS @Synchronized, and that is a correctness requirement, not
 * tidiness. Without it, a double-tap on the Settings toggle runs grant() and deny()
 * concurrently: one persists `denied` while the other enables Analytics, leaving stored
 * consent and SDK state permanently disagreeing. The plugin additionally funnels every
 * call through a single-thread executor, so this is belt and braces - but the lock is
 * what makes the property testable without a device (see the concurrency test).
 */
class TelemetryMachine(private val sdk: TelemetrySdk, private val store: ConsentStore) {

    @Synchronized
    fun consent(): String = Consent.normalise(store.read())

    /**
     * Boot reconciliation. Asserts SDK state against recorded consent; never assumes,
     * because a persisted override outlives the manifest.
     *
     * `unset` and `denied` also delete: that is what clears what build 37's
     * provider-initialised Crashlytics left on disk when a tester upgrades, and what
     * retries a deletion a crash cut short.
     *
     * Reconciliation is best-effort by nature - it cannot refuse to boot - but it must
     * REPORT rather than pretend, so a failure is visible instead of silently leaving
     * the SDKs disagreeing with Settings.
     */
    @Synchronized
    fun reconcile(): TelemetryResult {
        val c = consent()
        if (!sdk.isAvailable()) return TelemetryResult(c, ok = true)   // no Firebase: already fail-closed
        return when (c) {
            Consent.GRANTED -> {
                val ok = sdk.setAnalyticsEnabled(true) and sdk.setCrashlyticsEnabled(true)
                TelemetryResult(c, ok, if (ok) null else "One or more telemetry SDK calls failed")
            }
            Consent.GRANTING -> finishGranting()
            else -> {
                // `and`, not `&&`: both must be ATTEMPTED. Short-circuiting would leave
                // the second SDK collecting because the first one failed.
                val a = sdk.setAnalyticsEnabled(false)
                val b = sdk.setCrashlyticsEnabled(false)
                val d = sdk.deleteUnsentReports()
                val ok = a and b and d
                TelemetryResult(c, ok, if (ok) null else "One or more telemetry SDK calls failed")
            }
        }
    }

    /**
     * `granting` -> `granted`, but ONLY on evidence.
     *
     * Crashlytics collection stays off for the whole of this. That is not incidental:
     * checkForUnsentReports() only reports while collection is disabled, so the state
     * that makes the question answerable is the same one that makes it safe to ask.
     *
     *   reports remain  -> ask again for deletion, stay `granting`, retry next boot
     *   none remain     -> NOW persist granted and enable Crashlytics
     *   cannot tell     -> stay `granting`. Not knowing is not the same as knowing there
     *                      are none, and only one of those is safe to act on.
     *
     * This converges: each boot either proves the queue empty or re-requests the delete.
     * A pre-consent crash therefore cannot be uploaded by the act of consenting, no
     * matter where the process died.
     */
    private fun finishGranting(): TelemetryResult {
        sdk.setCrashlyticsEnabled(false)   // assert: the check below is only valid while off
        return when (sdk.hasUnsentReports()) {
            false -> {
                if (!store.write(Consent.GRANTED)) {
                    return TelemetryResult(Consent.GRANTING, ok = false, error = "Could not save your choice")
                }
                val ok = sdk.setAnalyticsEnabled(true) and sdk.setCrashlyticsEnabled(true)
                TelemetryResult(Consent.GRANTED, ok, if (ok) null else "Diagnostics did not fully start")
            }
            else -> {   // true (reports remain) or null (cannot tell) - both mean "not yet"
                sdk.deleteUnsentReports()
                TelemetryResult(Consent.GRANTING, ok = true)
            }
        }
    }

    /**
     * -> granting (NOT granted).
     *
     *   1. persist granting        durable, BEFORE anything is requested
     *   2. request deletion        async, unobservable - this is why we cannot finish here
     *   3. resetAnalyticsData()
     *   4. enable ANALYTICS ONLY
     *
     * CRASHLYTICS IS NOT ENABLED HERE AND `granted` IS NOT PERSISTED HERE. Step 2 gives
     * no completion signal, so this run cannot know the queue is clear. [finishGranting]
     * proves it on a later boot via checkForUnsentReports() and only then completes the
     * transition. The cost is crash coverage for the session in which you consent, which
     * the disclosure already describes: "takes full effect next time you open the app".
     *
     * Persisting `granting` FIRST is what makes an interruption safe: die anywhere after
     * step 1 and the next boot resumes the cleanup rather than forgetting a decision was
     * ever made. Die before it and nothing changed at all.
     */
    @Synchronized
    fun grant(): TelemetryResult {
        if (!sdk.isAvailable()) {
            // No Firebase to enable. Recording consent would claim a state that does
            // not exist; leave it and say so.
            return TelemetryResult(consent(), ok = false, error = "Diagnostics are unavailable on this build")
        }
        if (!store.write(Consent.GRANTING)) {
            return TelemetryResult(consent(), ok = false, error = "Could not save your choice")
        }
        if (!sdk.deleteUnsentReports()) {
            // Stay `granting`: the decision stands and the next boot retries the cleanup.
            return TelemetryResult(Consent.GRANTING, ok = false, error = "Could not clear reports gathered before you chose")
        }
        sdk.resetAnalyticsData()   // best effort: a stale app-instance id is not a correctness failure
        val ok = sdk.setAnalyticsEnabled(true)
        return TelemetryResult(Consent.GRANTING, ok, if (ok) null else "Saved, but Analytics did not start")
    }

    /**
     * -> denied.
     *
     *   1. disable BOTH            the overrides are written BEFORE the decision persists,
     *                              so the next process starts disabled and cleanup cannot
     *                              race an enabled provider
     *   2. persist denied          ONLY IF step 1 actually succeeded
     *   3. delete + reset          best effort; reconcile() retries on every boot
     *
     * If disabling fails we do NOT persist `denied`. The caller keeps showing ON, which
     * is true: the attempted change failed. Persisting anyway would show OFF while an
     * SDK kept a live override - rule 2 above, and the defect this ordering was rewritten
     * to remove.
     */
    @Synchronized
    fun deny(): TelemetryResult {
        if (!sdk.isAvailable()) {
            // Nothing is collecting and nothing can. Recording the refusal is honest and
            // makes the state durable for a future build that does have Firebase.
            return TelemetryResult(if (store.write(Consent.DENIED)) Consent.DENIED else consent(), ok = true)
        }
        val a = sdk.setAnalyticsEnabled(false)
        val b = sdk.setCrashlyticsEnabled(false)
        if (!(a and b)) {
            return TelemetryResult(consent(), ok = false, error = "Could not turn diagnostics off")
        }
        if (!store.write(Consent.DENIED)) {
            return TelemetryResult(consent(), ok = false, error = "Could not save your choice")
        }
        sdk.deleteUnsentReports()   // best effort - reconcile() retries every boot
        sdk.resetAnalyticsData()
        return TelemetryResult(Consent.DENIED, ok = true)
    }
}
