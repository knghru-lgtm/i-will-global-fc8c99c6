package com.iwillglobal.crm;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * Main Capacitor BridgeActivity for IWG CRM & Sarah (480-331-9455).
 * Requests runtime call-answering permissions, enforces Doze battery optimization exemption
 * (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS), starts SarahCallBridgeService as a persistent
 * Foreground Service, and bridges native call events into the WebView.
 */
public class MainActivity extends BridgeActivity {
    private static final int REQ_SARAH_PERMISSIONS = 9455;
    private static WeakReference<MainActivity> activeInstance = new WeakReference<>(null);

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = new WeakReference<>(this);

        requestRequiredCallPermissions();
        verifyBatteryOptimizationExemption();
        startSarahForegroundBridge();

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.addJavascriptInterface(new SarahJsBridge(getApplicationContext()), "SarahAndroidBridge");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        activeInstance = new WeakReference<>(this);
        startSarahForegroundBridge();
    }

    private void requestRequiredCallPermissions() {
        List<String> needed = new ArrayList<>();
        needed.add(Manifest.permission.READ_PHONE_STATE);
        needed.add(Manifest.permission.RECORD_AUDIO);
        needed.add(Manifest.permission.CALL_PHONE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            needed.add(Manifest.permission.ANSWER_PHONE_CALLS);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS);
        }

        List<String> missing = new ArrayList<>();
        for (String perm : needed) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                missing.add(perm);
            }
        }
        if (!missing.isEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), REQ_SARAH_PERMISSIONS);
        }
    }

    /**
     * Programmatically verifies exemption from Android Doze / Battery Optimization
     * and launches ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS if not yet exempted.
     */
    @SuppressLint("BatteryLife")
    private void verifyBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            String pkg = getPackageName();
            if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + pkg));
                    startActivity(intent);
                } catch (Exception ignored) {}
            }
        }
    }

    private void startSarahForegroundBridge() {
        try {
            Intent serviceIntent = new Intent(this, SarahCallBridgeService.class);
            ContextCompat.startForegroundService(this, serviceIntent);
        } catch (Exception ignored) {}
    }

    public static void notifyIncomingCallAnswered(String callerPhone, boolean isBusinessHours, String greetingText) {
        MainActivity activity = activeInstance.get();
        if (activity == null || activity.getBridge() == null) return;
        WebView webView = activity.getBridge().getWebView();
        if (webView == null) return;

        final String safePhone = callerPhone != null ? callerPhone.replace("'", "\\'") : "";
        final String safeGreeting = greetingText != null ? greetingText.replace("'", "\\'") : "";
        final String js = "window.dispatchEvent(new CustomEvent('iwg-android-call-answered', { detail: {"
            + " callerPhone: '" + safePhone + "',"
            + " isBusinessHours: " + (isBusinessHours ? "true" : "false") + ","
            + " greeting: '" + safeGreeting + "'"
            + " } }));";

        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    public static class SarahJsBridge {
        private final Context appContext;

        SarahJsBridge(Context context) {
            this.appContext = context.getApplicationContext();
        }

        @JavascriptInterface
        public boolean acceptRingingCallNow() {
            return SarahCallBridgeService.acceptRingingCallImmediate(appContext);
        }

        @JavascriptInterface
        public boolean endActiveCall() {
            return SarahCallBridgeService.endActiveCall(appContext);
        }

        @JavascriptInterface
        public boolean isArizonaBusinessHours() {
            return ArizonaTimeRouter.isBusinessHoursNow();
        }

        @JavascriptInterface
        public String getAfterHoursGreeting() {
            return ArizonaTimeRouter.AFTER_HOURS_GREETING;
        }

        @JavascriptInterface
        public boolean isIgnoringBatteryOptimizations() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
                return pm != null && pm.isIgnoringBatteryOptimizations(appContext.getPackageName());
            }
            return true;
        }
    }
}
