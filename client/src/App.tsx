import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';

import { DashboardPage } from './pages/DashboardPage';
import { LeadsPage } from './pages/LeadsPage';
import { ClientsPage } from './pages/ClientsPage';
import { PipelinePage } from './pages/PipelinePage';
import { PoliciesPage } from './pages/PoliciesPage';
import { CommissionsPage } from './pages/CommissionsPage';
import { UnifiedInboxPage } from './pages/UnifiedInboxPage';
import { ActivitiesPage } from './pages/ActivitiesPage';
import { CalendarPage } from './pages/CalendarPage';
import { ReportsPage } from './pages/ReportsPage';
import { TeamPage } from './pages/TeamPage';
import { RecordDetailPage } from './pages/RecordDetailPage';
import { SettingsPage } from './pages/SettingsPage';
import { PublicSOAPage } from './pages/PublicSOAPage';
import { IWillGlobalPortalPage } from './pages/IWillGlobalPortalPage';
import { PublicChatWidget } from './components/PublicChatWidget';
import { PublicTeamDirectorySection } from './components/PublicTeamDirectorySection';
import { SarahVoiceModal, type SarahLaunchPayload } from './components/SarahVoiceModal';

// Public Website Components
// @ts-ignore
import Header from './components/Header.jsx';
// @ts-ignore
import Footer from './components/Footer.jsx';
// @ts-ignore
import Home from './pages/Home.jsx';
// @ts-ignore
import About from './pages/About.jsx';
// @ts-ignore
import MedicareResources from './pages/MedicareResources.jsx';
// @ts-ignore
import OtherOfferingsPage from './pages/OtherOfferingsPage.jsx';
import './pages/Page.css';
import './styles/public.css';

const PublicLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="public-website">
    <Header />
    <main style={{ minHeight: '80vh' }}>{children}</main>
    <Footer />
  </div>
);

const LoginPage: React.FC = () => {
  const [isRegistering, setIsRegistering] = React.useState(false);
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<'licensed_agent' | 'scheduler' | 'manager'>('licensed_agent');
  const { user, login } = useAuth();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let cleanEmail = email.trim();
      if (cleanEmail.toLowerCase() === 'aneesha' || cleanEmail.toLowerCase() === 'aneesha@iwillglobal') {
        cleanEmail = 'aneesha@iwillglobal.com';
      } else if (cleanEmail.toLowerCase() === 'king' || cleanEmail.toLowerCase() === 'king@iwillglobal') {
        cleanEmail = 'king@iwillglobal.com';
      } else if (!cleanEmail.includes('@') && cleanEmail.length > 0) {
        cleanEmail = `${cleanEmail}@iwillglobal.com`;
      } else if (cleanEmail.toLowerCase().endsWith('@iwillglobal')) {
        cleanEmail = `${cleanEmail}.com`;
      }

      if (isRegistering) {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password, name, role }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Team registration failed');
      }
      await login(cleanEmail, password);
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0b132b', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: '440px', backgroundColor: '#111c3a', border: '1px solid #243566', borderRadius: '16px', padding: '2rem', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div style={{ width: '54px', height: '54px', borderRadius: '14px', background: '#16245c', border: '2px solid #c8963e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c8963e', fontWeight: 700, fontSize: '1.5rem', margin: '0 auto 0.75rem' }}>
            IWG
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff' }}>
            {isRegistering ? 'Team Member Registration' : 'I Will Global CRM'}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            {isRegistering ? 'Create your @iwillglobal.com agent or scheduler workspace account' : 'Sign in to access your Medicare CRM workspace'}
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div style={{ display: 'flex', backgroundColor: '#16245c', padding: '4px', borderRadius: '10px', marginBottom: '1.25rem' }}>
          <button
            type="button"
            onClick={() => { setIsRegistering(false); setError(''); }}
            style={{
              flex: 1, padding: '0.55rem', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
              backgroundColor: !isRegistering ? '#c8963e' : 'transparent',
              color: !isRegistering ? '#051039' : '#94a3b8',
              transition: 'all 0.2s',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setIsRegistering(true); setError(''); }}
            style={{
              flex: 1, padding: '0.55rem', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
              backgroundColor: isRegistering ? '#c8963e' : 'transparent',
              color: isRegistering ? '#051039' : '#94a3b8',
              transition: 'all 0.2s',
            }}
          >
            Team Registration
          </button>
        </div>

        {error && (
          <div style={{ padding: '0.75rem', backgroundColor: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem' }}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {isRegistering && (
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem', color: '#cbd5e1' }}>
                Full Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jordan Rivera"
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', backgroundColor: '#1b2a59', border: '1px solid #243566', color: '#fff', fontSize: '0.9rem' }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem', color: '#cbd5e1' }}>
              {isRegistering ? 'Workspace Email (@iwillglobal.com)' : 'Workspace Email / Username'}
            </label>
            <input
              type="text"
              required
              autoCapitalize="none"
              autoCorrect="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isRegistering ? 'name@iwillglobal.com' : 'name@iwillglobal.com or username'}
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', backgroundColor: '#1b2a59', border: '1px solid #243566', color: '#fff', fontSize: '0.9rem' }}
            />
          </div>

          {isRegistering && (
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem', color: '#cbd5e1' }}>
                Team Role Application
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', backgroundColor: '#1b2a59', border: '1px solid #243566', color: '#fff', fontSize: '0.9rem' }}
              >
                <option value="licensed_agent">⚖️ Licensed Medicare Agent</option>
                <option value="scheduler">📞 Outbound Appointment Scheduler</option>
                <option value="manager">👔 Sales & Operations Manager</option>
              </select>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.3rem' }}>
                ℹ️ Administrators manage and verify all final licensing and permissions.
              </div>
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem', color: '#cbd5e1' }}>
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isRegistering ? 'Minimum 6 characters' : 'Enter your password'}
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', backgroundColor: '#1b2a59', border: '1px solid #243566', color: '#fff', fontSize: '0.9rem' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{ padding: '0.85rem', borderRadius: '8px', background: 'linear-gradient(135deg, #c8963e, #e0ac53)', color: '#051039', fontWeight: 700, fontSize: '0.95rem', border: 'none', cursor: 'pointer', marginTop: '0.5rem' }}
          >
            {loading ? 'Please Wait...' : isRegistering ? 'Complete Team Registration' : 'Sign In to Workspace'}
          </button>
        </form>

        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => { setIsRegistering(!isRegistering); setError(''); }}
            style={{ background: 'none', border: 'none', color: '#60a5fa', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {isRegistering ? 'Already registered? Sign in here' : 'New agent or staff? Click here for Team Registration'}
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminPortalRoute: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ backgroundColor: '#0b132b', height: '100vh', color: '#94a3b8', padding: '2rem' }}>Loading IWG CRM...</div>;
  if (!user || user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <IWillGlobalPortalPage />;
};

const ProtectedRoutes: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ backgroundColor: '#0b132b', height: '100vh', color: '#94a3b8', padding: '2rem' }}>Loading IWG CRM...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/:id" element={<RecordDetailPage type="lead" />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/:id" element={<RecordDetailPage type="client" />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/opportunities/:id" element={<RecordDetailPage type="opportunity" />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/commissions" element={<CommissionsPage />} />
        <Route path="/inbox" element={<UnifiedInboxPage />} />
        <Route path="/activities" element={<ActivitiesPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
};

export const App: React.FC = () => {
  const [isSarahVoiceOpen, setIsSarahVoiceOpen] = React.useState(false);
  const [sarahPayload, setSarahPayload] = React.useState<SarahLaunchPayload | null>(null);

  React.useEffect(() => {
    const handleOpenSarah = (e: Event) => {
      const detail = (e as CustomEvent<SarahLaunchPayload>).detail;
      if (detail) {
        setSarahPayload(detail);
      } else {
        setSarahPayload({ mode: 'inbound' });
      }
      setIsSarahVoiceOpen(true);
    };
    window.addEventListener('iwg-open-sarah-voice', handleOpenSarah);

    // Support direct URL launch for outbound test calls (e.g. ?sarah_call=6232230165&mode=outbound)
    try {
      const params = new URLSearchParams(window.location.search);
      const sarahCallPhone = params.get('sarah_call') || params.get('call_phone');
      const sarahMode = params.get('mode') === 'inbound' ? 'inbound' : 'outbound';
      if (sarahCallPhone || params.get('sarah') === 'outbound') {
        setSarahPayload({
          mode: sarahMode,
          phone: sarahCallPhone || '(623) 223-0165',
          prospect_name: params.get('prospect_name') || 'Medicare Beneficiary',
          state: params.get('state') || 'AZ',
        });
        setIsSarahVoiceOpen(true);
      }
    } catch {}

    return () => window.removeEventListener('iwg-open-sarah-voice', handleOpenSarah);
  }, []);
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Website */}
          <Route path="/" element={<PublicLayout><Home /></PublicLayout>} />
          <Route path="/about-us" element={<PublicLayout><About /></PublicLayout>} />
          <Route path="/meet-the-team" element={<PublicLayout><PublicTeamDirectorySection /></PublicLayout>} />
          <Route path="/our-team" element={<PublicLayout><PublicTeamDirectorySection /></PublicLayout>} />
          <Route path="/medicare-resources" element={<PublicLayout><MedicareResources /></PublicLayout>} />
          <Route path="/services" element={<PublicLayout><OtherOfferingsPage /></PublicLayout>} />
          <Route path="/offerings" element={<Navigate to="/services" replace />} />

          {/* CRM & Portal */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/portal" element={<AdminPortalRoute />} />
          <Route path="/soa/:token" element={<PublicSOAPage />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
        {/* Embed public AI chat widget button for testing */}
        <PublicChatWidget />
        {/* Global Floating Pill for Sarah Voice AI Receptionist */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('iwg-open-sarah-voice'))}
          title="Talk to Sarah — Voice AI Receptionist (100% Free Spoken Audio, $0.00 / min)"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '84px',
            zIndex: 9998,
            backgroundColor: '#0a163d',
            border: '2px solid #c8963e',
            color: '#ffffff',
            borderRadius: '999px',
            padding: '0.65rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            boxShadow: '0 8px 25px rgba(0, 0, 0, 0.5), 0 0 20px rgba(200, 150, 62, 0.4)',
            cursor: 'pointer',
            fontWeight: 800,
            fontSize: '0.88rem',
            transition: 'all 0.2s ease',
          }}
        >
          <span style={{ fontSize: '1.2rem' }}>🎙️</span>
          <span>Talk to Sarah</span>
          <span
            style={{
              backgroundColor: '#22c55e',
              color: '#051039',
              fontSize: '0.68rem',
              padding: '0.1rem 0.45rem',
              borderRadius: '999px',
              fontWeight: 800,
              textTransform: 'uppercase',
            }}
          >
            Voice AI
          </span>
        </button>
        {/* Global Sarah Voice AI Receptionist & Outbound Caller Modal */}
        <SarahVoiceModal
          isOpen={isSarahVoiceOpen}
          onClose={() => setIsSarahVoiceOpen(false)}
          initialPayload={sarahPayload}
        />
      </Router>
    </AuthProvider>
  );
};
