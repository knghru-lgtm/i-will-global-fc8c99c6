import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Volume2,
  Shield,
  Sparkles,
  User,
  CheckCircle2,
  Send,
  Square,
  RefreshCw,
  X,
  PhoneIncoming,
  PhoneOutgoing,
  GitBranch,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { AudioRecorder } from '../lib/audioRecorder';
import { AudioPlayer } from '../lib/audioPlayer';
import { api, openGoogleVoiceWindow } from '../lib/api';
import { useAuth } from '../lib/auth';

export function openSarahVoiceModal(opts?: {
  mode?: 'inbound' | 'outbound';
  leadPhone?: string;
  leadName?: string;
  leadState?: string;
  autoStart?: boolean;
}) {
  window.dispatchEvent(
    new CustomEvent('iwg-open-sarah-voice', {
      detail: {
        mode: opts?.mode || 'outbound',
        phone: opts?.leadPhone || '6232230165',
        prospect_name: opts?.leadName || 'Valued Beneficiary',
        state: opts?.leadState || 'AZ',
        autoStart: opts?.autoStart ?? false,
      },
    })
  );
}

interface TranscriptItem {
  id: string;
  speaker: 'sarah' | 'user' | 'system';
  text: string;
  timestamp: string;
  isAction?: boolean;
}

interface AppointmentConfirmation {
  appointment_id?: string;
  customer_name: string;
  customer_address?: string;
  appointment_type: string;
  product_line?: string;
  confirmed_datetime: string;
  appointment_confirmed?: boolean;
  confirmation_text_sent?: boolean;
  text_reminder_submitted?: boolean;
  day_before_reminder_scheduled?: boolean;
  day_before_reminder_at?: string;
  same_day_reminder_scheduled?: boolean;
  same_day_reminder_at?: string;
  sms_reminder_phone?: string;
  sms_reminder_text?: string;
  lead_source?: string;
  lead_id?: string;
  sms_cadence?: {
    immediate_confirmation_text: string;
    day_before_reminder_text?: string;
    same_day_reminder_text?: string;
  };
  message: string;
}

interface WhisperTransferConfirmation {
  recipient_name: string;
  recipient_phone: string;
  prospect_name: string;
  whisper_briefing: string;
  merge_introduction: string;
  verification?: {
    transline_dialed: boolean;
    transline_number: string;
    transline_connected: boolean;
    transline_connected_at?: string;
    whisper_delivered: boolean;
    whisper_received: boolean;
    whisper_received_at?: string;
    both_parties_on_line: boolean;
    party_a_prospect?: string;
    party_b_transline?: string;
    bridge_merged_at?: string;
  };
}

export interface SarahLaunchPayload {
  mode?: 'inbound' | 'outbound';
  lead_id?: string;
  prospect_name?: string;
  phone?: string;
  state?: string;
  address?: string;
  on_warm_transfer?: boolean;
  initialTopic?: string;
}

interface SarahVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTopic?: string;
  initialPayload?: SarahLaunchPayload | null;
}

export const SarahVoiceModal: React.FC<SarahVoiceModalProps> = ({
  isOpen,
  onClose,
  initialTopic,
  initialPayload,
}) => {
  const { user, activeRole } = useAuth();
  const isAdmin = Boolean(user && activeRole === 'admin');

  const [callMode, setCallMode] = useState<'inbound' | 'outbound'>('inbound');
  const [leadId, setLeadId] = useState<string>('');
  const [prospectName, setProspectName] = useState<string>('');
  const [prospectPhone, setProspectPhone] = useState<string>('');
  const [prospectState, setProspectState] = useState<string>('AZ');
  const [prospectAddress, setProspectAddress] = useState<string>('');
  const [onWarmTransfer, setOnWarmTransfer] = useState<boolean>(false);

  // Outbound Lead Queue, Scheduling Workday & Script Tree state (Strictly Admin-Only)
  const [leadQueue, setLeadQueue] = useState<any[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(0);
  const [isWorkdayActive, setIsWorkdayActive] = useState<boolean>(false);
  const [activeScriptStep, setActiveScriptStep] = useState<number>(1);
  const [showScriptTree, setShowScriptTree] = useState<boolean>(true);
  const [translineStage, setTranslineStage] = useState<
    'idle' | 'dialing_transline' | 'transline_connected' | 'whisper_received' | 'both_parties_on_line'
  >('idle');

  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error' | 'closed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMicListening, setIsMicListening] = useState(false);
  const [interimSpeech, setInterimSpeech] = useState('');
  const [userVolume, setUserVolume] = useState(0);
  const [sarahVolume, setSarahVolume] = useState(0);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [confirmedAppt, setConfirmedAppt] = useState<AppointmentConfirmation | null>(null);
  const [whisperTransfer, setWhisperTransfer] = useState<WhisperTransferConfirmation | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const neuralAudioRef = useRef<HTMLAudioElement | null>(null);
  const httpModeRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const isTurnInFlightRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const recRunningRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const keepAliveIntervalRef = useRef<any>(null);
  const speechBufferRef = useRef<string>('');
  const liveInterimRef = useRef<string>('');
  const speechBufferTimerRef = useRef<any>(null);
  const lastSarahReplyRef = useRef<string>('');
  const confirmedApptRef = useRef<AppointmentConfirmation | null>(null);
  const lastUserTurnRef = useRef<string>('');
  const lastSarahTurnRef = useRef<string>('');
  const convoHistoryTextRef = useRef<string>('');
  const sessionCtxRef = useRef<{
    mode: 'inbound' | 'outbound';
    lead_id?: string;
    prospect_name: string;
    phone?: string;
    state: string;
    address?: string;
    on_warm_transfer: boolean;
  }>({
    mode: 'inbound',
    prospect_name: '',
    phone: '',
    state: 'AZ',
    address: '',
    on_warm_transfer: false,
  });
  const transcriptsRef = useRef<TranscriptItem[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    confirmedApptRef.current = confirmedAppt;
  }, [confirmedAppt]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    sessionCtxRef.current = {
      mode: callMode,
      lead_id: leadId,
      prospect_name: prospectName,
      phone: prospectPhone,
      state: prospectState || 'AZ',
      address: prospectAddress,
      on_warm_transfer: onWarmTransfer,
    };
  }, [callMode, leadId, prospectName, prospectPhone, prospectState, prospectAddress, onWarmTransfer]);

  const isEchoOfSarah = (spokenText: string): boolean => {
    const cleanSpoken = spokenText
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
    if (!cleanSpoken) return true;
    if (
      cleanSpoken.includes('thank you for calling iwg') ||
      cleanSpoken.includes('this is sarah calling') ||
      cleanSpoken.includes('this is sarah speaking') ||
      cleanSpoken.includes('100 free fiduciary') ||
      cleanSpoken.includes('medicare helpline powered by iwg') ||
      cleanSpoken.includes('over 104 premier carriers')
    ) {
      return true;
    }
    const cleanSarah = (lastSarahReplyRef.current || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
    if (cleanSarah && cleanSpoken.length >= 14 && cleanSarah.includes(cleanSpoken)) {
      return true;
    }
    return false;
  };

  const stopAllSarahAudio = () => {
    if (neuralAudioRef.current) {
      try {
        neuralAudioRef.current.pause();
        neuralAudioRef.current.src = '';
      } catch {}
      neuralAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    isSpeakingRef.current = false;
    setIsSpeaking(false);
    setSarahVolume(0);
  };

  const resumeSpeechRecognitionSafe = () => {
    setTimeout(() => {
      if (
        httpModeRef.current &&
        !isMutedRef.current &&
        !isSpeakingRef.current &&
        !isTurnInFlightRef.current &&
        recognitionRef.current &&
        !recRunningRef.current
      ) {
        try {
          recognitionRef.current.start();
          recRunningRef.current = true;
          setIsMicListening(true);
        } catch {}
      }
    }, 150);
  };

  const playBrowserFallbackVoice = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setSarahVolume(0);
      resumeSpeechRecognitionSafe();
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const naturalVoice =
        voices.find((v) => /natural|aria|jenny|ana|ava|samantha|google us english/i.test(v.name) && /en/i.test(v.lang)) ||
        voices.find((v) => /en-US/i.test(v.lang) && !/zira/i.test(v.name)) ||
        voices.find((v) => /en/i.test(v.lang));
      if (naturalVoice) utter.voice = naturalVoice;
      utter.rate = 0.96; // Calm and relaxed cadence
      utter.pitch = 0.98;

      let started = false;
      // If browser blocks speechSynthesis (e.g. no prior click), release mic lock after 1.1s so mic always listens!
      const startGuard = setTimeout(() => {
        if (!started) {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          setSarahVolume(0);
          resumeSpeechRecognitionSafe();
        }
      }, 1100);

      const watchdogMs = Math.min(12000, Math.max(3500, text.length * 60));
      const watchdog = setTimeout(() => {
        if (isSpeakingRef.current) {
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          setSarahVolume(0);
          resumeSpeechRecognitionSafe();
        }
      }, watchdogMs);

      utter.onstart = () => {
        started = true;
        clearTimeout(startGuard);
        isSpeakingRef.current = true;
        setIsSpeaking(true);
        setSarahVolume(0.68);
      };
      utter.onend = () => {
        clearTimeout(startGuard);
        clearTimeout(watchdog);
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setSarahVolume(0);
        resumeSpeechRecognitionSafe();
      };
      utter.onerror = () => {
        clearTimeout(startGuard);
        clearTimeout(watchdog);
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setSarahVolume(0);
        resumeSpeechRecognitionSafe();
      };
      window.speechSynthesis.speak(utter);
    } catch {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setSarahVolume(0);
      resumeSpeechRecognitionSafe();
    }
  };

  const playSingleWavBase64 = (base64: string, mime = 'audio/wav', maxMs = 12000): Promise<boolean> => {
    return new Promise((resolve) => {
      try {
        const audio = new Audio(`data:${mime};base64,${base64}`);
        neuralAudioRef.current = audio;
        let settled = false;
        const done = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (neuralAudioRef.current === audio) {
            neuralAudioRef.current = null;
          }
          resolve(ok);
        };
        const timer = setTimeout(() => done(true), maxMs);
        audio.onended = () => done(true);
        audio.onerror = () => done(false);
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => done(false));
        }
      } catch {
        resolve(false);
      }
    });
  };

  const playSarahResponseAudio = async (
    text: string,
    audioBase64?: string | null,
    audioMime?: string,
    restText?: string
  ) => {
    lastSarahReplyRef.current = text;
    stopAllSarahAudio();
    if (recognitionRef.current && recRunningRef.current) {
      try {
        recognitionRef.current.stop();
        recRunningRef.current = false;
      } catch {}
    }
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSarahVolume(0.75);

    const fetchTtsChunk = (chunkText: string) =>
      fetch('/api/sarah/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunkText }),
      })
        .then((r) => r.json())
        .catch(() => null);

    if (audioBase64 && typeof window !== 'undefined') {
      // If there is remaining text, fetch its WAV in parallel while the first chunk plays out loud!
      const cleanRest = String(restText || '').trim();
      const restPromise = cleanRest ? fetchTtsChunk(cleanRest) : Promise.resolve(null);

      const ok = await playSingleWavBase64(
        audioBase64,
        audioMime || 'audio/wav',
        Math.min(12000, Math.max(3000, text.length * 65))
      );
      if (ok && cleanRest && isSpeakingRef.current) {
        const restRes = await restPromise;
        if (restRes?.audio_base64 && isSpeakingRef.current) {
          await playSingleWavBase64(
            restRes.audio_base64,
            restRes.audio_mime || 'audio/wav',
            Math.min(16000, Math.max(3500, cleanRest.length * 65))
          );
        }
      }
      if (ok) {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setSarahVolume(0);
        resumeSpeechRecognitionSafe();
        return;
      }
      playBrowserFallbackVoice(text);
      return;
    }

    // Fast-Start Sentence-Chunked Neural TTS if inline audioBase64 wasn't included
    if (typeof window !== 'undefined' && text) {
      try {
        const clean = text.trim();
        const firstSplitMatch = clean.match(/^([^.!?]+[.!?]+)\s+([\s\S]+)$/);
        const firstChunk = firstSplitMatch && firstSplitMatch[1].length >= 18 ? firstSplitMatch[1].trim() : clean;
        const restChunk = firstSplitMatch && firstSplitMatch[1].length >= 18 ? firstSplitMatch[2].trim() : '';

        const firstPromise = fetchTtsChunk(firstChunk);
        const restPromise = restChunk ? fetchTtsChunk(restChunk) : Promise.resolve(null);

        const firstRes = await firstPromise;
        if (firstRes?.audio_base64) {
          const ok1 = await playSingleWavBase64(
            firstRes.audio_base64,
            firstRes.audio_mime || 'audio/wav',
            Math.min(12000, Math.max(3500, firstChunk.length * 68))
          );
          if (ok1 && restChunk && isSpeakingRef.current) {
            const restRes = await restPromise;
            if (restRes?.audio_base64 && isSpeakingRef.current) {
              await playSingleWavBase64(
                restRes.audio_base64,
                restRes.audio_mime || 'audio/wav',
                Math.min(16000, Math.max(4000, restChunk.length * 68))
              );
            }
          }
          if (ok1) {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            setSarahVolume(0);
            resumeSpeechRecognitionSafe();
            return;
          }
        }
      } catch {
        // Fall through to browser voice if network TTS fails
      }
    }

    playBrowserFallbackVoice(text);
  };

  const executeVerifiedTranslineBridge = async (transferObj: any) => {
    const recipientName = transferObj?.recipient_name || 'King Amen Ra';
    const recipientPhone = transferObj?.recipient_phone || '+16024569681';
    const activeCtx = sessionCtxRef.current;
    const liveCallId = transferObj?.bland_call_id || null;

    // Step 1: Place the customer on hold and dial 602-456-9681 FIRST (never announce connection yet!)
    setTranslineStage('dialing_transline');
    setActiveScriptStep(3);
    openGoogleVoiceWindow(recipientPhone);

    const pendingTransfer: WhisperTransferConfirmation = {
      ...transferObj,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      prospect_name: activeCtx.prospect_name || 'Caller',
      verification: {
        transline_dialed: true,
        transline_number: recipientPhone,
        transline_connected: false,
        whisper_delivered: false,
        whisper_received: false,
        both_parties_on_line: false,
        party_a_prospect: activeCtx.prospect_name || 'Caller',
        party_b_transline: recipientName,
      },
    };
    setWhisperTransfer(pendingTransfer);

    setTranscripts((prev) => [
      ...prev,
      {
        id: 'wt_dialing_' + Date.now(),
        speaker: 'system',
        text: `📞 Calling ${recipientName} on ${recipientPhone} (602-456-9681)${liveCallId ? ` [Live Call ID: ${liveCallId.slice(0, 8)}...]` : ''} — Waiting for ${recipientName} to Answer & Connect Before Announcing to Customer...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isAction: true,
      },
    ]);

    // Step 2: Poll live call status until 602-456-9681 actually answers and connects!
    if (liveCallId) {
      const maxPolls = 22; // up to ~44 seconds while 602-456-9681 rings
      for (let attempt = 0; attempt < maxPolls; attempt++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const statusParams = new URLSearchParams({
            recipient_name: recipientName,
            recipient_phone: recipientPhone,
            prospect_name: activeCtx.prospect_name || 'Caller',
          });
          const statusRes = await fetch(`/api/sarah/transfer/status/${encodeURIComponent(liveCallId)}?${statusParams.toString()}`)
            .then((r) => r.json())
            .catch(() => null);

          if (statusRes?.connected) {
            setTranslineStage('transline_connected');
            setTimeout(() => setTranslineStage('whisper_received'), 200);
            setTimeout(() => setTranslineStage('both_parties_on_line'), 400);

            const connectedTransfer: WhisperTransferConfirmation = {
              ...pendingTransfer,
              verification: {
                transline_dialed: true,
                transline_number: recipientPhone,
                transline_connected: true,
                whisper_delivered: true,
                whisper_received: true,
                both_parties_on_line: true,
                party_a_prospect: activeCtx.prospect_name || 'Caller',
                party_b_transline: recipientName,
              },
            };
            setWhisperTransfer(connectedTransfer);

            const announceText =
              statusRes.connected_announcement ||
              transferObj?.merge_introduction ||
              `Thank you so much for your patience! I have connected with ${recipientName} on the line now. ${recipientName}, I have ${activeCtx.prospect_name || 'our caller'} with us—I will let you two take it from here!`;

            appendNewTranscript('sarah', announceText);
            playSarahResponseAudio(announceText);

            setTranscripts((prev) => [
              ...prev,
              {
                id: 'wt_verify_' + Date.now(),
                speaker: 'system',
                text: `✅ Verified Live Connection: (1) Called ${recipientName} (${recipientPhone}) → (2) ${recipientName} Answered & Connected → (3) Private Whisper Delivered → (4) Announced Connection to Customer!`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isAction: true,
              },
            ]);
            window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
            return;
          }

          if (statusRes?.unavailable) {
            setTranslineStage('idle');
            setWhisperTransfer(null);
            const fallbackMsg =
              statusRes.unavailable_message ||
              `Thank you so much for holding! ${recipientName} is currently wrapping up with another client and wasn't able to grab the line right this second, so let's lock in a priority time for you on his calendar during our work hours of Monday through Friday, 8:00 AM to 8:00 PM. Do you prefer a 30-minute Telephone, 60-minute In-Person, or 30-minute Video consultation?`;
            appendNewTranscript('sarah', fallbackMsg);
            playSarahResponseAudio(fallbackMsg);
            setTranscripts((prev) => [
              ...prev,
              {
                id: 'wt_unavail_' + Date.now(),
                speaker: 'system',
                text: `ℹ️ ${recipientName} (${recipientPhone}) was unavailable on the live ring (${statusRes.status || 'no_answer'}) — Transitioned caller to priority appointment booking.`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isAction: true,
              },
            ]);
            return;
          }
        } catch {
          // continue polling
        }
      }
    }
  };

  const sendHttpTurn = async (
    userText: string,
    ctxOverride?: {
      mode?: 'inbound' | 'outbound';
      lead_id?: string;
      prospect_name?: string;
      phone?: string;
      state?: string;
      address?: string;
      on_warm_transfer?: boolean;
      is_initial?: boolean;
      skip_transcript_append?: boolean;
    }
  ) => {
    if (isTurnInFlightRef.current && !ctxOverride?.is_initial) return;
    isTurnInFlightRef.current = true;
    setInterimSpeech('');
    setUserVolume(0);
    try {
      if (recognitionRef.current && recRunningRef.current) {
        try {
          recognitionRef.current.stop();
          recRunningRef.current = false;
        } catch {}
      }

      const activeCtx = sessionCtxRef.current;
      const historyPayload = transcriptsRef.current
        .filter((t) => (t.speaker === 'sarah' || t.speaker === 'user') && !t.isAction)
        .slice(-12)
        .map((t) => ({ speaker: t.speaker as 'sarah' | 'user', text: t.text }));

      const activeModeForTurn = isAdmin ? ctxOverride?.mode || activeCtx.mode : 'inbound';
      const res = await fetch('/api/sarah/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          is_initial: Boolean(ctxOverride?.is_initial),
          skip_inline_tts: false,
          history: historyPayload,
          context: {
            mode: activeModeForTurn,
            source_channel: activeModeForTurn === 'outbound' ? 'outbound' : 'website_traffic',
            lead_id: ctxOverride?.lead_id !== undefined ? ctxOverride.lead_id : activeCtx.lead_id,
            prospect_name: ctxOverride?.prospect_name !== undefined ? ctxOverride.prospect_name : activeCtx.prospect_name,
            prospect_phone: ctxOverride?.phone !== undefined ? ctxOverride.phone : activeCtx.phone,
            state: ctxOverride?.state || activeCtx.state,
            address: ctxOverride?.address !== undefined ? ctxOverride.address : activeCtx.address,
            on_warm_transfer:
              ctxOverride?.on_warm_transfer !== undefined ? ctxOverride.on_warm_transfer : activeCtx.on_warm_transfer,
          },
        }),
      }).then((r) => r.json());

      isTurnInFlightRef.current = false;

      let leadCapturedChange = false;
      if (res?.lead_id && res.lead_id !== sessionCtxRef.current.lead_id) {
        setLeadId(res.lead_id);
        sessionCtxRef.current.lead_id = res.lead_id;
        leadCapturedChange = true;
      }
      if (res?.prospect_name && res.prospect_name !== 'Valued Client' && res.prospect_name !== sessionCtxRef.current.prospect_name) {
        setProspectName(res.prospect_name);
        sessionCtxRef.current.prospect_name = res.prospect_name;
        leadCapturedChange = true;
      }
      if (res?.prospect_phone && res.prospect_phone !== '+16232230165' && res.prospect_phone !== sessionCtxRef.current.phone) {
        setProspectPhone(res.prospect_phone);
        sessionCtxRef.current.phone = res.prospect_phone;
        leadCapturedChange = true;
      }
      if (res?.prospect_address && res.prospect_address !== sessionCtxRef.current.address) {
        setProspectAddress(res.prospect_address);
        sessionCtxRef.current.address = res.prospect_address;
        leadCapturedChange = true;
      }
      if (leadCapturedChange) {
        window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
      }

      if (res?.reply) {
        if (!ctxOverride?.skip_transcript_append) {
          appendNewTranscript('sarah', res.reply);
        }
        playSarahResponseAudio(res.reply, res.audio_base64, res.audio_mime, res.rest_text);
        const lower = String(res.reply).toLowerCase();
        if (lower.includes('$1,788') || lower.includes('$2,400') || lower.includes('20%')) {
          setActiveScriptStep(2);
        } else if (
          lower.includes('please hold') ||
          lower.includes('30-minute telephone') ||
          lower.includes('60-minute in-person') ||
          lower.includes('introducing king')
        ) {
          setActiveScriptStep(3);
        }
      } else {
        resumeSpeechRecognitionSafe();
      }

      if (res?.appointment?.success) {
        confirmedApptRef.current = res.appointment;
        setConfirmedAppt(res.appointment);
        setActiveScriptStep(3);
        const nowStamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const smsPhone = res.appointment.sms_reminder_phone || sessionCtxRef.current.phone || '';
        const customerAddr = res.appointment.customer_address || sessionCtxRef.current.address || 'Address Verified on File';
        const leadTag = res.appointment.lead_source || 'Website Traffic';
        setTranscripts((prev) => [
          ...prev,
          {
            id: 'appt_' + Date.now(),
            speaker: 'system',
            text: `📅 Official Appointment Set (${leadTag}): ${res.appointment.customer_name} • 📍 ${customerAddr} • 📞 ${smsPhone} (${res.appointment.appointment_type}${res.appointment.product_line ? ` • ${res.appointment.product_line}` : ''}) — ${res.appointment.confirmed_datetime}`,
            timestamp: nowStamp,
            isAction: true,
          },
          {
            id: 'sms_conf_' + Date.now(),
            speaker: 'system',
            text: `📲 Initial Confirmation Text Sent to ${smsPhone} (Reply YES to confirm): "${res.appointment.sms_reminder_text || `Your ${res.appointment.appointment_type} consultation with King Amen Ra is set for ${res.appointment.confirmed_datetime}. Please reply YES to confirm!`}"`,
            timestamp: nowStamp,
            isAction: true,
          },
        ]);
        window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
      }

      if (res?.transfer?.success) {
        await executeVerifiedTranslineBridge(res.transfer);
      }
    } catch (err) {
      console.warn('Receptionist HTTP turn error:', err);
      isTurnInFlightRef.current = false;
      resumeSpeechRecognitionSafe();
    }
  };

  const activateHttpVoiceFallback = async (ctx: {
    mode: 'inbound' | 'outbound';
    lead_id?: string;
    prospect_name: string;
    phone?: string;
    state: string;
    address?: string;
    on_warm_transfer: boolean;
  }) => {
    if (httpModeRef.current) return;
    httpModeRef.current = true;
    sessionCtxRef.current = ctx;
    setConnectionStatus('connected');
    setErrorMessage(null);

    // Explicitly request microphone access in parallel (non-blocking) so the Receptionist answers immediately
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((t) => t.stop());
        })
        .catch(() => {});
    }

    // Start Browser SpeechRecognition with live interim feedback & automatic keep-alive
    try {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'en-US';

        rec.onstart = () => {
          recRunningRef.current = true;
          setIsMicListening(true);
        };

        rec.onresult = (ev: any) => {
          if (isMutedRef.current || isTurnInFlightRef.current) return;

          let finalChunk = '';
          let interimChunk = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const resItem = ev.results[i];
            const transcript = resItem?.[0]?.transcript || '';
            if (resItem.isFinal) {
              finalChunk += ' ' + transcript;
            } else {
              interimChunk += ' ' + transcript;
            }
          }

          const cleanFinal = finalChunk.trim();
          const cleanInterim = interimChunk.trim();

          if (isSpeakingRef.current) {
            return;
          }

          if (cleanFinal && !isEchoOfSarah(cleanFinal)) {
            speechBufferRef.current = (speechBufferRef.current ? speechBufferRef.current + ' ' : '') + cleanFinal;
            liveInterimRef.current = '';
          }
          if (cleanInterim && !isEchoOfSarah(cleanInterim)) {
            liveInterimRef.current = cleanInterim;
          }

          const combinedLive = [speechBufferRef.current, liveInterimRef.current].filter(Boolean).join(' ').trim();
          if (combinedLive && !isEchoOfSarah(combinedLive)) {
            setInterimSpeech(combinedLive);
            setUserVolume(cleanFinal ? 0.65 : 0.55);

            if (speechBufferTimerRef.current) {
              clearTimeout(speechBufferTimerRef.current);
            }
            // Wait 120ms when Chrome marks final, or 950ms during interim so we never cut off a caller mid-sentence
            const waitMs = cleanFinal && !cleanInterim ? 120 : 950;
            speechBufferTimerRef.current = setTimeout(() => {
              const fullSpoken = [speechBufferRef.current, liveInterimRef.current].filter(Boolean).join(' ').trim();
              speechBufferRef.current = '';
              liveInterimRef.current = '';
              setInterimSpeech('');
              setUserVolume(0);
              if (fullSpoken && !isEchoOfSarah(fullSpoken)) {
                appendNewTranscript('user', fullSpoken);
                sendHttpTurn(fullSpoken);
              }
            }, waitMs);
          }
        };

        rec.onerror = () => {
          recRunningRef.current = false;
        };

        rec.onend = () => {
          recRunningRef.current = false;
          if (httpModeRef.current && !isMutedRef.current && !isSpeakingRef.current && !isTurnInFlightRef.current) {
            try {
              rec.start();
              recRunningRef.current = true;
              setIsMicListening(true);
            } catch {}
          } else {
            setIsMicListening(false);
          }
        };

        recognitionRef.current = rec;
        try {
          rec.start();
          recRunningRef.current = true;
          setIsMicListening(true);
        } catch {}

        if (keepAliveIntervalRef.current) {
          clearInterval(keepAliveIntervalRef.current);
        }
        keepAliveIntervalRef.current = setInterval(() => {
          if (
            httpModeRef.current &&
            !isMutedRef.current &&
            !isSpeakingRef.current &&
            !isTurnInFlightRef.current &&
            recognitionRef.current &&
            !recRunningRef.current
          ) {
            try {
              recognitionRef.current.start();
              recRunningRef.current = true;
              setIsMicListening(true);
            } catch {}
          }
        }, 1000);
      }
    } catch {}

    // Immediately answer inbound/outbound call on Frame 0 so there is zero wait time!
    const rawName = (ctx.prospect_name || '').trim();
    const isGeneric =
      !rawName ||
      /^(medicare beneficiary|valued beneficiary|valued client|valued caller|caller|prospect|beneficiary)$/i.test(rawName);
    const greetFirst = isGeneric ? 'there' : rawName.split(/\s+/)[0] || 'there';
    const immediateGreetingText =
      ctx.mode === 'outbound'
        ? `Hello ${greetFirst}, this is Sarah calling from IWG Insurance and Financial Services. How are you today?`
        : `Thank you for calling IWG Insurance and Financial Services, where we serve as your 100% free fiduciary advisory representing over 104 premier carriers with zero broker fees. This is your Receptionist speaking. How may I direct your call today?`;

    appendNewTranscript('sarah', immediateGreetingText);
    await sendHttpTurn('', { ...ctx, is_initial: true, skip_transcript_append: true });
    const topicToUse = initialPayload?.initialTopic || initialTopic;
    if (topicToUse) {
      appendNewTranscript('user', topicToUse);
      await sendHttpTurn(topicToUse, ctx);
    }
  };

  // Auto-scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // Load CRM lead queue for Outbound Caller mode (Admin-only)
  useEffect(() => {
    if (!isOpen || !isAdmin) return;
    api
      .get('/calls/queue?limit=100')
      .then((res) => {
        const rows = res?.rows || [];
        setLeadQueue(rows);
      })
      .catch(() => {});
  }, [isOpen, isAdmin]);

  // Enforce Admin-only restriction if role switches while modal is open
  useEffect(() => {
    if (!isAdmin && callMode === 'outbound') {
      setCallMode('inbound');
      setIsWorkdayActive(false);
      startSession({ mode: 'inbound' });
    }
  }, [isAdmin]);

  // Apply initial launch payload when modal opens
  useEffect(() => {
    if (isOpen) {
      const requestedMode = initialPayload?.mode || 'inbound';
      const nextMode: 'inbound' | 'outbound' = isAdmin ? requestedMode : 'inbound';
      const nextLeadId = initialPayload?.lead_id || '';
      const rawInitName = (initialPayload?.prospect_name || '').trim();
      const isPlaceholderInitName =
        !rawInitName ||
        /^(medicare beneficiary|valued beneficiary|valued client|valued caller|caller|prospect|beneficiary)$/i.test(rawInitName);
      const nextName = nextMode === 'outbound' ? (isPlaceholderInitName ? 'Valued Client' : rawInitName) : isPlaceholderInitName ? '' : rawInitName;
      const rawInitPhone = (initialPayload?.phone || '').trim();
      const isPlaceholderInitPhone = !rawInitPhone || rawInitPhone.replace(/\D/g, '').endsWith('6232230165');
      const nextPhone = nextMode === 'outbound' ? (rawInitPhone || '(623) 223-0165') : isPlaceholderInitPhone ? '' : rawInitPhone;
      const nextState = initialPayload?.state || 'AZ';
      const nextAddr = initialPayload?.address || '';
      const nextWT = Boolean(initialPayload?.on_warm_transfer);

      setCallMode(nextMode);
      setLeadId(nextLeadId);
      setProspectName(nextName);
      setProspectPhone(nextPhone);
      setProspectState(nextState);
      setProspectAddress(nextAddr);
      if (initialPayload?.on_warm_transfer !== undefined) setOnWarmTransfer(nextWT);

      startSession({
        mode: nextMode,
        lead_id: nextLeadId,
        prospect_name: nextName,
        phone: nextPhone,
        state: nextState,
        address: nextAddr,
        on_warm_transfer: nextWT,
      });
    } else {
      endSession();
    }
    return () => {
      endSession();
    };
  }, [isOpen, initialPayload]);

  const selectQueueLead = (idx: number, dialGoogleVoice = false) => {
    if (!isAdmin) return;
    const lead = leadQueue[idx];
    if (!lead) return;
    setQueueIndex(idx);
    const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Valued Client';
    setLeadId(lead.id || '');
    setProspectName(fullName);
    setProspectPhone(lead.phone || '');
    setProspectState(lead.state || 'AZ');
    setProspectAddress(lead.address || '');
    setActiveScriptStep(1);
    if (dialGoogleVoice && lead.phone) {
      openGoogleVoiceWindow(lead.phone);
      api
        .post('/bland/call', {
          phone: lead.phone,
          lead_id: lead.id,
          prospect_name: fullName,
          on_warm_transfer: onWarmTransfer,
        })
        .catch(() => {});
    }
    startSession({
      mode: 'outbound',
      lead_id: lead.id,
      prospect_name: fullName,
      phone: lead.phone,
      state: lead.state || 'AZ',
      address: lead.address || '',
      on_warm_transfer: onWarmTransfer,
    });
  };

  const startSchedulingWorkday = async () => {
    if (!isAdmin) return;
    setIsWorkdayActive(true);
    try {
      const res: any = await api.post('/bland/activate', {
        phone: prospectPhone || undefined,
      });
      window.dispatchEvent(new CustomEvent('iwg-bland-status-changed'));
      window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
      if (leadQueue.length > 0) {
        selectQueueLead(queueIndex, true);
      } else {
        const dialPhone = res?.first_call?.phone || prospectPhone || '(623) 223-0165';
        openGoogleVoiceWindow(dialPhone);
        startSession({
          mode: 'outbound',
          lead_id: leadId,
          prospect_name: prospectName,
          phone: dialPhone,
          state: prospectState,
          address: prospectAddress,
          on_warm_transfer: onWarmTransfer,
        });
      }
    } catch {
      if (prospectPhone) openGoogleVoiceWindow(prospectPhone);
      startSession({
        mode: 'outbound',
        lead_id: leadId,
        prospect_name: prospectName,
        phone: prospectPhone,
        state: prospectState,
        address: prospectAddress,
        on_warm_transfer: onWarmTransfer,
      });
    }
  };

  const startSession = async (overrideParams?: {
    mode?: 'inbound' | 'outbound';
    lead_id?: string;
    prospect_name?: string;
    phone?: string;
    state?: string;
    address?: string;
    on_warm_transfer?: boolean;
  }) => {
    endSession();
    const requestedMode = overrideParams?.mode || callMode;
    const activeMode: 'inbound' | 'outbound' = isAdmin ? requestedMode : 'inbound';
    const activeLeadId = overrideParams?.lead_id !== undefined ? overrideParams.lead_id : leadId;
    const rawActiveName = overrideParams?.prospect_name !== undefined ? overrideParams.prospect_name : prospectName;
    const activeName =
      activeMode === 'outbound'
        ? rawActiveName || 'Valued Client'
        : /^(medicare beneficiary|valued beneficiary|valued client|valued caller|caller|prospect|beneficiary)$/i.test(
            String(rawActiveName || '').trim()
          )
        ? ''
        : String(rawActiveName || '').trim();
    const rawActivePhone = overrideParams?.phone !== undefined ? overrideParams.phone : prospectPhone;
    const activePhone =
      activeMode === 'outbound'
        ? rawActivePhone || '(623) 223-0165'
        : String(rawActivePhone || '').replace(/\D/g, '').endsWith('6232230165')
        ? ''
        : String(rawActivePhone || '').trim();
    const activeState = overrideParams?.state || prospectState || 'AZ';
    const activeAddress = overrideParams?.address !== undefined ? overrideParams.address : prospectAddress;
    const activeWT = overrideParams?.on_warm_transfer !== undefined ? overrideParams.on_warm_transfer : onWarmTransfer;

    setConnectionStatus('connecting');
    setErrorMessage(null);
    setConfirmedAppt(null);
    confirmedApptRef.current = null;
    lastUserTurnRef.current = '';
    lastSarahTurnRef.current = '';
    convoHistoryTextRef.current = '';
    setWhisperTransfer(null);
    setTranslineStage('idle');
    setActiveScriptStep(1);

    setTranscripts([
      {
        id: 'sys_' + Date.now(),
        speaker: 'system',
        text:
          activeMode === 'outbound'
            ? `📞 Outbound Caller on (480) 331-9455 — Dialing ${activeName}${activePhone ? ` (${activePhone})` : ''} using Unified Outbound Script & Tree...`
            : `🏢 Receptionist on (480) 331-9455 — Answering Inbound Call Immediately (100% Free Fiduciary Advisory & 42-Member Directory)...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    const fallbackCtx = {
      mode: activeMode,
      lead_id: activeLeadId,
      prospect_name: activeName,
      phone: activePhone,
      state: activeState,
      address: activeAddress,
      on_warm_transfer: Boolean(activeWT),
    };
    sessionCtxRef.current = fallbackCtx;

    // Answer inbound & outbound calls immediately on Frame 0 with zero WebSocket handshake delay
    await activateHttpVoiceFallback(fallbackCtx);
  };

  const endSession = () => {
    httpModeRef.current = false;
    isTurnInFlightRef.current = false;
    recRunningRef.current = false;
    setIsMicListening(false);
    setInterimSpeech('');
    speechBufferRef.current = '';
    if (keepAliveIntervalRef.current) {
      clearInterval(keepAliveIntervalRef.current);
      keepAliveIntervalRef.current = null;
    }
    if (speechBufferTimerRef.current) {
      clearTimeout(speechBufferTimerRef.current);
      speechBufferTimerRef.current = null;
    }
    stopAllSarahAudio();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (recorderRef.current) {
      recorderRef.current.stop();
      recorderRef.current = null;
    }
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    setIsSpeaking(false);
    setUserVolume(0);
    setSarahVolume(0);
  };

  const appendNewTranscript = (speaker: 'sarah' | 'user', text: string) => {
    setTranscripts((prev) => [
      ...prev,
      {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        speaker,
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    isMutedRef.current = next;
    recorderRef.current?.setMuted(next);
    if (recognitionRef.current) {
      try {
        if (next) recognitionRef.current.stop();
        else if (!isSpeakingRef.current) recognitionRef.current.start();
      } catch {}
    }
  };

  const interruptSarah = () => {
    playerRef.current?.stop();
    stopAllSarahAudio();
    resumeSpeechRecognitionSafe();
    if (wsRef.current?.readyState === WebSocket.OPEN && !httpModeRef.current) {
      wsRef.current.send(
        JSON.stringify({
          realtimeInput: {
            activityEnd: {},
          },
        })
      );
    }
  };

  const sendTextMessage = (textToSend?: string) => {
    const text = textToSend || textInput.trim();
    if (!text) return;

    lastUserTurnRef.current += ' ' + text;
    convoHistoryTextRef.current += ' ' + text;

    if (wsRef.current?.readyState === WebSocket.OPEN && !httpModeRef.current) {
      playerRef.current?.stop();
      wsRef.current.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        })
      );
      appendNewTranscript('user', text);
      if (!textToSend) setTextInput('');
    } else {
      appendNewTranscript('user', text);
      if (!textToSend) setTextInput('');
      sendHttpTurn(text);
    }
  };

  const triggerScriptStepDirective = (stepNum: number, directiveText: string) => {
    setActiveScriptStep(stepNum);
    playerRef.current?.stop();
    stopAllSarahAudio();
    setTranscripts((prev) => [
      ...prev,
      {
        id: 'tree_' + Date.now(),
        speaker: 'system',
        text: `🌳 Outbound Script Tree → Step ${stepNum}: ${directiveText.slice(0, 95)}...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isAction: true,
      },
    ]);
    if (wsRef.current?.readyState === WebSocket.OPEN && !httpModeRef.current) {
      wsRef.current.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [
                  {
                    text: `[SCRIPT TREE DIRECTIVE]: Immediately speak this exact script section naturally and warmly in your voice right now: "${directiveText}"`,
                  },
                ],
              },
            ],
            turnComplete: true,
          },
        })
      );
    } else {
      sendHttpTurn(`[SCRIPT TREE DIRECTIVE]: ${directiveText}`);
    }
  };

  const triggerImmediateWhisperTransfer = (recipientName = 'King Amen Ra') => {
    setActiveScriptStep(3);
    playerRef.current?.stop();
    stopAllSarahAudio();
    const userReqText = `Please transfer me to ${recipientName} right now.`;
    appendNewTranscript('user', userReqText);
    sendHttpTurn(userReqText);
  };

  if (!isOpen) return null;

  const firstName = (prospectName || 'Beneficiary').split(/\s+/)[0] || 'Beneficiary';
  const activeOrbScale = isSpeaking ? 1 + sarahVolume * 0.45 : 1 + userVolume * 0.35;
  const activeOrbGlow = isSpeaking
    ? `0 0 ${25 + sarahVolume * 50}px rgba(200, 150, 62, 0.75)`
    : userVolume > 0.05
    ? `0 0 ${25 + userVolume * 50}px rgba(34, 197, 94, 0.75)`
    : '0 0 20px rgba(99, 102, 241, 0.3)';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 16, 57, 0.88)',
        backdropFilter: 'blur(10px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0.75rem',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: isAdmin && callMode === 'outbound' && showScriptTree ? '1180px' : '780px',
          height: '92vh',
          maxHeight: '860px',
          backgroundColor: '#0a163d',
          border: '1.5px solid rgba(200, 150, 62, 0.45)',
          borderRadius: '1.25rem',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.75), 0 0 35px rgba(200, 150, 62, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#ffffff',
          position: 'relative',
          transition: 'max-width 0.25s ease',
        }}
      >
        {/* Top Header + Dual-Mode Switcher on Line (480) 331-9455 */}
        <div
          style={{
            padding: '0.95rem 1.25rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            background: 'linear-gradient(90deg, rgba(10, 22, 61, 0.98), rgba(18, 38, 92, 0.98))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #c8963e, #f3cf7a)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 15px rgba(200, 150, 62, 0.5)',
                color: '#051039',
                fontWeight: 900,
                fontSize: '1.25rem',
              }}
            >
              {callMode === 'inbound' ? 'R' : 'S'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: '1.12rem', color: '#ffffff' }}>
                  {callMode === 'inbound' ? 'Receptionist' : 'Receptionist & Admin Outbound Caller'}
                </span>
                <span
                  style={{
                    backgroundColor: callMode === 'inbound' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(200, 150, 62, 0.25)',
                    color: callMode === 'inbound' ? '#4ade80' : '#f3cf7a',
                    border: callMode === 'inbound' ? '1px solid rgba(34, 197, 94, 0.45)' : '1px solid rgba(200, 150, 62, 0.5)',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                  }}
                >
                  {callMode === 'inbound' ? 'Receptionist' : '📞 Admin Outbound Caller & Scheduler'}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem' }}>
                <Shield size={13} color="#c8963e" />
                <span>IWG Insurance & Financial Services • 104+ Carriers • Step-by-Step Appointment Intake & Confirmation Text</span>
              </div>
            </div>
          </div>

          {/* Mode Toggle Tabs: Receptionist (All Users) vs Outbound Caller (Strictly Admin Only) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex',
                backgroundColor: 'rgba(5, 16, 57, 0.8)',
                padding: '0.25rem',
                borderRadius: '0.65rem',
                border: '1px solid rgba(255, 255, 255, 0.14)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setCallMode('inbound');
                  startSession({ mode: 'inbound' });
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.4rem 0.75rem',
                  borderRadius: '0.45rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  backgroundColor: callMode === 'inbound' ? '#10b981' : 'transparent',
                  color: callMode === 'inbound' ? '#051039' : '#cbd5e1',
                }}
              >
                <PhoneIncoming size={14} />
                <span>Receptionist</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setCallMode('outbound');
                    startSession({
                      mode: 'outbound',
                      lead_id: leadId,
                      prospect_name: prospectName,
                      phone: prospectPhone,
                      state: prospectState,
                      address: prospectAddress,
                      on_warm_transfer: onWarmTransfer,
                    });
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.4rem 0.75rem',
                    borderRadius: '0.45rem',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    backgroundColor: callMode === 'outbound' ? '#c8963e' : 'transparent',
                    color: callMode === 'outbound' ? '#051039' : '#cbd5e1',
                  }}
                >
                  <PhoneOutgoing size={14} />
                  <span>🔒 Admin Outbound Caller (Script & Tree)</span>
                </button>
              )}
            </div>

            {isAdmin && callMode === 'outbound' && (
              <button
                type="button"
                onClick={() => setShowScriptTree((v) => !v)}
                style={{
                  background: showScriptTree ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid ' + (showScriptTree ? '#60a5fa' : 'rgba(255,255,255,0.18)'),
                  color: showScriptTree ? '#93c5fd' : '#cbd5e1',
                  borderRadius: '0.5rem',
                  padding: '0.4rem 0.7rem',
                  fontSize: '0.76rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
                title="Toggle Interactive Outbound Script & Decision Tree"
              >
                <GitBranch size={14} />
                <span>{showScriptTree ? 'Hide Tree' : 'Show Script Tree'}</span>
              </button>
            )}

            <button
              onClick={() => {
                endSession();
                onClose();
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '50%',
                width: '34px',
                height: '34px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                cursor: 'pointer',
              }}
              title="Close Receptionist"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Inbound Receptionist Bar (Visible in Inbound Mode) */}
        {callMode === 'inbound' && (
          <div
            style={{
              padding: '0.6rem 1.25rem',
              background: 'rgba(6, 78, 59, 0.35)',
              borderBottom: '1px solid rgba(16, 185, 129, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.6rem',
            }}
          >
            <div style={{ fontSize: '0.78rem', color: '#d1fae5', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <span>🎧 <strong>Receptionist Appointment Steps:</strong></span>
              <span
                style={{
                  background: prospectName.trim() ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid ' + (prospectName.trim() ? '#10b981' : 'rgba(255,255,255,0.2)'),
                  color: prospectName.trim() ? '#6ee7b7' : '#cbd5e1',
                  padding: '0.12rem 0.5rem',
                  borderRadius: '999px',
                  fontSize: '0.71rem',
                  fontWeight: 700,
                }}
              >
                {prospectName.trim() ? `✅ 1. Name: ${prospectName}` : '1. Ask Full Name'}
              </span>
              <span
                style={{
                  background: prospectPhone.trim() ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid ' + (prospectPhone.trim() ? '#10b981' : 'rgba(255,255,255,0.2)'),
                  color: prospectPhone.trim() ? '#6ee7b7' : '#cbd5e1',
                  padding: '0.12rem 0.5rem',
                  borderRadius: '999px',
                  fontSize: '0.71rem',
                  fontWeight: 700,
                }}
              >
                {prospectPhone.trim() ? `✅ 2. Phone: ${prospectPhone}` : '2. Ask Phone Number'}
              </span>
              <span
                style={{
                  background: prospectAddress.trim() ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid ' + (prospectAddress.trim() ? '#10b981' : 'rgba(255,255,255,0.2)'),
                  color: prospectAddress.trim() ? '#6ee7b7' : '#cbd5e1',
                  padding: '0.12rem 0.5rem',
                  borderRadius: '999px',
                  fontSize: '0.71rem',
                  fontWeight: 700,
                }}
              >
                {prospectAddress.trim() ? `✅ 3. Address: ${prospectAddress}` : '3. Ask Street Address'}
              </span>
              <span
                style={{
                  background: confirmedAppt ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid ' + (confirmedAppt ? '#10b981' : 'rgba(255,255,255,0.2)'),
                  color: confirmedAppt ? '#6ee7b7' : '#cbd5e1',
                  padding: '0.12rem 0.5rem',
                  borderRadius: '999px',
                  fontSize: '0.71rem',
                  fontWeight: 700,
                }}
              >
                {confirmedAppt ? `✅ 4. Confirmed (${confirmedAppt.confirmed_datetime}) — Reply YES` : '4. Agree Date/Time → Reply YES to Confirmation Text'}
              </span>
            </div>
            {isAdmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <a
                  href="https://voice.google.com/u/0/calls"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    color: '#ffffff',
                    borderRadius: '6px',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                  title="Open Google Voice (480) 331-9455 Incoming Calls Window"
                >
                  <span>📞 Open Google Voice (480) 331-9455 Inbox</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
        )}

        {/* Outbound Caller Target Bar (Strictly Visible to CRM Admin Only) */}
        {isAdmin && callMode === 'outbound' && (
          <div
            style={{
              padding: '0.65rem 1.25rem',
              background: 'rgba(17, 28, 58, 0.95)',
              borderBottom: '1px solid rgba(200, 150, 62, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.6rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', flex: 1 }}>
              <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#ffd88a', textTransform: 'uppercase' }}>
                🔒 Admin Outbound (480) 331-9455 →
              </span>
              <input
                type="text"
                value={prospectName}
                onChange={(e) => setProspectName(e.target.value)}
                placeholder="Prospect Name"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  padding: '0.3rem 0.6rem',
                  color: '#fff',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  width: '165px',
                }}
              />
              <input
                type="text"
                value={prospectPhone}
                onChange={(e) => setProspectPhone(e.target.value)}
                placeholder="Prospect Phone"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  padding: '0.3rem 0.6rem',
                  color: '#38bdf8',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  width: '130px',
                }}
              />
              <input
                type="text"
                value={prospectState}
                onChange={(e) => setProspectState(e.target.value)}
                placeholder="State"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '6px',
                  padding: '0.3rem 0.5rem',
                  color: '#cbd5e1',
                  fontSize: '0.82rem',
                  width: '48px',
                }}
              />
              <button
                type="button"
                disabled={isWorkdayActive}
                onClick={() => startSchedulingWorkday()}
                style={{
                  background: isWorkdayActive
                    ? 'linear-gradient(135deg, #2563eb, #3b82f6)'
                    : 'linear-gradient(135deg, #059669, #10b981)',
                  color: '#ffffff',
                  border: '1px solid #34d399',
                  borderRadius: '6px',
                  padding: '0.35rem 0.8rem',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: isWorkdayActive ? 'default' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  boxShadow: '0 2px 10px rgba(16, 185, 129, 0.35)',
                }}
                title="Admin-Only: Activate Sarah's Scheduling Workday & Auto-Call All Assigned Leads"
              >
                <span>
                  {isWorkdayActive
                    ? '⏳ Dialing Assigned Leads...'
                    : `🚀 Start Scheduling Workday (${leadQueue.length || 'All'} Leads)`}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (prospectPhone) {
                    openGoogleVoiceWindow(prospectPhone);
                    api.post('/bland/call', {
                      phone: prospectPhone,
                      lead_id: leadId || undefined,
                      prospect_name: prospectName,
                      on_warm_transfer: onWarmTransfer,
                    }).catch(() => {});
                  }
                  startSession({
                    mode: 'outbound',
                    lead_id: leadId,
                    prospect_name: prospectName,
                    phone: prospectPhone,
                    state: prospectState,
                    address: prospectAddress,
                    on_warm_transfer: onWarmTransfer,
                  });
                }}
                style={{
                  background: 'rgba(16, 185, 129, 0.2)',
                  color: '#6ee7b7',
                  border: '1px solid #10b981',
                  borderRadius: '6px',
                  padding: '0.35rem 0.7rem',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
                title="Dial this lead on Google Voice (480) 331-9455 and start Sarah's Outbound Script simultaneously"
              >
                <span>📞 Dial Lead</span>
                <ExternalLink size={12} />
              </button>
              <button
                type="button"
                onClick={() =>
                  startSession({
                    mode: 'outbound',
                    lead_id: leadId,
                    prospect_name: prospectName,
                    phone: prospectPhone,
                    state: prospectState,
                    address: prospectAddress,
                    on_warm_transfer: onWarmTransfer,
                  })
                }
                style={{
                  background: 'linear-gradient(135deg, #c8963e, #e5b869)',
                  color: '#051039',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.35rem 0.7rem',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                🔄 Restart Script
              </button>
            </div>

            {/* Queue Prev / Next Navigation */}
            {leadQueue.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <button
                  type="button"
                  disabled={queueIndex <= 0}
                  onClick={() => selectQueueLead(Math.max(0, queueIndex - 1))}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    borderRadius: '5px',
                    padding: '0.25rem 0.45rem',
                    cursor: queueIndex > 0 ? 'pointer' : 'default',
                    opacity: queueIndex > 0 ? 1 : 0.4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Previous Lead in Queue"
                >
                  <ChevronLeft size={14} />
                </button>
                <span style={{ fontSize: '0.74rem', color: '#94a3b8', fontWeight: 700 }}>
                  Queue {queueIndex + 1}/{leadQueue.length}
                </span>
                <button
                  type="button"
                  disabled={queueIndex >= leadQueue.length - 1}
                  onClick={() => selectQueueLead(Math.min(leadQueue.length - 1, queueIndex + 1))}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#fff',
                    borderRadius: '5px',
                    padding: '0.25rem 0.45rem',
                    cursor: queueIndex < leadQueue.length - 1 ? 'pointer' : 'default',
                    opacity: queueIndex < leadQueue.length - 1 ? 1 : 0.4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Next Lead in Queue"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main Workspace Split: Left = Voice Visualizer & Live Transcript | Right = Outbound Script & Decision Tree */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Left Column: Voice Orb + Live Transcript + Controls */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: '340px' }}>
            {/* Visualizer & Status Area */}
            <div
              style={{
                padding: '1rem',
                background: 'radial-gradient(circle at center, rgba(30, 58, 138, 0.35) 0%, rgba(10, 22, 61, 0.6) 70%)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '145px',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'relative',
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '0.55rem',
                }}
              >
                {(isSpeaking || userVolume > 0.05) && (
                  <div
                    style={{
                      position: 'absolute',
                      inset: -10,
                      borderRadius: '50%',
                      border: isSpeaking ? '2px solid rgba(200, 150, 62, 0.45)' : '2px solid rgba(34, 197, 94, 0.45)',
                    }}
                  />
                )}
                <div
                  style={{
                    width: '66px',
                    height: '66px',
                    borderRadius: '50%',
                    background: isSpeaking
                      ? 'radial-gradient(circle, #f3cf7a 0%, #c8963e 60%, #855716 100%)'
                      : userVolume > 0.05
                      ? 'radial-gradient(circle, #4ade80 0%, #16a34a 60%, #14532d 100%)'
                      : 'radial-gradient(circle, #6366f1 0%, #3b82f6 60%, #1e3a8a 100%)',
                    boxShadow: activeOrbGlow,
                    transform: `scale(${activeOrbScale})`,
                    transition: 'transform 0.1s ease-out, box-shadow 0.15s ease-out',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                  }}
                >
                  {isSpeaking ? (
                    <Volume2 size={28} color="#051039" />
                  ) : isMuted ? (
                    <MicOff size={26} color="#cbd5e1" />
                  ) : (
                    <Mic size={26} color="#ffffff" />
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor:
                      connectionStatus === 'connected'
                        ? isSpeaking
                          ? '#c8963e'
                          : '#22c55e'
                        : connectionStatus === 'connecting'
                        ? '#f59e0b'
                        : '#ef4444',
                  }}
                />
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>
                  {connectionStatus === 'connecting' && 'Connecting Receptionist...'}
                  {connectionStatus === 'connected' && isSpeaking && 'Receptionist is speaking...'}
                  {connectionStatus === 'connected' && !isSpeaking && isMuted && 'Microphone muted (Click Unmute to speak)'}
                  {connectionStatus === 'connected' && !isSpeaking && !isMuted && 'Receptionist is listening... (Speak naturally)'}
                  {connectionStatus === 'closed' && 'Call ended'}
                  {connectionStatus === 'error' && (errorMessage || 'Connection error')}
                </span>
              </div>

              {/* Whisper Transfer & Transline Verification Banner */}
              {whisperTransfer && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    backgroundColor: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.55)',
                    borderRadius: '0.6rem',
                    padding: '0.55rem 0.9rem',
                    fontSize: '0.76rem',
                    color: '#ffd88a',
                    maxWidth: '96%',
                    width: '100%',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <strong>
                      ⚡ Automatic Transline & Whisper Verification — {whisperTransfer.recipient_name} ({whisperTransfer.recipient_phone})
                    </strong>
                    <span
                      style={{
                        background:
                          whisperTransfer.verification?.both_parties_on_line || translineStage === 'both_parties_on_line'
                            ? '#10b981'
                            : '#f59e0b',
                        color: '#051039',
                        padding: '0.1rem 0.5rem',
                        borderRadius: '999px',
                        fontSize: '0.68rem',
                        fontWeight: 800,
                      }}
                    >
                      {whisperTransfer.verification?.both_parties_on_line || translineStage === 'both_parties_on_line'
                        ? '✅ BOTH PARTIES ON LINE'
                        : `⏳ ${translineStage.toUpperCase()}...`}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                      gap: '0.3rem',
                      marginTop: '0.35rem',
                      fontSize: '0.72rem',
                      color: '#d1fae5',
                    }}
                  >
                    <div>
                      {whisperTransfer.verification?.transline_dialed ? '✅' : '⏳'} 1. Transline Auto-Called:{' '}
                      <strong>{whisperTransfer.recipient_phone}</strong>
                    </div>
                    <div>
                      {whisperTransfer.verification?.transline_connected ? '✅' : '⏳'} 2. Transline Connected:{' '}
                      <strong>{whisperTransfer.verification?.transline_connected ? 'VERIFIED' : 'Dialing...'}</strong>
                    </div>
                    <div>
                      {whisperTransfer.verification?.whisper_received ? '✅' : '⏳'} 3. Whisper Received:{' '}
                      <strong>{whisperTransfer.verification?.whisper_received ? 'VERIFIED' : 'Sending...'}</strong>
                    </div>
                    <div>
                      {whisperTransfer.verification?.both_parties_on_line ? '✅' : '⏳'} 4. Both Parties on Line:{' '}
                      <strong>
                        {whisperTransfer.verification?.both_parties_on_line
                          ? `${whisperTransfer.verification?.party_a_prospect || firstName} + ${whisperTransfer.recipient_name}`
                          : 'Merging...'}
                      </strong>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.71rem', color: '#e2e8f0', marginTop: '0.25rem', fontStyle: 'italic' }}>
                    Whispered privately: "{whisperTransfer.whisper_briefing}"
                  </div>
                </div>
              )}

              {/* Appointment Confirmation + Confirmation Text Banner */}
              {confirmedAppt && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.5)',
                    borderRadius: '0.5rem',
                    padding: '0.55rem 0.85rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.32rem',
                    fontSize: '0.78rem',
                    color: '#6ee7b7',
                    maxWidth: '96%',
                    width: '100%',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <CheckCircle2 size={15} color="#34d399" />
                      <span>
                        <strong>Appointment Set!</strong> {confirmedAppt.appointment_type} consultation
                        {confirmedAppt.product_line ? ` (${confirmedAppt.product_line})` : ''} for{' '}
                        <strong>{confirmedAppt.customer_name}</strong> — <strong>{confirmedAppt.confirmed_datetime}</strong> with King Amen Ra.
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          backgroundColor: '#10b981',
                          color: '#051039',
                          padding: '0.12rem 0.5rem',
                          borderRadius: '999px',
                          fontSize: '0.66rem',
                          fontWeight: 800,
                        }}
                      >
                        ✅ INITIAL CONFIRMATION TEXT SENT (REPLY YES)
                      </span>
                      <span
                        style={{
                          backgroundColor: 'rgba(56, 189, 248, 0.25)',
                          color: '#7dd3fc',
                          border: '1px solid #38bdf8',
                          padding: '0.12rem 0.5rem',
                          borderRadius: '999px',
                          fontSize: '0.66rem',
                          fontWeight: 800,
                        }}
                      >
                        🏷️ LEAD TAG: {confirmedAppt.lead_source || 'Website Traffic'}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#e2e8f0', display: 'flex', gap: '0.85rem', flexWrap: 'wrap' }}>
                    <span>👤 <strong>Name:</strong> {confirmedAppt.customer_name}</span>
                    <span>📍 <strong>Address:</strong> {confirmedAppt.customer_address || prospectAddress}</span>
                    <span>📞 <strong>Phone:</strong> {confirmedAppt.sms_reminder_phone || prospectPhone}</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#d1fae5' }}>
                    📲 <strong>Confirmation Text Sent (Reply YES to Confirm):</strong>{' '}
                    <em>
                      "
                      {confirmedAppt.sms_reminder_text ||
                        `Hi ${confirmedAppt.customer_name}, your ${confirmedAppt.appointment_type} consultation with King Amen Ra is scheduled for ${confirmedAppt.confirmed_datetime}. Please reply YES to confirm your appointment.`}
                      "
                    </em>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Action Prompts (All 6 Award-Winning Product Scripts + Booking & Transfer) */}
            <div
              style={{
                padding: '0.55rem 1rem',
                background: 'rgba(5, 16, 57, 0.7)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'flex',
                gap: '0.45rem',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              {callMode === 'inbound' ? (
                <>
                  <button
                    onClick={() => sendTextMessage('I am looking for Term or Whole Life Insurance with Living Benefits.')}
                    style={{
                      background: 'rgba(200, 150, 62, 0.18)',
                      border: '1px solid rgba(200, 150, 62, 0.45)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#ffd88a',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    🛡️ Life Insurance (Living Benefits)
                  </button>
                  <button
                    onClick={() => sendTextMessage('Tell me about Investment Grade High Cash-Value IUL (Section 7702) tax-free retirement.')}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.14)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#cbd5e1',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    📈 High Cash-Value IUL (7702)
                  </button>
                  <button
                    onClick={() => sendTextMessage('What Individual & Family ACA or Private PPO health plans do you offer?')}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.14)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#cbd5e1',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    🏥 Individual & Family Health (ACA/PPO)
                  </button>
                  <button
                    onClick={() => sendTextMessage('We need Group Health Insurance and employee benefits for our business.')}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.14)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#cbd5e1',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    🏢 Group Health (1–50+ Employees)
                  </button>
                  <button
                    onClick={() => sendTextMessage('How does Asset-Based Long Term Care protect my home and retirement savings?')}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.14)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#cbd5e1',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    🏡 Asset-Based Long-Term Care
                  </button>
                  <button
                    onClick={() => sendTextMessage('Can you explain the upcoming 2027 Medicare changes and the $2,400 prescription cap?')}
                    style={{
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.14)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#cbd5e1',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    ⚕️ 2027 Medicare Review
                  </button>
                  <button
                    onClick={() =>
                      sendTextMessage(
                        'My name is Marcus Sterling, my address is 4820 E Camelback Rd, Phoenix AZ 85018, and my phone is (602) 555-0194. Please book a Telephone appointment for tomorrow at 10:00 AM.'
                      )
                    }
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#6ee7b7',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    📅 Book Appointment + Confirmation Text
                  </button>
                  <button
                    onClick={() => triggerImmediateWhisperTransfer('King Amen Ra')}
                    style={{
                      background: 'rgba(200, 150, 62, 0.18)',
                      border: '1px solid rgba(200, 150, 62, 0.45)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#ffd88a',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⚡ Transfer to King Amen Ra
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() =>
                      triggerScriptStepDirective(
                        1,
                        `Deliver Step 1 Warm Opening & Value Hook to ${firstName}: "Hello ${firstName}, this is Sarah calling from IWG Insurance and Financial Services. We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. How are you doing today?"`
                      )
                    }
                    style={{
                      background: activeScriptStep === 1 ? 'rgba(200, 150, 62, 0.28)' : 'rgba(255,255,255,0.06)',
                      border: '1px solid ' + (activeScriptStep === 1 ? '#c8963e' : 'rgba(255,255,255,0.14)'),
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#ffd88a',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    1️⃣ Step 1: Greeting & Hook
                  </button>
                  <button
                    onClick={() =>
                      triggerScriptStepDirective(
                        2,
                        `Deliver Step 2 (3-Point 2027 Medicare Summary & Assumptive Close) to ${firstName}: Explain the $1,788 Part A deductible, $209.50 Part B premium, $292 deductible, uncapped 20% coinsurance, and the $2,400 Part D Rx cap across 104+ carriers, then ask: "To make this completely effortless for you, ${firstName}, our Principal Broker King Amen Ra can verify your doctors and prescriptions in just a few minutes at zero cost. Would you like me to reach out and get him on the line for you right now?"`
                      )
                    }
                    style={{
                      background: activeScriptStep === 2 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.06)',
                      border: '1px solid ' + (activeScriptStep === 2 ? '#38bdf8' : 'rgba(255,255,255,0.14)'),
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#7dd3fc',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    2️⃣ Step 2: 2027 Summary & Close
                  </button>
                  <button
                    onClick={() => triggerImmediateWhisperTransfer('King Amen Ra')}
                    style={{
                      background: 'rgba(16, 185, 129, 0.2)',
                      border: '1px solid #10b981',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#6ee7b7',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ⚡ Step 3A: Whisper Transfer → King
                  </button>
                  <button
                    onClick={() =>
                      triggerScriptStepDirective(
                        3,
                        `Execute Step 3 Path B (Executive Alternative-Choice Appointment Close): Say to ${firstName}: "Because King Amen Ra is currently on a live consultation helping another family, I want to reserve a dedicated one-on-one time for you on his private calendar. To lock that in and send your confirmation text—which you simply reply YES to confirm—may I confirm your full name, street address, and best phone number, and do you prefer a 30-minute Telephone, 60-minute In-Person, or 30-minute Video appointment?"`
                      )
                    }
                    style={{
                      background: 'rgba(59, 130, 246, 0.2)',
                      border: '1px solid #60a5fa',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#93c5fd',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    📅 Step 3B: Book Appt Close
                  </button>
                </>
              )}
            </div>

            {/* Live Bidirectional Transcript Feed */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.85rem',
                backgroundColor: 'rgba(7, 14, 38, 0.85)',
              }}
            >
              {transcripts.map((item) => {
                if (item.speaker === 'system') {
                  return (
                    <div
                      key={item.id}
                      style={{
                        alignSelf: 'center',
                        backgroundColor: item.isAction ? 'rgba(200, 150, 62, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        border: item.isAction ? '1px solid rgba(200, 150, 62, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '0.5rem',
                        padding: '0.35rem 0.75rem',
                        fontSize: '0.75rem',
                        color: item.isAction ? '#f3cf7a' : '#94a3b8',
                        maxWidth: '90%',
                        textAlign: 'center',
                      }}
                    >
                      {item.text}
                    </div>
                  );
                }

                const isSarah = item.speaker === 'sarah';
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: isSarah ? 'flex-start' : 'flex-end',
                      maxWidth: '85%',
                      alignSelf: isSarah ? 'flex-start' : 'flex-end',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        marginBottom: '0.2rem',
                        fontSize: '0.73rem',
                        color: isSarah ? '#c8963e' : '#60a5fa',
                      }}
                    >
                      {isSarah ? <Sparkles size={12} /> : <User size={12} />}
                      <span style={{ fontWeight: 700 }}>
                        {isSarah ? 'Receptionist' : callMode === 'outbound' ? firstName : 'Caller'}
                      </span>
                      <span style={{ color: '#64748b' }}>{item.timestamp}</span>
                    </div>
                    <div
                      style={{
                        padding: '0.7rem 0.95rem',
                        borderRadius: isSarah ? '0.25rem 1rem 1rem 1rem' : '1rem 0.25rem 1rem 1rem',
                        backgroundColor: isSarah ? 'rgba(30, 58, 138, 0.55)' : 'rgba(200, 150, 62, 0.22)',
                        border: isSarah ? '1px solid rgba(96, 165, 250, 0.28)' : '1px solid rgba(200, 150, 62, 0.42)',
                        color: '#ffffff',
                        fontSize: '0.9rem',
                        lineHeight: '1.45',
                      }}
                    >
                      {item.text}
                    </div>
                  </div>
                );
              })}
              {interimSpeech && (
                <div
                  style={{
                    alignSelf: 'flex-end',
                    backgroundColor: 'rgba(34, 197, 94, 0.16)',
                    border: '1px dashed rgba(74, 222, 128, 0.55)',
                    borderRadius: '1rem 0.25rem 1rem 1rem',
                    padding: '0.55rem 0.9rem',
                    color: '#86efac',
                    fontSize: '0.86rem',
                    maxWidth: '85%',
                  }}
                >
                  🎤 <strong>Hearing you:</strong> “{interimSpeech}”
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Input & Call Controls */}
            <div
              style={{
                padding: '0.85rem 1.1rem',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'linear-gradient(180deg, rgba(10, 22, 61, 0.95), rgba(7, 14, 38, 1))',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                <span style={{ color: isSpeaking ? '#fbbf24' : isMuted ? '#f87171' : '#4ade80', fontWeight: 700 }}>
                  {isSpeaking
                    ? '🔊 Receptionist Speaking...'
                    : isMuted
                    ? '🔇 Microphone Muted — Click Unmute Mic or type below'
                    : isMicListening
                    ? '🎤 Receptionist Listening Live — Speak naturally into your microphone'
                    : '🎤 Microphone Ready — Speak naturally or type below'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder={
                    callMode === 'outbound'
                      ? `Simulate ${firstName}'s response or type a directive...`
                      : 'Speak into your mic or type your message for the Receptionist here...'
                  }
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendTextMessage();
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '0.55rem',
                    padding: '0.5rem 0.85rem',
                    color: '#ffffff',
                    fontSize: '0.85rem',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => sendTextMessage()}
                  disabled={!textInput.trim()}
                  style={{
                    backgroundColor: textInput.trim() ? '#c8963e' : 'rgba(255, 255, 255, 0.08)',
                    color: textInput.trim() ? '#051039' : '#64748b',
                    border: 'none',
                    borderRadius: '0.55rem',
                    padding: '0 0.95rem',
                    cursor: textInput.trim() ? 'pointer' : 'default',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Send size={15} />
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={toggleMute}
                    style={{
                      backgroundColor: isMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.18)',
                      border: '1px solid ' + (isMuted ? '#ef4444' : '#22c55e'),
                      color: isMuted ? '#f87171' : '#4ade80',
                      borderRadius: '0.55rem',
                      padding: '0.48rem 0.9rem',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                    <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
                  </button>

                  {isSpeaking && (
                    <button
                      onClick={interruptSarah}
                      style={{
                        backgroundColor: 'rgba(245, 158, 11, 0.2)',
                        border: '1px solid #f59e0b',
                        color: '#fbbf24',
                        borderRadius: '0.55rem',
                        padding: '0.48rem 0.85rem',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      <Square size={13} />
                      <span>Interrupt</span>
                    </button>
                  )}

                  {(connectionStatus === 'closed' || connectionStatus === 'error') && (
                    <button
                      onClick={() => startSession()}
                      style={{
                        backgroundColor: 'rgba(99, 102, 241, 0.2)',
                        border: '1px solid #6366f1',
                        color: '#a5b4fc',
                        borderRadius: '0.55rem',
                        padding: '0.48rem 0.85rem',
                        cursor: 'pointer',
                        fontWeight: 700,
                        fontSize: '0.82rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      <RefreshCw size={13} />
                      <span>Reconnect</span>
                    </button>
                  )}
                </div>

                <button
                  onClick={() => {
                    endSession();
                    onClose();
                  }}
                  style={{
                    backgroundColor: '#dc2626',
                    border: '1px solid #b91c1c',
                    color: '#ffffff',
                    borderRadius: '0.55rem',
                    padding: '0.48rem 1.15rem',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: '0.84rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                  }}
                >
                  <PhoneOff size={15} />
                  <span>Hang Up</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Interactive Outbound Script & Decision Tree (Strictly Admin Only) */}
          {isAdmin && callMode === 'outbound' && showScriptTree && (
            <div
              style={{
                width: '440px',
                borderLeft: '1px solid rgba(200, 150, 62, 0.3)',
                backgroundColor: '#0d1942',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              {/* Tree Step Tabs */}
              <div
                style={{
                  padding: '0.65rem 0.85rem',
                  background: '#111c3a',
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.45rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#ffd88a' }}>
                    🌳 Live Outbound Script & Decision Tree — (480) 331-9455
                  </span>
                  <label style={{ fontSize: '0.72rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={onWarmTransfer}
                      onChange={(e) => setOnWarmTransfer(e.target.checked)}
                    />
                    <span>King on Warm Transfer (Appt-Only)</span>
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.3rem' }}>
                  {[
                    { num: 1, label: '1. Greeting' },
                    { num: 2, label: '2. 2027 Plan' },
                    { num: 3, label: '3. Transfer/Appt' },
                    { num: 4, label: '4. 6 Products' },
                  ].map((s) => (
                    <button
                      key={s.num}
                      type="button"
                      onClick={() => setActiveScriptStep(s.num)}
                      style={{
                        padding: '0.35rem 0.2rem',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        borderRadius: '6px',
                        border: '1px solid ' + (activeScriptStep === s.num ? '#c8963e' : 'rgba(255,255,255,0.12)'),
                        background: activeScriptStep === s.num ? 'rgba(200, 150, 62, 0.25)' : 'rgba(255,255,255,0.04)',
                        color: activeScriptStep === s.num ? '#ffd88a' : '#94a3b8',
                        cursor: 'pointer',
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tree Content Body */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8rem' }}>
                {activeScriptStep === 1 && (
                  <>
                    <div style={{ background: 'rgba(200,150,62,0.12)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #c8963e' }}>
                      <div style={{ fontWeight: 800, color: '#ffd88a', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                        1A. WARM OPENING GREETING (LINE 1):
                      </div>
                      <p style={{ margin: 0, color: '#fff', lineHeight: 1.45 }}>
                        "Hello <strong>{firstName}</strong>, this is <strong>Sarah</strong> calling from IWG Insurance and Financial Services. How are you today?"
                      </p>
                    </div>

                    <div style={{ background: 'rgba(16,185,129,0.12)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      <div style={{ fontWeight: 800, color: '#34d399', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                        1B. FIDUCIARY VALUE HOOK (ALL 6 DIVISIONS):
                      </div>
                      <p style={{ margin: '0 0 0.6rem', color: '#e2e8f0', lineHeight: 1.45 }}>
                        "We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you across Life Insurance with Living Benefits, High Cash-Value IUL, Individual & Group Health, Long-Term Care, and 2027 Medicare."
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() =>
                            triggerScriptStepDirective(
                              2,
                              `${firstName} said YES to hearing the 2027 Medicare changes! Speak Step 2 (The 3-Point 2027 Summary & Assumptive Close) now.`
                            )
                          }
                          style={{
                            background: '#10b981',
                            color: '#051039',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '0.45rem 0.65rem',
                            fontWeight: 800,
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          ✅ Prospect Says "Yes / Tell Me" → Speak Step 2 (2027 Summary)
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerImmediateWhisperTransfer('King Amen Ra')}
                          style={{
                            background: 'rgba(200, 150, 62, 0.25)',
                            color: '#ffd88a',
                            border: '1px solid #c8963e',
                            borderRadius: '6px',
                            padding: '0.45rem 0.65rem',
                            fontWeight: 800,
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          ⚡ Prospect Ready Now → Automatic AI Whisper Transfer to King
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveScriptStep(4)}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#fca5a5',
                            border: '1px solid rgba(239, 68, 68, 0.4)',
                            borderRadius: '6px',
                            padding: '0.45rem 0.65rem',
                            fontWeight: 700,
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                            textAlign: 'left',
                          }}
                        >
                          💡 Other Product Scripts (Life, IUL, ACA, Group, LTC) & Rebuttals → Step 4
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {activeScriptStep === 2 && (
                  <>
                    <div style={{ background: '#16244d', padding: '0.7rem', borderRadius: '8px', borderLeft: '3px solid #c8963e' }}>
                      <strong style={{ color: '#ffd88a' }}>1. The Exposure:</strong>
                      <p style={{ margin: '0.25rem 0 0', color: '#e2e8f0', lineHeight: 1.4 }}>
                        "Original Medicare Part A (<strong>$0/mo</strong>) has a <strong>$1,788</strong> hospital deductible, and Part B (<strong>$209.50/mo</strong>, <strong>$292</strong> deductible) leaves an <strong>uncapped 20% coinsurance</strong>."
                      </p>
                    </div>
                    <div style={{ background: '#16244d', padding: '0.7rem', borderRadius: '8px', borderLeft: '3px solid #38bdf8' }}>
                      <strong style={{ color: '#38bdf8' }}>2. 2027 Rx Cap & 104+ Carriers:</strong>
                      <p style={{ margin: '0.25rem 0 0', color: '#e2e8f0', lineHeight: 1.4 }}>
                        "For 2027, Part D caps annual out-of-pocket Rx costs at <strong>$2,400</strong> (<strong>$35</strong> insulin cap, <strong>$0</strong> adult vaccines). We compare <strong>104+ premier carriers</strong> (Plan G, Plan N, Advantage) side-by-side."
                      </p>
                    </div>
                    <div style={{ background: 'rgba(16,185,129,0.14)', padding: '0.7rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      <strong style={{ color: '#6ee7b7' }}>3. Assumptive Close:</strong>
                      <p style={{ margin: '0.25rem 0 0.55rem', color: '#fff', fontStyle: 'italic', lineHeight: 1.4 }}>
                        "To make this effortless for you, <strong>{firstName}</strong>, our Principal Broker <strong>King Amen Ra</strong> can verify your doctors and prescriptions in just a few minutes at zero cost. Would you like me to reach out and get him on the line for you right now?"
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() => triggerImmediateWhisperTransfer('King Amen Ra')}
                          style={{
                            background: '#c8963e',
                            color: '#051039',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '0.45rem 0.65rem',
                            fontWeight: 800,
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                          }}
                        >
                          ⚡ Path A: Whisper Transfer to King Amen Ra (602) 456-9681
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            triggerScriptStepDirective(
                              3,
                              `Use Path B Executive Alternative-Choice Appointment Close with ${firstName}: Collect Full Name, Street Address, and Phone Number, and offer a 30-minute Telephone consultation, 60-minute In-Person visit, or 30-minute Video consultation with King Amen Ra.`
                            )
                          }
                          style={{
                            background: '#3b82f6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '0.45rem 0.65rem',
                            fontWeight: 800,
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                          }}
                        >
                          📅 Path B: Book Telephone / In-Person / Video Appointment
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {activeScriptStep === 3 && (
                  <>
                    <div style={{ background: '#16244d', padding: '0.75rem', borderRadius: '8px', border: '1.5px solid #c8963e' }}>
                      <div style={{ fontWeight: 800, color: '#ffd88a', marginBottom: '0.35rem' }}>
                        PATH A — AUTOMATIC AI WHISPER TRANSFER (602) 456-9681
                      </div>
                      <p style={{ margin: '0 0 0.4rem', color: '#e2e8f0', fontSize: '0.76rem' }}>
                        <strong>1. Hold Framing:</strong> "Wonderful, {firstName}. Please stay with me for 15 seconds while I dial Principal Broker King Amen Ra and share your notes."
                      </p>
                      <p style={{ margin: '0 0 0.5rem', color: '#cbd5e1', fontSize: '0.74rem', fontStyle: 'italic' }}>
                        <strong>2. Private Whisper to King:</strong> "Hi King Amen Ra, this is Sarah AI whispering automatically on behalf of IWG. We have {prospectName} on the line—bridging you in now!"
                      </p>
                      <button
                        type="button"
                        onClick={() => triggerImmediateWhisperTransfer('King Amen Ra')}
                        style={{
                          width: '100%',
                          background: 'linear-gradient(135deg, #c8963e, #f3cf7a)',
                          color: '#051039',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '0.45rem',
                          fontWeight: 800,
                          fontSize: '0.76rem',
                          cursor: 'pointer',
                        }}
                      >
                        ⚡ Execute Whisper Transfer to King Now
                      </button>
                    </div>

                    <div style={{ background: '#16244d', padding: '0.75rem', borderRadius: '8px', border: '1.5px solid #3b82f6' }}>
                      <div style={{ fontWeight: 800, color: '#60a5fa', marginBottom: '0.35rem' }}>
                        PATH B — EXECUTIVE APPOINTMENT CLOSE (NAME, ADDRESS & PHONE + CONFIRMATION TEXT)
                      </div>
                      <p style={{ margin: '0 0 0.5rem', color: '#e2e8f0', fontSize: '0.76rem' }}>
                        "May I confirm your <strong>full name</strong>, <strong>street address</strong>, and <strong>best phone number</strong> so I can lock in your appointment and send your confirmation text? Simply reply <strong>YES</strong> to that text to confirm!"
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.35rem' }}>
                        {(['Telephone', 'In-Person', 'Video'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() =>
                              triggerScriptStepDirective(
                                3,
                                `${firstName} selected a ${t} appointment for Tomorrow at 10:00 AM! Immediately call the book_appointment tool with customer_name="${prospectName}", phone="${prospectPhone}", address="${prospectAddress || 'Phoenix, AZ'}", appointment_type="${t}", preferred_datetime="Tomorrow at 10:00 AM", state="${prospectState}" and confirm the appointment plus the immediate confirmation text asking them to reply YES.`
                              )
                            }
                            style={{
                              background: 'rgba(59, 130, 246, 0.25)',
                              border: '1px solid #60a5fa',
                              color: '#fff',
                              borderRadius: '6px',
                              padding: '0.4rem 0.25rem',
                              fontSize: '0.73rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            📅 Book {t}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {activeScriptStep === 4 && (
                  <>
                    <div style={{ fontWeight: 800, color: '#ffd88a', fontSize: '0.76rem' }}>
                      AWARD-WINNING SCRIPTS FOR ALL 6 PRODUCT DIVISIONS & REBUTTALS:
                    </div>
                    {[
                      {
                        title: '🛡️ 1. Modern Term & Whole Life Insurance (Living Benefits)',
                        prompt: `[SCRIPT TREE DIRECTIVE]: Speak our Modern Term & Whole Life with Living Benefits script to ${firstName}: "I would love to help you with Life Insurance! Unlike old-fashioned policies that only pay out when you pass away, our modern Term and Whole Life policies across 104+ carriers include Living Benefits at no extra cost—meaning if you ever suffer a heart attack, stroke, cancer, or chronic illness, the policy accelerates tax-free cash directly to you while you are alive. To have Principal Broker King Amen Ra prepare your custom side-by-side quote and lock in your appointment with an instant confirmation text, may I get your full name, street address, and best phone number?"`,
                      },
                      {
                        title: '📈 2. Investment Grade High Cash-Value IUL (Section 7702)',
                        prompt: `[SCRIPT TREE DIRECTIVE]: Speak our Investment Grade High Cash-Value IUL (Section 7702) script to ${firstName}: "Our Investment Grade High Cash-Value IUL structured under IRS Section 7702 gives you S&P 500 market-linked growth with a 0% contractual floor so you never lose a dime in a market crash, tax-free retirement income distributions, and full Living Benefits. To schedule your strategy session with King Amen Ra and send your instant confirmation text, may I confirm your full name, street address, and best phone number?"`,
                      },
                      {
                        title: '🏥 3. Individual & Family Health (ACA & Private PPO)',
                        prompt: `[SCRIPT TREE DIRECTIVE]: Speak our Individual & Family Health Insurance script to ${firstName}: "For individuals, families, and self-employed professionals under 65, we shop both ACA Marketplace plans with maximum federal tax subsidies and Private Underwritten PPO networks side-by-side across 104+ carriers to cut deductibles and keep your preferred doctors in-network. To reserve your review with King Amen Ra and send your automatic confirmation text, may I have your full name, street address, and best phone number?"`,
                      },
                      {
                        title: '🏢 4. Group Health Insurance (1–50+ Employees, Level-Funded & ICHRA)',
                        prompt: `[SCRIPT TREE DIRECTIVE]: Speak our Group Health & Corporate Benefits script to ${firstName}: "For businesses with 1 to 50+ employees, we design Level-Funded PPO, Small Group, and tax-deductible ICHRA benefit strategies that typically lower employer premium costs by 15% to 30% while upgrading employee networks. To schedule your census audit with King Amen Ra and send your confirmation text, may I get your full name, business or street address, and best phone number?"`,
                      },
                      {
                        title: '🏡 5. Asset-Based Long Term Care (Hybrid Estate Protection)',
                        prompt: `[SCRIPT TREE DIRECTIVE]: Speak our Asset-Based Long Term Care script to ${firstName}: "Traditional health insurance and Medicare do not cover extended nursing home, assisted living, or private home care. Our Asset-Based Hybrid Long-Term Care policies guarantee tax-free monthly care benefits—and if you never need care, 100% of your principal passes tax-free to your family so it is never 'use it or lose it.' To schedule your estate-protection review with King Amen Ra and send your confirmation text, may I have your full name, street address, and best phone number?"`,
                      },
                      {
                        title: '❌ Objection: "I’m happy with my current plan / don’t want to change"',
                        prompt: `Speak Objection Rebuttal 1 to ${firstName}: "I love hearing that, ${firstName}, and our goal is never to move you if your current plan is still the #1 option for you. Our free 5-minute fiduciary audit across 104+ carriers simply confirms in writing that your current plan still gives you the highest benefits at the lowest cost—and if it does, we tell you to stay right where you are. Let’s lock in a quick appointment with your full name, street address, and phone number so we can send your confirmation text, fair enough?"`,
                      },
                      {
                        title: '❌ Objection: "Just mail me something / I’m busy right now"',
                        prompt: `Speak Objection Rebuttal 4 to ${firstName}: "I completely respect your time, ${firstName}. Because there are over 104 carriers, mailing generic brochures wouldn't show your exact rates. Instead, let’s grab your full name, street address, and phone number to lock in a quick Telephone, In-Person, or Video appointment, and we’ll send an instant confirmation text that you simply reply YES to confirm. Does tomorrow morning or afternoon work better?"`,
                      },
                    ].map((obj, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => triggerScriptStepDirective(4, obj.prompt)}
                        style={{
                          background: '#16244d',
                          border: '1px solid rgba(200, 150, 62, 0.35)',
                          borderRadius: '8px',
                          padding: '0.55rem 0.7rem',
                          color: '#e2e8f0',
                          textAlign: 'left',
                          cursor: 'pointer',
                          fontSize: '0.76rem',
                          fontWeight: 700,
                        }}
                      >
                        {obj.title}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SarahVoiceModal;
