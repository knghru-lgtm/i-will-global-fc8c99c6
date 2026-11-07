import React, { useState, useEffect } from 'react';

export const PublicChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const startChat = async () => {
    try {
      const res = await fetch('/api/public/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'web' }),
      });
      const data = await res.json();
      setConvId(data.conversation_id);
      setToken(data.token);
      setMessages(data.messages || []);
      setQuickReplies(data.messages?.[0]?.meta?.quick_replies || []);
    } catch (err) {
      console.error('Widget error:', err);
    }
  };

  useEffect(() => {
    startChat();
  }, []);

  const sendMessage = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim() || !convId || !token) return;

    const userMsg = { id: Date.now().toString(), sender: 'visitor', body: text };
    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInput('');
    setLoading(true);

    try {
      const res = await fetch(`/api/public/chat/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, body: text }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, ...(data.replies || [])]);
      const lastReply = data.replies?.[data.replies.length - 1];
      setQuickReplies(lastReply?.meta?.quick_replies || []);
    } catch (err) {
      console.error('Send message error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="iwg-public-chat-btn"
        aria-label="Toggle live AI assistant"
      >
        {isOpen ? '✕' : '💬'}
      </button>

      {/* Floating Chat Box */}
      {isOpen && (
        <div className="iwg-public-chat-box">
          {/* Header */}
          <div style={{ backgroundColor: '#051039', padding: '1rem', borderBottom: '1px solid #243566', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#16245c', border: '1px solid #c8963e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c8963e', fontWeight: 700 }}>
              IWG
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem' }}>Global Assistant</div>
              <div style={{ color: '#c8963e', fontSize: '0.75rem' }}>I Will Global Medicare AI</div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                window.dispatchEvent(new CustomEvent('iwg-open-sarah-voice'));
              }}
              title="Switch to live voice call with Receptionist"
              style={{
                marginLeft: 'auto',
                background: 'linear-gradient(135deg, #c8963e, #0284c7)',
                border: '1px solid #f3cf7a',
                borderRadius: '999px',
                color: '#ffffff',
                padding: '0.35rem 0.75rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                boxShadow: '0 0 10px rgba(200, 150, 62, 0.4)',
              }}
            >
              <span>🎙️</span>
              <span>Receptionist</span>
            </button>
          </div>

          {/* Messages Stream */}
          <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {messages.map((m, idx) => (
              <div
                key={m.id || idx}
                style={{
                  alignSelf: m.sender === 'visitor' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  backgroundColor: m.sender === 'visitor' ? '#162b66' : '#111c3a',
                  border: `1px solid ${m.sender === 'visitor' ? '#243566' : '#1b2a59'}`,
                  color: '#f1f5f9',
                  padding: '0.75rem 0.85rem',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.body}
              </div>
            ))}
            {loading && <div style={{ color: '#94a3b8', fontSize: '0.8rem', fontStyle: 'italic' }}>Global Assistant is typing...</div>}
          </div>

          {/* Quick Reply Pills */}
          {quickReplies.length > 0 && (
            <div style={{ padding: '0.5rem 0.75rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', backgroundColor: '#0b132b', borderTop: '1px solid #1b2a59' }}>
              {quickReplies.map((qr) => (
                <button
                  key={qr}
                  onClick={() => sendMessage(qr)}
                  style={{
                    backgroundColor: '#16244d',
                    border: '1px solid #c8963e',
                    color: '#c8963e',
                    borderRadius: '12px',
                    padding: '0.25rem 0.6rem',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                >
                  {qr}
                </button>
              ))}
            </div>
          )}

          {/* Input Footer */}
          <div style={{ padding: '0.75rem', backgroundColor: '#051039', borderTop: '1px solid #243566', display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Ask about Medicare options..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              style={{
                flex: 1,
                padding: '0.6rem',
                borderRadius: '8px',
                backgroundColor: '#111c3a',
                border: '1px solid #243566',
                color: '#fff',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
            <button
              onClick={() => sendMessage()}
              style={{
                backgroundColor: '#c8963e',
                color: '#051039',
                border: 'none',
                borderRadius: '8px',
                padding: '0 0.85rem',
                fontWeight: 700,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
};
