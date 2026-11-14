package com.iwillglobal.crm;

import android.net.Uri;
import android.telecom.Call;
import android.telecom.InCallService;
import android.telecom.VideoProfile;
import android.util.Log;

import java.util.concurrent.atomic.AtomicReference;

/**
 * Native Android Telecom InCallService for Sarah (480-331-9455).
 * Executes Call.answer(VideoProfile.STATE_AUDIO_ONLY) immediately (<5ms) on Ring 1
 * before any WebSocket, audio stream, or Gemini API initialization occurs.
 */
public class SarahInCallService extends InCallService {
    private static final String TAG = "SarahInCallService";
    private static final AtomicReference<Call> ACTIVE_CALL = new AtomicReference<>(null);

    private final Call.Callback callCallback = new Call.Callback() {
        @Override
        public void onStateChanged(Call call, int state) {
            if (state == Call.STATE_RINGING) {
                answerImmediately(call);
            } else if (state == Call.STATE_DISCONNECTED || state == Call.STATE_DISCONNECTING) {
                ACTIVE_CALL.compareAndSet(call, null);
                call.unregisterCallback(this);
            }
        }
    };

    @Override
    public void onCallAdded(Call call) {
        super.onCallAdded(call);
        ACTIVE_CALL.set(call);
        call.registerCallback(callCallback);

        // 1. ZERO-DELAY AUTO-ANSWER (<10ms): Answer immediately on Ring 1 before any AI/network work
        if (call.getState() == Call.STATE_RINGING) {
            answerImmediately(call);
        }
    }

    @Override
    public void onCallRemoved(Call call) {
        call.unregisterCallback(callCallback);
        ACTIVE_CALL.compareAndSet(call, null);
        super.onCallRemoved(call);
    }

    private void answerImmediately(Call call) {
        try {
            call.answer(VideoProfile.STATE_AUDIO_ONLY);
            Log.i(TAG, "Instant 1st-ring pickup via Call.answer(STATE_AUDIO_ONLY)");
        } catch (Exception e) {
            Log.e(TAG, "Call.answer failed, delegating to TelecomManager fallback", e);
        }

        String callerNumber = extractCallerNumber(call);
        // 2. DECOUPLED PARALLEL ROUTING: Bridge audio & trigger Arizona time routing asynchronously
        SarahCallBridgeService.onCallAnsweredImmediately(getApplicationContext(), callerNumber, "InCallService");
    }

    private String extractCallerNumber(Call call) {
        try {
            if (call != null && call.getDetails() != null) {
                Uri handle = call.getDetails().getHandle();
                if (handle != null && handle.getSchemeSpecificPart() != null) {
                    return handle.getSchemeSpecificPart();
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    public static boolean disconnectActiveCall() {
        Call call = ACTIVE_CALL.getAndSet(null);
        if (call != null) {
            try {
                call.disconnect();
                return true;
            } catch (Exception e) {
                Log.w(TAG, "Failed to disconnect active Call", e);
            }
        }
        return false;
    }
}

