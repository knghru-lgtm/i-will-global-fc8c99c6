import React, { useState, useEffect } from 'react';
import { api, formatPhone } from '../lib/api';
import { Link } from 'react-router-dom';

export const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<any[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    api.get('/records/clients?sort=last_name:asc')
      .then((res) => {
        setClients(res.rows || []);
        setTotal(res.total || 0);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const filteredClients = clients.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const fullName = `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase();
    const phone = (c.phone || '').toLowerCase();
    const email = (c.email || '').toLowerCase();
    const city = (c.city || '').toLowerCase();
    const county = (c.county || '').toLowerCase();
    return fullName.includes(q) || phone.includes(q) || email.includes(q) || city.includes(q) || county.includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Client Roster & Policyholders</h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Showing {filteredClients.length} of {total} active policyholders
          </div>
        </div>
        <Link to="/policies" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
          📜 View Book of Business by Carrier →
        </Link>
      </div>

      {/* Client Search Toolbar */}
      <div style={{ display: 'flex', gap: '0.75rem', background: 'var(--bg-card)', padding: '0.85rem 1rem', borderRadius: '10px', border: '1px solid var(--border-color)', alignItems: 'center' }}>
        <span style={{ fontSize: '1rem' }}>🔍</span>
        <input
          type="text"
          placeholder="Search clients by name, phone, email, city, county..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.88rem' }}
        />
        {searchQuery && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setSearchQuery('')}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem' }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Client Name</th>
              <th>Phone / Email</th>
              <th>City / County</th>
              <th>Part A / B Dates</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>Loading clients...</td></tr>
            ) : filteredClients.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No clients matched your search "{searchQuery}"</td></tr>
            ) : filteredClients.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/clients/${c.id}`} style={{ color: 'var(--text-main)', fontWeight: 600, textDecoration: 'none' }}>
                    {c.first_name} {c.last_name}
                  </Link>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>DOB: {c.dob || 'N/A'}</div>
                </td>

                <td>
                  <div>{formatPhone(c.phone)}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.email || ''}</div>
                </td>

                <td>
                  <div>{c.city ? `${c.city}, ` : ''}{c.state || 'AZ'}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.county || ''}</div>
                </td>

                <td>
                  <div style={{ fontSize: '0.8rem' }}>Part A: {c.part_a_date || 'Enrolled'}</div>
                  <div style={{ fontSize: '0.8rem' }}>Part B: {c.part_b_date || 'Enrolled'}</div>
                </td>

                <td>
                  <span className="badge badge-success">{c.status || 'Active'}</span>
                </td>

                <td>
                  <Link to={`/clients/${c.id}`} className="btn btn-secondary" style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}>
                    View Profile →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
