import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const STAGES = [
  'New Lead',
  'Contacted',
  'SOA Signed',
  'Needs Analysis',
  'Plan Presented',
  'Application Submitted',
  'Enrolled',
  'Lost',
];

export const PipelinePage: React.FC = () => {
  const { isScheduler } = useAuth();
  const [opps, setOpps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOpps = async () => {
    setLoading(true);
    try {
      const res = await api.get('/records/opportunities?limit=200');
      setOpps(res.rows || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOpps();
  }, []);

  const handleStageChange = async (oppId: string, newStage: string) => {
    try {
      await api.patch(`/records/opportunities/${oppId}`, { stage: newStage });
      loadOpps();
    } catch (err: any) {
      alert(`Error updating stage: ${err.message}`);
    }
  };

  if (isScheduler) {
    return (
      <div style={{ padding: '2rem', color: 'var(--warning)', background: 'var(--warning-bg)', borderRadius: '12px' }}>
        ⚠️ Pipeline management is restricted to Licensed Agents and Managers.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Visual Sales Pipeline</h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Drag and drop or click stage actions to advance Medicare deals
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem' }}>Loading pipeline...</div>
      ) : (
        <div className="kanban-board">
          {STAGES.map((stage) => {
            const stageOpps = opps.filter((o) => o.stage === stage);
            const totalValue = stageOpps.reduce((sum, o) => sum + Number(o.expected_commission || 0), 0);

            return (
              <div key={stage} className="kanban-column">
                <div className="kanban-column-header">
                  <div>
                    <div style={{ fontSize: '0.9rem' }}>{stage}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>
                      ${Math.round(totalValue).toLocaleString()}
                    </div>
                  </div>
                  <span className="badge badge-gold" style={{ fontSize: '0.75rem' }}>
                    {stageOpps.length}
                  </span>
                </div>

                <div className="kanban-cards">
                  {stageOpps.map((opp) => (
                    <div key={opp.id} className="kanban-card">
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.3rem', color: 'var(--text-main)' }}>
                        {opp.name}
                      </div>

                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span>Carrier: <strong>{opp.carrier || 'TBD'}</strong></span>
                        <span>Type: <strong>{opp.plan_type || 'MAPD'}</strong></span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)' }}>
                          ${opp.expected_commission || 611}
                        </span>

                        {/* Quick Move Selector */}
                        <select
                          value={opp.stage}
                          onChange={(e) => handleStageChange(opp.id, e.target.value)}
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.2rem 0.4rem',
                            borderRadius: '4px',
                            backgroundColor: 'var(--bg-input)',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-main)',
                          }}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
