import React, { useState, useEffect, useRef } from 'react';
import { api, formatPhone } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  FileSpreadsheet, 
  Download, 
  RefreshCw, 
  Search, 
  Building2, 
  ShieldCheck, 
  CheckCircle2, 
  Users, 
  DollarSign, 
  Layers
} from 'lucide-react';

interface CarrierSummary {
  carrier: string;
  total_count: number;
  active_count: number;
  total_premium: number;
}

interface OverallSummary {
  total_policies: number;
  active_policies: number;
  monthly_premium: number;
  total_clients: number;
  total_carriers: number;
}

const CARRIER_COLORS: Record<string, string> = {
  'UnitedHealthcare': '#002677',
  'Humana': '#00754a',
  'Aetna Medicare': '#d2092b',
  'Aetna': '#d2092b',
  'Wellcare': '#00843d',
  'Cigna Healthcare': '#0097a9',
  'Cigna': '#0097a9',
  'Blue Cross Blue Shield / Anthem': '#005596',
  'Mutual of Omaha': '#0b4ea2',
  'Devoted Health': '#632ca6',
  'Kaiser Permanente': '#0067a3',
  'Molina Healthcare': '#1c3f94',
  'SilverScript': '#cc0000',
  'Other Carrier': '#4f46e5'
};

function getCarrierBadgeColor(carrierName: string): string {
  for (const [k, color] of Object.entries(CARRIER_COLORS)) {
    if (carrierName.toLowerCase().includes(k.toLowerCase())) return color;
  }
  return '#3b82f6';
}

const CORE_CARRIERS = [
  'UnitedHealthcare',
  'Humana',
  'Aetna Medicare',
  'Wellcare',
  'Cigna Healthcare',
  'Blue Cross Blue Shield / Anthem',
  'Mutual of Omaha',
  'Devoted Health',
  'Kaiser Permanente',
  'Molina Healthcare',
  'SilverScript',
];

export const PoliciesPage: React.FC = () => {
  const { isScheduler, user } = useAuth();
  
  // Data state
  const [policies, setPolicies] = useState<any[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [carrierBreakdown, setCarrierBreakdown] = useState<CarrierSummary[]>([]);
  const [summary, setSummary] = useState<OverallSummary>({
    total_policies: 0,
    active_policies: 0,
    monthly_premium: 0,
    total_clients: 0,
    total_carriers: 0,
  });

  const allDisplayCarriers = React.useMemo(() => {
    const map = new Map<string, CarrierSummary>();
    for (const c of CORE_CARRIERS) {
      map.set(c.toLowerCase(), { carrier: c, total_count: 0, active_count: 0, total_premium: 0 });
    }
    for (const cb of carrierBreakdown) {
      const existing = map.get(cb.carrier.toLowerCase());
      if (existing) {
        existing.total_count = cb.total_count;
        existing.active_count = cb.active_count;
        existing.total_premium = cb.total_premium;
      } else {
        map.set(cb.carrier.toLowerCase(), cb);
      }
    }
    return Array.from(map.values());
  }, [carrierBreakdown]);

  // Filters
  const [selectedCarrier, setSelectedCarrier] = useState<string>('All');
  const [selectedPlanType, setSelectedPlanType] = useState<string>('All');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Agents list for assignment
  const [agents, setAgents] = useState<any[]>([]);

  // Book of Business Upload Modal state
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [uploadFileName, setUploadFileName] = useState<string>('');
  const [carrierMode, setCarrierMode] = useState<'auto' | 'manual'>('auto');
  const [manualCarrier, setManualCarrier] = useState<string>('UnitedHealthcare');
  const [targetAgentId, setTargetAgentId] = useState<string>('');
  const [detectedCarriers, setDetectedCarriers] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadResult, setUploadResult] = useState<any | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load Book of Business
  const loadBookOfBusiness = async () => {
    setLoading(true);
    try {
      let url = `/records/policies/book-of-business?sort=effective_date:desc&limit=100`;
      if (selectedCarrier && selectedCarrier !== 'All') {
        url += `&carrier=${encodeURIComponent(selectedCarrier)}`;
      }
      if (selectedPlanType && selectedPlanType !== 'All') {
        url += `&plan_type=${encodeURIComponent(selectedPlanType)}`;
      }
      if (selectedStatus && selectedStatus !== 'All') {
        url += `&status=${encodeURIComponent(selectedStatus)}`;
      }
      if (searchQuery.trim()) {
        url += `&q=${encodeURIComponent(searchQuery.trim())}`;
      }

      const res = await api.get(url);
      setPolicies(res.rows || []);
      setTotal(res.total || 0);
      setCarrierBreakdown(res.carrier_breakdown || []);
      if (res.summary) {
        setSummary(res.summary);
      }
    } catch (err) {
      console.error('Failed to load book of business:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load agents for assignment
  useEffect(() => {
    api.get('/records/users?limit=100')
      .then((res) => {
        const list = res.rows || [];
        setAgents(list.filter((u: any) => u.active !== false));
      })
      .catch((err) => console.error('Failed to load agents:', err));
  }, []);

  useEffect(() => {
    loadBookOfBusiness();
  }, [selectedCarrier, selectedPlanType, selectedStatus, searchQuery]);

  // Handle Excel / CSV File Parsing for Book of Business
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadFileName(file.name);
    setUploadResult(null);
    setUploadProgress(0);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!json || json.length === 0) {
        alert('The uploaded spreadsheet is empty or has no recognizable data rows.');
        return;
      }

      // Detect carrier distribution in file
      const cDist: Record<string, number> = {};
      json.forEach((row) => {
        const rawC = row.carrier || row.Carrier || row.company || row.Company || row.payer || row.Payer || row['Carrier Name'] || row['Company Name'] || '';
        if (rawC) {
          const cName = String(rawC).trim();
          cDist[cName] = (cDist[cName] || 0) + 1;
        }
      });

      setDetectedCarriers(cDist);
      setParsedRows(json);
      setTargetAgentId(user?.id || '');
      setShowUploadModal(true);
    } catch (err: any) {
      alert(`Error reading spreadsheet: ${err.message || 'Invalid format'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Submit Book of Business Batch
  const handleConfirmImport = async () => {
    if (!parsedRows.length) return;
    setIsUploading(true);
    setUploadProgress(10);

    try {
      const CHUNK_SIZE = 250;
      let totalImported = 0;
      let aggregatedCarriers: Record<string, number> = {};

      for (let i = 0; i < parsedRows.length; i += CHUNK_SIZE) {
        const chunk = parsedRows.slice(i, i + CHUNK_SIZE);
        const payload = {
          rows: chunk,
          default_carrier: carrierMode === 'manual' ? manualCarrier : undefined,
          default_agent_id: targetAgentId || undefined,
        };

        const res = await api.post('/records/batch-import/book-of-business', payload);
        if (res.imported) totalImported += res.imported;
        if (res.carriers_breakdown) {
          for (const [c, cnt] of Object.entries(res.carriers_breakdown as Record<string, number>)) {
            aggregatedCarriers[c] = (aggregatedCarriers[c] || 0) + cnt;
          }
        }

        const pct = Math.round(((i + chunk.length) / parsedRows.length) * 100);
        setUploadProgress(pct);
      }

      setUploadResult({
        total: totalImported,
        carriers: aggregatedCarriers,
      });

      // Reload fresh data
      loadBookOfBusiness();
    } catch (err: any) {
      alert(`Book of business import failed: ${err.message || 'Server error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Export current carrier's roster to CSV
  const handleExportCSV = () => {
    if (!policies.length) {
      alert('No policies available to export in current filter.');
      return;
    }

    const exportData = policies.map((p) => ({
      'Carrier': p.carrier,
      'Client Name': p.client_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      'Phone': formatPhone(p.client_phone),
      'Email': p.client_email || '',
      'City': p.client_city || '',
      'State': p.client_state || '',
      'Plan Name': p.plan_name,
      'Plan Type': p.plan_type,
      'Policy Number': p.policy_number || '',
      'Status': p.status,
      'Effective Date': p.effective_date || '',
      'Monthly Premium': p.premium ? `$${p.premium}` : '$0',
      'Writing Agent': p.agent_name || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'BookOfBusiness');
    const safeCarrierName = selectedCarrier.replace(/[^a-zA-Z0-9]/g, '_');
    XLSX.writeFile(wb, `IWG_Book_Of_Business_${safeCarrierName}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  if (isScheduler) {
    return (
      <div style={{ padding: '2rem', color: 'var(--warning)', background: 'var(--warning-bg)', borderRadius: '12px' }}>
        ⚠️ Policy book of business management is restricted to Licensed Agents and Managers.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelect} 
        accept=".xlsx, .xls, .csv" 
        style={{ display: 'none' }} 
        id="bob-file-upload"
      />

      {/* Top Header & Executive Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
              Book of Business
            </h1>
            <span className="badge badge-primary" style={{ fontSize: '0.8rem', padding: '0.2rem 0.65rem' }}>
              Carrier Separation Engine
            </span>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Showing {policies.length} of {total} policies • Active policyholders and enrolled plans separated by carrier, line of business, and policy status.
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button 
            className="btn btn-secondary" 
            onClick={loadBookOfBusiness}
            title="Refresh policies"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>

          <button 
            className="btn btn-secondary" 
            onClick={handleExportCSV}
            title="Export filtered policies to CSV"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
          >
            <Download size={15} /> Export Carrier List
          </button>

          <label 
            htmlFor="bob-file-upload" 
            className="btn btn-primary" 
            style={{ 
              cursor: 'pointer', 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '0.5rem', 
              fontWeight: 700,
              backgroundColor: 'var(--accent)',
              color: '#000',
              boxShadow: '0 4px 14px rgba(200, 150, 62, 0.35)'
            }}
          >
            <Upload size={16} /> Upload Book of Business (Excel / CSV)
          </label>
        </div>
      </div>

      {/* KPI Overview Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '4px solid var(--accent)' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(200, 150, 62, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
            <Layers size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Policies</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
              {(summary.total_policies || 0).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#10b981' }}>
              {(summary.active_policies || 0).toLocaleString()} Active Enrolled
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '4px solid #10b981' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
            <DollarSign size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Active Monthly Premium</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
              ${Math.round(summary.monthly_premium || 0).toLocaleString()}<span style={{ fontSize: '0.8rem', fontWeight: 500 }}>/mo</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              ${Math.round((summary.monthly_premium || 0) * 12).toLocaleString()} Annualized
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '4px solid #3b82f6' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
            <Building2 size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Active Carriers</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
              {carrierBreakdown.length || summary.total_carriers || 0}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>
              Separated Roster
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: 'rgba(139, 92, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
            <Users size={22} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Enrolled Clients</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
              {(summary.total_clients || 0).toLocaleString()}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Unique Policyholders
            </div>
          </div>
        </div>
      </div>

      {/* CARRIER SEPARATION TABS (HORIZONTALLY SCROLLABLE RIBBON) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Filter Book by Insurance Carrier:
        </div>
        <div 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.5rem', 
            overflowX: 'auto', 
            paddingBottom: '0.4rem',
            scrollbarWidth: 'thin'
          }}
        >
          {/* All Carriers Tab */}
          <button
            onClick={() => setSelectedCarrier('All')}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '9999px',
              border: selectedCarrier === 'All' ? '2px solid var(--accent)' : '1px solid rgba(255,255,255,0.12)',
              backgroundColor: selectedCarrier === 'All' ? 'rgba(200, 150, 62, 0.18)' : '#16245c',
              color: selectedCarrier === 'All' ? 'var(--accent)' : '#cbd5e1',
              fontWeight: selectedCarrier === 'All' ? 700 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🌐 All Carriers</span>
            <span style={{ 
              backgroundColor: selectedCarrier === 'All' ? 'var(--accent)' : 'rgba(255,255,255,0.1)', 
              color: selectedCarrier === 'All' ? '#000' : '#cbd5e1',
              padding: '0.1rem 0.5rem', 
              borderRadius: '9999px', 
              fontSize: '0.75rem',
              fontWeight: 700 
            }}>
              {summary.total_policies || 0}
            </span>
          </button>

          {/* Individual Carrier Tabs */}
          {allDisplayCarriers.map((cb) => {
            const isSelected = selectedCarrier === cb.carrier;
            const brandColor = getCarrierBadgeColor(cb.carrier);
            return (
              <button
                key={cb.carrier}
                onClick={() => setSelectedCarrier(cb.carrier)}
                style={{
                  padding: '0.55rem 1rem',
                  borderRadius: '9999px',
                  border: isSelected ? `2px solid ${brandColor}` : '1px solid rgba(255,255,255,0.12)',
                  backgroundColor: isSelected ? 'rgba(255,255,255,0.1)' : '#16245c',
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  fontWeight: isSelected ? 700 : 500,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: brandColor, display: 'inline-block' }} />
                <span>{cb.carrier}</span>
                <span style={{ 
                  backgroundColor: isSelected ? brandColor : 'rgba(255,255,255,0.1)', 
                  color: '#ffffff',
                  padding: '0.1rem 0.5rem', 
                  borderRadius: '9999px', 
                  fontSize: '0.75rem',
                  fontWeight: 700 
                }}>
                  {cb.total_count}
                </span>
                {cb.total_premium > 0 && (
                  <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 600 }}>
                    ${Math.round(cb.total_premium).toLocaleString()}/mo
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Secondary Search and Attribute Filters */}
      <div className="card" style={{ padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ flex: '1 1 250px', position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            className="form-control" 
            placeholder="Search by client name, policy #, plan name, phone, city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: '2.2rem', width: '100%', fontSize: '0.85rem' }}
          />
        </div>

        {/* Plan Type Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Plan Type:</span>
          <select 
            className="form-control" 
            value={selectedPlanType} 
            onChange={(e) => setSelectedPlanType(e.target.value)}
            style={{ fontSize: '0.85rem', width: 'auto' }}
          >
            <option value="All">All Plan Types</option>
            <option value="Medicare Advantage">Medicare Advantage (Part C / MAPD)</option>
            <option value="Medicare Supplement">Medicare Supplement (Medigap)</option>
            <option value="Part D (PDP)">Prescription Drug Plan (Part D)</option>
            <option value="ACA / Individual Health">ACA / Under 65 Health</option>
            <option value="Dental / Vision">Dental / Vision / Hearing</option>
            <option value="Life / Annuity">Life / Annuity / IUL</option>
          </select>
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Status:</span>
          <select 
            className="form-control" 
            value={selectedStatus} 
            onChange={(e) => setSelectedStatus(e.target.value)}
            style={{ fontSize: '0.85rem', width: 'auto' }}
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active Only</option>
            <option value="Pending">Pending Only</option>
            <option value="Terminated">Terminated / Lapsed</option>
          </select>
        </div>

        {/* Active Filter Clear */}
        {(selectedCarrier !== 'All' || selectedPlanType !== 'All' || selectedStatus !== 'All' || searchQuery) && (
          <button 
            className="btn btn-secondary" 
            onClick={() => {
              setSelectedCarrier('All');
              setSelectedPlanType('All');
              setSelectedStatus('All');
              setSearchQuery('');
            }}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Main Book of Business Data Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Client Name / Insured</th>
              <th>Carrier</th>
              <th>Plan Details</th>
              <th>Policy / Member ID</th>
              <th>Effective Date</th>
              <th>Monthly Premium</th>
              <th>Status</th>
              <th>Contact & State</th>
              <th>Writing Agent</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: '#cbd5e1' }}>
                  <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.75rem', display: 'block', color: 'var(--accent)' }} />
                  Loading carrier policies...
                </td>
              </tr>
            ) : policies.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '3.5rem', color: '#cbd5e1' }}>
                  <Building2 size={32} style={{ margin: '0 auto 0.75rem', display: 'block', color: 'var(--accent)', opacity: 0.6 }} />
                  <div style={{ fontWeight: 600, fontSize: '1rem', color: '#f8fafc' }}>
                    No policies found in {selectedCarrier === 'All' ? 'your book of business' : selectedCarrier}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem', maxWidth: '420px', margin: '0.25rem auto 1rem' }}>
                    Upload your active carrier book of business spreadsheet (.xlsx or .csv) to view and separate policyholders by carrier.
                  </div>
                  <label htmlFor="bob-file-upload" className="btn btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700 }}>
                    <Upload size={16} /> Upload Book of Business
                  </label>
                </td>
              </tr>
            ) : (
              policies.map((p) => {
                const badgeColor = getCarrierBadgeColor(p.carrier);
                return (
                  <tr key={p.id}>
                    {/* Client Name */}
                    <td>
                      {p.client_id ? (
                        <Link 
                          to={`/clients/${p.client_id}`} 
                          style={{ color: '#ffffff', fontWeight: 700, textDecoration: 'none' }}
                          className="hover:underline"
                        >
                          {p.client_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Enrolled Client'}
                        </Link>
                      ) : (
                        <div style={{ color: '#ffffff', fontWeight: 700 }}>
                          {p.client_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Enrolled Client'}
                        </div>
                      )}
                      {p.client_dob && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          DOB: {p.client_dob} {p.mbi_last4 ? `• MBI: ...${p.mbi_last4}` : ''}
                        </div>
                      )}
                    </td>

                    {/* Carrier Badge */}
                    <td>
                      <span 
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          borderLeft: `4px solid ${badgeColor}`,
                          color: '#f8fafc',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {p.carrier}
                      </span>
                    </td>

                    {/* Plan Details */}
                    <td>
                      <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: '0.85rem' }}>{p.plan_name}</div>
                      <span className="badge badge-info" style={{ fontSize: '0.72rem', marginTop: '0.15rem' }}>
                        {p.plan_type}
                      </span>
                    </td>

                    {/* Policy # */}
                    <td>
                      <code style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
                        {p.policy_number || 'Pending Assignment'}
                      </code>
                    </td>

                    {/* Effective Date */}
                    <td>
                      <div style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
                        {p.effective_date || 'N/A'}
                      </div>
                      {p.term_date && (
                        <div style={{ fontSize: '0.72rem', color: '#ef4444' }}>
                          Term: {p.term_date}
                        </div>
                      )}
                    </td>

                    {/* Monthly Premium */}
                    <td>
                      <div style={{ fontWeight: 700, color: p.premium > 0 ? '#10b981' : '#94a3b8', fontSize: '0.85rem' }}>
                        ${p.premium || 0}<span style={{ fontSize: '0.72rem', fontWeight: 400 }}>/mo</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td>
                      <span className={`badge ${
                        p.status === 'Active' ? 'badge-success' : 
                        p.status === 'Pending' ? 'badge-warning' : 'badge-danger'
                      }`}>
                        {p.status}
                      </span>
                    </td>

                    {/* Contact & State */}
                    <td>
                      <div style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>{formatPhone(p.client_phone)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {p.client_city ? `${p.client_city}, ` : ''}{p.client_state || 'AZ'}
                      </div>
                    </td>

                    {/* Writing Agent */}
                    <td>
                      <div style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
                        {p.agent_name || 'House / Direct'}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* DEDICATED BOOK OF BUSINESS UPLOAD & CARRIER SEPARATION MODAL */}
      {showUploadModal && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1.25rem',
          }}
        >
          <div 
            style={{
              backgroundColor: '#111c3a',
              border: '1px solid #243566',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '720px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.75rem',
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)',
              color: '#f8fafc',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #243566', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'rgba(200, 150, 62, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
                    Upload Book of Business
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    File: <strong style={{ color: '#f8fafc' }}>{uploadFileName}</strong> ({parsedRows.length} policyholder records detected)
                  </div>
                </div>
              </div>
              <button 
                className="btn btn-secondary" 
                onClick={() => { setShowUploadModal(false); setUploadResult(null); }}
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
              >
                ✕
              </button>
            </div>

            {uploadResult ? (
              /* Success State */
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981', margin: '0 auto 1rem' }}>
                  <CheckCircle2 size={32} />
                </div>
                <h4 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.5rem' }}>
                  Book of Business Successfully Imported!
                </h4>
                <p style={{ fontSize: '0.9rem', color: '#cbd5e1', marginBottom: '1.25rem' }}>
                  Successfully ingested <strong style={{ color: 'var(--accent)' }}>{uploadResult.total} policies</strong> and created/updated corresponding policyholder client records.
                </p>

                {/* Carriers Breakdown Pill Box */}
                <div style={{ background: '#16245c', borderRadius: '12px', padding: '1rem', marginBottom: '1.5rem', textAlign: 'left' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                    Policies Separated by Carrier:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {Object.entries(uploadResult.carriers as Record<string, number>).map(([c, count]) => (
                      <span 
                        key={c}
                        style={{
                          backgroundColor: 'rgba(255,255,255,0.08)',
                          borderLeft: `4px solid ${getCarrierBadgeColor(c)}`,
                          padding: '0.35rem 0.75rem',
                          borderRadius: '6px',
                          fontSize: '0.85rem',
                          fontWeight: 600,
                          color: '#ffffff'
                        }}
                      >
                        {c}: <strong style={{ color: 'var(--accent)' }}>{count}</strong>
                      </span>
                    ))}
                  </div>
                </div>

                <button 
                  className="btn btn-primary" 
                  onClick={() => setShowUploadModal(false)}
                  style={{ fontWeight: 700, padding: '0.65rem 2rem' }}
                >
                  View Updated Book of Business →
                </button>
              </div>
            ) : (
              /* Configuration & Preview Form */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Carrier Separation Mode */}
                <div style={{ background: '#16245c', borderRadius: '12px', padding: '1rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', display: 'block', marginBottom: '0.5rem' }}>
                    1. Carrier Separation Mode:
                  </label>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', cursor: 'pointer' }}>
                      <input 
                        type="radio" 
                        name="carrierMode" 
                        checked={carrierMode === 'auto'} 
                        onChange={() => setCarrierMode('auto')} 
                        style={{ marginTop: '0.2rem' }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f8fafc' }}>
                          ⚡ Auto-Detect Carriers from Spreadsheet (Recommended for Agency & FMO Reports)
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Reads the Carrier / Company column for each row. Normalizes UnitedHealthcare, Humana, Aetna, Cigna, Wellcare, Anthem, etc. automatically.
                          {Object.keys(detectedCarriers).length > 0 && (
                            <span style={{ color: 'var(--accent)', display: 'block', marginTop: '0.2rem' }}>
                              Found {Object.keys(detectedCarriers).length} carriers in this file: {Object.keys(detectedCarriers).slice(0, 4).join(', ')}{Object.keys(detectedCarriers).length > 4 ? '...' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>

                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.65rem', cursor: 'pointer' }}>
                      <input 
                        type="radio" 
                        name="carrierMode" 
                        checked={carrierMode === 'manual'} 
                        onChange={() => setCarrierMode('manual')} 
                        style={{ marginTop: '0.2rem' }}
                      />
                      <div style={{ width: '100%' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f8fafc' }}>
                          Assign All Rows to a Specific Carrier (Best for Direct Carrier Portal Exports)
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                          Use when downloading straight from UHC Jarvis, Humana Vantage, Aetna Producer World, etc.
                        </div>

                        {carrierMode === 'manual' && (
                          <select 
                            className="form-control" 
                            value={manualCarrier} 
                            onChange={(e) => setManualCarrier(e.target.value)}
                            style={{ width: '100%', fontSize: '0.85rem' }}
                          >
                            <option value="UnitedHealthcare">UnitedHealthcare (UHC / AARP)</option>
                            <option value="Humana">Humana</option>
                            <option value="Aetna Medicare">Aetna Medicare / CVS Health</option>
                            <option value="Wellcare">Wellcare (Centene)</option>
                            <option value="Cigna Healthcare">Cigna Healthcare</option>
                            <option value="Blue Cross Blue Shield / Anthem">Blue Cross Blue Shield / Anthem</option>
                            <option value="Mutual of Omaha">Mutual of Omaha</option>
                            <option value="Devoted Health">Devoted Health</option>
                            <option value="Kaiser Permanente">Kaiser Permanente</option>
                            <option value="Molina Healthcare">Molina Healthcare</option>
                            <option value="SilverScript">SilverScript</option>
                            <option value="Other Carrier">Other Carrier</option>
                          </select>
                        )}
                      </div>
                    </label>
                  </div>
                </div>

                {/* Writing Agent Assignment */}
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', display: 'block', marginBottom: '0.35rem' }}>
                    2. Writing Agent of Record (Optional):
                  </label>
                  <select 
                    className="form-control" 
                    value={targetAgentId} 
                    onChange={(e) => setTargetAgentId(e.target.value)}
                    style={{ width: '100%', fontSize: '0.85rem' }}
                  >
                    <option value="">House Account / Use Current User ({user?.name})</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.title || a.role})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Preview Table (First 5 Rows) */}
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
                    Previewing First 5 Records:
                  </div>
                  <div style={{ overflowX: 'auto', border: '1px solid #243566', borderRadius: '8px' }}>
                    <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead style={{ background: '#16245c', color: 'var(--text-muted)' }}>
                        <tr>
                          <th style={{ padding: '0.5rem' }}>Client Name</th>
                          <th style={{ padding: '0.5rem' }}>Carrier</th>
                          <th style={{ padding: '0.5rem' }}>Plan / Product</th>
                          <th style={{ padding: '0.5rem' }}>Policy #</th>
                          <th style={{ padding: '0.5rem' }}>Effective</th>
                          <th style={{ padding: '0.5rem' }}>Premium</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.slice(0, 5).map((row, idx) => {
                          const cName = carrierMode === 'manual' 
                            ? manualCarrier 
                            : (row.carrier || row.Carrier || row.company || row.Company || row['Carrier Name'] || 'Auto-Detect');
                          const clientName = row.name || row.Name || row['Client Name'] || row['Insured Name'] || `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Client';
                          const planName = row.plan_name || row.plan || row['Plan Name'] || row.product || 'Standard Plan';
                          const polNum = row.policy_number || row.policy_no || row['Policy Number'] || row.member_id || 'N/A';
                          const effDate = row.effective_date || row.eff_date || row['Effective Date'] || 'N/A';
                          const prem = row.premium || row['Monthly Premium'] || row.rate || '$0';

                          return (
                            <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                              <td style={{ padding: '0.5rem', fontWeight: 600 }}>{clientName}</td>
                              <td style={{ padding: '0.5rem', color: 'var(--accent)' }}>{cName}</td>
                              <td style={{ padding: '0.5rem' }}>{planName}</td>
                              <td style={{ padding: '0.5rem' }}><code>{polNum}</code></td>
                              <td style={{ padding: '0.5rem' }}>{effDate}</td>
                              <td style={{ padding: '0.5rem' }}>{prem}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Upload Progress Bar */}
                {isUploading && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.3rem' }}>
                      <span style={{ color: 'var(--accent)' }}>Ingesting Book of Business & Separating Carriers...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div style={{ width: '100%', height: '8px', background: '#16245c', borderRadius: '4px', overflow: 'hidden' }}>
                      <div 
                        style={{ 
                          width: `${uploadProgress}%`, 
                          height: '100%', 
                          background: 'linear-gradient(90deg, var(--accent), #10b981)',
                          transition: 'width 0.2s ease' 
                        }} 
                      />
                    </div>
                  </div>
                )}

                {/* Modal Footer Actions */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => setShowUploadModal(false)}
                    disabled={isUploading}
                    style={{ fontSize: '0.85rem' }}
                  >
                    Cancel
                  </button>

                  <button 
                    className="btn btn-primary" 
                    onClick={handleConfirmImport}
                    disabled={isUploading}
                    style={{ 
                      fontSize: '0.85rem', 
                      fontWeight: 700, 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '0.4rem',
                      backgroundColor: 'var(--accent)',
                      color: '#000'
                    }}
                  >
                    {isUploading ? (
                      <>
                        <RefreshCw size={15} className="animate-spin" /> Ingesting {parsedRows.length} Policies...
                      </>
                    ) : (
                      <>
                        <ShieldCheck size={16} /> Confirm & Ingest Book of Business
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
