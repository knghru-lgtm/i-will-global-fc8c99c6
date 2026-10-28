import React, { useState } from 'react';
import { useAuth } from '../lib/auth';

export const IWillGlobalPortalPage: React.FC = () => {
  const { login } = useAuth();
  const [selectedRole, setSelectedRole] = useState<'all' | 'admin' | 'manager' | 'scheduler' | 'licensed_agent'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const teamMembers = [
    { name: 'King Amen Ra', email: 'king@iwillglobal.com', role: 'admin', title: 'Agency Principal / Broker of Record', phone: '(602) 456-9681', npn: '16094432', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '👑 Agency Principal / Broker of Record' },
    { name: 'Aneesha Sullivan', email: 'aneesha@iwillglobal.com', role: 'admin', title: 'Principal & COO Governance', phone: '(602) 412-1945', npn: '19842012', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '👑 Principal & COO Governance' },
    { name: 'Licensed Transfer Agent', email: 'admin@iwillglobal.com', role: 'admin', title: 'State-Licensed Transfer Agent & Principal', phone: '(480) 331-9455', npn: '19842011', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '👑 Licensed Transfer Agent (480-331-9455)' },
    { name: 'Sarah Jenkins', email: 'sjenkins@iwillglobal.com', role: 'manager', title: 'Sales Director', phone: '(480) 331-9401', npn: '18923012', states: ['AZ', 'CA', 'NV'], badge: '👔 Director' },
    { name: 'Marcus Vance', email: 'mvance@iwillglobal.com', role: 'manager', title: 'Inbound & Scheduling Manager', phone: '(480) 331-9402', npn: '17849203', states: ['AZ', 'TX', 'NM'], badge: '👔 Manager' },

    // Dedicated Outbound Call Appointment Schedulers
    { name: 'JaKeeta Sullivan', email: 'jakeeta@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist & Appointment Setter', phone: '(602) 456-2760', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '📞 Outbound Lead Specialist' },
    { name: 'Shakira Granger', email: 'sgranger@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist & Appointment Setter', phone: '(602) 753-6169', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '📞 Outbound Lead Specialist' },
    { name: 'Kamille Martinez', email: 'kmartinez@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist & Appointment Setter', phone: '(602) 456-0293', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '📞 Outbound Lead Specialist' },
    { name: 'Regina McCullough', email: 'rmccullough@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist & Appointment Setter', phone: '(602) 456-5903', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '📞 Outbound Lead Specialist' },
    { name: 'Janice Varnado', email: 'jvarnado@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist & Appointment Setter', phone: '(602) 456-2520', states: ['AZ', 'CA', 'NV', 'TX', 'FL', 'NM', 'CO'], badge: '📞 Outbound Lead Specialist' },
    { name: 'David Miller', email: 'dmiller@iwillglobal.com', role: 'scheduler', title: 'Outbound Senior Scheduler', phone: '(480) 331-9411', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Chloe Bennett', email: 'cbennett@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9412', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Jordan Rivera', email: 'jrivera@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Coordinator', phone: '(480) 331-9413', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Hannah Abbott', email: 'habbott@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9414', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Maya Collins', email: 'mcollins@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9415', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Tyler Sanders', email: 'tsanders@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Scheduler', phone: '(480) 331-9416', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Vikram Patel', email: 'vpatel@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9417', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Sofia Ramirez', email: 'sramirez@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Qualifier', phone: '(480) 331-9418', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Lucas Nelson', email: 'lnelson@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9419', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Emma Russell', email: 'erussell@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9433', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Kevin Wright', email: 'kwright@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9434', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Alicia Diaz', email: 'adiaz@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Scheduler', phone: '(480) 331-9435', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Nathan Parker', email: 'nparker@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Coordinator', phone: '(480) 331-9436', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Zainab Khouri', email: 'zkhouri@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9437', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Brandon Sullivan', email: 'bsullivan@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9438', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Jasmine Chen', email: 'jchen@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9439', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Marcus Reed', email: 'mreed@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Scheduler', phone: '(480) 331-9440', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Kayla Bailey', email: 'kbailey@iwillglobal.com', role: 'scheduler', title: 'Outbound Lead Qualifier', phone: '(480) 331-9441', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Derek Howard', email: 'dhoward@iwillglobal.com', role: 'scheduler', title: 'Outbound Appointment Setter', phone: '(480) 331-9442', states: ['AZ'], badge: '📞 Outbound Scheduler' },
    { name: 'Samantha Wood', email: 'swood@iwillglobal.com', role: 'scheduler', title: 'Outbound Call Specialist', phone: '(480) 331-9443', states: ['AZ'], badge: '📞 Outbound Scheduler' },

    // Licensed Agents (13)
    { name: 'Robert Chen', email: 'rchen@iwillglobal.com', role: 'licensed_agent', title: 'Senior Medicare Specialist', phone: '(480) 331-9420', npn: '19482015', states: ['AZ', 'CA', 'NV'], badge: '⚖️ Licensed Agent' },
    { name: 'Amanda Torres', email: 'atorres@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Advisor', phone: '(480) 331-9421', npn: '20194821', states: ['AZ', 'TX'], badge: '⚖️ Licensed Agent' },
    { name: 'James Wilson', email: 'jwilson@iwillglobal.com', role: 'licensed_agent', title: 'Retirement & Health Advisor', phone: '(480) 331-9422', npn: '18392044', states: ['AZ', 'NM', 'CO'], badge: '⚖️ Licensed Agent' },
    { name: 'Rachel Adams', email: 'radams@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Benefits Counselor', phone: '(480) 331-9423', npn: '20938410', states: ['AZ', 'CA'], badge: '⚖️ Licensed Agent' },
    { name: 'Carlos Gomez', email: 'cgomez@iwillglobal.com', role: 'licensed_agent', title: 'Bi-lingual Senior Advisor', phone: '(480) 331-9424', npn: '19384029', states: ['AZ', 'NV', 'FL'], badge: '⚖️ Licensed Agent' },
    { name: 'Emily Watson', email: 'ewatson@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Specialist', phone: '(480) 331-9425', npn: '21039482', states: ['AZ'], badge: '⚖️ Licensed Agent' },
    { name: 'Brian O\'Connor', email: 'boconnor@iwillglobal.com', role: 'licensed_agent', title: 'Senior Insurance Broker', phone: '(480) 331-9426', npn: '17594032', states: ['AZ', 'TX', 'CO'], badge: '⚖️ Licensed Agent' },
    { name: 'Jessica Taylor', email: 'jtaylor@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Agent', phone: '(480) 331-9427', npn: '20495820', states: ['AZ', 'CA'], badge: '⚖️ Licensed Agent' },
    { name: 'Michael Chang', email: 'mchang@iwillglobal.com', role: 'licensed_agent', title: 'Senior Health Broker', phone: '(480) 331-9428', npn: '19203948', states: ['AZ', 'NV'], badge: '⚖️ Licensed Agent' },
    { name: 'Laura Martinez', email: 'lmartinez@iwillglobal.com', role: 'licensed_agent', title: 'Medicare Advisor', phone: '(480) 331-9429', npn: '20839401', states: ['AZ', 'NM'], badge: '⚖️ Licensed Agent' },
    { name: 'Kevin Brooks', email: 'kbrooks@iwillglobal.com', role: 'licensed_agent', title: 'Senior Specialist', phone: '(480) 331-9430', npn: '18493021', states: ['AZ'], badge: '⚖️ Licensed Agent' },
    { name: 'Timothy Hays', email: 'thays@iwillglobal.com', role: 'licensed_agent', title: 'Insurance Specialist', phone: '(480) 331-9432', npn: '19503928', states: ['AZ'], badge: '⚖️ Licensed Agent' },
  ];

  const handleQuickLogin = async (email: string) => {
    try {
      const pass = email === 'king@iwillglobal.com' ? 'Heru5464' : (email === 'kmartinez@iwillglobal.com' || email === 'jvarnado@iwillglobal.com' || email === 'jvarado@iwillglobal.com' || email === 'jvanado@iwillglobal.com' || email === 'rmccullough@iwillglobal.com' ? 'Today#01' : 'Welcome123!');
      await login(email, pass);
      window.location.href = '/dashboard';
    } catch (err: any) {
      alert(`Login failed: ${err.message}`);
    }
  };

  const filteredTeam = teamMembers.filter((m) => {
    const matchesRole = selectedRole === 'all' || m.role === selectedRole;
    const matchesSearch = m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          m.title.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesRole && matchesSearch;
  });

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#051039', color: '#fff', padding: '2rem 1rem' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        
        {/* Header Branding & Link to iwillglobal.com */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(200,150,62,0.3)', padding: '1.5rem', borderRadius: '16px', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#16245c', border: '2px solid #c8963e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c8963e', fontWeight: 800, fontSize: '1.3rem' }}>
                IWG
              </div>
              <div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: '#c8963e' }}>
                  I Will Global — Team & Agent Portal
                </h1>
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                  Direct Workspace Access for 20+ Licensed Agents & Schedulers (iwillglobal.com)
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <a href="/team" className="btn btn-primary" style={{ textDecoration: 'none', padding: '0.6rem 1rem', fontSize: '0.85rem', fontWeight: 700, background: 'linear-gradient(135deg, #c8963e, #e0ac53)', color: '#051039' }}>
              🛡️ Manage Team & Assign Roles →
            </a>
            <a href="/dashboard" className="btn btn-secondary" style={{ textDecoration: 'none', padding: '0.6rem 1rem', fontSize: '0.85rem' }}>
              📊 Go to CRM Dashboard
            </a>
          </div>
        </div>

        {/* Filter Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: 'All 37 Team Members' },
              { id: 'admin', label: '👑 Admin (2)' },
              { id: 'manager', label: '👔 Managers (2)' },
              { id: 'scheduler', label: '📞 Outbound Schedulers (21)' },
              { id: 'licensed_agent', label: '⚖️ Licensed Agents (13)' },
            ].map((f) => (
              <button
                key={f.id}
                className={`btn ${selectedRole === f.id ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSelectedRole(f.id as any)}
                style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search team member name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              backgroundColor: '#111c3a',
              border: '1px solid #243566',
              color: '#fff',
              fontSize: '0.88rem',
              width: '280px',
            }}
          />
        </div>

        {/* 20+ Team Roster Login Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {filteredTeam.map((member) => (
            <div
              key={member.email}
              style={{
                backgroundColor: '#0e1838',
                border: '1px solid #1f2e5c',
                borderRadius: '14px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '1rem',
                transition: 'transform 0.2s, border-color 0.2s',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#fff' }}>{member.name}</div>
                  <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', borderRadius: '20px', background: 'rgba(200,150,62,0.15)', color: '#c8963e', fontWeight: 600, border: '1px solid rgba(200,150,62,0.3)' }}>
                    {member.badge}
                  </span>
                </div>
                <div style={{ fontSize: '0.84rem', color: '#94a3b8', fontWeight: 500 }}>{member.title}</div>
                <div style={{ fontSize: '0.82rem', color: '#cbd5e1', marginTop: '0.4rem', fontFamily: 'monospace' }}>
                  📧 {member.email}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.3rem' }}>
                  📞 {member.phone} {member.npn ? `· NPN: ${member.npn}` : ''}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#60a5fa', marginTop: '0.3rem' }}>
                  🎥 Google Meet: <a href={`https://meet.google.com/iwg-${member.email.split('@')[0]}`} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline' }}>meet.google.com/iwg-{member.email.split('@')[0]}</a>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#c8963e', marginTop: '0.3rem' }}>
                  State Licenses: {member.states.join(', ')}
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => handleQuickLogin(member.email)}
                style={{ width: '100%', padding: '0.65rem', fontSize: '0.88rem', fontWeight: 700 }}
              >
                ⚡ 1-Click Access as {member.name.split(' ')[0]}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
