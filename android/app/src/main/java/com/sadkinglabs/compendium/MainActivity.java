package com.sadkinglabs.compendium;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.sadkinglabs.compendium.scanner.CardScannerPlugin;
import com.sadkinglabs.compendium.telemetry.TelemetryPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-module plugins are not auto-discovered by `npx cap sync`; register them
        // before the bridge initializes. Forgetting a line here still COMPILES and
        // still ships - the only symptom is "plugin not implemented" at runtime.
        registerPlugin(CardScannerPlugin.class);
        registerPlugin(TelemetryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
