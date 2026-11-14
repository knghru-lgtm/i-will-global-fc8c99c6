package com.iwillglobal.crm;

import android.app.Notification;
import android.app.PendingIntent;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import java.util.Locale;

/**
 * Intercepts incoming Google Voice (com.google.android.apps.googlevoice) and Android Telecom
 * call notifications on (480) 331-9455 and fires the "Answer" / "Accept" PendingIntent
 * immediately (<15ms) on the very first ring.
 */
public class SarahNotificationListenerService extends NotificationListenerService {
    private static final String TAG = "SarahNotifListener";
    private static final String GOOGLE_VOICE_PKG = "com.google.android.apps.googlevoice";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;
        String pkg = sbn.getPackageName() != null ? sbn.getPackageName() : "";
        Notification notification = sbn.getNotification();
        if (notification == null) return;

        boolean isCallCategory = Notification.CATEGORY_CALL.equals(notification.category);
        boolean isGoogleVoice = GOOGLE_VOICE_PKG.equalsIgnoreCase(pkg) || pkg.toLowerCase(Locale.US).contains("googlevoice");
        boolean isTelecom = pkg.contains("telecom") || pkg.contains("dialer") || pkg.contains("incallui");

        if (!isCallCategory && !isGoogleVoice && !isTelecom) {
            return;
        }

        Notification.Action[] actions = notification.actions;
        if (actions == null || actions.length == 0) {
            return;
        }

        Bundle extras = notification.extras;
        String title = extras != null ? String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE, "")) : "";
        String text = extras != null ? String.valueOf(extras.getCharSequence(Notification.EXTRA_TEXT, "")) : "";
        String combined = (title + " " + text).toLowerCase(Locale.US);

        for (Notification.Action action : actions) {
            if (action == null || action.title == null || action.actionIntent == null) continue;
            String label = action.title.toString().trim().toLowerCase(Locale.US);

            if (label.equals("answer") || label.equals("accept") || label.contains("answer call")) {
                // 1. ZERO-DELAY AUTO-ANSWER (<15ms): Execute PendingIntent immediately before any network/AI work
                try {
                    action.actionIntent.send();
                    Log.i(TAG, "Instant 1st-ring pickup via Google Voice Notification PendingIntent [" + pkg + "]");
                } catch (PendingIntent.CanceledException e) {
                    Log.w(TAG, "Notification answer PendingIntent was canceled", e);
                }

                // 2. Also invoke TelecomManager.acceptRingingCall() in case PSTN bridge is ringing simultaneously
                SarahCallBridgeService.acceptRingingCallImmediate(getApplicationContext());

                // 3. Fire parallel audio routing & Arizona business-hours / after-hours session
                String callerPhone = extractPhoneFromText(title + " " + text);
                SarahCallBridgeService.onCallAnsweredImmediately(
                    getApplicationContext(),
                    callerPhone,
                    isGoogleVoice ? "GoogleVoiceNotification" : "CallNotification:" + combined
                );
                return;
            }
        }
    }

    private String extractPhoneFromText(String raw) {
        if (raw == null) return "";
        String digits = raw.replaceAll("[^0-9+]", "");
        return digits.length() >= 10 ? digits : raw.trim();
    }
}

