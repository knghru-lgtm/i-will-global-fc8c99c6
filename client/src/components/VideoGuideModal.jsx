import React, { useState, useEffect, useRef } from 'react';
import { 
  PlayCircle, 
  X, 
  ShieldCheck, 
  PhoneCall, 
  ExternalLink, 
  Sparkles, 
  ArrowUp, 
  ArrowDown, 
  RotateCcw, 
  GripHorizontal,
  Minimize2,
  Maximize2,
  Play
} from 'lucide-react';
import { IWGBrandedVideoPlayer } from './IWGBrandedVideoPlayer';
import './VideoGuideModal.css';

export const VideoGuideModal = ({ 
  isOpen, 
  onClose,
  src = '/videos/medicare-guide-2027.mp4',
  fileId = '1MibMsPiM6X6i0uYCQBQYSLzTYdA9ITnz',
  title = 'Official 2027 Medicare Video Guide',
  subtitle = 'Complete Medicare Breakdown: Parts A, B, C, D & Medigap Pathways',
  badge = '2027 Medicare Guide',
  loadingText = 'Loading Official Medicare Video Guide...'
}) => {
  const [offsetY, setOffsetY] = useState(0);
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const playerRef = useRef(null);
  const dragStartRef = useRef({ startY: 0, initialOffsetY: 0 });
  const cardRef = useRef(null);

  const chapters = [
    { time: 0, label: '0:00 Intro', desc: 'Welcome to I Will Global — Fiduciary Medicare guidance & enrollment.' },
    { time: 35, label: '0:35 Part A (Hospital)', desc: '2027 $1,788 hospital deductible & $0 copay for the first 60 days.' },
    { time: 75, label: '1:15 Part B (Medical)', desc: '2027 $209.50/mo premium, $292 annual deductible & 20% coinsurance.' },
    { time: 110, label: '1:50 The Gaps', desc: 'Why Original Medicare has NO annual out-of-pocket maximum without supplemental defense.' },
    { time: 150, label: '2:30 Medigap (Supplement)', desc: 'Plan G & Plan N nationwide doctor freedom with zero network restrictions.' },
    { time: 190, label: '3:10 Part C (Advantage)', desc: 'All-in-one plans featuring maximum out-of-pocket caps, dental, and vision.' },
    { time: 225, label: '3:45 Part D (Rx Drugs)', desc: '2027 statutory $2,400 federal out-of-pocket cap, $35 insulin & $0 vaccines.' },
    { time: 260, label: '4:20 1:1 Enrollment', desc: 'Dedicated personal Medicare advisor assigned at no cost: (480) 331-9455.' }
  ];

  // Reset position whenever opened
  useEffect(() => {
    if (isOpen) {
      setOffsetY(0);
      setIsMiniMode(false);
    }
  }, [isOpen]);

  // Handle Dragging
  const handleMouseDown = (e) => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    setIsDragging(true);
    dragStartRef.current = {
      startY: e.clientY,
      initialOffsetY: offsetY
    };
  };

  const handleTouchStart = (e) => {
    if (e.target.closest('button') || e.target.closest('a')) return;
    setIsDragging(true);
    dragStartRef.current = {
      startY: e.touches[0].clientY,
      initialOffsetY: offsetY
    };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const deltaY = e.clientY - dragStartRef.current.startY;
      setOffsetY(dragStartRef.current.initialOffsetY + deltaY);
    };

    const handleTouchMove = (e) => {
      if (!isDragging) return;
      const deltaY = e.touches[0].clientY - dragStartRef.current.startY;
      setOffsetY(dragStartRef.current.initialOffsetY + deltaY);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleMoveUp = (e) => {
    e.stopPropagation();
    setOffsetY((prev) => prev - 120);
  };

  const handleMoveDown = (e) => {
    e.stopPropagation();
    setOffsetY((prev) => prev + 120);
  };

  const handleResetPos = (e) => {
    e.stopPropagation();
    setOffsetY(0);
  };

  const handleSeek = (seconds) => {
    if (playerRef.current) {
      playerRef.current.seekTo(seconds);
    }
  };

  // If Mini Mode is active, render a non-modal floating picture-in-picture box
  if (isMiniMode) {
    return (
      <div className="iwg-mini-player-box" style={{ transform: `translateY(${offsetY}px)` }}>
        <div className="iwg-mini-header" onMouseDown={handleMouseDown} onTouchStart={handleTouchStart}>
          <div className="iwg-mini-title">
            <PlayCircle size={15} color="var(--accent)" />
            <span>{title}</span>
          </div>
          <div className="iwg-mini-actions">
            <button 
              type="button" 
              className="iwg-mini-btn" 
              onClick={() => setIsMiniMode(false)}
              title="Expand to Full View"
            >
              <Maximize2 size={14} />
            </button>
            <button 
              type="button" 
              className="iwg-mini-btn" 
              onClick={onClose}
              title="Close Video"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <IWGBrandedVideoPlayer 
          ref={playerRef}
          src={src}
          fileId={fileId}
          title={title}
          subtitle={subtitle}
          badge={badge}
          loadingText={loadingText}
          autoPlay={true}
        />
      </div>
    );
  }

  return (
    <div className="video-modal-backdrop" onClick={onClose}>
      <div 
        ref={cardRef}
        className="video-modal-card" 
        style={{ 
          transform: `translateY(${offsetY}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s cubic-bezier(0.2, 0.9, 0.4, 1)'
        }}
        onClick={(e) => e.stopPropagation()} 
        role="dialog" 
        aria-modal="true"
        aria-labelledby="video-modal-title"
      >
        {/* Draggable Header with Position Controls */}
        <div 
          className="video-modal-header"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          title="Click and drag up or down to reposition"
        >
          <div className="video-header-left">
            <div className="video-header-icon">
              <PlayCircle size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.15rem' }}>
                <span className="badge badge-gold" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                  <Sparkles size={11} /> {badge}
                </span>
                <span className="iwg-drag-indicator">
                  <GripHorizontal size={14} /> Drag to move
                </span>
              </div>
              <h2 id="video-modal-title" className="video-modal-title">
                {title}
              </h2>
            </div>
          </div>

          {/* Position & Control Buttons */}
          <div className="video-header-right">
            {/* Move Up / Down Buttons */}
            <div className="iwg-position-controls">
              <button 
                type="button" 
                className="iwg-pos-btn" 
                onClick={handleMoveUp}
                title="Move Video Up"
                aria-label="Move Up"
              >
                <ArrowUp size={14} />
                <span>Up</span>
              </button>
              <button 
                type="button" 
                className="iwg-pos-btn" 
                onClick={handleMoveDown}
                title="Move Video Down"
                aria-label="Move Down"
              >
                <ArrowDown size={14} />
                <span>Down</span>
              </button>
              {offsetY !== 0 && (
                <button 
                  type="button" 
                  className="iwg-pos-btn iwg-reset-btn" 
                  onClick={handleResetPos}
                  title="Reset to Center"
                  aria-label="Reset"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>

            {/* Float / Mini Player Mode */}
            <button 
              type="button" 
              className="video-header-action-btn"
              onClick={() => setIsMiniMode(true)}
              title="Switch to Floating Mini Player (browse page while watching)"
            >
              <Minimize2 size={16} />
            </button>

            {/* Close Button */}
            <button 
              type="button" 
              className="video-close-btn" 
              onClick={onClose}
              aria-label="Close modal"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Video Player Body */}
        <div className="video-body">
          {/* IWG Branded Interactive Video Player */}
          <IWGBrandedVideoPlayer 
            ref={playerRef}
            src={src}
            fileId={fileId}
            title={title}
            subtitle={subtitle}
            badge={badge}
            loadingText={loadingText}
            autoPlay={true}
          />

          {/* Key Topics & Interactive Guide Chapters */}
          <div className="video-info-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', flexWrap: 'wrap', gap: '0.4rem' }}>
              <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <ShieldCheck size={16} color="var(--accent)" />
                Medicare Chapters & 2027 Key Takeaways (Click to Jump):
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--accent)', background: 'rgba(200,150,62,0.15)', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                Interactive Chapter Navigation
              </span>
            </div>

            <div className="video-takeaways-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.45rem' }}>
              {chapters.map((ch, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="video-takeaway-item"
                  style={{ cursor: 'pointer', textAlign: 'left', border: '1px solid rgba(200, 150, 62, 0.25)', transition: 'all 0.2s ease' }}
                  onClick={() => handleSeek(ch.time)}
                  title={`Jump to ${ch.label}`}
                >
                  <Play size={12} fill="var(--accent)" color="var(--accent)" style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div>
                    <span style={{ fontWeight: 700, color: 'var(--accent)', marginRight: '0.35rem' }}>{ch.label}:</span>
                    <span>{ch.desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Call to Action Footer */}
          <div className="video-modal-cta">
            <div className="video-cta-text">
              <h4>Ready to Compare or Enroll in a 2027 Medicare Plan?</h4>
              <p>Speak with a licensed advisor at I Will Global across AZ, TX, CA, NV, FL, NM, & CO at $0 cost to you.</p>
            </div>
            <div className="video-cta-buttons">
              <a href="tel:(480) 331-9455" className="video-btn-call">
                <PhoneCall size={14} /> Call (480) 331-9455
              </a>
              <a 
                href="https://my.destinationrx.com/hub/s/SMPJW7R2A" 
                target="_blank" 
                rel="noreferrer" 
                className="video-btn-quote"
              >
                <ExternalLink size={14} /> Find a Plan (Medicare) ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoGuideModal;
