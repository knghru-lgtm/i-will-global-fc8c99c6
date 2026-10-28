import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { 
  ExternalLink, 
  Sparkles, 
  PhoneCall, 
  Mail, 
  RotateCcw,
  AlertCircle
} from 'lucide-react';
import './IWGBrandedVideoPlayer.css';

export const IWGBrandedVideoPlayer = forwardRef(({
  src = '/videos/welcome-video.mp4',
  altSrc,
  altLabel = 'Alternate Cut',
  defaultSrc,
  fileId = '1DLstMOwsStQGHBB1Pm7SD6jZ4JysG8c9',
  title = 'I Will Global Official Welcome Video',
  subtitle = 'Fiduciary Healthcare Guidance & Institutional Wealth Protection',
  badge = 'Agency Overview',
  loadingText = 'Loading I Will Global Video...',
  poster,
  autoPlay = false,
  muted = false
}, ref) => {
  const [activeSrc, setActiveSrc] = useState(defaultSrc || src);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const videoRef = useRef(null);

  useImperativeHandle(ref, () => ({
    seekTo: (seconds) => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds;
        videoRef.current.play().catch(() => {});
      }
    },
    play: () => videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
    getVideoElement: () => videoRef.current
  }));

  // Synchronize when src prop changes
  useEffect(() => {
    setActiveSrc(defaultSrc || src);
    setIsVideoReady(false);
    setHasError(false);
    setUseIframeFallback(false);
  }, [src, defaultSrc]);

  const previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
  const shareUrl = `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

  const handleReload = () => {
    setIsVideoReady(false);
    setHasError(false);
    setReloadKey((prev) => prev + 1);
    if (videoRef.current) {
      videoRef.current.load();
    }
  };

  const handleVideoLoaded = () => {
    setIsVideoReady(true);
    setHasError(false);
  };

  const handleVideoError = () => {
    console.warn(`Direct video source failed for ${activeSrc}, checking fallback options`);
    setHasError(true);
  };

  return (
    <div className="iwg-drive-video-wrapper">
      {/* Top Video Header Bar */}
      <div className="iwg-video-header-bar">
        <div className="iwg-video-header-left">
          <img src="/logo.png" alt="I Will Global" className="iwg-video-logo" />
          <div>
            <div className="iwg-video-title-row">
              <span className="iwg-video-title">{title}</span>
              <span className="iwg-video-badge">
                <Sparkles size={11} /> {badge}
              </span>
            </div>
            <div className="iwg-video-sub">{subtitle}</div>
          </div>
        </div>

        <div className="iwg-video-header-right">
          {altSrc && (
            <div className="iwg-video-toggle-group">
              <button 
                type="button" 
                className={`iwg-video-toggle-btn ${activeSrc === src ? 'active' : ''}`}
                onClick={() => { setActiveSrc(src); setIsVideoReady(false); setHasError(false); }}
                title="Play Primary Video"
              >
                Welcome
              </button>
              <button 
                type="button" 
                className={`iwg-video-toggle-btn ${activeSrc === altSrc ? 'active' : ''}`}
                onClick={() => { setActiveSrc(altSrc); setIsVideoReady(false); setHasError(false); }}
                title={altLabel}
              >
                {altLabel}
              </button>
            </div>
          )}

          <button 
            type="button" 
            className="iwg-video-head-btn" 
            onClick={handleReload}
            title="Reload Video Stream"
          >
            <RotateCcw size={14} /> <span>Reload</span>
          </button>
          
          <a 
            href={shareUrl} 
            target="_blank" 
            rel="noreferrer" 
            className="iwg-video-head-btn highlight"
            title="Open in Google Drive in a new tab"
          >
            <ExternalLink size={14} /> <span>Open in Drive ↗</span>
          </a>
        </div>
      </div>

      {/* Main Video Cinema Screen */}
      <div className="iwg-drive-video-container">
        {!isVideoReady && !hasError && (
          <div className="iwg-video-loader-overlay">
            <div className="iwg-video-spinner" />
            <div style={{ color: '#ffd88a', fontWeight: 700, fontSize: '1rem', marginTop: '0.85rem' }}>
              {loadingText}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.82rem', marginTop: '4px' }}>
              High-Definition Direct Stream
            </div>
          </div>
        )}

        {hasError && !useIframeFallback ? (
          <div className="iwg-video-loader-overlay" style={{ pointerEvents: 'auto' }}>
            <AlertCircle size={36} color="#f59e0b" style={{ marginBottom: '0.5rem' }} />
            <div style={{ color: '#ffffff', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>
              Direct Video Stream Unavailable
            </div>
            <p style={{ color: '#cbd5e1', fontSize: '0.85rem', maxWidth: '380px', textAlign: 'center', margin: '0 0 1rem' }}>
              You can switch to the Google Drive preview stream or open it directly in Google Drive.
            </p>
            <div style={{ display: 'flex', gap: '0.65rem' }}>
              <button 
                type="button" 
                className="iwg-video-head-btn highlight"
                onClick={() => setUseIframeFallback(true)}
              >
                Try Drive Stream
              </button>
              <a 
                href={shareUrl} 
                target="_blank" 
                rel="noreferrer" 
                className="iwg-video-head-btn"
              >
                Open in Drive ↗
              </a>
            </div>
          </div>
        ) : useIframeFallback || !activeSrc ? (
          <iframe
            key={reloadKey}
            src={previewUrl}
            title={title}
            className="iwg-drive-iframe"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            onLoad={() => setIsVideoReady(true)}
          />
        ) : (
          <video
            ref={videoRef}
            key={`${activeSrc}-${reloadKey}`}
            src={activeSrc}
            title={title}
            poster={poster}
            className="iwg-native-video"
            controls
            playsInline
            preload="metadata"
            autoPlay={autoPlay}
            muted={muted}
            onLoadedData={handleVideoLoaded}
            onCanPlay={handleVideoLoaded}
            onError={handleVideoError}
          >
            Your browser does not support high-definition video playback.
          </video>
        )}
      </div>

      {/* Bottom Video Meta Bar */}
      <div className="iwg-video-footer-bar">
        <div className="iwg-video-footer-meta">
          <span className="iwg-footer-dot" />
          <span>HD Presentation</span>
          <span className="iwg-footer-sep">•</span>
          <span>104+ Top Carriers</span>
          <span className="iwg-footer-sep">•</span>
          <span>100% Free Fiduciary Advisory</span>
        </div>
        <div className="iwg-video-footer-actions">
          <a href="tel:(480) 331-9455" className="iwg-footer-link">
            <PhoneCall size={13} /> (480) 331-9455
          </a>
          <a href="mailto:info@iwillglobal.com?subject=Inquiry%20from%20Video%20Guide" className="iwg-footer-link">
            <Mail size={13} /> info@iwillglobal.com
          </a>
        </div>
      </div>
    </div>
  );
});

IWGBrandedVideoPlayer.displayName = 'IWGBrandedVideoPlayer';

export default IWGBrandedVideoPlayer;
