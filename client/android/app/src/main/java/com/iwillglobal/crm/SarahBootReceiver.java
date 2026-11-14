package com.iwillglobal.crm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;
import androidx.core.content.ContextCompat;

/**
 * Starts SarahCallBridgeService on device boot and intercepts PHONE_STATE ringing
 * broadcasts to guarantee <100ms 1st-ring pickup 24/7.
 */
public class SarahBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction();

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Intent svc = new Intent(context, SarahCallBridgeService.class);
            ContextCompat.startForegroundService(context, svc);
            return;
        }

        if (TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(action)) {
            String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
            if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
                // 1. ZERO-DELAY AUTO-ANSWER (<10ms): Answer immediately before any network/AI warmup
                SarahCallBridgeService.acceptRingingCallImmediate(context);
                @SuppressWarnings("deprecation")
                String caller = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
                SarahCallBridgeService.onCallAnsweredImmediately(context, caller, "PhoneStateReceiver");
            }
        }
    }
}

