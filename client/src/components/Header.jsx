import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Phone, Mail, Menu, X, MapPin } from 'lucide-react';
import './Header.css';

const Header = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const isActive = (path) => {
    return location.pathname === path ? 'active' : '';
  };

  const closeMenu = () => setMobileMenuOpen(false);

  return (
    <header className="site-header">
      {/* Top Banner */}
      <div className="top-banner">
        <div className="container banner-inner">
          <div className="contact-info">
            <a href="tel:(480) 331-9455" className="contact-link">
              <Phone size={14} /> <span>(480) 331-9455</span>
            </a>
            <a href="mailto:info@iwillglobal.com" className="contact-link">
              <Mail size={14} /> <span>info@iwillglobal.com</span>
            </a>
          </div>
          <div className="agent-locator">
            <a href="/#our-team" className="contact-link text-accent">
              <MapPin size={14} /> <span>Our Team Directory</span>
            </a>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="main-nav glass animate-fade-in">
        <div className="container nav-inner">
          <Link to="/" className="brand-logo" title="I Will Global Insurance and Financial Services" onClick={closeMenu}>
            <img src="/logo.png" alt="I Will Global Insurance and Financial Services" className="header-logo" />
          </Link>

          <nav className="desktop-menu">
            <Link to="/" className={`nav-link ${isActive('/')}`}>Home</Link>
            <Link to="/about-us" className={`nav-link ${isActive('/about-us')}`}>About Us</Link>
            <a href="/#our-team" className="nav-link">Our Team</a>
            <Link to="/medicare-resources" className={`nav-link ${isActive('/medicare-resources')}`}>Medicare Resources</Link>
            <Link to="/services" className={`nav-link ${isActive('/services')}`}>Other Offerings</Link>
            <a href="/login" className="nav-link" style={{fontWeight: '700', color: 'var(--accent, #c8963e)'}}>Agent Login</a>
          </nav>

          <div className="nav-actions">
            <a 
              href="https://my.destinationrx.com/hub/s/SMPJW7R2A" 
              target="_blank" 
              rel="noreferrer" 
              className="btn btn-accent btn-small"
              title="Find a Medicare Plan Online (For other quotes, call 480-331-9455 or email info@iwillglobal.com)"
            >
              Find a Plan (Medicare)
            </a>
            <button 
              type="button"
              className="mobile-menu-btn" 
              aria-label="Toggle menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: '#051039' }}
            >
              {mobileMenuOpen ? <X size={26} /> : <Menu size={26} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="mobile-drawer animate-fade-in">
            <nav className="mobile-nav-links">
              <Link to="/" className={`mobile-nav-link ${isActive('/')}`} onClick={closeMenu}>Home</Link>
              <Link to="/about-us" className={`mobile-nav-link ${isActive('/about-us')}`} onClick={closeMenu}>About Us</Link>
              <a href="/#our-team" className="mobile-nav-link" onClick={closeMenu}>Our Team</a>
              <Link to="/medicare-resources" className={`mobile-nav-link ${isActive('/medicare-resources')}`} onClick={closeMenu}>Medicare Resources</Link>
              <Link to="/services" className={`mobile-nav-link ${isActive('/services')}`} onClick={closeMenu}>Other Offerings</Link>
              <a href="/login" className="mobile-nav-link" style={{fontWeight: '700', color: 'var(--accent, #c8963e)'}} onClick={closeMenu}>Agent Login</a>
            </nav>
            <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <a href="https://my.destinationrx.com/hub/s/SMPJW7R2A" target="_blank" rel="noreferrer" className="btn btn-accent" style={{ textAlign: 'center', width: '100%', fontWeight: 700 }}>
                Find a Plan (Medicare) ↗
              </a>
              <a href="tel:(480) 331-9455" className="btn btn-primary" style={{ textAlign: 'center', width: '100%' }}>
                📞 Call (480) 331-9455
              </a>
              <a href="mailto:info@iwillglobal.com" className="btn btn-secondary" style={{ textAlign: 'center', width: '100%' }}>
                ✉️ Email info@iwillglobal.com
              </a>
              <div style={{ fontSize: '0.74rem', color: '#475569', textAlign: 'center', lineHeight: 1.4, padding: '0 0.5rem' }}>
                * <strong>"Find a Plan"</strong> is for Medicare. For all other quotes, please call (480) 331-9455 or email info@iwillglobal.com.
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
