// IWG Main-World WebRTC Virtual Audio Bridge for Google Voice (480) 331-9455
// Routes Sarah's Vindemiatrix WAV audio directly into Google Voice's outgoing WebRTC stream
// and captures the remote caller's incoming WebRTC audio track for 100% internal call handling.
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
  let micGainNode = null;
  let sarahGainNode = null;
  let activeSourceNode = null;
  let sarahSpeakingNow = false;
  const hookedRemoteTrackIds = new Set();

  function ensureAudioGraph() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!bridgeAudioCtx || bridgeAudioCtx.state === 'closed') {
        bridgeAudioCtx = new AudioCtx();
        virtualMicDest = bridgeAudioCtx.createMediaStreamDestination();
        micGainNode = bridgeAudioCtx.createGain();
        micGainNode.gain.value = 1.0;
        sarahGainNode = bridgeAudioCtx.createGain();
        sarahGainNode.gain.value = 1.15;

        micGainNode.connect(virtualMicDest);
        sarahGainNode.connect(virtualMicDest);

        // Sub-audible keep-alive signal so WebRTC RTP packets flow continuously
        try {
          const osc = bridgeAudioCtx.createOscillator();
          const silentGain = bridgeAudioCtx.createGain();
          silentGain.gain.value = 0.00001;
          osc.connect(silentGain);
          silentGain.connect(virtualMicDest);
          osc.start();
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
    return baseTrack.clone();
  }

  // 1. Intercept navigator.mediaDevices.getUserMedia so Google Voice receives our internal virtual mic bus
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async function (constraints) {
      const wantsAudio = Boolean(constraints && constraints.audio);
      if (!wantsAudio) {
        return origGetUserMedia(constraints);
      }

      const ctx = ensureAudioGraph();
      let realStream = null;
      try {
        realStream = await origGetUserMedia(constraints);
      } catch {
        try {
          realStream = await origGetUserMedia({ audio: true });
        } catch {}
      }

      if (ctx && realStream && micGainNode) {
        try {
          const micSource = ctx.createMediaStreamSource(realStream);
          micSource.connect(micGainNode);
        } catch {}
      }

      const virtualTrack = getClonedVirtualAudioTrack();
      if (virtualTrack) {
        const tracks = [virtualTrack];
        if (realStream) {
          for (const vt of realStream.getVideoTracks()) {
            tracks.push(vt);
          }
        }
        return new MediaStream(tracks);
      }

      return realStream || origGetUserMedia(constraints);
    };
  }

  // 2. Attach VAD + MediaRecorder to incoming remote WebRTC audio tracks from the phone caller
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
        if (sarahSpeakingNow) {
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
        const now = Date.now();

        if (rms > 0.015) {
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
                if (blob.size < 700) return;
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
        } else if (isRecordingUtterance && now - lastVoiceTs > 720) {
          finishRecording();
        }
      }, 75);
    } catch {}
  }

  // 3. Wrap RTCPeerConnection so outgoing audio uses our virtual bus and incoming audio is captured
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

  // Also hook HTMLMediaElement.srcObject in case Google Voice attaches remote streams to <audio> elements
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

      // Feed directly into Google Voice's WebRTC virtual mic stream AND local audio context
      source.connect(sarahGainNode);
      try {
        source.connect(ctx.destination);
      } catch {}

      sarahSpeakingNow = true;
      if (micGainNode) {
        micGainNode.gain.value = 0.0;
      }
      activeSourceNode = source;

      let doneCalled = false;
      const onEnded = (ok) => {
        if (doneCalled) return;
        doneCalled = true;
        if (activeSourceNode === source) {
          activeSourceNode = null;
          sarahSpeakingNow = false;
          if (micGainNode) {
            micGainNode.gain.value = 1.0;
          }
        }
        finish(ok);
      };

      const maxMs = Math.min(25000, Math.ceil((audioBuffer.duration || 10) * 1000) + 1500);
      const timer = setTimeout(() => onEnded(true), maxMs);
      source.onended = () => {
        clearTimeout(timer);
        onEnded(true);
      };
      source.start(0);
    } catch {
      sarahSpeakingNow = false;
      if (micGainNode) {
        micGainNode.gain.value = 1.0;
      }
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
      if (micGainNode) {
        micGainNode.gain.value = 1.0;
      }
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
