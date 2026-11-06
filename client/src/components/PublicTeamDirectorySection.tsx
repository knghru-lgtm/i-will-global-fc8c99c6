import React, { useState, useEffect } from 'react';
import { PhoneCall, Search, Users, Headphones } from 'lucide-react';

export interface PublicDirectoryMember {
  name: string;
  role: string;
  department: 'Executive & Governance' | 'Licensed Brokers & Advisors' | 'Outbound & Inbound Schedulers';
  phone: string;
  e164: string;
}

const FALLBACK_TEAM_DIRECTORY: PublicDirectoryMember[] = [
  // Executive & Principal Leadership
  { name: 'King Amen Ra', role: 'Principal & Broker of Record (NPN: 16094432)', department: 'Executive & Governance', phone: '(602) 456-9681', e164: '+16024569681' },
  { name: 'Aneesha Sullivan, PA', role: 'Chief Operating Officer (COO), Physician Assistant (PA) & Principal Governance', department: 'Executive & Governance', phone: '(602) 412-1945', e164: '+16024121945' },
  { name: 'Sarah Jenkins', role: 'Sales Director', department: 'Executive & Governance', phone: '(480) 331-9401', e164: '+14803319401' },
  { name: 'Marcus Vance', role: 'Inbound & Scheduling Manager', department: 'Executive & Governance', phone: '(480) 331-9402', e164: '+14803319402' },
  { name: 'Licensed Transfer Agent', role: 'Main Transfer Desk & Master Calendar', department: 'Executive & Governance', phone: '(480) 331-9455', e164: '+14803319455' },

  // Dedicated Core Outbound & Scheduling Specialists
  { name: 'JaKeeta Sullivan', role: 'Outbound Scheduling Specialist', department: 'Outbound & Inbound Schedulers', phone: '(602) 456-2760', e164: '+16024562760' },
  { name: 'Shakira Granger', role: 'Outbound Scheduling Specialist', department: 'Outbound & Inbound Schedulers', phone: '(602) 753-6169', e164: '+16027536169' },
  { name: 'Kamille Martinez', role: 'Outbound Call Specialist & Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(602) 456-0293', e164: '+16024560293' },
  { name: 'Regina McCullough', role: 'Outbound Call Specialist & Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(602) 456-5903', e164: '+16024565903' },

  // Licensed Brokers & Senior Advisors
  { name: 'Robert Chen', role: 'Senior Medicare Specialist (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9420', e164: '+14803319420' },
  { name: 'Amanda Torres', role: 'Medicare Advisor (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9421', e164: '+14803319421' },
  { name: 'James Wilson', role: 'Retirement & Health Advisor (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9422', e164: '+14803319422' },
  { name: 'Rachel Adams', role: 'Medicare Benefits Counselor (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9423', e164: '+14803319423' },
  { name: 'Carlos Gomez', role: 'Bi-lingual Senior Advisor (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9424', e164: '+14803319424' },
  { name: 'Emily Watson', role: 'Medicare Specialist (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9425', e164: '+14803319425' },
  { name: "Brian O'Connor", role: 'Senior Insurance Broker (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9426', e164: '+14803319426' },
  { name: 'Jessica Taylor', role: 'Medicare Agent (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9427', e164: '+14803319427' },
  { name: 'Michael Chang', role: 'Senior Health Broker (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9428', e164: '+14803319428' },
  { name: 'Laura Martinez', role: 'Medicare Advisor (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9429', e164: '+14803319429' },
  { name: 'Kevin Brooks', role: 'Senior Specialist (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9430', e164: '+14803319430' },
  { name: 'Nicole Foster', role: 'Medicare Counselor (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9431', e164: '+14803319431' },
  { name: 'Timothy Hays', role: 'Insurance Specialist (Licensed Agent)', department: 'Licensed Brokers & Advisors', phone: '(480) 331-9432', e164: '+14803319432' },

  // Outbound & Inbound Schedulers
  { name: 'David Miller', role: 'Outbound Senior Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9411', e164: '+14803319411' },
  { name: 'Chloe Bennett', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9412', e164: '+14803319412' },
  { name: 'Jordan Rivera', role: 'Outbound Lead Coordinator', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9413', e164: '+14803319413' },
  { name: 'Hannah Abbott', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9414', e164: '+14803319414' },
  { name: 'Maya Collins', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9415', e164: '+14803319415' },
  { name: 'Tyler Sanders', role: 'Outbound Call Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9416', e164: '+14803319416' },
  { name: 'Vikram Patel', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9417', e164: '+14803319417' },
  { name: 'Sofia Ramirez', role: 'Outbound Lead Qualifier', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9418', e164: '+14803319418' },
  { name: 'Lucas Nelson', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9419', e164: '+14803319419' },
  { name: 'Emma Russell', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9433', e164: '+14803319433' },
  { name: 'Kevin Wright', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9434', e164: '+14803319434' },
  { name: 'Alicia Diaz', role: 'Outbound Call Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9435', e164: '+14803319435' },
  { name: 'Nathan Parker', role: 'Outbound Lead Coordinator', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9436', e164: '+14803319436' },
  { name: 'Zainab Khouri', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9437', e164: '+14803319437' },
  { name: 'Brandon Sullivan', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9438', e164: '+14803319438' },
  { name: 'Jasmine Chen', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9439', e164: '+14803319439' },
  { name: 'Marcus Reed', role: 'Outbound Call Scheduler', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9440', e164: '+14803319440' },
  { name: 'Kayla Bailey', role: 'Outbound Lead Qualifier', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9441', e164: '+14803319441' },
  { name: 'Derek Howard', role: 'Outbound Appointment Setter', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9442', e164: '+14803319442' },
  { name: 'Samantha Wood', role: 'Outbound Call Specialist', department: 'Outbound & Inbound Schedulers', phone: '(480) 331-9443', e164: '+14803319443' },
];

export const PublicTeamDirectorySection: React.FC = () => {
  const [directory, setDirectory] = useState<PublicDirectoryMember[]>(FALLBACK_TEAM_DIRECTORY);
  const [activeDept, setActiveDept] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    fetch('/api/bland/public-directory')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.directory) && data.directory.length > 0) {
          setDirectory(data.directory);
        }
      })
      .catch(() => {
        // fallback already loaded
      });
  }, []);

  const filteredMembers = directory.filter((member) => {
    const matchesDept = activeDept === 'ALL' || member.department === activeDept;
    const q = searchQuery.trim().toLowerCase();
    const matchesQuery =
      !q ||
      member.name.toLowerCase().includes(q) ||
      member.role.toLowerCase().includes(q) ||
      member.phone.toLowerCase().includes(q) ||
      member.department.toLowerCase().includes(q);
    return matchesDept && matchesQuery;
  });

  const deptCounts = {
    ALL: directory.length,
    'Executive & Governance': directory.filter((d) => d.department === 'Executive & Governance').length,
    'Licensed Brokers & Advisors': directory.filter((d) => d.department === 'Licensed Brokers & Advisors').length,
    'Outbound & Inbound Schedulers': directory.filter((d) => d.department === 'Outbound & Inbound Schedulers').length,
  };

  return (
    <section
      id="meet-the-team"
      style={{
        background: 'linear-gradient(180deg, #051039 0%, #0a1847 100%)',
        padding: '5rem 1.5rem',
        borderTop: '2px solid rgba(200, 150, 62, 0.35)',
        borderBottom: '2px solid rgba(200, 150, 62, 0.35)',
        color: '#ffffff',
      }}
    >
      <div id="our-team" className="container" style={{ maxWidth: '1240px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              background: 'rgba(200, 150, 62, 0.2)',
              border: '1px solid #c8963e',
              color: '#ffd88a',
              borderRadius: '999px',
              padding: '0.35rem 1rem',
              fontSize: '0.8rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: '0.85rem',
            }}
          >
            <Users size={15} /> Meet the Team & Live Direct Directory
          </span>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 900, color: '#ffffff', margin: '0 0 0.75rem', letterSpacing: '-0.5px' }}>
            Meet the Team — IWG Insurance & Financial Services Directory
          </h2>
          <p style={{ fontSize: '1.05rem', color: '#cbd5e1', maxWidth: '820px', margin: '0 auto 1.25rem', lineHeight: 1.65 }}>
            Connect directly with our Executive Leadership, Licensed Senior Advisors, or Scheduling Specialists. Call our 24/7 AI Receptionist Sarah on our main line at{' '}
            <a href="tel:+14803319455" style={{ color: '#ffd88a', fontWeight: 800, textDecoration: 'underline' }}>
              (480) 331-9455
            </a>{' '}
            and ask for any team member by name for an instant AI whisper transfer, or tap <strong>Talk to Sarah (Voice AI)</strong> to speak with her live in your browser for free.
          </p>

          {/* AI Receptionist Live Routing Callout */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
              justifyContent: 'center',
              background: 'rgba(16, 185, 129, 0.14)',
              border: '1.5px solid rgba(16, 185, 129, 0.45)',
              borderRadius: '12px',
              padding: '0.75rem 1.25rem',
              fontSize: '0.88rem',
              color: '#d1fae5',
            }}
          >
            <Headphones size={18} color="#34d399" />
            <span>
              <strong>Live AI Receptionist & Product Funnel:</strong> Ask Sarah for <strong>Medicare (2027 Changes)</strong>, <strong>Individual Health</strong>, <strong>Group Health</strong>, <strong>Investment Grade Life (IUL)</strong>, <strong>Long Term Care</strong>, <strong>Term Life</strong>, or <strong>any team member below</strong>!
            </span>
          </div>
        </div>

        {/* Filter Tabs + Search Bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '2rem',
            background: 'rgba(17, 28, 58, 0.85)',
            padding: '1rem 1.25rem',
            borderRadius: '14px',
            border: '1px solid rgba(200, 150, 62, 0.3)',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { id: 'ALL', label: `All Team (${deptCounts.ALL})` },
              { id: 'Executive & Governance', label: `👑 Executive & Governance (${deptCounts['Executive & Governance']})` },
              { id: 'Licensed Brokers & Advisors', label: `⚖️ Licensed Brokers & Advisors (${deptCounts['Licensed Brokers & Advisors']})` },
              { id: 'Outbound & Inbound Schedulers', label: `📞 Scheduling Specialists (${deptCounts['Outbound & Inbound Schedulers']})` },
            ].map((tab) => {
              const active = activeDept === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveDept(tab.id)}
                  style={{
                    padding: '0.55rem 1rem',
                    borderRadius: '999px',
                    fontSize: '0.84rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: active ? '1.5px solid #ffd88a' : '1px solid rgba(255,255,255,0.15)',
                    background: active ? 'linear-gradient(135deg, #c8963e, #e0ac53)' : 'rgba(255,255,255,0.06)',
                    color: active ? '#051039' : '#e2e8f0',
                    transition: 'all 0.2s',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div style={{ position: 'relative', minWidth: '260px', flex: '1 1 280px', maxWidth: '380px' }}>
            <Search
              size={16}
              color="#94a3b8"
              style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search team by name, role, or phone..."
              style={{
                width: '100%',
                padding: '0.6rem 0.85rem 0.6rem 2.4rem',
                borderRadius: '999px',
                background: '#051039',
                border: '1px solid rgba(200, 150, 62, 0.45)',
                color: '#ffffff',
                fontSize: '0.88rem',
              }}
            />
          </div>
        </div>

        {/* Directory Cards Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1.15rem',
          }}
        >
          {filteredMembers.map((member) => {
            const isKing = member.name.toLowerCase().includes('king amen ra');
            const isExec = member.department === 'Executive & Governance';
            const isBroker = member.department === 'Licensed Brokers & Advisors';

            return (
              <div
                key={member.name}
                style={{
                  background: isKing
                    ? 'linear-gradient(135deg, rgba(200, 150, 62, 0.22) 0%, rgba(22, 36, 92, 0.98) 100%)'
                    : 'rgba(17, 28, 58, 0.92)',
                  border: isKing
                    ? '2px solid #ffd88a'
                    : isExec
                      ? '1.5px solid rgba(200, 150, 62, 0.55)'
                      : '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '14px',
                  padding: '1.2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '0.9rem',
                  boxShadow: isKing ? '0 8px 25px rgba(200, 150, 62, 0.28)' : '0 4px 14px rgba(0, 0, 0, 0.25)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '50%',
                          background: isKing || isExec ? 'linear-gradient(135deg, #c8963e, #ffd88a)' : isBroker ? '#1e3a8a' : '#0f2942',
                          color: isKing || isExec ? '#051039' : '#ffd88a',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '1.05rem',
                          flexShrink: 0,
                          border: '1px solid rgba(255, 216, 138, 0.45)',
                        }}
                      >
                        {isKing ? '👑' : member.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#ffffff' }}>
                          {member.name}
                        </h3>
                        <div style={{ fontSize: '0.8rem', color: '#ffd88a', fontWeight: 600, marginTop: '0.15rem' }}>
                          {member.role}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.6rem',
                        borderRadius: '999px',
                        background: isExec
                          ? 'rgba(200, 150, 62, 0.22)'
                          : isBroker
                            ? 'rgba(59, 130, 246, 0.2)'
                            : 'rgba(16, 185, 129, 0.18)',
                        color: isExec ? '#ffd88a' : isBroker ? '#93c5fd' : '#6ee7b7',
                        border: '1px solid rgba(255,255,255,0.12)',
                      }}
                    >
                      {member.department}
                    </span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '0.2rem 0.55rem',
                        borderRadius: '999px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#34d399',
                      }}
                    >
                      ● AI Whisper Transfer Active
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    paddingTop: '0.75rem',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ fontSize: '0.84rem', color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>
                    {member.phone}
                  </div>
                  <a
                    href={`tel:${member.e164 || member.phone.replace(/\D/g, '')}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.4rem 0.85rem',
                      borderRadius: '8px',
                      background: isKing ? 'linear-gradient(135deg, #c8963e, #e0ac53)' : 'rgba(200, 150, 62, 0.2)',
                      border: '1px solid #c8963e',
                      color: isKing ? '#051039' : '#ffd88a',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      textDecoration: 'none',
                    }}
                  >
                    <PhoneCall size={13} />
                    <span>Call Direct</span>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default PublicTeamDirectorySection;

