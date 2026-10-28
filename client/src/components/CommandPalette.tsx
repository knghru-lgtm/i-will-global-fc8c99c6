import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export const CommandPalette: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!query || query.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/search?q=${encodeURIComponent(query)}`);
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="slideover-overlay" style={{ justifyContent: 'center', alignItems: 'flex-start', paddingTop: '10vh' }} onClick={onClose}>
      <div
        className="slideover-panel"
        style={{ width: 'min(600px, 92vw)', maxWidth: '92vw', height: 'auto', maxHeight: '75vh', borderRadius: '16px', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ color: 'var(--accent)', fontSize: '1.2rem' }}>🔍</span>
          <input
            type="text"
            placeholder="Search leads, clients, opportunities, policies... (esc to close)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-main)',
              fontSize: '1rem',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ padding: '1rem', overflowY: 'auto', maxHeight: '50vh' }}>
          {loading && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>Searching...</div>}
          {!loading && results.length === 0 && query.length >= 2 && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No records found</div>
          )}
          {results.map((r) => (
            <div
              key={r.type + r.id}
              onClick={() => { navigate(r.link); onClose(); }}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                marginBottom: '0.35rem',
                backgroundColor: 'var(--bg-surface)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-input)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface)')}
            >
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{r.title}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.subtitle}</div>
              </div>
              <span className="badge badge-gold" style={{ textTransform: 'uppercase', fontSize: '0.7rem' }}>
                {r.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
