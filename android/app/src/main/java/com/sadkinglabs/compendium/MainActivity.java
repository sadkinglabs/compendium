package com.sadkinglabs.compendium;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.sadkinglabs.compendium.scanner.CardScannerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-module plugins are not auto-discovered by `npx cap sync`; register the
        // native card scanner before the bridge initializes.
        registerPlugin(CardScannerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
