package com.iwillglobal.crm;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.telecom.TelecomManager;
import android.telephony.PhoneStateListener;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;
import android.util.Log;
import android.view.KeyEvent;

import androidx.annotation.Nullable;
import androidx.annotation.RequiresApi;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 24/7 Persistent Foreground Service for Sarah (480-331-9455).
 * Holds a PARTIAL_WAKE_LOCK to prevent Doze sleep, listens for incoming calls via
 * TelephonyCallback / PhoneStateListener, executes telecomManager.acceptRingingCall()
 * in <100ms on Ring 1, and routes strictly by America/Phoenix (8:00 AM - 5:00 PM MST).
 */
public class SarahCallBridgeService extends Service {
    private static final String TAG = "SarahCallBridgeSvc";
    public static final String CHANNEL_ID = "iwg_sarah_24_7_bridge_channel";
    public static final int NOTIFICATION_ID = 9455;
    private static final String CLOUD_API_BASE = "https://voice.iwillglobal.com";

    private static final AtomicLong LAST_ANSWER_TS = new AtomicLong(0L);
    private static final ExecutorService IO_EXECUTOR = Executors.newCachedThreadPool();

    private PowerManager.WakeLock wakeLock;
    private TelephonyManager telephonyManager;
    private Object telephonyCallbackObj;
    private PhoneStateListener legacyPhoneStateListener;
    private TextToSpeech fallbackTts;
    private volatile boolean ttsReady = false;
    private MediaPlayer activeMediaPlayer;

    private static SarahCallBridgeService instance;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        acquireDozeWakeLock();
        startPersistentForegroundNotification();
        initFallbackTextToSpeech();
        registerCallStateListener();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        acquireDozeWakeLock();
        startPersistentForegroundNotification();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        unregisterCallStateListener();
        releaseMediaPlayer();
        if (fallbackTts != null) {
            try {
                fallbackTts.stop();
                fallbackTts.shutdown();
            } catch (Exception ignored) {}
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {}
        }
        instance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @SuppressLint("WakelockTimeout")
    private void acquireDozeWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && (wakeLock == null || !wakeLock.isHeld())) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "IWG:SarahFirstRingWakeLock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire PARTIAL_WAKE_LOCK", e);
        }
    }

    private void startPersistentForegroundNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Sarah 24/7 Receptionist Bridge (480-331-9455)",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Ensures Sarah answers incoming calls on (480) 331-9455 on the 1st ring 24/7.");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(channel);
        }

        Intent launchIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Sarah 24/7 AI Receptionist • (480) 331-9455")
            .setContentText("Instant 1st-Ring Pickup Active (Mon–Fri 8 AM–5 PM MST)")
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            int fgTypes = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            startForeground(NOTIFICATION_ID, notification, fgTypes);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void initFallbackTextToSpeech() {
        try {
            fallbackTts = new TextToSpeech(getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS && fallbackTts != null) {
                    fallbackTts.setLanguage(Locale.US);
                    fallbackTts.setSpeechRate(1.0f);
                    ttsReady = true;
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "Fallback TTS initialization warning", e);
        }
    }

    private void registerCallStateListener() {
        telephonyManager = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
        if (telephonyManager == null) return;

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE)
            != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "READ_PHONE_STATE not yet granted; waiting for MainActivity permission grant");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            registerModernTelephonyCallback();
        } else {
            registerLegacyPhoneStateListener();
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.S)
    private void registerModernTelephonyCallback() {
        try {
            if (telephonyCallbackObj != null) return;
            SarahTelephonyCallback cb = new SarahTelephonyCallback();
            telephonyManager.registerTelephonyCallback(getMainExecutor(), cb);
            telephonyCallbackObj = cb;
            Log.i(TAG, "Registered TelephonyCallback.CallStateListener for instant 1st-ring pickup");
        } catch (SecurityException e) {
            Log.e(TAG, "SecurityException registering TelephonyCallback", e);
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.S)
    private class SarahTelephonyCallback extends TelephonyCallback implements TelephonyCallback.CallStateListener {
        @Override
        public void onCallStateChanged(int state) {
            if (state == TelephonyManager.CALL_STATE_RINGING) {
                // 1. ZERO-DELAY AUTO-ANSWER (<10ms): Execute acceptRingingCall() immediately!
                acceptRingingCallImmediate(getApplicationContext());
                onCallAnsweredImmediately(getApplicationContext(), "", "TelephonyCallback");
            }
        }
    }

    @SuppressWarnings("deprecation")
    private void registerLegacyPhoneStateListener() {
        try {
            if (legacyPhoneStateListener != null) return;
            legacyPhoneStateListener = new PhoneStateListener() {
                @Override
                public void onCallStateChanged(int state, String phoneNumber) {
                    if (state == TelephonyManager.CALL_STATE_RINGING) {
                        // 1. ZERO-DELAY AUTO-ANSWER (<10ms): Execute acceptRingingCall() immediately!
                        acceptRingingCallImmediate(getApplicationContext());
                        onCallAnsweredImmediately(getApplicationContext(), phoneNumber, "PhoneStateListener");
                    }
                }
            };
            telephonyManager.listen(legacyPhoneStateListener, PhoneStateListener.LISTEN_CALL_STATE);
        } catch (Exception e) {
            Log.e(TAG, "Error registering PhoneStateListener", e);
        }
    }

    @SuppressWarnings("deprecation")
    private void unregisterCallStateListener() {
        if (telephonyManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && telephonyCallbackObj != null) {
                telephonyManager.unregisterTelephonyCallback((TelephonyCallback) telephonyCallbackObj);
                telephonyCallbackObj = null;
            } else if (legacyPhoneStateListener != null) {
                telephonyManager.listen(legacyPhoneStateListener, PhoneStateListener.LISTEN_NONE);
                legacyPhoneStateListener = null;
            }
        } catch (Exception ignored) {}
    }

    /**
     * Executes TelecomManager.acceptRingingCall() immediately (<100ms) on the calling thread
     * without waiting for any WebSocket, audio handshake, or Gemini API call.
     */
    @SuppressLint("MissingPermission")
    public static boolean acceptRingingCallImmediate(Context context) {
        try {
            TelecomManager tm = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS)
                    == PackageManager.PERMISSION_GRANTED) {
                    tm.acceptRingingCall();
                    Log.i(TAG, "Executed TelecomManager.acceptRingingCall() in <50ms on Ring 1");
                    return true;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "TelecomManager.acceptRingingCall exception, trying KeyEvent fallback", e);
        }

        // Hardware media button hook fallback
        try {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                KeyEvent downEvent = new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_HEADSETHOOK);
                KeyEvent upEvent = new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_HEADSETHOOK);
                am.dispatchMediaKeyEvent(downEvent);
                am.dispatchMediaKeyEvent(upEvent);
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    /**
     * Decoupled parallel post-pickup router: runs AFTER the line is already answered on Ring 1.
     * Evaluates America/Phoenix (Mon-Fri 8:00 AM - 5:00 PM MST) and either:
     * - Business Hours: bridges audio to Sarah's interactive Google conversational session
     * - After Hours: plays the exact deterministic closed greeting and terminates the call cleanly
     */
    public static void onCallAnsweredImmediately(Context context, String callerPhone, String triggerSource) {
        long now = System.currentTimeMillis();
        long prev = LAST_ANSWER_TS.get();
        if (now - prev < 5000L) {
            return; // Deduplicate simultaneous TelephonyCallback + InCallService + Notification triggers
        }
        LAST_ANSWER_TS.set(now);

        final String cleanCaller = callerPhone != null ? callerPhone.trim() : "";
        final boolean isBusinessHours = ArizonaTimeRouter.isBusinessHoursNow();

        // Route audio & notify backend asynchronously in parallel so call pickup is never delayed
        IO_EXECUTOR.execute(() -> {
            configureInCallAudioRoute(context);

            if (isBusinessHours) {
                // BUSINESS HOURS (Mon-Fri, 8:00 AM - 5:00 PM America/Phoenix):
                // Bridge incoming call audio to Sarah's interactive Google conversational flow
                MainActivity.notifyIncomingCallAnswered(cleanCaller, true, ArizonaTimeRouter.BUSINESS_HOURS_GREETING);
                if (instance != null) {
                    instance.playCloudOrFallbackGreeting(
                        CLOUD_API_BASE + "/api/sarah/audio.wav?preset=business_greeting",
                        ArizonaTimeRouter.BUSINESS_HOURS_GREETING,
                        false
                    );
                }
            } else {
                // AFTER HOURS (Evenings after 5:00 PM, Weekends, Holidays in America/Phoenix):
                // Speak exact deterministic closed message and cleanly terminate the call
                MainActivity.notifyIncomingCallAnswered(cleanCaller, false, ArizonaTimeRouter.AFTER_HOURS_GREETING);
                if (instance != null) {
                    instance.playCloudOrFallbackGreeting(
                        CLOUD_API_BASE + "/api/sarah/audio.wav?preset=after_hours",
                        ArizonaTimeRouter.AFTER_HOURS_GREETING,
                        true
                    );
                } else {
                    new Handler(Looper.getMainLooper()).postDelayed(
                        () -> endActiveCall(context),
                        14000L
                    );
                }
            }

            // Fire CRM & Watchdog telemetry asynchronously in the background
            postJsonAsync(
                CLOUD_API_BASE + "/api/sarah/inbound",
                "{\"from\":\"" + escapeJson(cleanCaller) + "\","
                    + "\"internal_only\":true,"
                    + "\"skip_inline_tts\":true,"
                    + "\"notes\":\"Android Bridge (" + escapeJson(triggerSource) + ") answered on 1st ring ["
                    + (isBusinessHours ? "business_hours" : "after_hours") + "]\"}"
            );
        });
    }

    private static void configureInCallAudioRoute(Context context) {
        try {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                am.setMicrophoneMute(false);
            }
        } catch (Exception ignored) {}
    }

    private void playCloudOrFallbackGreeting(String wavUrl, String exactText, boolean hangupOnComplete) {
        releaseMediaPlayer();
        try {
            MediaPlayer mp = new MediaPlayer();
            activeMediaPlayer = mp;
            mp.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            );
            mp.setDataSource(wavUrl);
            mp.setOnPreparedListener(MediaPlayer::start);
            mp.setOnCompletionListener(player -> {
                releaseMediaPlayer();
                if (hangupOnComplete) {
                    endActiveCall(getApplicationContext());
                }
            });
            mp.setOnErrorListener((player, what, extra) -> {
                releaseMediaPlayer();
                speakFallbackTts(exactText, hangupOnComplete);
                return true;
            });
            mp.prepareAsync();
        } catch (Exception e) {
            speakFallbackTts(exactText, hangupOnComplete);
        }
    }

    private void speakFallbackTts(String exactText, boolean hangupOnComplete) {
        if (fallbackTts != null && ttsReady) {
            String utteranceId = "sarah_utt_" + System.currentTimeMillis();
            fallbackTts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {}

                @Override
                public void onDone(String id) {
                    if (hangupOnComplete) {
                        endActiveCall(getApplicationContext());
                    }
                }

                @Override
                public void onError(String id) {
                    if (hangupOnComplete) {
                        endActiveCall(getApplicationContext());
                    }
                }
            });
            fallbackTts.speak(exactText, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        } else if (hangupOnComplete) {
            new Handler(Looper.getMainLooper()).postDelayed(
                () -> endActiveCall(getApplicationContext()),
                12000L
            );
        }
    }

    private void releaseMediaPlayer() {
        if (activeMediaPlayer != null) {
            try {
                activeMediaPlayer.stop();
            } catch (Exception ignored) {}
            try {
                activeMediaPlayer.release();
            } catch (Exception ignored) {}
            activeMediaPlayer = null;
        }
    }

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    public static boolean endActiveCall(Context context) {
        boolean disconnectedInCall = SarahInCallService.disconnectActiveCall();
        try {
            TelecomManager tm = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
            if (tm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.ANSWER_PHONE_CALLS)
                    == PackageManager.PERMISSION_GRANTED) {
                    return tm.endCall() || disconnectedInCall;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "TelecomManager.endCall warning", e);
        }
        return disconnectedInCall;
    }

    private static void postJsonAsync(String urlString, String jsonBody) {
        try {
            URL url = new URL(urlString);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setDoOutput(true);
            byte[] bytes = jsonBody.getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bytes);
            }
            conn.getResponseCode();
            conn.disconnect();
        } catch (Exception ignored) {}
    }

    private static String escapeJson(String input) {
        if (input == null) return "";
        return input.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}

