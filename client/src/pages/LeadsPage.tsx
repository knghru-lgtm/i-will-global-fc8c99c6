import React, { useState, useEffect, useRef } from 'react';
import { api, formatPhone, googleVoiceWebUrl, openGoogleVoiceWindow } from '../lib/api';
import { Link } from 'react-router-dom';
import { CallPanel } from '../components/CallPanel';
import { BookAppointmentModal } from '../components/BookAppointmentModal';
import { WarmTransferModal } from '../components/WarmTransferModal';
import * as XLSX from 'xlsx';
import { 
  Upload, 
  Zap, 
  FileSpreadsheet, 
  RefreshCw,
  UserCheck,
  Trash2,
  ShieldCheck,
  Calendar
} from 'lucide-react';
import { useAuth } from '../lib/auth';

interface Caller {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string;
  assigned_leads_count: number;
}

export const LeadsPage: React.FC = () => {
  const { user, activeRole } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.email?.toLowerCase() === 'king@iwillglobal.com' || user?.email?.toLowerCase() === 'aneesha@iwillglobal.com' || activeRole === 'admin';
  const [leads, setLeads] = useState<any[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [callerFilter, setCallerFilter] = useState<string>('');
  const [t65Filter, setT65Filter] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Callers & Pool Stats
  const [callers, setCallers] = useState<Caller[]>([]);
  const [unassignedCount, setUnassignedCount] = useState<number>(0);

  // Call panel modal state
  const [activeCallLead, setActiveCallLead] = useState<any>(null);

  // Schedule appointment modal state
  const [activeScheduleLead, setActiveScheduleLead] = useState<any>(null);
  const [activeWarmTransferLead, setActiveWarmTransferLead] = useState<any>(null);

  // Create lead modal state
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false);
  const [newLead, setNewLead] = useState<any>({
    first_name: '', last_name: '', phone: '', address: '', email: '', dob: '', city: '', state: 'AZ', zip: '', county: 'Maricopa', source: 'Call-In Lead', tcpa_consent: true
  });

  // Bulk Assign Modal state (500 at a time)
  const [isBatchAssignOpen, setIsBatchAssignOpen] = useState<boolean>(false);
  const [selectedCallerId, setSelectedCallerId] = useState<string>('');
  const [batchAssignCount, setBatchAssignCount] = useState<number>(500);
  const [batchStateFilter, setBatchStateFilter] = useState<string>('All');
  const [isAssigning, setIsAssigning] = useState<boolean>(false);
  const [assignSuccessMsg, setAssignSuccessMsg] = useState<string>('');

  // Excel / CSV Import Modal state & Duplicate Guard
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [importFileName, setImportFileName] = useState<string>('');
  const [parsedLeads, setParsedLeads] = useState<any[]>([]);
  const [importAssignCallerId, setImportAssignCallerId] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [importResultMsg, setImportResultMsg] = useState<string>('');
  const [inFileDuplicatesCount, setInFileDuplicatesCount] = useState<number>(0);
  const [duplicatesSkippedCount, setDuplicatesSkippedCount] = useState<number>(0);
  const [scrubbedNoPhoneCount, setScrubbedNoPhoneCount] = useState<number>(0);
  const [scrubbedNoNameOrAddressCount, setScrubbedNoNameOrAddressCount] = useState<number>(0);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState<boolean>(false);
  const [isScrubbingNoPhones, setIsScrubbingNoPhones] = useState<boolean>(false);
  const [isCleaningIncomplete, setIsCleaningIncomplete] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Row selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Sarah Voice Engine Live Outbound Start / Stop State
  const [isSarahActive, setIsSarahActive] = useState<boolean>(false);
  const [sarahBusy, setSarahBusy] = useState<boolean>(false);
  const [sarahBannerMsg, setSarahBannerMsg] = useState<string>('');
  const [sarahWindow, setSarahWindow] = useState<{ open: boolean; today?: string; schedule?: string; next_open?: string } | null>(null);
  const [sarahAssigned, setSarahAssigned] = useState<{ assigned_total: number; remaining_today: number }>({ assigned_total: 0, remaining_today: 0 });

  const loadSarahStatus = async () => {
    try {
      const cfg = await api.get('/sarah/config');
      if (cfg) {
        setIsSarahActive(Boolean(cfg.is_campaign_active));
        if (cfg.calling_window) setSarahWindow(cfg.calling_window);
        if (cfg.sarah_assigned) setSarahAssigned(cfg.sarah_assigned);
      }
    } catch {
      // ignore
    }
  };

  const handleAssignToSarah = async (targetLeadIds: string[]) => {
    if (!targetLeadIds.length) return;
    setSarahBusy(true);
    try {
      const res = await api.post('/sarah/assign', { lead_ids: targetLeadIds });
      setSarahBannerMsg(res.message || `📞 ${targetLeadIds.length} prospect(s) assigned to Sarah Outbound Caller.`);
      setSelectedIds([]);
      window.dispatchEvent(new CustomEvent('iwg-sarah-status-changed'));
      loadLeads();
      loadPoolStats();
      loadSarahStatus();
    } catch (err: any) {
      alert(err.message || 'Failed to assign prospects to Sarah Outbound Caller');
    } finally {
      setSarahBusy(false);
    }
  };

  const handleStartSarahOutboundCalls = async (targetLeadIds?: string[]) => {
    setSarahBusy(true);
    setSarahBannerMsg('');
    try {
      const idsToCall = targetLeadIds && targetLeadIds.length > 0
        ? targetLeadIds
        : (selectedIds.length > 0 ? selectedIds : undefined);
      const res = await api.post('/sarah/activate', {
        lead_ids: idsToCall,
        continue_queue: true,
      });
      setIsSarahActive(true);
      setSarahBannerMsg(res.message || '📞 Sarah Outbound Caller + Google Voice (480) 331-9455 activated! Outbound calls have started.');
      const firstDispatched = res.dispatched?.[0];
      const firstLead = idsToCall?.length ? leads.find((l) => l.id === idsToCall[0]) : leads[0];
      const dialPhone = firstDispatched?.phone || firstLead?.phone || '';
      const dialName = firstDispatched?.prospect_name || (firstLead ? `${firstLead.first_name || ''} ${firstLead.last_name || ''}`.trim() : 'Medicare Beneficiary');
      if (dialPhone) openGoogleVoiceWindow(dialPhone);
      window.dispatchEvent(
        new CustomEvent('iwg-open-sarah-voice', {
          detail: {
            mode: 'outbound',
            lead_id: firstDispatched?.lead_id || firstLead?.id,
            prospect_name: dialName || 'Medicare Beneficiary',
            phone: dialPhone,
            state: firstLead?.state || 'AZ',
          },
        })
      );
      if (res.calling_window) setSarahWindow(res.calling_window);
      if (idsToCall) setSelectedIds([]);
      window.dispatchEvent(new CustomEvent('iwg-sarah-status-changed'));
      loadLeads();
      loadPoolStats();
      loadSarahStatus();
    } catch (err: any) {
      alert(err.message || 'Failed to start Sarah Outbound Caller calls');
    } finally {
      setSarahBusy(false);
    }
  };

  const handleStopSarahOutboundCalls = async () => {
    setSarahBusy(true);
    try {
      const res = await api.post('/sarah/stop', { stop_all: true });
      setIsSarahActive(false);
      setSarahBannerMsg(res.message || '🛑 Sarah Outbound Caller calls and queue dialing have been stopped.');
      window.dispatchEvent(new CustomEvent('iwg-sarah-status-changed'));
      loadLeads();
    } catch (err: any) {
      alert(err.message || 'Failed to stop Sarah Outbound Caller calls');
    } finally {
      setSarahBusy(false);
    }
  };

  // Load pool stats and outbound callers
  const loadPoolStats = async () => {
    try {
      const res = await api.get('/records/leads/pool-stats');
      setUnassignedCount(res.unassigned_count || 0);
      setCallers(res.callers || []);
      if (!selectedCallerId && res.callers?.length > 0) {
        setSelectedCallerId(res.callers[0].id);
      }
    } catch (err) {
      console.error('Failed to load pool stats:', err);
    }
  };

  const loadLeads = async () => {
    setLoading(true);
    try {
      let url = `/records/leads?sort=score:desc&limit=100`;
      if (statusFilter) url += `&f_status=${encodeURIComponent(statusFilter)}`;
      if (sourceFilter) url += `&f_source=${encodeURIComponent(sourceFilter)}`;
      if (t65Filter) url += `&f_dob__gte=1961-01-01`;
      if (searchQuery) url += `&q=${encodeURIComponent(searchQuery)}`;
      if (callerFilter === 'unassigned') {
        url += `&f_owner_id__null=true`;
      } else if (callerFilter) {
        url += `&f_owner_id=${encodeURIComponent(callerFilter)}`;
      }
      const res = await api.get(url);
      setLeads(res.rows || []);
      setTotal(res.total || 0);
      setSelectedIds([]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLeads();
    loadPoolStats();
    loadSarahStatus();

    const handleLeadUpdated = () => {
      loadLeads();
      loadPoolStats();
      loadSarahStatus();
    };
    window.addEventListener('iwg-lead-updated', handleLeadUpdated);
    window.addEventListener('iwg-sarah-status-changed', loadSarahStatus);
    return () => {
      window.removeEventListener('iwg-lead-updated', handleLeadUpdated);
      window.removeEventListener('iwg-sarah-status-changed', loadSarahStatus);
    };
  }, [statusFilter, sourceFilter, callerFilter, t65Filter, searchQuery]);

  // Clean and parse Excel / CSV file in browser
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    setImportResultMsg('');
    setIsImporting(false);
    setImportProgress({ current: 0, total: 0 });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const rawRows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[sheetName]);

      if (!rawRows || rawRows.length === 0) {
        alert('No data rows found in this file. Please verify file format.');
        return;
      }

      // Helper to detect phone number across any standard or custom header variation
      const extractPhoneFromRow = (r: any): string => {
        if (!r || typeof r !== 'object') return '';
        const direct = 
          r['Primary Phone'] || r.primary_phone || r.PrimaryPhone ||
          r.phone || r.Phone || r['Phone Number'] || r['Phone'] ||
          r['Cell Phone'] || r.cell || r.mobile || r['Mobile Phone'] ||
          r.telephone || r.Telephone || r.Tel || r.tel ||
          r['Phone 1'] || r['Contact Phone'] || r['Home Phone'];
        if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
          return String(direct).trim();
        }
        for (const k of Object.keys(r)) {
          if (/phone|mobile|cell|tel/i.test(k)) {
            const val = r[k];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
              const digits = String(val).replace(/\D/g, '');
              if (digits.length >= 7) return String(val).trim();
            }
          }
        }
        return '';
      };

      // Normalize columns, scrub records without names/addresses or valid phone numbers, and guard against duplicates
      const cleaned: any[] = [];
      const seenPhones = new Set<string>();
      const seenEmails = new Set<string>();
      let fileDupes = 0;
      let noPhoneCount = 0;
      let noNameOrAddressCount = 0;

      for (const row of rawRows) {
        let firstName = String(
          row.first_name || 
          row.firstName || 
          row.FirstName || 
          row['First Name'] || 
          row['patient firstname'] || 
          row['Patient Firstname'] || 
          row['patient first name'] || 
          row['Patient First Name'] || 
          row.first || 
          ''
        ).trim();

        let lastName = String(
          row.last_name || 
          row.lastName || 
          row.LastName || 
          row['Last Name'] || 
          row['patient lastname'] || 
          row['Patient Lastname'] || 
          row['patient last name'] || 
          row['Patient Last Name'] || 
          row.last || 
          ''
        ).trim();

        const fullName = String(
          row.name || 
          row.Name || 
          row['Full Name'] || 
          row['FullName'] || 
          row['Contact Name'] || 
          row['patient name'] || 
          row['Patient Name'] || 
          ''
        ).trim();

        if ((!firstName || ['imported', 'prospect'].includes(firstName.toLowerCase())) && fullName) {
          const parts = fullName.split(' ');
          firstName = parts[0] || '';
          lastName = parts.slice(1).join(' ') || '';
        }

        const rawAddress = String(
          row.address || 
          row.Address || 
          row['Street Address'] || 
          row['street address'] || 
          row.street || 
          row.Street || 
          row['patient address1'] || 
          row['Patient Address1'] || 
          row['patient address'] || 
          row['Patient Address'] || 
          row['address1'] || 
          row['Address1'] || 
          row['Address 1'] || 
          row.addr || 
          row.Addr || 
          ''
        ).trim();
        const address = rawAddress.length > 0 && rawAddress.toLowerCase() !== 'n/a' ? rawAddress : '';

        // Strict Name & Address Scrub: Lead MUST show valid first & last name and a street address!
        const isPlaceholderFirst = !firstName || ['prospect', 'imported', 'unknown', 'n/a'].includes(firstName.toLowerCase());
        const isPlaceholderLast = !lastName || ['lead', 'prospect', 'imported', 'unknown', 'n/a'].includes(lastName.toLowerCase());
        const hasValidName = !isPlaceholderFirst && !isPlaceholderLast;
        const hasValidAddress = Boolean(address && address.length > 0);

        if (!hasValidName || !hasValidAddress) {
          noNameOrAddressCount++;
          continue;
        }

        const rawPhone = extractPhoneFromRow(row);
        const digits = rawPhone.replace(/\D/g, '');

        // Strict Phone Scrub: Every prospect MUST have a valid 10-digit phone number
        if (!digits || digits.length < 10) {
          noPhoneCount++;
          continue;
        }

        const normPhone = digits.slice(-10);
        const formattedPhone = digits.length === 11 && digits.startsWith('1')
          ? `+1${digits.slice(1)}`
          : (digits.length === 10 ? `+1${digits}` : rawPhone);

        const email = row.email || row.Email || row['Email Address'] || null;
        const normEmail = email ? String(email).trim().toLowerCase() : '';

        // Guard against duplicate records within the uploaded spreadsheet
        let isDupe = false;
        if (normPhone && seenPhones.has(normPhone)) {
          isDupe = true;
        }
        if (normEmail && seenEmails.has(normEmail)) {
          isDupe = true;
        }

        if (isDupe) {
          fileDupes++;
          continue;
        }

        if (normPhone) seenPhones.add(normPhone);
        if (normEmail) seenEmails.add(normEmail);

        // Sanitize and format date of birth (handles Excel serial numbers, Date objects, or string formats)
        const rawDob = row.dob || row.DOB || row['Date of Birth'] || row['Birth Date'] || row.patientdob || row.patient_dob || '';
        let cleanDobStr = '';
        if (rawDob) {
          if (typeof rawDob === 'number' && rawDob > 1000 && rawDob < 100000) {
            const excelEpoch = new Date(1899, 11, 30);
            const d = new Date(excelEpoch.getTime() + rawDob * 86400000);
            if (!isNaN(d.getTime())) {
              const pad = (n: number) => String(n).padStart(2, '0');
              cleanDobStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            }
          } else {
            const str = String(rawDob).trim();
            const mdy = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
            if (mdy) {
              const pad = (n: number) => String(n).padStart(2, '0');
              cleanDobStr = `${mdy[3]}-${pad(Number(mdy[1]))}-${pad(Number(mdy[2]))}`;
            } else {
              cleanDobStr = str;
            }
          }
        }

        cleaned.push({
          first_name: firstName,
          last_name: lastName,
          phone: formattedPhone,
          email,
          city: row.city || row.City || row['patient city'] || row['Patient City'] || '',
          state: row.state || row.State || row.ST || 'AZ',
          zip: row.zip || row.Zip || row['Zip Code'] || row['ZIP'] || row['patient zip'] || row['Patient Zip'] || '',
          county: row.county || row.County || '',
          address,
          dob: cleanDobStr || null,
          source: row.source || row.Source || 'Excel/CSV Import',
          status: 'New'
        });
      }

      if (cleaned.length === 0) {
        let msg = 'Could not find valid prospects in this spreadsheet.';
        if (noNameOrAddressCount > 0 && noPhoneCount > 0) {
          msg = `All rows were filtered out: ${noNameOrAddressCount.toLocaleString()} rows did not show names and addresses, and ${noPhoneCount.toLocaleString()} lacked valid phone numbers. Every prospect must show name, address, and phone.`;
        } else if (noNameOrAddressCount > 0) {
          msg = `All ${noNameOrAddressCount.toLocaleString()} rows in this spreadsheet lacked names or addresses. Every prospect must show a name and street address.`;
        } else if (noPhoneCount > 0) {
          msg = `All ${noPhoneCount.toLocaleString()} rows lacked valid 10-digit phone numbers.`;
        }
        alert(msg);
        return;
      }

      setScrubbedNoNameOrAddressCount(noNameOrAddressCount);
      setScrubbedNoPhoneCount(noPhoneCount);
      setInFileDuplicatesCount(fileDupes);
      setDuplicatesSkippedCount(0);
      setParsedLeads(cleaned);
      setImportAssignCallerId(isAdmin ? '' : (user?.id || ''));
      setIsImportModalOpen(true);
    } catch (err: any) {
      console.error('File parsing error:', err);
      alert(`Failed to parse file: ${err.message || 'Invalid format'}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Perform chunked batch import (up to 500 per HTTP call) with duplicate guard
  const executeBatchImport = async () => {
    if (!parsedLeads.length) return;
    setIsImporting(true);
    setImportProgress({ current: 0, total: parsedLeads.length });

    const CHUNK_SIZE = 500;
    let importedCount = 0;
    let dbDuplicatesSkipped = 0;

    try {
      for (let i = 0; i < parsedLeads.length; i += CHUNK_SIZE) {
        const chunk = parsedLeads.slice(i, i + CHUNK_SIZE);
        const res = await api.post('/records/batch-import/leads', {
          leads: chunk,
          caller_id: importAssignCallerId || null,
          guard_duplicates: true
        });

        if (res.imported !== undefined) {
          importedCount += res.imported;
          dbDuplicatesSkipped += (res.duplicates_skipped || 0);
        } else {
          importedCount += chunk.length;
        }

        setImportProgress({ current: Math.min(importedCount + dbDuplicatesSkipped, parsedLeads.length), total: parsedLeads.length });
      }

      setDuplicatesSkippedCount(dbDuplicatesSkipped);
      let successMsg = `🎉 Successfully imported ${importedCount.toLocaleString()} new prospects!`;
      const totalDupesGuarded = dbDuplicatesSkipped + inFileDuplicatesCount;
      if (totalDupesGuarded > 0) {
        successMsg += ` (🛡️ ${totalDupesGuarded.toLocaleString()} duplicates guarded & skipped)`;
      }
      if (scrubbedNoNameOrAddressCount > 0) {
        successMsg += ` (⚠️ ${scrubbedNoNameOrAddressCount.toLocaleString()} rows missing names or addresses were removed)`;
      }

      setImportResultMsg(successMsg);
      loadLeads();
      loadPoolStats();
      setTimeout(() => {
        setIsImportModalOpen(false);
      }, 2500);
    } catch (err: any) {
      console.error('Import execution error:', err);
      alert(`Import error: ${err.message || 'Failed to complete batch upload'}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Permanently purge any leads in database missing names or addresses
  const handlePurgeIncompleteLeads = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to permanently remove any uploaded leads that do not show names and addresses?'
    );
    if (!confirmed) return;
    setIsCleaningIncomplete(true);
    try {
      const res = await api.delete('/records/leads/cleanup-incomplete');
      alert(`Cleaned up ${res.deletedCount || 0} leads that did not show names and addresses.`);
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      alert(`Cleanup failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsCleaningIncomplete(false);
    }
  };

  // Bulk assign prospects 500 at a time
  const handleBulkAssign = async () => {
    if (!selectedCallerId) {
      alert('Please select an outbound caller to receive these prospects.');
      return;
    }

    setIsAssigning(true);
    setAssignSuccessMsg('');

    try {
      const res = await api.post('/records/leads/assign-bulk', {
        caller_id: selectedCallerId,
        count: batchAssignCount,
        state_filter: batchStateFilter === 'All' ? undefined : batchStateFilter,
        status_filter: 'New',
        unassigned_only: true
      });

      if (res.success) {
        setAssignSuccessMsg(`✅ Successfully assigned ${res.assigned.toLocaleString()} prospects to ${res.caller_name}! (${res.remaining_unassigned.toLocaleString()} remaining in pool)`);
        loadLeads();
        loadPoolStats();
        setTimeout(() => {
          setIsBatchAssignOpen(false);
          setAssignSuccessMsg('');
        }, 2200);
      }
    } catch (err: any) {
      console.error('Bulk assign error:', err);
      alert(`Assignment failed: ${err.message}`);
    } finally {
      setIsAssigning(false);
    }
  };

  // Assign manually selected rows
  const handleAssignSelected = async (targetCallerId: string) => {
    if (!selectedIds.length || !targetCallerId) return;
    try {
      const res = await api.post('/records/leads/assign-selected', {
        lead_ids: selectedIds,
        caller_id: targetCallerId
      });
      alert(`Assigned ${res.assigned} selected prospects to ${res.caller_name}!`);
      setSelectedIds([]);
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      alert(`Assignment failed: ${err.message}`);
    }
  };

  // Admin: unassign multiple selected prospects
  const handleUnassignSelected = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Are you sure you want to unassign ${selectedIds.length} selected prospect(s) and return them to the Master List Bank unassigned pool?`)) {
      return;
    }
    try {
      const res = await api.post('/records/leads/unassign-bulk', {
        lead_ids: selectedIds
      });
      alert(`⚡ ${res.message || `Successfully unassigned ${res.unassigned} prospects!`}`);
      setSelectedIds([]);
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      alert(`Unassignment failed: ${err.message}`);
    }
  };

  // Admin: unassign a single prospect
  const handleUnassignLead = async (leadId: string, leadName: string) => {
    if (!window.confirm(`Are you sure you want to unassign ${leadName} and return this prospect to the Master List Bank?`)) {
      return;
    }
    try {
      const res = await api.post(`/records/leads/${leadId}/unassign`);
      alert(`⚡ ${res.message || 'Prospect unassigned and returned to Master List Bank.'}`);
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      alert(`Unassign failed: ${err.message}`);
    }
  };

  // Admin: permanently delete multiple selected leads
  const handleDeleteSelected = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`⚠️ Are you sure you want to permanently delete ${selectedIds.length} selected lead(s)? This action cannot be undone.`)) {
      return;
    }
    try {
      const res = await api.post('/records/leads/delete-bulk', {
        lead_ids: selectedIds
      });
      alert(`🗑️ ${res.message || `Successfully deleted ${res.deleted} lead(s).`}`);
      setSelectedIds([]);
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // Admin: permanently delete a single lead
  const handleDeleteLead = async (leadId: string, leadName: string) => {
    if (!window.confirm(`⚠️ Are you sure you want to permanently delete lead ${leadName}? This action cannot be undone.`)) {
      return;
    }
    try {
      await api.delete(`/records/leads/${leadId}`);
      alert(`🗑️ Lead ${leadName} has been permanently deleted.`);
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  // Admin: run database duplicate cleanup
  const handleCleanupDuplicates = async () => {
    if (!isAdmin) return;
    if (!window.confirm('🛡️ Scan and clean duplicate prospects in database?\n\nThis will scan all leads by phone number and email, keep the primary record (preserving active calls, tasks, highest score, or earliest created), and safely remove redundant duplicate entries.\n\nProceed?')) {
      return;
    }

    setIsCleaningDuplicates(true);
    try {
      const res = await api.post('/records/leads/cleanup-duplicates');
      if (!res.removed_duplicates || res.removed_duplicates === 0) {
        alert('🛡️ Database is clean! No duplicate prospects found.');
      } else {
        alert(`🛡️ Duplicate Cleanup Complete!\n\n• Duplicate groups identified: ${res.duplicate_groups_found}\n• Redundant duplicate leads removed: ${res.removed_duplicates}\n• Primary leads kept safe: ${res.duplicate_groups_found}`);
        loadLeads();
        loadPoolStats();
      }
    } catch (err: any) {
      alert(`Cleanup failed: ${err.message || 'Error executing duplicate cleanup'}`);
    } finally {
      setIsCleaningDuplicates(false);
    }
  };

  // Admin: scan and scrub prospects without phone numbers
  const handleScrubNoPhones = async () => {
    if (!isAdmin) return;
    if (!window.confirm('🧹 Scrub prospects without phone numbers?\n\nThis will scan the CRM database and permanently remove any prospect that does not have a valid 10-digit phone number.\n\nProceed?')) {
      return;
    }

    setIsScrubbingNoPhones(true);
    try {
      const res = await api.post('/records/leads/scrub-no-phones');
      alert(`🧹 ${res.message || `Scrubbed ${res.deleted_count || 0} prospects without phone numbers.`}`);
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      console.error('Scrub no phones error:', err);
      alert(`Scrub operation failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsScrubbingNoPhones(false);
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = (newLead.phone || '').replace(/\D/g, '');
    if (digits.length < 10) {
      alert('A valid 10-digit phone number is required for all prospects.');
      return;
    }
    try {
      await api.post('/records/leads', newLead);
      setIsCreateOpen(false);
      setNewLead({ first_name: '', last_name: '', phone: '', email: '', dob: '', city: '', state: 'AZ', zip: '', county: 'Maricopa', source: 'Direct Lead', tcpa_consent: true });
      loadLeads();
      loadPoolStats();
    } catch (err: any) {
      alert(`Error creating lead: ${err.message}`);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === leads.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(leads.map(l => l.id));
    }
  };

  const toggleSelectRow = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const getCallerName = (ownerId?: string, assignedAgentId?: string) => {
    if (assignedAgentId === 'u_principal' || ownerId === 'u_principal') return 'King Amen Ra (Principal Broker)';
    const targetId = assignedAgentId || ownerId;
    if (!targetId) return 'Unassigned';
    const c = callers.find(u => u.id === targetId);
    return c ? (c.id === 'u_principal' ? 'King Amen Ra (Principal Broker)' : c.name) : 'Assigned Caller';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
              Prospects & Lead Workspace
            </h1>
            {isAdmin && (
              <span style={{ background: 'rgba(212, 160, 76, 0.2)', border: '1px solid var(--accent)', color: '#ffd88a', fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px' }}>
                {unassignedCount.toLocaleString()} In Master List Bank
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: '3px' }}>
            Showing {leads.length} of {total.toLocaleString()} leads · Ranked by Medicare AI scoring algorithm
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Hidden File Input */}
          <input
            type="file"
            id="file-upload"
            ref={fileInputRef}
            accept=".xlsx, .xls, .csv"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
          
          {/* Upload Button */}
          <label htmlFor="file-upload" className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}>
            <Upload size={16} color="var(--accent)" /> Upload Excel / CSV
          </label>

          {/* Admin Duplicate Cleanup Button */}
          {isAdmin && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCleanupDuplicates}
              disabled={isCleaningDuplicates}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}
              title="Scan CRM database and remove duplicate prospects, keeping the best primary record (Admin Only)"
            >
              <ShieldCheck size={16} color="var(--accent)" />
              {isCleaningDuplicates ? 'Cleaning Duplicates...' : 'Clean Duplicates'}
            </button>
          )}

          {/* Admin Scrub Phone-less Prospects Button */}
          {isAdmin && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleScrubNoPhones}
              disabled={isScrubbingNoPhones}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}
              title="Scan CRM database and permanently scrub any prospects lacking a valid 10-digit phone number (Admin Only)"
            >
              <span>🧹</span>
              {isScrubbingNoPhones ? 'Scrubbing...' : 'Scrub Phone-less'}
            </button>
          )}

          {/* Admin Scrub Leads Without Names and Addresses Button */}
          {isAdmin && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePurgeIncompleteLeads}
              disabled={isCleaningIncomplete}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700 }}
              title="Scan CRM database and permanently remove any uploaded leads that do not show names and addresses (Admin Only)"
            >
              <span>🚫</span>
              {isCleaningIncomplete ? 'Purging...' : 'Purge No Name/Address'}
            </button>
          )}

          {/* Sarah Voice Engine Start / Stop Outbound Calls Control Group */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.25rem 0.4rem',
              borderRadius: '10px',
              background: isSarahActive ? 'rgba(16, 185, 129, 0.14)' : 'rgba(139, 92, 246, 0.12)',
              border: `1.5px solid ${isSarahActive ? '#10b981' : '#8b5cf6'}`,
            }}
          >
            <button
              type="button"
              className="btn"
              disabled={sarahBusy}
              onClick={() => handleStartSarahOutboundCalls()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontWeight: 800,
                fontSize: '0.82rem',
                padding: '0.42rem 0.8rem',
                background: 'linear-gradient(135deg, #059669, #10b981)',
                borderColor: '#10b981',
                color: '#fff',
                boxShadow: '0 3px 10px rgba(16, 185, 129, 0.35)',
                cursor: sarahBusy ? 'not-allowed' : 'pointer',
              }}
              title="Start Sarah Voice AI autonomous outbound calls right now"
            >
              <span>▶</span> {sarahBusy ? 'Working...' : (selectedIds.length > 0 ? `Start Sarah AI (${selectedIds.length})` : 'Start Sarah AI Calls')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={sarahBusy}
              onClick={handleStopSarahOutboundCalls}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontWeight: 800,
                fontSize: '0.82rem',
                padding: '0.42rem 0.8rem',
                background: 'rgba(239, 68, 68, 0.22)',
                borderColor: '#ef4444',
                color: '#fca5a5',
                cursor: sarahBusy ? 'not-allowed' : 'pointer',
              }}
              title="Stop all active Sarah Voice AI outbound calls and halt queue dialing"
            >
              <span>⏹</span> Stop Calls
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('iwg-open-sarah-voice', {
                    detail: {
                      mode: 'outbound',
                      lead_id: leads[0]?.id,
                      prospect_name: leads[0] ? `${leads[0].first_name || ''} ${leads[0].last_name || ''}`.trim() : 'Valued Beneficiary',
                      phone: leads[0]?.phone || '',
                      state: leads[0]?.state || 'AZ',
                      address: leads[0]?.address || '',
                    },
                  })
                )
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontWeight: 800,
                fontSize: '0.82rem',
                padding: '0.42rem 0.75rem',
                background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
                borderColor: '#a855f7',
                color: '#fff',
                cursor: 'pointer',
              }}
              title="Open Sarah Voice AI Command Center"
            >
              <span>🎙️</span> Sarah AI Hub
            </button>
          </div>

          {/* 5 - 500 Master List Bank Assignment Button - ADMIN ONLY */}
          {isAdmin && (
            <button 
              type="button" 
              className="btn btn-accent" 
              onClick={() => setIsBatchAssignOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 800, boxShadow: '0 4px 15px rgba(212, 160, 76, 0.35)' }}
              title="Assign 5 to 500 prospects from Master List Bank to outbound schedulers or yourself (Admin Only)"
            >
              <Zap size={16} /> Assign from Master List Bank (5 - 500)
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            disabled={!activeCallLead}
            onClick={() => {
              if (activeCallLead) {
                setActiveWarmTransferLead(activeCallLead);
              }
            }}
            style={{
              fontWeight: 800,
              borderColor: activeCallLead ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)',
              color: activeCallLead ? 'var(--accent)' : '#64748b',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: activeCallLead ? 'rgba(200,150,62,0.12)' : 'rgba(255, 255, 255, 0.04)',
              cursor: activeCallLead ? 'pointer' : 'not-allowed',
              opacity: activeCallLead ? 1 : 0.6,
            }}
            title={activeCallLead ? "Live 3-Way Warm Transfer (Call active)" : "🔒 Warm Transfer Locked: Only available once connected on a live call with prospect"}
          >
            <span>{activeCallLead ? '⚡' : '🔒'}</span> 3-Way Transfer
          </button>

          <button className="btn btn-primary" onClick={() => setIsCreateOpen(true)} style={{ fontWeight: 700 }}>
            + Add New Lead
          </button>
        </div>
      </div>

      {/* Live Sarah Voice Engine Status Banner */}
      {(sarahBannerMsg || isSarahActive) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            padding: '0.75rem 1.1rem',
            borderRadius: '10px',
            background: isSarahActive ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)',
            border: `1.5px solid ${isSarahActive ? '#10b981' : '#f59e0b'}`,
            color: isSarahActive ? '#6ee7b7' : '#fde68a',
            fontSize: '0.86rem',
            fontWeight: 700,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>{isSarahActive ? '🟢' : '🛑'}</span>
            <span>
              {sarahBannerMsg || `🎙️ Sarah Voice AI (480) 331-9455 is ACTIVE — automatically calling every prospect assigned to Sarah AI (${sarahAssigned.remaining_today} of ${sarahAssigned.assigned_total} still to call today).`}
              <span style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#cbd5e1', marginTop: '0.2rem' }}>
                🕘 Outbound hours: Mon–Fri 9:00 AM–7:00 PM · Sat–Sun 9:00 AM–6:00 PM (Arizona time)
                {sarahWindow ? (sarahWindow.open ? ` · Calling now (${sarahWindow.today})` : ` · Closed now — ${sarahWindow.next_open || ''}`) : ''}
                {' '}· 📞 Inbound calls answered immediately 24/7
              </span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isSarahActive ? (
              <button
                type="button"
                disabled={sarahBusy}
                onClick={handleStopSarahOutboundCalls}
                style={{
                  padding: '0.35rem 0.85rem',
                  borderRadius: '6px',
                  background: '#ef4444',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                ⏹ Stop Outbound Calls Now
              </button>
            ) : (
              <button
                type="button"
                disabled={sarahBusy}
                onClick={() => handleStartSarahOutboundCalls()}
                style={{
                  padding: '0.35rem 0.85rem',
                  borderRadius: '6px',
                  background: '#10b981',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                }}
              >
                ▶ Start Outbound Calls Again
              </button>
            )}
            {sarahBannerMsg && (
              <button
                type="button"
                onClick={() => setSarahBannerMsg('')}
                style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', background: 'var(--bg-card)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search leads by name, phone, city, state..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, minWidth: '220px', padding: '0.55rem 0.85rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.88rem' }}
        />

        {/* Caller & Pool Filter - ADMIN ONLY */}
        {isAdmin && (
          <select
            value={callerFilter}
            onChange={(e) => setCallerFilter(e.target.value)}
            style={{ padding: '0.55rem 0.85rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.88rem', fontWeight: 500 }}
          >
            <option value="">All Callers & Master List Bank</option>
            <option value="unassigned">🏛️ Master List Bank ({unassignedCount.toLocaleString()})</option>
            {callers.map(c => {
              const isKing = c.id === 'u_principal' || c.email?.toLowerCase() === 'king@iwillglobal.com';
              return (
                <option key={c.id} value={c.id}>
                  {isKing ? `👑 King Amen Ra — Principal & Broker (${c.assigned_leads_count || 0} leads)` : c.id === 'u_sarah_ai' ? `🎙️ Sarah Voice AI (480) 331-9455 — Auto-Dialer Queue (${c.assigned_leads_count || 0} leads)` : `👤 ${c.name} (${c.assigned_leads_count || 0} leads)`}
                </option>
              );
            })}
          </select>
        )}

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: '0.55rem 0.85rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.88rem' }}
        >
          <option value="">All Statuses</option>
          <option value="New">New</option>
          <option value="Contacted">Contacted</option>
          <option value="SOA Sent">SOA Sent</option>
          <option value="SOA Signed">SOA Signed</option>
          <option value="Appointment Set">Appointment Set</option>
          <option value="Nurture">Nurture</option>
          <option value="DNC">DNC</option>
        </select>

        {/* Lead Tag / Source Filter (Call-In Lead / Website Traffic) */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          style={{ padding: '0.55rem 0.85rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: 'var(--text-main)', fontSize: '0.88rem' }}
        >
          <option value="">All Lead Tags / Sources</option>
          <option value="Inbound Lead">📞 Inbound Lead</option>
          <option value="Call-In Lead">📞 Call-In Lead</option>
          <option value="Website Traffic">🌐 Website Traffic</option>
          <option value="Direct Lead">Direct Lead</option>
        </select>

        {/* T-65 Focus Toggle */}
        <button
          type="button"
          className={`btn ${t65Filter ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setT65Filter(!t65Filter)}
          style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}
        >
          🎯 Turning 65 Focus
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => { loadLeads(); loadPoolStats(); }}
          title="Refresh table"
          style={{ padding: '0.55rem 0.75rem' }}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Leads Table */}
      <div className="table-container" style={{ position: 'relative' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={leads.length > 0 && selectedIds.length === leads.length}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th>Lead Name</th>
              <th>Phone / Address / State</th>
              <th>Status</th>
              <th>AI Score</th>
              <th>Assigned Caller</th>
              <th>DOB / Turning 65</th>
              <th>Last Call</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: '#cbd5e1' }}>Loading leads...</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: '#cbd5e1' }}>No leads match the current filters.</td></tr>
            ) : (
              leads.map((l) => {
                const isSelected = selectedIds.includes(l.id);
                const isAssignedKing = l.assigned_agent_id === 'u_principal' || l.owner_id === 'u_principal';
                const callerName = getCallerName(l.owner_id, l.assigned_agent_id);
                const isUnassigned = !l.owner_id && !l.assigned_agent_id;
                return (
                  <tr key={l.id} style={{ background: isSelected ? 'rgba(212, 160, 76, 0.08)' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectRow(l.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>

                    <td>
                      <Link to={`/leads/${l.id}`} style={{ color: 'var(--text-main)', fontWeight: 600, textDecoration: 'none' }}>
                        {l.first_name} {l.last_name}
                      </Link>
                      <div style={{ marginTop: '0.2rem' }}>
                        {/call-in|inbound/i.test(String(l.source || '')) ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              background: 'rgba(16, 185, 129, 0.18)',
                              color: '#6ee7b7',
                              border: '1px solid rgba(16, 185, 129, 0.45)',
                              padding: '1px 7px',
                              borderRadius: '999px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                            }}
                          >
                            📞 {l.source || 'Inbound Lead'}
                          </span>
                        ) : /website/i.test(String(l.source || '')) ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              background: 'rgba(56, 189, 248, 0.18)',
                              color: '#7dd3fc',
                              border: '1px solid rgba(56, 189, 248, 0.45)',
                              padding: '1px 7px',
                              borderRadius: '999px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                            }}
                          >
                            🌐 Website Traffic
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{l.source || 'Direct Lead'}</span>
                        )}
                      </div>
                    </td>

                    <td>
                      <div>{formatPhone(l.phone)}</div>
                      {l.address && (
                        <div style={{ fontSize: '0.75rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ color: 'var(--accent)' }}>📍</span> {l.address}
                        </div>
                      )}
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{l.city ? `${l.city}, ` : ''}{l.state || 'AZ'}{l.zip ? ` ${l.zip}` : ''}</div>
                    </td>

                    <td>
                      <span className={`badge ${l.status === 'SOA Signed' ? 'badge-gold' : l.status === 'Appointment Set' ? 'badge-info' : l.status === 'DNC' ? 'badge-danger' : 'badge-warning'}`}>
                        {l.status}
                      </span>
                    </td>

                    <td>
                      <span className="badge badge-gold" title={l.score_reason || 'Score'}>
                        {l.score || 35} / 100
                      </span>
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {isAssignedKing ? (
                          <span style={{ background: 'rgba(200, 150, 62, 0.2)', color: '#ffd88a', border: '1px solid #c8963e', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700 }}>
                            👑 King Amen Ra (Principal Broker)
                          </span>
                        ) : isUnassigned ? (
                          <span style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#facc15', border: '1px solid rgba(234, 179, 8, 0.4)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                            ⚡ Unassigned
                          </span>
                        ) : (
                          <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', border: '1px solid rgba(59, 130, 246, 0.4)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                            👤 {callerName}
                          </span>
                        )}
                        {isAdmin && !isUnassigned && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnassignLead(l.id, `${l.first_name} ${l.last_name}`);
                            }}
                            title="Admin: Unassign prospect & return to Master List Bank"
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.4)',
                              color: '#f87171',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.7rem',
                              cursor: 'pointer',
                              fontWeight: 700,
                              lineHeight: 1.2,
                            }}
                          >
                            ⚡ Unassign
                          </button>
                        )}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontSize: '0.85rem' }}>{l.dob || 'N/A'}</div>
                    </td>

                    <td>
                      <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>{l.last_disposition || 'No calls'}</div>
                    </td>

                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <a
                          href={l.phone ? googleVoiceWebUrl(l.phone, user?.email) : '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-secondary"
                          onClick={() => {
                            const c = { id: l.id, name: `${l.first_name} ${l.last_name}`, phone: l.phone, email: l.email, address: l.address, type: 'lead', state: l.state, status: l.status };
                            try { sessionStorage.setItem('iwg_last_active_prospect', JSON.stringify(c)); } catch (e) {}
                            setActiveCallLead(c);
                          }}
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                          title={`Call ${formatPhone(l.phone)} via Google Voice in new tab`}
                        >
                          📞 Call
                        </a>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            if (l.phone) openGoogleVoiceWindow(l.phone);
                            window.dispatchEvent(
                              new CustomEvent('iwg-open-sarah-voice', {
                                detail: {
                                  mode: 'outbound',
                                  lead_id: l.id,
                                  prospect_name: `${l.first_name || ''} ${l.last_name || ''}`.trim() || 'Medicare Beneficiary',
                                  phone: l.phone || '',
                                  state: l.state || 'AZ',
                                  address: l.address || '',
                                },
                              })
                            );
                          }}
                          style={{
                            padding: '0.35rem 0.65rem',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            background: 'rgba(139, 92, 246, 0.15)',
                            borderColor: '#8b5cf6',
                            color: '#c084fc',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            whiteSpace: 'nowrap',
                          }}
                          title="Launch Sarah Voice AI + Google Voice (480) 331-9455 to call, qualify, book, or warm-transfer this prospect"
                        >
                          🎙️ Sarah AI
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent"
                          onClick={() => {
                            const c = { id: l.id, name: `${l.first_name} ${l.last_name}`, phone: l.phone, email: l.email, type: 'lead', state: l.state, address: l.address, status: l.status };
                            try { sessionStorage.setItem('iwg_last_active_prospect', JSON.stringify(c)); } catch (e) {}
                            setActiveScheduleLead(c);
                          }}
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}
                          title="Schedule appointment slot, assign to licensed agent, and put on calendar"
                        >
                          <Calendar size={13} /> Schedule
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={!(activeCallLead && activeCallLead.id === l.id)}
                          onClick={() => {
                            if (activeCallLead && activeCallLead.id === l.id) {
                              const c = { id: l.id, name: `${l.first_name} ${l.last_name}`, phone: l.phone, email: l.email, address: l.address, type: 'lead', state: l.state, status: l.status, notes: l.notes };
                              setActiveWarmTransferLead(c);
                            }
                          }}
                          style={{
                            padding: '0.35rem 0.65rem',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            borderColor: (activeCallLead && activeCallLead.id === l.id) ? 'var(--accent)' : 'rgba(255, 255, 255, 0.12)',
                            color: (activeCallLead && activeCallLead.id === l.id) ? 'var(--accent)' : '#64748b',
                            backgroundColor: (activeCallLead && activeCallLead.id === l.id) ? 'rgba(200, 150, 62, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                            cursor: (activeCallLead && activeCallLead.id === l.id) ? 'pointer' : 'not-allowed',
                            opacity: (activeCallLead && activeCallLead.id === l.id) ? 1 : 0.5,
                            whiteSpace: 'nowrap',
                          }}
                          title={(activeCallLead && activeCallLead.id === l.id) ? "Live 3-Way Warm Transfer (Call active)" : "🔒 3-Way Warm Transfer Locked: Only available once connected on a live call with prospect"}
                        >
                          <span>{(activeCallLead && activeCallLead.id === l.id) ? '⚡' : '🔒'} 3-Way</span>
                        </button>
                        {isAdmin && !isUnassigned && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleUnassignLead(l.id, `${l.first_name} ${l.last_name}`)}
                            title="Admin: Unassign prospect & return to Master List Bank"
                            style={{
                              padding: '0.35rem 0.5rem',
                              fontSize: '0.75rem',
                              color: '#fca5a5',
                              borderColor: 'rgba(239, 68, 68, 0.4)',
                              background: 'rgba(239, 68, 68, 0.12)',
                              fontWeight: 700,
                            }}
                          >
                            ⚡ Unassign
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => handleDeleteLead(l.id, `${l.first_name} ${l.last_name}`)}
                            title="Admin: Permanently delete lead"
                            style={{
                              padding: '0.35rem 0.5rem',
                              fontSize: '0.75rem',
                              color: '#f87171',
                              borderColor: 'rgba(239, 68, 68, 0.5)',
                              background: 'rgba(239, 68, 68, 0.1)',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.2rem',
                            }}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Floating Selected Rows Action Bar */}
      {selectedIds.length > 0 && (
        <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: '#0e2052', border: '2px solid var(--accent)', borderRadius: '12px', padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', boxShadow: '0 8px 30px rgba(0, 0, 0, 0.8)', zIndex: 100, flexWrap: 'wrap' }}>
          <span style={{ color: '#ffffff', fontWeight: 700, fontSize: '0.9rem' }}>
            {selectedIds.length} prospects selected
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn"
              disabled={sarahBusy}
              onClick={() => handleStartSarahOutboundCalls(selectedIds)}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #059669, #10b981)',
                color: '#ffffff',
                border: '1.5px solid #10b981',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
              title="Assign the selected prospects to Sarah Voice AI and start calling them now (inside calling hours)"
            >
              ▶ Assign & Start Sarah AI ({selectedIds.length})
            </button>
            <button
              type="button"
              className="btn"
              disabled={sarahBusy}
              onClick={() => handleAssignToSarah(selectedIds)}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #7c3aed, #9333ea)',
                color: '#ffffff',
                border: '1.5px solid #a855f7',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
              title="Assign the selected prospects to Sarah Voice AI — they are called automatically Mon–Fri 9–7 and Sat–Sun 9–6 (Arizona time)"
            >
              🎙️ Assign to Sarah AI
            </button>
            <button
              type="button"
              className="btn"
              disabled={sarahBusy}
              onClick={handleStopSarahOutboundCalls}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 800,
                background: 'rgba(239, 68, 68, 0.25)',
                color: '#fca5a5',
                border: '1.5px solid #ef4444',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
              title="Stop all active Sarah Voice AI outbound calls"
            >
              ⏹ Stop Sarah AI
            </button>
            {isAdmin && (
              <button
                type="button"
                className="btn"
                onClick={handleDeleteSelected}
                style={{
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  backgroundColor: 'rgba(239, 68, 68, 0.35)',
                  color: '#ffffff',
                  border: '1.5px solid #ef4444',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  cursor: 'pointer',
                }}
                title="Admin: Permanently delete selected leads"
              >
                <Trash2 size={13} /> Delete Selected ({selectedIds.length})
              </button>
            )}
            {isAdmin && (
              <button
                type="button"
                className="btn"
                onClick={handleUnassignSelected}
                style={{
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  backgroundColor: 'rgba(239, 68, 68, 0.25)',
                  color: '#fca5a5',
                  border: '1.5px solid rgba(239, 68, 68, 0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  cursor: 'pointer',
                }}
                title="Admin: Unassign selected prospects and return to Master List Bank unassigned pool"
              >
                ⚡ Unassign Selected ({selectedIds.length})
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => handleAssignSelected('u_principal')}
              style={{
                padding: '0.45rem 0.85rem',
                fontSize: '0.85rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #c8963e, #936021)',
                color: '#ffffff',
                border: '1px solid #c8963e',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              👑 Assign to King Amen Ra
            </button>
            <select
              id="selected-caller-select"
              style={{ padding: '0.45rem 0.75rem', borderRadius: '6px', background: '#051039', color: '#ffffff', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}
            >
              {callers.map(c => {
                const isKing = c.id === 'u_principal' || c.email?.toLowerCase() === 'king@iwillglobal.com';
                return (
                  <option key={c.id} value={c.id}>
                    {isKing ? `👑 King Amen Ra (Principal Broker)` : `${c.name} (${c.title || c.role})`}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => {
                const el = document.getElementById('selected-caller-select') as HTMLSelectElement;
                if (el) handleAssignSelected(el.value);
              }}
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem', fontWeight: 700 }}
            >
              Assign Selected
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSelectedIds([])}
              style={{ padding: '0.45rem 0.65rem', fontSize: '0.85rem' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Master List Bank Batch Assignment Modal (5 - 500) - ADMIN ONLY */}
      {isAdmin && isBatchAssignOpen && (
        <div className="slideover-overlay" onClick={() => !isAssigning && setIsBatchAssignOpen(false)}>
          <div className="slideover-panel" onClick={(e) => e.stopPropagation()} style={{ width: '560px', background: '#070e24', color: '#ffffff', border: '1px solid var(--border-accent)' }}>
            <div className="slideover-header" style={{ borderBottom: '1px solid var(--border-color)', padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Zap size={22} color="var(--accent)" />
                <div>
                  <span style={{ fontWeight: 800, fontSize: '1.2rem', color: '#ffffff', display: 'block' }}>
                    Assign from Master List Bank
                  </span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600 }}>
                    Assign 5 to 500 prospects to an outbound scheduler or yourself as caller
                  </span>
                </div>
              </div>
              <button 
                className="btn btn-secondary" 
                onClick={() => !isAssigning && setIsBatchAssignOpen(false)} 
                style={{ padding: '0.3rem 0.6rem' }}
              >
                ✕
              </button>
            </div>

            <div className="slideover-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Master List Bank Stat Card */}
              <div style={{ background: 'linear-gradient(135deg, rgba(212, 160, 76, 0.15) 0%, rgba(14, 32, 82, 0.5) 100%)', border: '1.5px solid var(--accent)', borderRadius: '12px', padding: '1.25rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.78rem', color: '#ffd88a', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  🏛️ Master List Bank (Available Pool)
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ffffff', margin: '0.25rem 0', letterSpacing: '-0.02em' }}>
                  {unassignedCount.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
                  Uncontacted, active Medicare prospects ready for outbound assignment
                </div>
              </div>

              {/* Step 1: Select Outbound Caller or Themselves */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>
                    1. Assign To: Outbound Scheduler or Myself (Caller) *
                  </label>
                  {user && (
                    <button
                      type="button"
                      onClick={() => setSelectedCallerId(user.id)}
                      style={{
                        background: selectedCallerId === user.id ? 'var(--accent)' : 'rgba(212, 160, 76, 0.15)',
                        color: selectedCallerId === user.id ? '#051039' : '#ffd88a',
                        border: '1px solid var(--accent)',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      <UserCheck size={13} /> Assign to Myself ({user.name})
                    </button>
                  )}
                </div>

                <select
                  value={selectedCallerId}
                  onChange={(e) => setSelectedCallerId(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#0e2052', color: '#ffffff', border: '1px solid var(--border-accent)', fontSize: '0.92rem', fontWeight: 600 }}
                >
                  {/* Current User (Myself / Caller) */}
                  {user && (
                    <optgroup label="Myself (Admin Caller)">
                      <option value={user.id}>
                        👑 {user.name} (Myself / Caller) — {callers.find(c => c.id === user.id)?.assigned_leads_count || 0} leads currently assigned
                      </option>
                    </optgroup>
                  )}

                  {/* Outbound Schedulers */}
                  <optgroup label="Outbound Schedulers">
                    {callers
                      .filter(c => c.role === 'scheduler' && c.id !== user?.id)
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          🎯 {c.name} — Outbound Scheduler ({c.assigned_leads_count || 0} leads assigned)
                        </option>
                      ))}
                  </optgroup>

                  {/* Licensed Agents & Brokers */}
                  <optgroup label="Licensed Agents & Principal Broker">
                    {callers
                      .filter(c => c.role !== 'scheduler' && c.id !== user?.id)
                      .map(c => {
                        const isKing = c.id === 'u_principal' || c.email?.toLowerCase() === 'king@iwillglobal.com';
                        return (
                          <option key={c.id} value={c.id}>
                            {isKing ? `👑 King Amen Ra — Principal & Broker (${c.assigned_leads_count || 0} leads assigned)` : `💼 ${c.name} — ${c.title || c.role} (${c.assigned_leads_count || 0} leads assigned)`}
                          </option>
                        );
                      })}
                  </optgroup>
                </select>
              </div>

              {/* Step 2: Batch Size Selection (5 - 500 Prospects) */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9' }}>
                    2. Prospects to Assign: 5 - 500 Batch Size
                  </label>
                  <span style={{ fontSize: '0.85rem', color: '#ffd88a', fontWeight: 800 }}>
                    {batchAssignCount} Prospects
                  </span>
                </div>

                {/* Preset Pills: 5 to 500 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.4rem', marginBottom: '0.75rem' }}>
                  {[5, 25, 50, 100, 250, 500].map(cnt => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setBatchAssignCount(cnt)}
                      className={`btn ${batchAssignCount === cnt ? 'btn-accent' : 'btn-secondary'}`}
                      style={{ padding: '0.45rem 0.2rem', fontWeight: batchAssignCount === cnt ? 800 : 600, fontSize: '0.82rem', textAlign: 'center' }}
                    >
                      {cnt === 500 ? '⚡ 500' : cnt}
                    </button>
                  ))}
                </div>

                {/* Range Slider for Granular Selection (5 to 500) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <input
                    type="range"
                    min="5"
                    max="500"
                    step="5"
                    value={batchAssignCount}
                    onChange={(e) => setBatchAssignCount(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <input
                    type="number"
                    min="5"
                    max="500"
                    value={batchAssignCount}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBatchAssignCount(isNaN(val) ? 5 : Math.max(5, Math.min(500, val)));
                    }}
                    style={{ width: '85px', padding: '0.45rem 0.5rem', borderRadius: '6px', background: '#0e2052', color: '#ffffff', border: '1px solid var(--border-color)', fontSize: '0.9rem', textAlign: 'center', fontWeight: 700 }}
                  />
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                  Admins can assign any quantity from 5 up to 500 prospects per batch.
                </div>
              </div>

              {/* Step 3: State Targeting */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', display: 'block', marginBottom: '0.4rem' }}>
                  3. State Geographic Filter (Optional)
                </label>
                <select
                  value={batchStateFilter}
                  onChange={(e) => setBatchStateFilter(e.target.value)}
                  style={{ width: '100%', padding: '0.65rem', borderRadius: '6px', background: '#0e2052', color: '#ffffff', border: '1px solid var(--border-color)', fontSize: '0.9rem' }}
                >
                  <option value="All">All Licensed States (AZ, TX, CA, NV, FL, NM, CO)</option>
                  <option value="AZ">Arizona Only (AZ)</option>
                  <option value="TX">Texas Only (TX)</option>
                  <option value="CA">California Only (CA)</option>
                  <option value="NV">Nevada Only (NV)</option>
                  <option value="FL">Florida Only (FL)</option>
                  <option value="NM">New Mexico Only (NM)</option>
                  <option value="CO">Colorado Only (CO)</option>
                </select>
              </div>

              {/* Success Message Banner */}
              {assignSuccessMsg && (
                <div style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#6ee7b7', padding: '0.85rem', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 600, textAlign: 'center' }}>
                  {assignSuccessMsg}
                </div>
              )}

              {/* Submit Button */}
              <button
                type="button"
                className="btn btn-accent"
                disabled={isAssigning || unassignedCount === 0 || batchAssignCount < 5 || batchAssignCount > 500}
                onClick={handleBulkAssign}
                style={{ padding: '0.9rem', fontSize: '1rem', fontWeight: 800, marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {isAssigning ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    Assigning {batchAssignCount} Prospects from Master List Bank...
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    Assign {batchAssignCount} Prospects from Master List Bank
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excel / CSV Import Modal */}
      {isImportModalOpen && (
        <div className="slideover-overlay" onClick={() => !isImporting && setIsImportModalOpen(false)}>
          <div className="slideover-panel" onClick={(e) => e.stopPropagation()} style={{ width: '640px', background: '#070e24', color: '#ffffff', border: '1px solid var(--border-accent)' }}>
            <div className="slideover-header" style={{ borderBottom: '1px solid var(--border-color)', padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileSpreadsheet size={20} color="var(--accent)" />
                <span style={{ fontWeight: 800, fontSize: '1.2rem', color: '#ffffff' }}>
                  Import & Assign Prospects
                </span>
              </div>
              <button 
                className="btn btn-secondary" 
                onClick={() => !isImporting && setIsImportModalOpen(false)} 
                style={{ padding: '0.3rem 0.6rem' }}
              >
                ✕
              </button>
            </div>

            <div className="slideover-body" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* File Info Banner */}
              <div style={{ background: '#0e2052', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>Source Spreadsheet</div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#ffffff' }}>{importFileName}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>Detected Prospects</div>
                  <div style={{ fontWeight: 800, fontSize: '1.3rem', color: 'var(--accent)' }}>
                    {parsedLeads.length.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Name, Address, Phone Scrub & Duplicate Guard Active Banner */}
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <ShieldCheck size={24} color="#10b981" style={{ flexShrink: 0 }} />
                <div style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
                  <span style={{ fontWeight: 700, color: '#6ee7b7' }}>🛡️ Name, Address & Phone Guard Active:</span> All prospects must have a verified first/last name, street address, and 10-digit phone number. Records missing names, addresses, or phone numbers are automatically scrubbed and excluded.
                  {scrubbedNoNameOrAddressCount > 0 && (
                    <div style={{ color: '#f87171', fontWeight: 600, marginTop: '3px' }}>
                      🚫 {scrubbedNoNameOrAddressCount.toLocaleString()} row(s) without valid names or street addresses were scrubbed and excluded.
                    </div>
                  )}
                  {scrubbedNoPhoneCount > 0 && (
                    <div style={{ color: '#f87171', fontWeight: 600, marginTop: '3px' }}>
                      🚫 {scrubbedNoPhoneCount.toLocaleString()} row(s) without phone numbers were scrubbed and excluded.
                    </div>
                  )}
                  {inFileDuplicatesCount > 0 && (
                    <div style={{ color: '#ffd88a', fontWeight: 600, marginTop: '3px' }}>
                      ⚠️ {inFileDuplicatesCount.toLocaleString()} duplicate row(s) in spreadsheet were automatically filtered out.
                    </div>
                  )}
                </div>
              </div>

              {/* Sample Preview Table */}
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '0.4rem' }}>
                  Data Preview (First 5 Rows):
                </div>
                <div style={{ maxHeight: '160px', overflowY: 'auto', background: '#051039', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', background: '#0b163b', color: '#cbd5e1' }}>
                        <th style={{ padding: '6px 8px' }}>Name</th>
                        <th style={{ padding: '6px 8px' }}>Phone</th>
                        <th style={{ padding: '6px 8px' }}>Address</th>
                        <th style={{ padding: '6px 8px' }}>City</th>
                        <th style={{ padding: '6px 8px' }}>State</th>
                        <th style={{ padding: '6px 8px' }}>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedLeads.slice(0, 5).map((r, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '6px 8px', color: '#ffffff' }}>{r.first_name} {r.last_name}</td>
                          <td style={{ padding: '6px 8px', color: '#93c5fd' }}>{r.phone}</td>
                          <td style={{ padding: '6px 8px', color: '#cbd5e1' }}>{r.address || '—'}</td>
                          <td style={{ padding: '6px 8px', color: '#cbd5e1' }}>{r.city || '—'}</td>
                          <td style={{ padding: '6px 8px', color: '#cbd5e1' }}>{r.state}</td>
                          <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{r.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Assignment Choice */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f1f5f9', display: 'block', marginBottom: '0.4rem' }}>
                  Assign Directly on Import:
                </label>
                <select
                  value={importAssignCallerId}
                  onChange={(e) => setImportAssignCallerId(e.target.value)}
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: '#0e2052', color: '#ffffff', border: '1px solid var(--border-accent)', fontSize: '0.92rem' }}
                >
                  {isAdmin && (
                    <option value="">⚡ Leave in Master List Bank (Distribute 500 at a time later)</option>
                  )}
                  {callers.map(c => {
                    const isKing = c.id === 'u_principal' || c.email?.toLowerCase() === 'king@iwillglobal.com';
                    return (
                      <option key={c.id} value={c.id}>
                        {isKing ? `👑 Assign All to: King Amen Ra — Principal Broker (${c.assigned_leads_count || 0} existing leads)` : `Assign All to: ${c.name} — ${c.title || c.role} (${c.assigned_leads_count || 0} existing leads)`}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Progress Bar during upload */}
              {isImporting && (
                <div style={{ background: '#051039', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#ffd88a', marginBottom: '0.4rem', fontWeight: 600 }}>
                    <span>
                      Importing in batches of 500...
                      {duplicatesSkippedCount > 0 && ` (🛡️ ${duplicatesSkippedCount} duplicates guarded)`}
                    </span>
                    <span>{importProgress.current.toLocaleString()} / {importProgress.total.toLocaleString()}</span>
                  </div>
                  <div style={{ height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden' }}>
                    <div 
                      style={{ 
                        height: '100%', 
                        background: 'linear-gradient(90deg, #d4a04c, #10b981)', 
                        width: `${importProgress.total ? (importProgress.current / importProgress.total) * 100 : 0}%`,
                        transition: 'width 0.3s ease'
                      }} 
                    />
                  </div>
                </div>
              )}

              {importResultMsg && (
                <div style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#6ee7b7', padding: '0.85rem', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 700, textAlign: 'center' }}>
                  {importResultMsg}
                </div>
              )}

              {/* Import Action Button */}
              <button
                type="button"
                className="btn btn-accent"
                disabled={isImporting}
                onClick={executeBatchImport}
                style={{ padding: '0.9rem', fontSize: '1rem', fontWeight: 800, marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
              >
                {isImporting ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    Uploading Prospects...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Start Import ({parsedLeads.length.toLocaleString()} Prospects)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call Panel Modal */}
      {activeCallLead && (
        <CallPanel
          contact={activeCallLead}
          onClose={() => setActiveCallLead(null)}
          onCallCompleted={() => loadLeads()}
        />
      )}

      {/* Warm Transfer Modal */}
      {activeWarmTransferLead && (
        <WarmTransferModal
          isOpen={Boolean(activeWarmTransferLead)}
          contact={activeWarmTransferLead}
          onClose={() => setActiveWarmTransferLead(null)}
          onTransferComplete={() => loadLeads()}
        />
      )}

      {/* Create Lead Modal */}
      {isCreateOpen && (
        <div className="slideover-overlay" onClick={() => setIsCreateOpen(false)}>
          <div className="slideover-panel" onClick={(e) => e.stopPropagation()} style={{ width: '480px' }}>
            <div className="slideover-header">
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>+ Create New Lead</div>
              <button className="btn btn-secondary" onClick={() => setIsCreateOpen(false)} style={{ padding: '0.3rem 0.6rem' }}>✕</button>
            </div>

            <form onSubmit={handleCreateLead} className="slideover-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>First Name *</label>
                  <input type="text" required value={newLead.first_name} onChange={(e) => setNewLead({ ...newLead, first_name: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Last Name *</label>
                  <input type="text" required value={newLead.last_name} onChange={(e) => setNewLead({ ...newLead, last_name: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff' }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Phone Number *</label>
                <input type="text" required placeholder="(480) 555-0123" value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff' }} />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Street Address</label>
                <input type="text" placeholder="4820 E Camelback Rd, Phoenix AZ 85018" value={newLead.address || ''} onChange={(e) => setNewLead({ ...newLead, address: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff' }} />
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Lead Tag / Source</label>
                <select value={newLead.source || 'Inbound Lead'} onChange={(e) => setNewLead({ ...newLead, source: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff' }}>
                  <option value="Inbound Lead">📞 Inbound Lead</option>
                  <option value="Call-In Lead">📞 Call-In Lead</option>
                  <option value="Website Traffic">🌐 Website Traffic</option>
                  <option value="Direct Lead">Direct Lead</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>Date of Birth (YYYY-MM-DD)</label>
                  <input type="date" value={newLead.dob} onChange={(e) => setNewLead({ ...newLead, dob: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>City</label>
                  <input type="text" value={newLead.city} onChange={(e) => setNewLead({ ...newLead, city: e.target.value })} style={{ width: '100%', padding: '0.5rem', borderRadius: '6px', backgroundColor: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff' }} />
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', marginTop: '0.5rem' }}>
                <input type="checkbox" checked={newLead.tcpa_consent} onChange={(e) => setNewLead({ ...newLead, tcpa_consent: e.target.checked })} />
                <span>TCPA Express Consent on File</span>
              </label>

              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem', padding: '0.75rem' }}>
                Save & Score Lead
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Schedule Appointment Modal */}
      {activeScheduleLead && (
        <BookAppointmentModal
          contact={activeScheduleLead}
          onClose={() => setActiveScheduleLead(null)}
          onScheduled={() => {
            setActiveScheduleLead(null);
            loadLeads();
            loadPoolStats();
          }}
        />
      )}
    </div>
  );
};
export default LeadsPage;
