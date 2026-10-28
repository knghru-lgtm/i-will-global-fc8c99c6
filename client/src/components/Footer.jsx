import { Link } from 'react-router-dom';
import { Phone, Mail } from 'lucide-react';
import './Footer.css';

const Footer = () => {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-col brand-col">
          <h3 className="footer-brand">I WILL GLOBAL</h3>
          <p className="footer-tagline">No-cost assistance with your Medicare enrollment and benefits.</p>
          <div className="footer-contact mt-1">
            <a href="tel:(480) 331-9455" className="footer-contact-link">
              <Phone size={16} /> <span>(480) 331-9455</span>
            </a>
            <a href="mailto:info@iwillglobal.com" className="footer-contact-link">
              <Mail size={16} /> <span>info@iwillglobal.com</span>
            </a>
          </div>
        </div>

        <div className="footer-col links-col">
          <h4>Explore</h4>
          <Link to="/">Home</Link>
          <Link to="/about-us">About Us</Link>
          <Link to="/medicare-resources">Medicare Resources</Link>
          <Link to="/services">Other Offerings</Link>
        </div>

        <div className="footer-col legal-col">
          <h4>Stay Healthy</h4>
          <p className="small-text mb-1">Join our newsletter for health tips straight to your inbox.</p>
          <div className="newsletter-form">
            <input type="email" placeholder="Your email address" />
            <button className="btn btn-accent btn-small">Join</button>
          </div>
        </div>
      </div>

      <div className="footer-bottom container">
        <p>© {new Date().getFullYear()} I Will Global, Inc. All Rights Reserved.</p>
        <p className="disclaimer">
          The online "Find a Plan" tool is exclusively for Medicare comparison. For all other quotes (Individual & Group Health, Life Insurance, Annuities, Long-Term Care), please call (480) 331-9455 or email info@iwillglobal.com.
        </p>
        <p className="disclaimer">
          Medicare has neither reviewed nor endorsed this information. Not connected with or endorsed by the United States government or the federal Medicare program.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
