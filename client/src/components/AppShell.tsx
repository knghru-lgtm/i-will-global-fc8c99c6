import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth, type Role } from '../lib/auth';
import { CommandPalette } from './CommandPalette';
import { CopilotDrawer } from './CopilotDrawer';
import { PowerDialer } from './PowerDialer';
import { OutboundScriptModal } from './OutboundScriptModal';
import { RunningLateModal } from './RunningLateModal';
import { ChangePasswordModal } from './ChangePasswordModal';
import { CallPanel } from './CallPanel';
import { WarmTransferModal } from './WarmTransferModal';
import { BlandAgentControlModal } from './BlandAgentControlModal';
import { api } from '../lib/api';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, activeRole, setActiveRole } = useAuth();
  const location = useLocation();

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [isScriptOpen, setIsScriptOpen] = useState(false);
  const [isRunningLateOpen, setIsRunningLateOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isQuotingMenuOpen, setIsQuotingMenuOpen] = useState(false);
  const [copilotDispositionContact, setCopilotDispositionContact] = useState<any>(null);
  const [isWarmTransferOpen, setIsWarmTransferOpen] = useState(false);
  const [isBlandControlOpen, setIsBlandControlOpen] = useState(false);
  const [blandStatus, setBlandStatus] = useState<{ is_campaign_active: boolean; is_on_warm_transfer: boolean }>({ is_campaign_active: false, is_on_warm_transfer: false });
  const headerScrollRef = React.useRef<HTMLDivElement | null>(null);

  const scrollHeaderToolbar = (direction: 'left' | 'right') => {
    if (!headerScrollRef.current) return;
    headerScrollRef.current.scrollBy({
      left: direction === 'left' ? -260 : 260,
      behavior: 'smooth',
    });
  };

  React.useEffect(() => {
    const refreshBland = () => {
      api.get('/bland/config')
        .then((res) => {
          if (res) {
            setBlandStatus({
              is_campaign_active: Boolean(res.is_campaign_active),
              is_on_warm_transfer: Boolean(res.is_on_warm_transfer),
            });
          }
        })
        .catch(() => {});
    };
    refreshBland();
    window.addEventListener('iwg-bland-status-changed', refreshBland);
    window.addEventListener('open-bland-ai-control', () => setIsBlandControlOpen(true));
    return () => {
      window.removeEventListener('iwg-bland-status-changed', refreshBland);
    };
  }, []);

  // Optional Bland AI dialer nudge while the CRM happens to be open. NOT required: the server dials on its own
  // (call-completion webhook chain + Vercel Cron every 15 minutes), so no one needs to be logged in.
  React.useEffect(() => {
    if (!blandStatus.is_campaign_active) return;
    const beat = () => {
      api.post('/bland/tick', {})
        .then((res: any) => {
          if (res?.dispatched?.length) {
            window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
          }
        })
        .catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 60_000);
    return () => clearInterval(interval);
  }, [blandStatus.is_campaign_active]);

  // Close mobile drawer and quoting menu on route navigation
  React.useEffect(() => {
    setIsMobileMenuOpen(false);
    setIsQuotingMenuOpen(false);
  }, [location.pathname]);

  // Close quoting menu on outside click
  React.useEffect(() => {
    const handleOutsideClick = () => setIsQuotingMenuOpen(false);
    if (isQuotingMenuOpen) {
      window.addEventListener('click', handleOutsideClick);
      return () => window.removeEventListener('click', handleOutsideClick);
    }
  }, [isQuotingMenuOpen]);

  // Global Ctrl+K shortcut
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isAgentOrAdmin = activeRole === 'admin' || activeRole === 'licensed_agent' || user?.role === 'admin' || user?.role === 'licensed_agent' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com';

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊', roles: ['admin', 'manager', 'licensed_agent', 'scheduler'] },
    { path: '/calendar', label: 'Master Calendar (info@)', icon: '📅', roles: ['admin', 'manager', 'licensed_agent', 'scheduler'] },
    { path: '/leads', label: 'Leads', icon: '🎯', roles: ['admin', 'manager', 'licensed_agent', 'scheduler'] },
    { path: '/clients', label: 'Clients', icon: '👥', roles: ['admin', 'manager', 'licensed_agent'] },
    { path: '/pipeline', label: 'Pipeline', icon: '🚀', roles: ['admin', 'manager', 'licensed_agent'] },
    { path: '/policies', label: 'Book of Business', icon: '📜', roles: ['admin', 'manager', 'licensed_agent'] },
    { path: '/commissions', label: 'Commissions', icon: '💰', roles: ['admin', 'manager', 'licensed_agent', 'scheduler'] },
    { path: '/inbox', label: 'Unified Inbox (Chat & Mail)', icon: '📥', roles: ['admin', 'manager', 'licensed_agent', 'scheduler'] },
    { path: '/activities', label: 'Activities & Calls', icon: '📞', roles: ['admin', 'manager', 'licensed_agent', 'scheduler'] },
    { path: '/team', label: 'Team Directory & Governance', icon: '🛡️', roles: ['admin', 'manager'] },
    { path: '/settings', label: 'Settings', icon: '⚙️', roles: ['admin', 'manager', 'licensed_agent', 'scheduler'] },
  ].filter((item) => item.roles.includes(activeRole) || (item.path === '/team' && (user?.role === 'admin' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com')));

  return (
    <div className="app-container">
      {/* Mobile Drawer Backdrop Overlay */}
      <div
        className={`sidebar-overlay ${isMobileMenuOpen ? 'mobile-open' : ''}`}
        onClick={() => setIsMobileMenuOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div className="sidebar-logo-icon">IWG</div>
            <div className="sidebar-brand-title">
              I Will Global
              <span className="sidebar-brand-sub">Insurance & Financial Services</span>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Close navigation drawer"
          >
            ✕
          </button>
        </div>

        <nav className="sidebar-nav">
          <button
            type="button"
            onClick={() => {
              setIsMobileMenuOpen(false);
              window.dispatchEvent(
                new CustomEvent('iwg-open-sarah-voice', {
                  detail: { mode: activeRole === 'admin' ? 'outbound' : 'inbound' },
                })
              );
            }}
            style={{
              margin: '0.25rem 0.5rem 0.5rem 0.5rem',
              padding: '0.65rem 0.85rem',
              borderRadius: '10px',
              border: '1.5px solid #34d399',
              background: 'linear-gradient(135deg, #059669 0%, #0284c7 100%)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.55rem',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
              textAlign: 'left',
            }}
            title={
              activeRole === 'admin'
                ? 'Activate Sarah Voice AI on (480) 331-9455 to Call Assigned Leads & Schedule Appointments'
                : 'Sarah Virtual Receptionist on (480) 331-9455'
            }
          >
            <span style={{ fontSize: '1.1rem' }}>🎙️</span>
            <span style={{ lineHeight: 1.2 }}>
              Sarah Voice AI
              <span style={{ display: 'block', fontSize: '0.68rem', color: '#a7f3d0', fontWeight: 700 }}>
                {activeRole === 'admin' ? '🚀 Activate & Call (480) 331-9455' : '🏢 Receptionist (480) 331-9455'}
              </span>
            </span>
          </button>
          {navItems.map((item) => {
            const isActive = location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Card at bottom of sidebar */}
        <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              backgroundColor: user?.avatar_color || 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              color: '#fff',
              fontSize: '0.9rem',
            }}
          >
            {user?.name?.slice(0, 2).toUpperCase() || 'IW'}
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.name}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user?.title || activeRole.replace('_', ' ')}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsChangePasswordOpen(true)}
            title="Change Your Password"
            style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem', color: '#ffd88a' }}
          >
            🔑
          </button>
          <button className="btn btn-secondary" onClick={logout} title="Sign Out" style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}>
            🚪
          </button>
        </div>
      </aside>

      {/* Main Content Layout */}
      <div className="main-layout">
        {/* Top Header */}
        <header className="top-header">
          {/* Mobile Hamburger Toggle Button */}
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle navigation menu"
            title="Open Menu"
          >
            ☰
          </button>

          {/* Mobile Compact Brand Title */}
          <div className="mobile-brand-title">
            <span style={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1.05rem', letterSpacing: '-0.02em' }}>IWG</span>
          </div>

          {/* Search Trigger for Leads, Clients, Policies */}
          <div
            className="search-trigger"
            onClick={() => setIsSearchOpen(true)}
            title="Search leads, clients, opportunities, and policies (Ctrl+K)"
          >
            <span className="search-icon">🔍</span>
            <span className="search-placeholder-text">Search leads, clients, policies...</span>
            <span className="kbd-shortcut">Ctrl K</span>
          </div>

          {/* Left Scroll Button for Top Toolbar */}
          <button
            type="button"
            className="toolbar-scroll-btn"
            onClick={() => scrollHeaderToolbar('left')}
            title="Scroll toolbar left"
            aria-label="Scroll toolbar left"
          >
            ◀
          </button>

          <div
            ref={headerScrollRef}
            className="header-actions"
            onWheel={(e) => {
              if (e.deltaY !== 0 && headerScrollRef.current) {
                headerScrollRef.current.scrollLeft += e.deltaY;
              }
            }}
          >
            {/* 1. Talk to Sarah Voice AI Receptionist & (Admin-Only) Outbound Caller (480) 331-9455 — FIRST BUTTON IN TOP BAR */}
            <button
              type="button"
              className="btn header-tool-btn"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('iwg-open-sarah-voice', {
                    detail: { mode: activeRole === 'admin' ? 'outbound' : 'inbound' },
                  })
                )
              }
              title={
                activeRole === 'admin'
                  ? 'Sarah Voice AI — (480) 331-9455 Virtual Receptionist & Admin Outbound Caller'
                  : 'Sarah Voice AI — (480) 331-9455 Virtual Receptionist'
              }
              style={{
                background: 'linear-gradient(135deg, #059669 0%, #0284c7 100%)',
                borderColor: '#34d399',
                color: '#ffffff',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 0 15px rgba(16, 185, 129, 0.45)',
              }}
            >
              <span style={{ fontSize: '1.05rem' }}>🎙️</span>
              <span className="btn-text">Sarah (480) 331-9455</span>
            </button>

            {/* 2. Admin-Only: Activate Sarah AI Outbound Scheduling Workday & Warm-Transfer Control */}
            {activeRole === 'admin' && (
              <button
                type="button"
                className="btn header-tool-btn"
                onClick={() => setIsBlandControlOpen(true)}
                title="Admin Only: Activate Sarah Voice AI to start her scheduling workday & call all assigned leads"
                style={{
                  background: blandStatus.is_on_warm_transfer
                    ? 'linear-gradient(135deg, #f59e0b, #7c3aed)'
                    : blandStatus.is_campaign_active
                    ? 'linear-gradient(135deg, #059669, #7c3aed)'
                    : 'linear-gradient(135deg, #7c3aed, #9333ea)',
                  borderColor: blandStatus.is_on_warm_transfer ? '#fbbf24' : '#a855f7',
                  color: '#ffffff',
                  fontWeight: 800,
                  boxShadow: '0 0 14px rgba(139, 92, 246, 0.45)',
                }}
              >
                <span>{blandStatus.is_on_warm_transfer ? '🔥🎙️' : '🚀'}</span>
                <span className="btn-text">
                  {blandStatus.is_on_warm_transfer
                    ? 'Sarah AI (Warm Transfer: Appt Only)'
                    : blandStatus.is_campaign_active
                    ? 'Sarah Workday Active'
                    : 'Activate Sarah AI'}
                </span>
              </button>
            )}

            {/* Quoting Portals Dropdown */}
            <div className="quoting-tools-dropdown-container" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="btn btn-secondary quoting-trigger-btn"
                onClick={() => setIsQuotingMenuOpen(!isQuotingMenuOpen)}
                title="Medicare Quoting & Enrollment Portals (MedicareCENTER, SunFire, Connecture)"
              >
                <span>⚡</span>
                <span className="btn-text">Quoting</span>
                <span style={{ fontSize: '0.65rem', opacity: 0.8, marginLeft: '2px' }}>▾</span>
              </button>

              {isQuotingMenuOpen && (
                <div className="quoting-dropdown-menu">
                  <div className="quoting-dropdown-header">
                    Medicare Quoting & Enrollment
                  </div>
                  <a
                    href="https://www.medicarecenter.com"
                    target="_blank"
                    rel="noreferrer"
                    className="quoting-dropdown-item"
                    onClick={() => setIsQuotingMenuOpen(false)}
                  >
                    <div>
                      <div className="quoting-item-title">MedicareCENTER ↗</div>
                      <div className="quoting-item-subtitle">Integrity / CSG Quotes & E-Apps</div>
                    </div>
                  </a>
                  <a
                    href="https://sunfirematrix.com"
                    target="_blank"
                    rel="noreferrer"
                    className="quoting-dropdown-item"
                    onClick={() => setIsQuotingMenuOpen(false)}
                  >
                    <div>
                      <div className="quoting-item-title">SunFire Matrix ↗</div>
                      <div className="quoting-item-subtitle">Carrier Comparison & Enrollment</div>
                    </div>
                  </a>
                  <a
                    href="https://connecture.com"
                    target="_blank"
                    rel="noreferrer"
                    className="quoting-dropdown-item"
                    onClick={() => setIsQuotingMenuOpen(false)}
                  >
                    <div>
                      <div className="quoting-item-title">Connecture DRX ↗</div>
                      <div className="quoting-item-subtitle">Part D Rx & MAPD Quoting Portal</div>
                    </div>
                  </a>
                  <div style={{ padding: '0.65rem 0.85rem', background: '#0a163b', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '0.75rem', color: '#cbd5e1', lineHeight: 1.4 }}>
                    <div style={{ color: '#ffd88a', fontWeight: 700, marginBottom: '2px' }}>Non-Medicare Quotes:</div>
                    <div>Call <strong>(480) 331-9455</strong> or email <strong>info@iwillglobal.com</strong> for Life, Group, Health & Annuity quotes.</div>
                  </div>
                </div>
              )}
            </div>

            {/* Master Exit All button visible whenever any panel or dialer is active */}
            {(isDialerOpen || isScriptOpen || isCopilotOpen || copilotDispositionContact || isRunningLateOpen || isWarmTransferOpen) && (
              <button
                type="button"
                className="btn header-tool-btn"
                onClick={() => {
                  setIsDialerOpen(false);
                  setIsScriptOpen(false);
                  setIsCopilotOpen(false);
                  setCopilotDispositionContact(null);
                  setIsRunningLateOpen(false);
                  setIsWarmTransferOpen(false);
                }}
                style={{
                  backgroundColor: '#dc2626',
                  borderColor: '#b91c1c',
                  color: '#ffffff',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.45rem 0.85rem',
                  boxShadow: '0 0 14px rgba(220, 38, 38, 0.5)',
                  cursor: 'pointer',
                }}
                title="Exit all open drawers and return to page"
              >
                <span>🚪</span> <span className="btn-text">Exit All</span>
              </button>
            )}

            {/* Outbound Call Script button */}
            {isScriptOpen ? (
              <button
                className="btn header-tool-btn active"
                onClick={() => setIsScriptOpen(false)}
                title="Exit Outbound Call Script"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.18)',
                  borderColor: '#ef4444',
                  color: '#f87171',
                  fontWeight: 750,
                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.25)',
                }}
              >
                <span>🚪</span> <span className="btn-text">Exit Script</span>
              </button>
            ) : (
              <button className="btn btn-secondary header-tool-btn" onClick={() => setIsScriptOpen(true)} title="Open Outbound Call Script">
                <span>📜</span> <span className="btn-text">Script</span>
              </button>
            )}

            {/* Power Dialer button */}
            {isDialerOpen ? (
              <button
                className="btn header-tool-btn active"
                onClick={() => setIsDialerOpen(false)}
                title="Exit Power Dialer"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.18)',
                  borderColor: '#ef4444',
                  color: '#f87171',
                  fontWeight: 750,
                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.25)',
                }}
              >
                <span>🚪</span> <span className="btn-text">Exit Dialer</span>
              </button>
            ) : (
              <button className="btn btn-secondary header-tool-btn" onClick={() => setIsDialerOpen(true)} title="Open Power Dialer">
                <span>⚡</span> <span className="btn-text">Dialer</span>
              </button>
            )}

            {/* Live Warm Transfer button */}
            {isWarmTransferOpen ? (
              <button
                className="btn header-tool-btn active"
                onClick={() => setIsWarmTransferOpen(false)}
                title="Close Warm Transfer"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.18)',
                  borderColor: '#ef4444',
                  color: '#f87171',
                  fontWeight: 750,
                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.25)',
                }}
              >
                <span>🚪</span> <span className="btn-text">Exit Transfer</span>
              </button>
            ) : (
              <button
                className="btn btn-secondary header-tool-btn"
                onClick={() => {
                  let hasRecent = false;
                  try {
                    hasRecent = Boolean(sessionStorage.getItem('iwg_last_active_prospect'));
                  } catch (e) {}
                  if (!isDialerOpen && !hasRecent) {
                    alert('⚠️ Live Call Required: Warm Transfer is only available once you are connected on a live call with a prospect. Opening dialer now to connect...');
                    setIsDialerOpen(true);
                  } else {
                    setIsWarmTransferOpen(true);
                  }
                }}
                title="Live 3-Way Warm Transfer (Agent + Scheduler + Prospect)"
                style={{
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                  fontWeight: 750,
                  backgroundColor: 'rgba(200, 150, 62, 0.15)',
                }}
              >
                <span>⚡</span> <span className="btn-text">3-Way Transfer</span>
              </button>
            )}

            {/* Copilot button */}
            {isCopilotOpen ? (
              <button
                className="btn header-tool-btn active"
                onClick={() => setIsCopilotOpen(false)}
                title="Exit IWG Copilot"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.18)',
                  borderColor: '#ef4444',
                  color: '#f87171',
                  fontWeight: 750,
                  boxShadow: '0 0 10px rgba(239, 68, 68, 0.25)',
                }}
              >
                <span>🚪</span> <span className="btn-text">Exit Copilot</span>
              </button>
            ) : (
              <button className="btn btn-primary header-tool-btn" onClick={() => setIsCopilotOpen(true)} title="Open IWG Copilot">
                <span>🤖</span> <span className="btn-text">Copilot</span>
              </button>
            )}

            {/* Running Late Auto-Text button - ADMIN & AGENTS ONLY */}
            {isAgentOrAdmin && (
              <button
                className="btn btn-secondary header-tool-btn"
                onClick={() => setIsRunningLateOpen(true)}
                title="Running Late? Send automated text to next appointment (Admin & Licensed Agents Only)"
                style={{ borderColor: '#f59e0b', color: '#fbbf24', fontWeight: 700 }}
              >
                <span>🏃</span> <span className="btn-text">Late?</span>
              </button>
            )}

            {/* Direct Admin Team Directory button */}
            {(user?.role === 'admin' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com' || activeRole === 'admin') && (
              <Link
                to="/team"
                className="btn btn-secondary header-tool-btn"
                style={{ borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 700, textDecoration: 'none' }}
                title="Manage team members, assign roles, and permissions"
              >
                <span>🛡️</span> <span className="btn-text">Team</span>
              </Link>
            )}

            {/* Role Tester Switcher */}
            <div className="role-selector" title="Switch view role for testing permissions">
              <span className="role-label">Role:</span>
              <select
                className="role-select-dropdown"
                value={activeRole}
                onChange={(e) => setActiveRole(e.target.value as Role)}
              >
                <option value="admin">Admin</option>
                <option value="manager">Manager</option>
                <option value="licensed_agent">Licensed Agent</option>
                <option value="scheduler">Scheduler</option>
              </select>
            </div>
          </div>

          {/* Right Scroll Button for Top Toolbar */}
          <button
            type="button"
            className="toolbar-scroll-btn"
            onClick={() => scrollHeaderToolbar('right')}
            title="Scroll toolbar right"
            aria-label="Scroll toolbar right"
          >
            ▶
          </button>
        </header>

        {/* Page Content */}
        <main className="page-content">{children}</main>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Bottom Navigation">
        <Link
          to="/dashboard"
          className={`mobile-bottom-nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <span>📊</span>
          <span>Home</span>
        </Link>
        <Link
          to="/calendar"
          className={`mobile-bottom-nav-item ${location.pathname.startsWith('/calendar') ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <span>📅</span>
          <span>Calendar</span>
        </Link>
        <Link
          to="/leads"
          className={`mobile-bottom-nav-item ${location.pathname.startsWith('/leads') ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <span>🎯</span>
          <span>Leads</span>
        </Link>
        {isDialerOpen ? (
          <button
            type="button"
            className="mobile-bottom-nav-item active"
            onClick={() => setIsDialerOpen(false)}
            style={{ color: '#f87171' }}
            title="Exit Power Dialer"
          >
            <span>🚪</span>
            <span>Exit</span>
          </button>
        ) : (
          <button
            type="button"
            className="mobile-bottom-nav-item"
            onClick={() => {
              setIsDialerOpen(true);
              setIsMobileMenuOpen(false);
            }}
            title="Open Power Dialer"
          >
            <span>⚡</span>
            <span>Dialer</span>
          </button>
        )}
        <button
          type="button"
          className="mobile-bottom-nav-item"
          onClick={() => {
            let hasRecent = false;
            try {
              hasRecent = Boolean(sessionStorage.getItem('iwg_last_active_prospect'));
            } catch (e) {}
            if (!isDialerOpen && !hasRecent) {
              alert('⚠️ Live Call Required: Warm Transfer is only available once you are connected on a live call with a prospect. Opening dialer now to connect...');
              setIsDialerOpen(true);
            } else {
              setIsWarmTransferOpen(true);
            }
            setIsMobileMenuOpen(false);
          }}
          title="Live Warm Transfer to King Amen Ra (602) 456-9681"
          style={{ color: 'var(--accent)' }}
        >
          <span>⚡</span>
          <span>Transfer</span>
        </button>
        <button
          type="button"
          className={`mobile-bottom-nav-item ${isMobileMenuOpen ? 'active' : ''}`}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-label="Toggle navigation drawer"
        >
          <span>☰</span>
          <span>Menu</span>
        </button>
      </nav>

      {/* Global Modals */}
      <CommandPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <CopilotDrawer
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        onExitAndDisposition={(contact) => {
          setIsCopilotOpen(false);
          setCopilotDispositionContact(contact);
        }}
      />
      <PowerDialer isOpen={isDialerOpen} onClose={() => setIsDialerOpen(false)} />
      <OutboundScriptModal isOpen={isScriptOpen} onClose={() => setIsScriptOpen(false)} />
      <WarmTransferModal isOpen={isWarmTransferOpen} onClose={() => setIsWarmTransferOpen(false)} />
      <BlandAgentControlModal isOpen={isBlandControlOpen} onClose={() => setIsBlandControlOpen(false)} />
      {isAgentOrAdmin && (
        <RunningLateModal isOpen={isRunningLateOpen} onClose={() => setIsRunningLateOpen(false)} />
      )}
      <ChangePasswordModal isOpen={isChangePasswordOpen} onClose={() => setIsChangePasswordOpen(false)} />

      {/* Global Disposition CallPanel Triggered from Copilot */}
      {copilotDispositionContact && (
        <CallPanel
          contact={copilotDispositionContact}
          onClose={() => setCopilotDispositionContact(null)}
          onCallCompleted={() => {
            setCopilotDispositionContact(null);
            window.dispatchEvent(new CustomEvent('iwg-lead-updated'));
          }}
        />
      )}
    </div>
  );
};
