// IWG Main-World WebRTC Virtual Audio Bridge for Google Voice (480) 331-9455 (v9 — Zero Echo / Zero Noise / Pure Digital Isolation)
// 1. Feeds ONLY Sarah's digital Vindemiatrix audio into Google Voice's outgoing WebRTC stream (NEVER opens or mixes the PC's physical microphone).
// 2. Replaces the 440Hz oscillator with pure 0.0 digital silence + DynamicsCompressor soft limiter so there is zero hum, buzz, or clipping.
// 3. Never outputs Sarah's voice or the remote caller's voice to the PC's physical speakers (zero acoustic feedback loop).
// 4. Captures the remote caller's incoming WebRTC MediaStreamTrack directly in digital memory via WebAudio AnalyserNode + MediaRecorder.
(function () {
  if (typeof window === 'undefined' || window.__IWG_WEBRTC_BRIDGE_INSTALLED__) {
    return;
  }
  window.__IWG_WEBRTC_BRIDGE_INSTALLED__ = true;
  try {
    document.documentElement?.setAttribute('data-iwg-webrtc-bridge', 'ready');
  } catch {}

  let bridgeAudioCtx = null;
  let virtualMicDest = null;
  let sarahGainNode = null;
  let limiterNode = null;
  let activeSourceNode = null;
  let sarahSpeakingNow = false;
  let lastSarahEndedTs = 0;
  const hookedRemoteTrackIds = new Set();

  function ensureAudioGraph() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!bridgeAudioCtx || bridgeAudioCtx.state === 'closed') {
        bridgeAudioCtx = new AudioCtx({ sampleRate: 48000 });
        virtualMicDest = bridgeAudioCtx.createMediaStreamDestination();

        // Clean studio gain + brickwall soft limiter to prevent any WebRTC Opus clipping or distortion
        sarahGainNode = bridgeAudioCtx.createGain();
        sarahGainNode.gain.value = 0.85;

        limiterNode = bridgeAudioCtx.createDynamicsCompressor();
        limiterNode.threshold.value = -3.0;
        limiterNode.knee.value = 6.0;
        limiterNode.ratio.value = 12.0;
        limiterNode.attack.value = 0.002;
        limiterNode.release.value = 0.08;

        sarahGainNode.connect(limiterNode);
        limiterNode.connect(virtualMicDest);

        // Pure 0.0 DC constant source (zero frequency, zero tone, zero hum) so WebRTC RTP frames stay active during silence
        try {
          if (typeof bridgeAudioCtx.createConstantSource === 'function') {
            const zeroSource = bridgeAudioCtx.createConstantSource();
            zeroSource.offset.value = 0.0;
            zeroSource.connect(virtualMicDest);
            zeroSource.start();
          }
        } catch {}
      }
      if (bridgeAudioCtx.state === 'suspended') {
        bridgeAudioCtx.resume().catch(() => {});
      }
      return bridgeAudioCtx;
    } catch {
      return null;
    }
  }

  function getClonedVirtualAudioTrack() {
    ensureAudioGraph();
    if (!virtualMicDest || !virtualMicDest.stream) return null;
    const baseTrack = virtualMicDest.stream.getAudioTracks()[0];
    if (!baseTrack) return null;
    const cloned = baseTrack.clone();
    cloned.enabled = true;
    return cloned;
  }

  // 1. Intercept navigator.mediaDevices.getUserMedia — NEVER open the physical PC microphone!
  // Returning ONLY our pure digital virtual track eliminates 100% of room noise, fan noise, and speaker-to-mic echo.
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const wantsAudio = Boolean(constraints && constraints.audio);
      if (!wantsAudio) {
        return origGetUserMedia(constraints);
      }

      const virtualTrack = getClonedVirtualAudioTrack();
      if (virtualTrack) {
        return new MediaStream([virtualTrack]);
      }

      return origGetUserMedia(constraints);
    };
  }

  // 2. Attach VAD + MediaRecorder directly to incoming remote WebRTC audio tracks from the phone caller
  function monitorRemoteAudioStream(remoteStream) {
    if (!remoteStream || typeof remoteStream.getAudioTracks !== 'function') return;
    const audioTracks = remoteStream.getAudioTracks();
    if (!audioTracks || audioTracks.length === 0) return;
    const track = audioTracks[0];
    if (!track || hookedRemoteTrackIds.has(track.id)) return;
    hookedRemoteTrackIds.add(track.id);

    const ctx = ensureAudioGraph();
    if (!ctx) return;

    try {
      const streamForAnalysis = new MediaStream([track]);
      const source = ctx.createMediaStreamSource(streamForAnalysis);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Float32Array(analyser.fftSize);
      let recorder = null;
      let chunks = [];
      let isRecordingUtterance = false;
      let speechStartTs = 0;
      let lastVoiceTs = 0;

      const finishRecording = () => {
        if (!recorder || recorder.state === 'inactive') {
          isRecordingUtterance = false;
          return;
        }
        try {
          recorder.stop();
        } catch {
          isRecordingUtterance = false;
        }
      };

      const vadInterval = setInterval(() => {
        if (track.readyState === 'ended') {
          clearInterval(vadInterval);
          finishRecording();
          return;
        }
        const now = Date.now();
        // Do not record while Sarah is speaking or within 450ms after she finishes speaking
        if (sarahSpeakingNow || now - lastSarahEndedTs < 450) {
          if (isRecordingUtterance) {
            chunks = [];
            finishRecording();
          }
          return;
        }

        analyser.getFloatTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          sumSq += data[i] * data[i];
        }
        const rms = Math.sqrt(sumSq / data.length);

        if (rms > 0.014) {
          lastVoiceTs = now;
          if (!isRecordingUtterance) {
            try {
              const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';
              chunks = [];
              recorder = new MediaRecorder(streamForAnalysis, { mimeType });
              recorder.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) chunks.push(ev.data);
              };
              recorder.onstop = () => {
                isRecordingUtterance = false;
                const durationMs = Date.now() - speechStartTs;
                if (sarahSpeakingNow || chunks.length === 0 || durationMs < 350) {
                  chunks = [];
                  return;
                }
                const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                chunks = [];
                if (blob.size < 650) return;
                const reader = new FileReader();
                reader.onloadend = () => {
                  const dataUrl = String(reader.result || '');
                  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
                  if (b64) {
                    window.postMessage(
                      {
                        __iwg_webrtc__: true,
                        type: 'IWG_CALLER_WEBRTC_AUDIO',
                        audioBase64: b64,
                        mimeType: 'audio/webm',
                        durationMs,
                      },
                      '*'
                    );
                  }
                };
                reader.readAsDataURL(blob);
              };
              speechStartTs = now;
              isRecordingUtterance = true;
              recorder.start();
            } catch {
              isRecordingUtterance = false;
            }
          } else if (now - speechStartTs > 8500) {
            finishRecording();
          }
        } else if (isRecordingUtterance && now - lastVoiceTs > 700) {
          finishRecording();
        }
      }, 70);
    } catch {}
  }

  // 3. Wrap RTCPeerConnection and RTCRtpSender so outgoing audio ALWAYS uses our pure digital bus
  //    and incoming audio is captured without playing out loud on the PC speakers
  if (typeof window.RTCPeerConnection === 'function') {
    const OrigPeerConnection = window.RTCPeerConnection;
    const WrappedPeerConnection = function (...args) {
      const pc = new OrigPeerConnection(...args);

      pc.addEventListener('track', (ev) => {
        try {
          if (ev.track && ev.track.kind === 'audio') {
            const stream = (ev.streams && ev.streams[0]) || new MediaStream([ev.track]);
            monitorRemoteAudioStream(stream);
          }
        } catch {}
      });

      const origAddTrack = pc.addTrack.bind(pc);
      pc.addTrack = function (track, ...streams) {
        try {
          if (track && track.kind === 'audio') {
            const vTrack = getClonedVirtualAudioTrack();
            if (vTrack) {
              return origAddTrack(vTrack, ...streams);
            }
          }
        } catch {}
        return origAddTrack(track, ...streams);
      };

      return pc;
    };
    WrappedPeerConnection.prototype = OrigPeerConnection.prototype;
    Object.setPrototypeOf(WrappedPeerConnection, OrigPeerConnection);
    window.RTCPeerConnection = WrappedPeerConnection;
  }

  if (typeof window.RTCRtpSender === 'function' && window.RTCRtpSender.prototype?.replaceTrack) {
    const origReplaceTrack = window.RTCRtpSender.prototype.replaceTrack;
    window.RTCRtpSender.prototype.replaceTrack = function (withTrack) {
      try {
        if (withTrack && withTrack.kind === 'audio') {
          const vTrack = getClonedVirtualAudioTrack();
          if (vTrack) {
            return origReplaceTrack.call(this, vTrack);
          }
        }
      } catch {}
      return origReplaceTrack.call(this, withTrack);
    };
  }

  // Hook HTMLMediaElement.srcObject & play() so remote caller audio streams are tapped digitally
  // AND muted on the local PC speakers (volume = 0) so the caller NEVER hears speaker echo or feedback!
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
    if (desc && desc.set && desc.get) {
      Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        enumerable: true,
        get() {
          return desc.get.call(this);
        },
        set(val) {
          try {
            if (val && typeof val.getAudioTracks === 'function' && val.getAudioTracks().length > 0) {
              monitorRemoteAudioStream(val);
              // Silence local PC speaker rendering of the remote stream to prevent acoustic feedback
              this.volume = 0.0;
              this.muted = true;
            }
          } catch {}
          return desc.set.call(this, val);
        },
      });
    }
  } catch {}

  async function handlePlayWavRequest(base64, requestId) {
    const finish = (ok) => {
      window.postMessage(
        {
          __iwg_webrtc__: true,
          type: 'IWG_SARAH_PLAY_DONE',
          requestId,
          ok,
        },
        '*'
      );
    };

    if (!base64) {
      return finish(false);
    }

    try {
      const ctx = ensureAudioGraph();
      if (!ctx || !sarahGainNode) {
        return finish(false);
      }

      if (activeSourceNode) {
        try {
          activeSourceNode.stop();
          activeSourceNode.disconnect();
        } catch {}
        activeSourceNode = null;
      }

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      // IMPORTANT: Connect ONLY to sarahGainNode (WebRTC outgoing stream).
      // NEVER connect to ctx.destination (PC physical speakers) — prevents 100% of double-voice echo and room feedback!
      source.connect(sarahGainNode);

      sarahSpeakingNow = true;
      activeSourceNode = source;

      let doneCalled = false;
      const onEnded = (ok) => {
        if (doneCalled) return;
        doneCalled = true;
        if (activeSourceNode === source) {
          activeSourceNode = null;
          sarahSpeakingNow = false;
          lastSarahEndedTs = Date.now();
        }
        finish(ok);
      };

      const maxMs = Math.min(25000, Math.ceil((audioBuffer.duration || 10) * 1000) + 1200);
      const timer = setTimeout(() => onEnded(true), maxMs);
      source.onended = () => {
        clearTimeout(timer);
        onEnded(true);
      };
      source.start(0);
    } catch {
      sarahSpeakingNow = false;
      lastSarahEndedTs = Date.now();
      finish(false);
    }
  }

  // 4. Listen for postMessage commands from content.js (crosses ISOLATED <-> MAIN worlds cleanly)
  window.addEventListener('message', (ev) => {
    const data = ev?.data;
    if (!data || !data.__iwg_webrtc__) return;
    if (data.type === 'IWG_SARAH_PLAY_WAV') {
      handlePlayWavRequest(data.base64, data.requestId);
    } else if (data.type === 'IWG_SARAH_STOP_WAV') {
      sarahSpeakingNow = false;
      lastSarahEndedTs = Date.now();
      if (activeSourceNode) {
        try {
          activeSourceNode.stop();
          activeSourceNode.disconnect();
        } catch {}
        activeSourceNode = null;
      }
    }
  });
})();
