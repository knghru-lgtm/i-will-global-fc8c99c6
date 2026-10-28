import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export const UnifiedInboxPage: React.FC = () => {
  const { isScheduler } = useAuth();
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const loadConversations = async () => {
    try {
      const res = await api.get('/inbox/conversations');
      setConversations(res || []);
      if (res.length > 0 && !selectedId) {
        setSelectedId(res[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (id: string) => {
    try {
      const res = await api.get(`/inbox/conversations/${id}`);
      setMessages(res.messages || []);
      setSummary(res.conversation.summary || '');
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
    }
  }, [selectedId]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedId) return;
    try {
      await api.post(`/inbox/conversations/${selectedId}/messages`, { body: inputMessage });
      setInputMessage('');
      loadMessages(selectedId);
      loadConversations();
    } catch (err: any) {
      alert(`Failed to send message: ${err.message}`);
    }
  };

  const handleTakeover = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/inbox/conversations/${selectedId}/takeover`);
      loadMessages(selectedId);
      loadConversations();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRelease = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/inbox/conversations/${selectedId}/release`);
      loadMessages(selectedId);
      loadConversations();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleCloseChat = async () => {
    if (!selectedId) return;
    try {
      await api.post(`/inbox/conversations/${selectedId}/close`);
      loadMessages(selectedId);
      loadConversations();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const currentConv = conversations.find((c) => c.id === selectedId);

  return (
    <div style={{ display: 'flex', gap: '1.25rem', height: 'calc(100vh - 120px)' }}>
      {/* Left List of Conversations */}
      <div style={{ width: '340px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 700, fontSize: '1.05rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Website Live Chats</span>
          <span className="badge badge-gold">{conversations.length}</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {loading ? (
            <div style={{ padding: '1.5rem', color: 'var(--text-muted)', textAlign: 'center' }}>Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div style={{ padding: '1.5rem', color: 'var(--text-muted)', textAlign: 'center' }}>No website chats yet.</div>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  padding: '1rem',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: selectedId === c.id ? 'var(--bg-surface)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.visitor_name || 'Website Visitor'}</span>
                  <span className={`badge ${c.status === 'waiting_agent' ? 'badge-danger' : c.status === 'agent' ? 'badge-gold' : 'badge-info'}`} style={{ fontSize: '0.7rem' }}>
                    {c.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.last_message || 'New session'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Chat Detail View */}
      <div style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {currentConv ? (
          <>
            {/* Header */}
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-surface)' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{currentConv.visitor_name || 'Website Visitor'}</h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Phone: {currentConv.visitor_phone || 'N/A'} · Email: {currentConv.visitor_email || 'N/A'} · Zip: {currentConv.visitor_zip || 'AZ'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {currentConv.status === 'agent' ? (
                  <button className="btn btn-secondary" onClick={handleRelease}>
                    🤖 Hand Back to AI
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={handleTakeover} disabled={isScheduler}>
                    👤 Take Over from AI
                  </button>
                )}
                <button className="btn btn-danger" onClick={handleCloseChat}>
                  ✕ Close Chat
                </button>
              </div>
            </div>

            {/* AI Summary Banner if present */}
            {summary && (
              <div style={{ padding: '0.75rem 1.25rem', backgroundColor: 'var(--accent-soft)', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem', color: 'var(--accent)' }}>
                💡 <strong>AI Conversation Summary:</strong> {summary}
              </div>
            )}

            {/* Message Stream */}
            <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === 'visitor' ? 'flex-start' : 'flex-end',
                    maxWidth: '75%',
                    backgroundColor: m.sender === 'visitor' ? 'var(--bg-surface)' : m.sender === 'ai' ? 'var(--bg-input)' : 'var(--accent-soft)',
                    border: `1px solid ${m.sender === 'agent' ? 'rgba(200,150,62,0.4)' : 'var(--border-color)'}`,
                    padding: '0.75rem 1rem',
                    borderRadius: '12px',
                    fontSize: '0.88rem',
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.2rem', textTransform: 'uppercase', fontWeight: 600 }}>
                    {m.sender === 'visitor' ? 'Visitor' : m.sender === 'ai' ? 'Global Assistant (AI)' : m.user_name || 'Agent'}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                </div>
              ))}
            </div>

            {/* Input Bar */}
            <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Type a message to the website visitor..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                style={{ flex: 1, padding: '0.75rem', borderRadius: '8px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.88rem' }}
              />
              <button className="btn btn-primary" onClick={handleSendMessage}>
                Send Message
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            Select a website conversation from the left
          </div>
        )}
      </div>
    </div>
  );
};
