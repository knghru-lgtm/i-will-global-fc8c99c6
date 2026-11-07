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
  appointment_type: string;
  confirmed_datetime: string;
  message: string;
}

interface WhisperTransferConfirmation {
  recipient_name: string;
  recipient_phone: string;
  prospect_name: string;
  whisper_briefing: string;
  merge_introduction: string;
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
  const [callMode, setCallMode] = useState<'inbound' | 'outbound'>('inbound');
  const [leadId, setLeadId] = useState<string>('');
  const [prospectName, setProspectName] = useState<string>('Medicare Beneficiary');
  const [prospectPhone, setProspectPhone] = useState<string>('(623) 223-0165');
  const [prospectState, setProspectState] = useState<string>('AZ');
  const [prospectAddress, setProspectAddress] = useState<string>('');
  const [onWarmTransfer, setOnWarmTransfer] = useState<boolean>(false);

  // Outbound Lead Queue & Script Tree state
  const [leadQueue, setLeadQueue] = useState<any[]>([]);
  const [queueIndex, setQueueIndex] = useState<number>(0);
  const [activeScriptStep, setActiveScriptStep] = useState<number>(1);
  const [showScriptTree, setShowScriptTree] = useState<boolean>(true);

  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error' | 'closed'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [userVolume, setUserVolume] = useState(0);
  const [sarahVolume, setSarahVolume] = useState(0);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [textInput, setTextInput] = useState('');
  const [confirmedAppt, setConfirmedAppt] = useState<AppointmentConfirmation | null>(null);
  const [whisperTransfer, setWhisperTransfer] = useState<WhisperTransferConfirmation | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const httpModeRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const transcriptsRef = useRef<TranscriptItem[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    transcriptsRef.current = transcripts;
  }, [transcripts]);

  const speakBrowserText = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const femaleVoice =
        voices.find((v) => /zira|aria|samantha|jenny|google us english|female/i.test(v.name) && /en/i.test(v.lang)) ||
        voices.find((v) => /en-US/i.test(v.lang));
      if (femaleVoice) utter.voice = femaleVoice;
      utter.rate = 1.03;
      utter.pitch = 1.05;
      utter.onstart = () => {
        setIsSpeaking(true);
        setSarahVolume(0.65);
      };
      utter.onend = () => {
        setIsSpeaking(false);
        setSarahVolume(0);
      };
      utter.onerror = () => {
        setIsSpeaking(false);
        setSarahVolume(0);
      };
      window.speechSynthesis.speak(utter);
    } catch {}
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
    }
  ) => {
    try {
      const historyPayload = transcriptsRef.current
        .filter((t) => (t.speaker === 'sarah' || t.speaker === 'user') && !t.isAction)
        .slice(-10)
        .map((t) => ({ speaker: t.speaker as 'sarah' | 'user', text: t.text }));

      const res = await fetch('/api/sarah/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          is_initial: Boolean(ctxOverride?.is_initial),
          history: historyPayload,
          context: {
            mode: ctxOverride?.mode || callMode,
            lead_id: ctxOverride?.lead_id !== undefined ? ctxOverride.lead_id : leadId,
            prospect_name: ctxOverride?.prospect_name || prospectName,
            prospect_phone: ctxOverride?.phone !== undefined ? ctxOverride.phone : prospectPhone,
            state: ctxOverride?.state || prospectState,
            address: ctxOverride?.address !== undefined ? ctxOverride.address : prospectAddress,
            on_warm_transfer: ctxOverride?.on_warm_transfer !== undefined ? ctxOverride.on_warm_transfer : onWarmTransfer,
          },
        }),
      }).then((r) => r.json());

      if (res?.reply) {
        appendNewTranscript('sarah', res.reply);
        speakBrowserText(res.reply);
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
      }

      if (res?.appointment?.success) {
        setConfirmedAppt(res.appointment);
        setActiveScriptStep(3);
        setTranscripts((prev) => [
          ...prev,
          {
            id: 'appt_' + Date.now(),
            speaker: 'system',
            text: `📅 Official Appointment Confirmed on (480) 331-9455: ${res.appointment.customer_name} (${res.appointment.appointment_type}) — ${res.appointment.confirmed_datetime}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isAction: true,
          },
        ]);
        window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
      }

      if (res?.transfer?.success) {
        setWhisperTransfer(res.transfer);
        setActiveScriptStep(3);
        if (res.transfer.recipient_phone) {
          openGoogleVoiceWindow(res.transfer.recipient_phone);
        }
        setTranscripts((prev) => [
          ...prev,
          {
            id: 'wt_' + Date.now(),
            speaker: 'system',
            text: `⚡ Google Voice Automatic AI Whisper Transfer to ${res.transfer.recipient_name} (${res.transfer.recipient_phone}) — Whisper Briefing Delivered & 3-Way Call Merged!`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isAction: true,
          },
        ]);
        window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
      }
    } catch (err) {
      console.warn('Sarah HTTP turn error:', err);
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
    setConnectionStatus('connected');
    setErrorMessage(null);

    // Start Browser SpeechRecognition if supported
    try {
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        const rec = new SpeechRec();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = 'en-US';
        rec.onresult = (ev: any) => {
          const lastIdx = ev.results.length - 1;
          const spoken = ev.results[lastIdx]?.[0]?.transcript?.trim();
          if (spoken) {
            appendNewTranscript('user', spoken);
            sendHttpTurn(spoken, ctx);
          }
        };
        rec.onerror = () => {};
        rec.onend = () => {
          if (httpModeRef.current && !isMuted) {
            try {
              rec.start();
            } catch {}
          }
        };
        recognitionRef.current = rec;
        rec.start();
      }
    } catch {}

    await sendHttpTurn('', { ...ctx, is_initial: true });
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

  // Load CRM lead queue for Outbound Caller mode (preserve default test number (623) 223-0165 unless user clicks Queue Prev/Next)
  useEffect(() => {
    if (!isOpen) return;
    api
      .get('/calls/queue?limit=50')
      .then((res) => {
        const rows = res?.rows || [];
        setLeadQueue(rows);
      })
      .catch(() => {});
  }, [isOpen]);

  // Apply initial launch payload when modal opens
  useEffect(() => {
    if (isOpen) {
      const nextMode = initialPayload?.mode || 'inbound';
      const nextLeadId = initialPayload?.lead_id || '';
      const nextName = initialPayload?.prospect_name || 'Medicare Beneficiary';
      const nextPhone = initialPayload?.phone || '(623) 223-0165';
      const nextState = initialPayload?.state || 'AZ';
      const nextAddr = initialPayload?.address || '';
      const nextWT = Boolean(initialPayload?.on_warm_transfer);

      setCallMode(nextMode);
      if (initialPayload?.lead_id) setLeadId(nextLeadId);
      if (initialPayload?.prospect_name) setProspectName(nextName);
      setProspectPhone(nextPhone);
      if (initialPayload?.state) setProspectState(nextState);
      if (initialPayload?.address) setProspectAddress(nextAddr);
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

  const selectQueueLead = (idx: number) => {
    const lead = leadQueue[idx];
    if (!lead) return;
    setQueueIndex(idx);
    const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Medicare Beneficiary';
    setLeadId(lead.id || '');
    setProspectName(fullName);
    setProspectPhone(lead.phone || '');
    setProspectState(lead.state || 'AZ');
    setProspectAddress(lead.address || '');
    setActiveScriptStep(1);
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
    const activeMode = overrideParams?.mode || callMode;
    const activeLeadId = overrideParams?.lead_id !== undefined ? overrideParams.lead_id : leadId;
    const activeName = overrideParams?.prospect_name || prospectName || 'Medicare Beneficiary';
    const activePhone = overrideParams?.phone !== undefined ? overrideParams.phone : prospectPhone;
    const activeState = overrideParams?.state || prospectState || 'AZ';
    const activeAddress = overrideParams?.address !== undefined ? overrideParams.address : prospectAddress;
    const activeWT = overrideParams?.on_warm_transfer !== undefined ? overrideParams.on_warm_transfer : onWarmTransfer;

    setConnectionStatus('connecting');
    setErrorMessage(null);
    setConfirmedAppt(null);
    setWhisperTransfer(null);
    setActiveScriptStep(1);

    setTranscripts([
      {
        id: 'sys_' + Date.now(),
        speaker: 'system',
        text:
          activeMode === 'outbound'
            ? `📞 Outbound Caller on (480) 331-9455 — Dialing ${activeName}${activePhone ? ` (${activePhone})` : ''} using Unified Outbound Script & Tree...`
            : `🏢 Virtual Receptionist on (480) 331-9455 — Answering Inbound Call (100% Free Fiduciary Advisory & 42-Member Directory)...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]);

    const player = new AudioPlayer({
      sampleRate: 24000,
      onVolumeChange: (vol) => setSarahVolume(vol),
      onPlaybackStateChange: (playing) => setIsSpeaking(playing),
    });
    playerRef.current = player;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const qs = new URLSearchParams({
        mode: activeMode,
        lead_id: activeLeadId || '',
        prospect_name: activeName,
        phone: activePhone || '',
        state: activeState,
        address: activeAddress || '',
        on_warm_transfer: String(Boolean(activeWT)),
      });
      const wsUrl = `${protocol}//${window.location.host}/api/sarah/live?${qs.toString()}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        setConnectionStatus('connected');
        try {
          const recorder = new AudioRecorder({
            sampleRate: 16000,
            onAudioData: (base64) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'audio', data: base64 }));
              }
            },
            onVolumeChange: (vol) => setUserVolume(vol),
            onError: (err) => {
              console.warn('Microphone warning:', err);
            },
          });
          recorderRef.current = recorder;
          await recorder.start();
        } catch (micErr: any) {
          console.warn('Microphone access denied or unavailable, continuing in text/listen mode:', micErr);
          setTranscripts((prev) => [
            ...prev,
            {
              id: 'mic_warn_' + Date.now(),
              speaker: 'system',
              text: 'Microphone muted or permission not granted. You can listen to Sarah and use the Script Tree buttons or text input below.',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'ready') {
            setConnectionStatus('connected');
            const topicToUse = initialPayload?.initialTopic || initialTopic;
            if (topicToUse) {
              sendTextMessage(topicToUse);
            }
          } else if (data.type === 'audio' && data.data) {
            player.enqueueChunk(data.data);
          } else if (data.type === 'transcript') {
            appendOrUpdateTranscript(data.speaker, data.text);
            // Automatically advance script step tracker when Sarah speaks key phrases
            if (data.speaker === 'sarah' && typeof data.text === 'string') {
              const lower = data.text.toLowerCase();
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
            }
          } else if (data.type === 'interrupted') {
            player.stop();
          } else if (data.type === 'appointment_confirmed') {
            setConfirmedAppt(data.appointment);
            setActiveScriptStep(3);
            setTranscripts((prev) => [
              ...prev,
              {
                id: 'appt_' + Date.now(),
                speaker: 'system',
                text: `📅 Official Appointment Confirmed on (480) 331-9455: ${data.appointment.customer_name} (${data.appointment.appointment_type}) — ${data.appointment.confirmed_datetime}`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isAction: true,
              },
            ]);
            window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
          } else if (data.type === 'whisper_transfer_initiated') {
            setWhisperTransfer(data.transfer);
            setActiveScriptStep(3);
            if (data.transfer?.recipient_phone) {
              openGoogleVoiceWindow(data.transfer.recipient_phone);
            }
            setTranscripts((prev) => [
              ...prev,
              {
                id: 'wt_' + Date.now(),
                speaker: 'system',
                text: `⚡ Google Voice Automatic AI Whisper Transfer to ${data.transfer.recipient_name} (${data.transfer.recipient_phone}) — Whisper Briefing Delivered & 3-Way Call Merged!`,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                isAction: true,
              },
            ]);
            window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
          } else if (data.type === 'error') {
            setErrorMessage(data.message || 'Voice service error');
            setConnectionStatus('error');
          }
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };

      let wsOpened = false;
      const fallbackCtx = {
        mode: activeMode,
        lead_id: activeLeadId,
        prospect_name: activeName,
        phone: activePhone,
        state: activeState,
        address: activeAddress,
        on_warm_transfer: Boolean(activeWT),
      };

      const prevOnOpen = ws.onopen;
      ws.onopen = async (ev) => {
        wsOpened = true;
        if (prevOnOpen) await (prevOnOpen as any).call(ws, ev);
      };

      ws.onerror = () => {
        if (!wsOpened) {
          activateHttpVoiceFallback(fallbackCtx);
        }
      };

      ws.onclose = () => {
        if (!wsOpened || !httpModeRef.current) {
          if (!wsOpened) {
            activateHttpVoiceFallback(fallbackCtx);
          } else {
            setConnectionStatus('closed');
          }
        }
      };
    } catch (err: any) {
      activateHttpVoiceFallback({
        mode: activeMode,
        lead_id: activeLeadId,
        prospect_name: activeName,
        phone: activePhone,
        state: activeState,
        address: activeAddress,
        on_warm_transfer: Boolean(activeWT),
      });
    }
  };

  const endSession = () => {
    httpModeRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
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

  const appendOrUpdateTranscript = (speaker: 'sarah' | 'user', text: string) => {
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker && !last.isAction) {
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            text: last.text.endsWith(' ') ? last.text + text : last.text + ' ' + text,
          },
        ];
      }
      return [
        ...prev,
        {
          id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          speaker,
          text,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ];
    });
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    recorderRef.current?.setMuted(next);
    if (recognitionRef.current) {
      try {
        if (next) recognitionRef.current.stop();
        else recognitionRef.current.start();
      } catch {}
    }
  };

  const interruptSarah = () => {
    playerRef.current?.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    setIsSpeaking(false);
    setSarahVolume(0);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end_turn' }));
    }
  };

  const sendTextMessage = (textToSend?: string) => {
    const text = textToSend || textInput.trim();
    if (!text) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text }));
      appendOrUpdateTranscript('user', text);
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
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'script_step', prompt: directiveText }));
    } else {
      sendHttpTurn(`[SCRIPT TREE DIRECTIVE]: ${directiveText}`);
    }
  };

  const triggerImmediateWhisperTransfer = (recipientName = 'King Amen Ra') => {
    setActiveScriptStep(3);
    playerRef.current?.stop();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'execute_whisper_transfer',
          recipient_name: recipientName,
        })
      );
    } else {
      openGoogleVoiceWindow('+16024569681');
      sendHttpTurn(`Please transfer me to ${recipientName} right now.`);
    }
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
          maxWidth: callMode === 'outbound' && showScriptTree ? '1180px' : '780px',
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
              S
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: '1.12rem', color: '#ffffff' }}>
                  Sarah — Line (480) 331-9455
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
                  {callMode === 'inbound' ? '🏢 Virtual Receptionist (Inbound)' : '📞 Outbound Caller (Script & Tree)'}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.15rem' }}>
                <Shield size={13} color="#c8963e" />
                <span>Medicare Helpline by IWG • 104+ Carriers • Whisper Transfer to King Amen Ra (602) 456-9681</span>
              </div>
            </div>
          </div>

          {/* Mode Toggle Tabs: Virtual Receptionist vs Outbound Caller on (480) 331-9455 */}
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
                <span>Virtual Receptionist (480) 331-9455</span>
              </button>
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
                <span>Outbound Caller (Script & Tree)</span>
              </button>
            </div>

            {callMode === 'outbound' && (
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
              title="Close voice session"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Inbound Google Voice Receptionist Bar (Visible in Inbound Mode) */}
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
            <div style={{ fontSize: '0.8rem', color: '#d1fae5', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span>🎧 <strong>Google Voice Inbound Receptionist on (480) 331-9455:</strong></span>
              <span>Sarah answers incoming Google Voice calls 24/7, funnels 6 product lines, and transfers via Google Voice to all 42 directory members.</span>
            </div>
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
          </div>
        )}

        {/* Outbound Caller Target Bar (Visible in Outbound Mode) */}
        {callMode === 'outbound' && (
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
                Outbound Line (480) 331-9455 →
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
                  width: '175px',
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
                  width: '135px',
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
                  width: '52px',
                }}
              />
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
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  color: '#ffffff',
                  border: '1px solid #34d399',
                  borderRadius: '6px',
                  padding: '0.35rem 0.8rem',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  boxShadow: '0 2px 10px rgba(16, 185, 129, 0.35)',
                }}
                title="Dial this number on Google Voice (480) 331-9455 and start Sarah's Outbound Script simultaneously"
              >
                <span>📞 Call on Google Voice + Speak Script</span>
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
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                🔄 Restart Outbound Script
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
                  {connectionStatus === 'connecting' && 'Connecting Sarah on (480) 331-9455...'}
                  {connectionStatus === 'connected' && isSpeaking && 'Sarah is speaking on (480) 331-9455...'}
                  {connectionStatus === 'connected' && !isSpeaking && isMuted && 'Microphone muted (Click Unmute to speak)'}
                  {connectionStatus === 'connected' && !isSpeaking && !isMuted && 'Sarah is listening... (Speak naturally)'}
                  {connectionStatus === 'closed' && 'Call ended'}
                  {connectionStatus === 'error' && (errorMessage || 'Connection error')}
                </span>
              </div>

              {/* Whisper Transfer Confirmation Banner */}
              {whisperTransfer && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    backgroundColor: 'rgba(200, 150, 62, 0.2)',
                    border: '1px solid rgba(200, 150, 62, 0.5)',
                    borderRadius: '0.5rem',
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.78rem',
                    color: '#ffd88a',
                    maxWidth: '95%',
                  }}
                >
                  <div>
                    <strong>⚡ Automatic AI Whisper Transfer Connected:</strong> {whisperTransfer.recipient_name} ({whisperTransfer.recipient_phone})
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#e2e8f0', marginTop: '0.15rem', fontStyle: 'italic' }}>
                    Whispered privately: "{whisperTransfer.whisper_briefing}"
                  </div>
                </div>
              )}

              {/* Appointment Confirmation Banner */}
              {confirmedAppt && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.45)',
                    borderRadius: '0.5rem',
                    padding: '0.45rem 0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.78rem',
                    color: '#6ee7b7',
                  }}
                >
                  <CheckCircle2 size={15} color="#34d399" />
                  <span>
                    <strong>Appointment Booked!</strong> {confirmedAppt.appointment_type} consultation for{' '}
                    {confirmedAppt.customer_name} ({confirmedAppt.confirmed_datetime}) with King Amen Ra.
                  </span>
                </div>
              )}
            </div>

            {/* Quick Action Prompts (Tailored to Inbound Receptionist vs Outbound Caller) */}
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
                    🛡️ 2027 Medicare Funnel
                  </button>
                  <button
                    onClick={() => sendTextMessage('I want to book a 30-minute Telephone consultation with King Amen Ra.')}
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.4)',
                      borderRadius: '999px',
                      padding: '0.28rem 0.75rem',
                      color: '#6ee7b7',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    📅 Book Consultation
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
                    🏥 ACA / PPO Health
                  </button>
                  <button
                    onClick={() => sendTextMessage('Tell me about High Cash-Value IUL (Section 7702) and Asset-Based Long Term Care.')}
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
                    📈 IUL & LTC
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() =>
                      triggerScriptStepDirective(
                        1,
                        `Deliver Step 1 Warm Opening & 2027 Value Hook to ${firstName}: "Hello ${firstName}, this is Sarah calling from the Medicare Helpline powered by IWG Insurance and Financial Services. We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?"`
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
                        `Execute Step 3 Path B (Executive Alternative-Choice Appointment Close): Say to ${firstName}: "Because King Amen Ra is currently on a live consultation helping another family with their 2027 benefits, I want to reserve a dedicated one-on-one time for you on his private calendar so you receive his undivided attention. Do you prefer a 30-minute Telephone consultation, a 60-minute In-Person visit, or a 30-minute Video consultation—and would morning or afternoon work best for you?"`
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
                        {isSarah ? 'Sarah — (480) 331-9455' : callMode === 'outbound' ? firstName : 'Caller'}
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
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder={
                    callMode === 'outbound'
                      ? `Simulate ${firstName}'s response or type a directive for Sarah...`
                      : 'Speak into your mic or type a question for Sarah here...'
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

          {/* Right Column: Live Interactive Outbound Script & Decision Tree (Visible in Outbound Mode) */}
          {callMode === 'outbound' && showScriptTree && (
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
                    { num: 4, label: '4. Rebuttals' },
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
                        "Hello <strong>{firstName}</strong>, this is <strong>Sarah</strong> calling from the Medicare Helpline powered by IWG Insurance and Financial Services. How are you today?"
                      </p>
                    </div>

                    <div style={{ background: 'rgba(16,185,129,0.12)', padding: '0.75rem', borderRadius: '8px', borderLeft: '3px solid #10b981' }}>
                      <div style={{ fontWeight: 800, color: '#34d399', fontSize: '0.74rem', marginBottom: '0.25rem' }}>
                        1B. 2027 MEDICARE VALUE HOOK:
                      </div>
                      <p style={{ margin: '0 0 0.6rem', color: '#e2e8f0', lineHeight: 1.45 }}>
                        "We are a 100% free fiduciary advisory comparing over 104 premier carriers at zero cost to you. To give you the most accurate, side-by-side information about your Medicare options and protect your benefits, would you like to know about the upcoming changes for 2027?"
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
                          💡 Prospect Has Objection / Other Product → Step 4 Rebuttals
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
                              `Use Path B Executive Alternative-Choice Appointment Close with ${firstName}: Offer a 30-minute Telephone consultation, 60-minute In-Person visit, or 30-minute Video consultation with King Amen Ra.`
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
                        <strong>2. Private Whisper to King:</strong> "Hi King Amen Ra, this is Sarah AI whispering automatically on behalf of the Medicare Helpline by IWG. We have {prospectName} on the line—bridging you in now!"
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
                        PATH B — EXECUTIVE APPOINTMENT CLOSE (3 TYPES ONLY)
                      </div>
                      <p style={{ margin: '0 0 0.5rem', color: '#e2e8f0', fontSize: '0.76rem' }}>
                        "Do you prefer a <strong>30-minute Telephone consultation</strong>, a <strong>60-minute In-Person visit</strong>, or a <strong>30-minute Video consultation</strong>—and would morning or afternoon work best?"
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.35rem' }}>
                        {(['Telephone', 'In-Person', 'Video'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() =>
                              triggerScriptStepDirective(
                                3,
                                `${firstName} selected a ${t} appointment for Tomorrow at 10:00 AM! Immediately call the book_appointment tool with customer_name="${prospectName}", phone="${prospectPhone}", appointment_type="${t}", preferred_datetime="Tomorrow at 10:00 AM", state="${prospectState}" and confirm warmly.`
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
                    <div style={{ fontWeight: 800, color: '#f87171', fontSize: '0.76rem' }}>
                      CLICK ANY OBJECTION OR PRODUCT LINE FOR SARAH TO SPEAK:
                    </div>
                    {[
                      {
                        title: '❌ "I’m happy with my current plan / don’t want to change"',
                        prompt: `Speak Objection Rebuttal 1 to ${firstName}: "I love hearing that, ${firstName}, and our goal is never to move you if your current plan is still the #1 option for you. Because insurance carriers adjust their doctor networks, drug tiers, and copays for 2027, our free 5-minute fiduciary audit simply confirms in writing that your current plan still gives you the highest benefits at the lowest cost—and if it does, we tell you to stay right where you are. Let’s have King Amen Ra verify that for your peace of mind, fair enough?"`,
                      },
                      {
                        title: '❌ "How much does this cost? / What is the catch?"',
                        prompt: `Speak Objection Rebuttal 2 to ${firstName}: "There is never a fee, markup, or obligation—ever. By federal law, Medicare and insurance premiums are fixed, meaning you pay the exact same rate whether you navigate 104 carriers alone or have our Principal Broker King Amen Ra and clinical leadership under Aneesha Sullivan, PA advocate for you year-round for free."`,
                      },
                      {
                        title: '❌ "I already have a broker / agent"',
                        prompt: `Speak Objection Rebuttal 3 to ${firstName}: "That is wonderful—having an advocate is so important. Many of our clients keep their current plan until they ask us for a complimentary second opinion across all 104+ national carriers, since many agents only represent a handful of companies. It takes 3 minutes to verify you aren't overpaying for 2027—would you be open to a quick, no-obligation second look?"`,
                      },
                      {
                        title: '❌ "Just mail me something / I’m busy right now"',
                        prompt: `Speak Objection Rebuttal 4 to ${firstName}: "I completely respect your time, ${firstName}. Because there are over 104 carriers, mailing a stack of generic brochures wouldn't show which plan covers your specific doctors and prescriptions. Instead, let’s lock in a quick Telephone, In-Person, or Video appointment at a time that is convenient for you, and we’ll prepare your custom 1-page summary in advance. Does tomorrow morning or afternoon work better?"`,
                      },
                    ].map((obj, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => triggerScriptStepDirective(4, obj.prompt)}
                        style={{
                          background: '#16244d',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
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
