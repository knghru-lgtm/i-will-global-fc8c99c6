import { Router } from 'express';
import multer from 'multer';
import * as xlsx from 'xlsx';
import { q, one, insert, update, audit, uid } from '../db/index.ts';
import { OBJECTS, filterableColumns, type ObjectDef } from './objects.ts';
import { isManager, type AuthUser } from '../auth.ts';
import { scoreLead } from '../services/scoring.ts';
import { parse, isoDate } from '../services/enrollment.ts';

export const records = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function extractPhoneField(raw: any): string {
  if (!raw || typeof raw !== 'object') return '';
  const direct = 
    raw['Primary Phone'] || raw.primary_phone || raw.PrimaryPhone ||
    raw.phone || raw.Phone || raw['Phone Number'] || raw['Phone'] ||
    raw['Cell Phone'] || raw.cell || raw.mobile || raw['Mobile Phone'] ||
    raw.telephone || raw.Telephone || raw.Tel || raw.tel ||
    raw['Phone 1'] || raw['Contact Phone'] || raw['Home Phone'];
  if (direct !== undefined && direct !== null && String(direct).trim() !== '') {
    return String(direct).trim();
  }

  // Scan keys for any phone/tel/mobile/cell column
  for (const k of Object.keys(raw)) {
    if (/phone|mobile|cell|tel/i.test(k)) {
      const val = raw[k];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const digits = String(val).replace(/\D/g, '');
        if (digits.length >= 7) {
          return String(val).trim();
        }
      }
    }
  }
  return '';
}

function cleanPhone(raw: any): string {
  if (!raw) return '';
  const str = String(raw).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return str;
}

function extract10Digits(phone: any): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

interface BatchInsertResult {
  imported: number;
  duplicatesSkipped: number;
  noPhoneSkipped: number;
  noNameOrAddressSkipped: number;
  totalProcessed: number;
}

async function batchInsertLeads(
  leadsList: any[], 
  defaultOwnerId: string | null = null,
  guardDuplicates: boolean = true
): Promise<BatchInsertResult> {
  if (!leadsList || !leadsList.length) {
    return { imported: 0, duplicatesSkipped: 0, noPhoneSkipped: 0, noNameOrAddressSkipped: 0, totalProcessed: 0 };
  }
  
  const CHUNK_SIZE = 100;
  let totalImported = 0;
  let totalDuplicatesSkipped = 0;
  let totalNoPhoneSkipped = 0;
  let totalNoNameOrAddressSkipped = 0;
  const inMemorySeenPhones = new Set<string>();
  const inMemorySeenEmails = new Set<string>();

  for (let i = 0; i < leadsList.length; i += CHUNK_SIZE) {
    const chunk = leadsList.slice(i, i + CHUNK_SIZE);
    
    // If guardDuplicates is enabled, pre-query DB for existing phone numbers & emails in this chunk
    const existingPhones = new Set<string>();
    const existingEmails = new Set<string>();

    if (guardDuplicates) {
      const chunkPhones: string[] = [];
      const chunkEmails: string[] = [];

      for (const raw of chunk) {
        const rawPhone = extractPhoneField(raw);
        const p10 = extract10Digits(rawPhone);
        if (p10.length === 10) chunkPhones.push(p10);

        const email = String(raw.email || raw.Email || raw['Email Address'] || '').trim().toLowerCase();
        if (email && email.includes('@')) chunkEmails.push(email);
      }

      if (chunkPhones.length > 0 || chunkEmails.length > 0) {
        const queryConds: string[] = [];
        const queryParams: any[] = [];

        if (chunkPhones.length > 0) {
          queryParams.push(chunkPhones);
          queryConds.push(`(phone IS NOT NULL AND LENGTH(REGEXP_REPLACE(phone, '\\D', '', 'g')) >= 10 AND RIGHT(REGEXP_REPLACE(phone, '\\D', '', 'g'), 10) = ANY($${queryParams.length}))`);
        }

        if (chunkEmails.length > 0) {
          queryParams.push(chunkEmails);
          queryConds.push(`(email IS NOT NULL AND LOWER(TRIM(email)) = ANY($${queryParams.length}))`);
        }

        const existing = await q<{ phone: string | null; email: string | null }>(
          `SELECT phone, email FROM leads WHERE ${queryConds.join(' OR ')}`,
          queryParams
        );

        for (const row of existing) {
          if (row.phone) {
            const p10 = extract10Digits(row.phone);
            if (p10.length === 10) existingPhones.add(p10);
          }
          if (row.email) {
            existingEmails.add(row.email.trim().toLowerCase());
          }
        }
      }
    }

    const valueSets: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    for (const raw of chunk) {
      const rawPhone = extractPhoneField(raw);
      const p10 = extract10Digits(rawPhone);

      // REQUIRE VALID 10-DIGIT PHONE: Scrub any prospect without a valid phone number
      if (!p10 || p10.length < 10) {
        totalNoPhoneSkipped++;
        continue;
      }

      const phone = cleanPhone(rawPhone);
      const email = String(raw.email || raw.Email || raw['Email Address'] || '').trim().toLowerCase() || null;

      if (guardDuplicates) {
        // Check if duplicate within this batch/file
        if (p10 && p10.length === 10) {
          if (inMemorySeenPhones.has(p10)) {
            totalDuplicatesSkipped++;
            continue;
          }
        } else if (email) {
          if (inMemorySeenEmails.has(email)) {
            totalDuplicatesSkipped++;
            continue;
          }
        }

        // Check if duplicate against existing records in DB
        if ((p10 && existingPhones.has(p10)) || (email && existingEmails.has(email))) {
          totalDuplicatesSkipped++;
          continue;
        }

        // Mark as seen in this session
        if (p10 && p10.length === 10) inMemorySeenPhones.add(p10);
        if (email) inMemorySeenEmails.add(email);
      }

      let firstName = String(
        raw.first_name || raw.firstName || raw.FirstName || raw['First Name'] ||
        raw['patient firstname'] || raw['Patient Firstname'] || raw['patient first name'] || raw['Patient First Name'] ||
        raw.first || ''
      ).trim();
      let lastName = String(
        raw.last_name || raw.lastName || raw.LastName || raw['Last Name'] ||
        raw['patient lastname'] || raw['Patient Lastname'] || raw['patient last name'] || raw['Patient Last Name'] ||
        raw.last || ''
      ).trim();
      
      const fullName = String(
        raw.name || raw.Name || raw['Full Name'] || raw['FullName'] || raw['Contact Name'] ||
        raw['patient name'] || raw['Patient Name'] || ''
      ).trim();

      if ((!firstName || ['imported', 'prospect'].includes(firstName.toLowerCase())) && fullName) {
        const parts = fullName.split(' ');
        firstName = parts[0] || '';
        lastName = parts.slice(1).join(' ') || '';
      }

      const rawAddress = String(
        raw.address || raw.Address || raw['Street Address'] || raw['street address'] ||
        raw.street || raw.Street || raw['patient address1'] || raw['Patient Address1'] ||
        raw['patient address'] || raw['Patient Address'] || raw['address1'] || raw['Address1'] ||
        raw['Address 1'] || raw.addr || raw.Addr || ''
      ).trim();
      const address = rawAddress.length > 0 && rawAddress.toLowerCase() !== 'n/a' ? rawAddress : null;

      // REQUIRE REAL NAMES AND ADDRESSES: Scrub any lead missing name or address
      const isPlaceholderFirst = !firstName || ['prospect', 'imported', 'unknown', 'n/a'].includes(firstName.toLowerCase());
      const isPlaceholderLast = !lastName || ['lead', 'prospect', 'imported', 'unknown', 'n/a'].includes(lastName.toLowerCase());
      const hasValidName = !isPlaceholderFirst && !isPlaceholderLast;
      const hasValidAddress = Boolean(address && address.length > 0);

      if (!hasValidName || !hasValidAddress) {
        totalNoNameOrAddressSkipped++;
        continue;
      }

      const city = raw.city || raw.City || raw['patient city'] || raw['Patient City'] || null;
      const state = raw.state || raw.State || raw.ST || 'AZ';
      const zip = raw.zip || raw.Zip || raw['Zip Code'] || raw['ZIP'] || raw['patient zip'] || raw['Patient Zip'] || raw.postal || null;
      const county = raw.county || raw.County || null;
      
      const rawDob = raw.dob || raw.DOB || raw['Date of Birth'] || raw['Birth Date'] || raw.patientdob || raw.patient_dob || null;
      let dob: string | null = null;
      if (rawDob) {
        const pd = parse(rawDob);
        if (!isNaN(pd.getTime())) {
          dob = isoDate(pd);
        } else {
          dob = String(rawDob).trim() || null;
        }
      }

      const source = raw.source || raw.Source || raw['Lead Source'] || 'Excel/CSV Import';
      const status = raw.status || 'New';
      const leadOwner = raw.owner_id || defaultOwnerId || null;
      
      const scored = scoreLead ? scoreLead({ dob, source, tcpa_consent: true, attempts: 0 } as any) : { score: 35, score_reason: 'Import' };
      const score = scored.score ?? 35;
      const scoreReason = scored.score_reason ?? 'Batch Import';

      const id = uid();
      params.push(id, firstName, lastName, phone, email, city, state, zip, county, address, dob, source, status, leadOwner, score, scoreReason, true);

      valueSets.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, $${pIdx+6}, $${pIdx+7}, $${pIdx+8}, $${pIdx+9}, $${pIdx+10}, $${pIdx+11}, $${pIdx+12}, $${pIdx+13}, $${pIdx+14}, $${pIdx+15}, $${pIdx+16})`);
      pIdx += 17;
    }

    if (valueSets.length > 0) {
      const sql = `
        INSERT INTO leads (
          id, first_name, last_name, phone, email, city, state, zip, county, address, dob, source, status, owner_id, score, score_reason, tcpa_consent
        ) VALUES ${valueSets.join(', ')}
        ON CONFLICT (id) DO NOTHING
      `;
      await q(sql, params);
      totalImported += valueSets.length;
    }
  }

  return {
    imported: totalImported,
    duplicatesSkipped: totalDuplicatesSkipped,
    noPhoneSkipped: totalNoPhoneSkipped,
    noNameOrAddressSkipped: totalNoNameOrAddressSkipped,
    totalProcessed: leadsList.length,
  };
}

/** Direct JSON Batch Import for Excel / CSV parsed in browser (ultra-fast, zero multer limits) */
records.post('/batch-import/leads', async (req, res) => {
  try {
    const { leads: rawLeads, caller_id, guard_duplicates = true } = req.body;
    if (!Array.isArray(rawLeads) || !rawLeads.length) {
      return res.status(400).json({ error: 'No leads provided in payload' });
    }

    const result = await batchInsertLeads(rawLeads, caller_id || null, guard_duplicates !== false);

    // Imported straight to Bland AI => start dialing immediately (inside calling hours, if the campaign is active)
    if (caller_id === 'u_bland_ai' && result.imported > 0) {
      const { runBlandAutoDialerTick } = await import('../services/bland.ts');
      await runBlandAutoDialerTick({ reason: 'import' }).catch(() => {});
    }
    await audit(req.user!.id, 'bulk_import', 'leads', '', {
      count: result.imported,
      duplicates_skipped: result.duplicatesSkipped,
      no_phone_skipped: result.noPhoneSkipped,
      no_name_or_address_skipped: result.noNameOrAddressSkipped,
      assigned_to: caller_id || 'unassigned'
    });

    res.json({
      success: true,
      imported: result.imported,
      duplicates_skipped: result.duplicatesSkipped,
      no_phone_skipped: result.noPhoneSkipped,
      no_name_or_address_skipped: result.noNameOrAddressSkipped,
      total_processed: result.totalProcessed,
    });
  } catch (err: any) {
    console.error('Batch import leads error:', err);
    res.status(500).json({ error: err.message || 'Import failed' });
  }
});

/** File upload fallback */
records.post('/upload/leads', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json<any>(workbook.Sheets[sheetName]);
    
    const callerId = req.body?.caller_id || null;
    const result = await batchInsertLeads(rows, callerId, true);
    
    await audit(req.user!.id, 'bulk_import', 'leads', '', {
      count: result.imported,
      duplicates_skipped: result.duplicatesSkipped,
      no_phone_skipped: result.noPhoneSkipped,
      no_name_or_address_skipped: result.noNameOrAddressSkipped,
      filename: req.file.originalname,
      caller_id: callerId,
    });
    res.json({
      success: true,
      imported: result.imported,
      duplicates_skipped: result.duplicatesSkipped,
      no_phone_skipped: result.noPhoneSkipped,
      no_name_or_address_skipped: result.noNameOrAddressSkipped,
      total_processed: result.totalProcessed,
    });
  } catch (err: any) {
    console.error('Upload leads error:', err);
    res.status(500).json({ error: err.message || 'File processing failed' });
  }
});

/** Purge any uploaded leads that do not show names and addresses */
records.delete('/leads/cleanup-incomplete', async (req, res) => {
  try {
    const deleted = await q<{ id: string }>(
      `DELETE FROM leads
       WHERE address IS NULL OR trim(address) = ''
          OR first_name IS NULL OR trim(first_name) = '' OR lower(first_name) IN ('prospect', 'imported')
          OR last_name IS NULL OR trim(last_name) = '' OR lower(last_name) IN ('lead')
       RETURNING id`
    );
    await audit(req.user!.id, 'purge_incomplete_leads', 'leads', '', { count: deleted.length });
    res.json({ ok: true, deletedCount: deleted.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Get Master List Bank pool stats and outbound callers list - Master List Bank visible to ADMIN ONLY */
records.get('/leads/pool-stats', async (req, res) => {
  try {
    const admin = isLeadAdmin(req.user);
    const unassigned = admin
      ? await one<{ n: number }>(`SELECT count(*)::int AS n FROM leads WHERE (owner_id IS NULL OR owner_id = '') AND status != 'DNC'`)
      : { n: 0 };
    const totalLeads = admin
      ? await one<{ n: number }>(`SELECT count(*)::int AS n FROM leads`)
      : await one<{ n: number }>(`SELECT count(*)::int AS n FROM leads WHERE owner_id = $1 OR assigned_agent_id = $1`, [req.user?.id || '']);
    
    // State breakdown of master list bank - ADMIN ONLY
    const stateBreakdown = admin
      ? await q<{ state: string; count: number }>(
          `SELECT COALESCE(state, 'Unknown') AS state, count(*)::int AS count
           FROM leads
           WHERE (owner_id IS NULL OR owner_id = '') AND status != 'DNC'
           GROUP BY state
           ORDER BY count DESC`
        )
      : [];

    const callers = await q(`
      SELECT u.id, u.name, u.email, u.role, u.title,
        COUNT(l.id)::int as assigned_leads_count
      FROM users u
      LEFT JOIN leads l ON l.owner_id = u.id AND l.status != 'DNC'
      WHERE u.active = true AND u.role IN ('scheduler', 'licensed_agent', 'admin', 'manager')
      GROUP BY u.id, u.name, u.email, u.role, u.title
      ORDER BY (CASE WHEN u.id = 'u_principal' OR lower(u.email) = 'king@iwillglobal.com' THEN 0 WHEN u.id = 'u_bland_ai' THEN 1 ELSE 2 END), u.role DESC, u.name ASC
    `);

    res.json({
      master_list_bank_count: admin ? (unassigned?.n ?? 0) : 0,
      unassigned_count: admin ? (unassigned?.n ?? 0) : 0,
      total_leads: totalLeads?.n ?? 0,
      state_breakdown: stateBreakdown,
      is_admin: admin,
      current_user: req.user ? { id: req.user.id, name: req.user.name, role: req.user.role } : null,
      callers: callers.map((c: any) => ({
        ...c,
        is_self: c.id === req.user?.id,
        is_scheduler: c.role === 'scheduler',
        is_admin: c.role === 'admin' || c.id === 'u_principal' || c.email?.toLowerCase() === 'king@iwillglobal.com',
      })),
    });
  } catch (err: any) {
    console.error('Pool stats error:', err);
    res.status(500).json({ error: err.message || 'Failed to load pool stats' });
  }
});

function isLeadAdmin(user: any): boolean {
  if (!user) return false;
  const email = (user.email || '').toLowerCase();
  return user.role === 'admin' || email === 'king@iwillglobal.com' || email === 'aneesha@iwillglobal.com' || user.id === 'u_principal';
}

/** Bulk assign 5 to 500 prospects from Master List Bank to an outbound caller or admin caller themselves - ADMIN ONLY */
records.post('/leads/assign-bulk', async (req, res) => {
  try {
    if (!isLeadAdmin(req.user)) {
      return res.status(403).json({ error: 'Only administrators can assign prospects from the Master List Bank' });
    }

    let { caller_id, count = 500, state_filter, status_filter = 'New', unassigned_only = true } = req.body;

    // Support admin assigning to themselves ("caller from master list bank")
    if (caller_id === 'self' || caller_id === 'me' || caller_id === 'myself' || !caller_id) {
      caller_id = req.user!.id;
    }

    const caller = await one<{ id: string; name: string; role: string }>(
      'SELECT id, name, role FROM users WHERE id = $1', [caller_id]
    );
    if (!caller) {
      return res.status(404).json({ error: 'Selected caller not found' });
    }

    // Validate batch count: 5 to 500 prospects per assignment
    const numCount = Number(count);
    if (isNaN(numCount) || numCount < 5 || numCount > 500) {
      return res.status(400).json({ error: 'Assignment batch size must be between 5 and 500 prospects' });
    }
    const batchCount = numCount;

    const conditions: string[] = ["t.status != 'DNC'"];
    const params: any[] = [caller.id];

    if (unassigned_only) {
      conditions.push("(t.owner_id IS NULL OR t.owner_id = '')");
    }

    if (status_filter && status_filter !== 'All') {
      params.push(status_filter);
      conditions.push(`t.status = $${params.length}`);
    }

    if (state_filter && state_filter !== 'All') {
      params.push(state_filter);
      conditions.push(`t.state = $${params.length}`);
    }

    params.push(batchCount);
    const limitIdx = params.length;

    const sql = `
      WITH to_assign AS (
        SELECT t.id 
        FROM leads t 
        WHERE ${conditions.join(' AND ')}
        ORDER BY t.score DESC, t.created_at DESC 
        LIMIT $${limitIdx}
      )
      UPDATE leads 
      SET owner_id = $1, updated_at = now() 
      WHERE id IN (SELECT id FROM to_assign) 
      RETURNING id;
    `;

    const updated = await q(sql, params);
    const assignedCount = updated.length;

    // Prospects assigned to Bland AI are dialed right away (inside calling hours, if the campaign is active)
    if (caller.id === 'u_bland_ai' && assignedCount > 0) {
      const { runBlandAutoDialerTick } = await import('../services/bland.ts');
      await runBlandAutoDialerTick({ reason: 'assign_bulk' }).catch(() => {});
    }

    const remaining = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM leads WHERE (owner_id IS NULL OR owner_id = '') AND status != 'DNC'`
    );

    // Notify assigned caller if not admin themselves
    if (caller.id !== req.user!.id && assignedCount > 0) {
      await insert('notifications', {
        user_id: caller.id,
        title: `🎯 ${assignedCount} Prospects Assigned from Master List Bank`,
        body: `${req.user!.name} assigned ${assignedCount} prospects from the Master List Bank to your outbound schedule.`,
        link: '/leads',
      });
    }

    await audit(req.user!.id, 'bulk_assign', 'leads', '', {
      assigned_to: caller.name,
      caller_id: caller.id,
      is_self: caller.id === req.user!.id,
      count: assignedCount,
      remaining_unassigned: remaining?.n ?? 0,
      source: 'master_list_bank',
    });

    res.json({
      success: true,
      assigned: assignedCount,
      caller_id: caller.id,
      caller_name: caller.name,
      is_self: caller.id === req.user!.id,
      remaining_unassigned: remaining?.n ?? 0,
    });
  } catch (err: any) {
    console.error('Bulk assign error:', err);
    res.status(500).json({ error: err.message || 'Failed to assign leads' });
  }
});

/** Bulk assign specific selected leads */
records.post('/leads/assign-selected', async (req, res) => {
  try {
    const { lead_ids, caller_id } = req.body;
    if (!Array.isArray(lead_ids) || !lead_ids.length) {
      return res.status(400).json({ error: 'No leads selected' });
    }
    if (!caller_id) {
      return res.status(400).json({ error: 'Caller is required' });
    }

    const caller = await one<{ id: string; name: string }>(
      'SELECT id, name FROM users WHERE id = $1', [caller_id]
    );
    if (!caller) return res.status(404).json({ error: 'Caller not found' });

    await q(`UPDATE leads SET owner_id = $1, updated_at = now() WHERE id = ANY($2)`, [caller_id, lead_ids]);

    // Prospects assigned to Bland AI are dialed right away (inside calling hours, if the campaign is active)
    if (caller_id === 'u_bland_ai') {
      const { runBlandAutoDialerTick } = await import('../services/bland.ts');
      await runBlandAutoDialerTick({ reason: 'assign_selected' }).catch(() => {});
    }

    await audit(req.user!.id, 'selected_assign', 'leads', '', {
      assigned_to: caller.name,
      caller_id,
      count: lead_ids.length
    });

    res.json({ success: true, assigned: lead_ids.length, caller_name: caller.name });
  } catch (err: any) {
    console.error('Assign selected error:', err);
    res.status(500).json({ error: err.message || 'Assignment failed' });
  }
});

/** Admin ability to unassign any single prospect - ADMIN ONLY */
records.post('/leads/:id/unassign', async (req, res) => {
  try {
    if (!isLeadAdmin(req.user)) {
      return res.status(403).json({ error: 'Only administrators can unassign prospects' });
    }

    const leadId = req.params.id;
    const lead = await one<any>('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Prospect not found' });

    const prevOwner = lead.owner_id;
    const prevAgent = lead.assigned_agent_id;

    const updated = await update('leads', leadId, {
      owner_id: null,
      assigned_agent_id: null,
      updated_at: new Date(),
    });

    await insert('activities', {
      type: 'system',
      subject: 'Prospect Unassigned by Administrator',
      body: `Prospect was unassigned by ${req.user!.name} (${req.user!.email}) and returned to the Master List Bank unassigned pool.`,
      related_type: 'lead',
      related_id: leadId,
      user_id: req.user!.id,
      completed: true,
      meta: {
        unassigned_by_user_id: req.user!.id,
        previous_owner_id: prevOwner,
        previous_assigned_agent_id: prevAgent,
        source: 'admin_unassign',
      },
    });

    await audit(req.user!.id, 'unassign_prospect', 'leads', leadId, {
      previous_owner_id: prevOwner,
      previous_assigned_agent_id: prevAgent,
    });

    const remaining = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM leads WHERE (owner_id IS NULL OR owner_id = '') AND status != 'DNC'`
    );

    res.json({
      success: true,
      lead: updated,
      remaining_unassigned: remaining?.n ?? 0,
      message: 'Prospect unassigned and returned to Master List Bank unassigned pool',
    });
  } catch (err: any) {
    console.error('Unassign prospect error:', err);
    res.status(500).json({ error: err.message || 'Failed to unassign prospect' });
  }
});

/** Admin ability to unassign multiple selected prospects in bulk - ADMIN ONLY */
records.post('/leads/unassign-bulk', async (req, res) => {
  try {
    if (!isLeadAdmin(req.user)) {
      return res.status(403).json({ error: 'Only administrators can unassign prospects' });
    }

    const { lead_ids } = req.body;
    if (!Array.isArray(lead_ids) || !lead_ids.length) {
      return res.status(400).json({ error: 'No prospects selected for unassignment' });
    }

    const updated = await q(
      `UPDATE leads 
       SET owner_id = NULL, assigned_agent_id = NULL, updated_at = now() 
       WHERE id = ANY($1) 
       RETURNING id`,
      [lead_ids]
    );

    const count = updated.length;

    const remaining = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM leads WHERE (owner_id IS NULL OR owner_id = '') AND status != 'DNC'`
    );

    await audit(req.user!.id, 'bulk_unassign', 'leads', '', {
      count,
      lead_ids,
      remaining_unassigned: remaining?.n ?? 0,
    });

    res.json({
      success: true,
      unassigned: count,
      remaining_unassigned: remaining?.n ?? 0,
      message: `Successfully unassigned ${count} prospects and returned them to the Master List Bank`,
    });
  } catch (err: any) {
    console.error('Bulk unassign error:', err);
    res.status(500).json({ error: err.message || 'Failed to bulk unassign prospects' });
  }
});

/** Admin ability to delete a single lead - ADMIN ONLY */
records.delete('/leads/:id', async (req, res) => {
  try {
    if (!isLeadAdmin(req.user)) {
      return res.status(403).json({ error: 'Only administrators can delete or remove leads' });
    }

    const leadId = req.params.id;
    const lead = await one<any>('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Clean up related activities, opportunities, and SOAs associated with this lead
    await q(`DELETE FROM activities WHERE related_type = 'lead' AND related_id = $1`, [leadId]);
    await q(`DELETE FROM soas WHERE lead_id = $1`, [leadId]);
    await q(`DELETE FROM opportunities WHERE lead_id = $1`, [leadId]);
    await q(`DELETE FROM leads WHERE id = $1`, [leadId]);

    await audit(req.user!.id, 'delete_lead', 'leads', leadId, {
      name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      phone: lead.phone,
      state: lead.state,
    });

    res.json({
      success: true,
      message: `Lead ${lead.first_name || ''} ${lead.last_name || ''}`.trim() + ' successfully deleted',
      id: leadId,
    });
  } catch (err: any) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete lead' });
  }
});

/** Admin ability to delete multiple selected leads in bulk - ADMIN ONLY */
records.post('/leads/delete-bulk', async (req, res) => {
  try {
    if (!isLeadAdmin(req.user)) {
      return res.status(403).json({ error: 'Only administrators can delete or remove leads' });
    }

    const { lead_ids } = req.body;
    if (!Array.isArray(lead_ids) || !lead_ids.length) {
      return res.status(400).json({ error: 'No leads selected for deletion' });
    }

    // Clean up related activities, opportunities, and SOAs
    await q(`DELETE FROM activities WHERE related_type = 'lead' AND related_id = ANY($1)`, [lead_ids]);
    await q(`DELETE FROM soas WHERE lead_id = ANY($1)`, [lead_ids]);
    await q(`DELETE FROM opportunities WHERE lead_id = ANY($1)`, [lead_ids]);

    const deleted = await q(
      `DELETE FROM leads WHERE id = ANY($1) RETURNING id`,
      [lead_ids]
    );

    const count = deleted.length;

    await audit(req.user!.id, 'bulk_delete_leads', 'leads', '', {
      count,
      lead_ids,
    });

    res.json({
      success: true,
      deleted: count,
      message: `Successfully deleted ${count} lead(s)`,
    });
  } catch (err: any) {
    console.error('Bulk delete leads error:', err);
    res.status(500).json({ error: err.message || 'Failed to bulk delete leads' });
  }
});

/** Admin ability to scan and clean up existing duplicate prospects in CRM - ADMIN ONLY */
records.post('/leads/cleanup-duplicates', async (req, res) => {
  try {
    if (!isLeadAdmin(req.user)) {
      return res.status(403).json({ error: 'Only administrators can clean up duplicate prospects' });
    }

    // Find duplicates based on last 10 digits of phone number
    const dupPhoneGroups = await q<{ phone_10: string; count: number }>(`
      SELECT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) AS phone_10, COUNT(*)::int AS count
      FROM leads
      WHERE phone IS NOT NULL AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
      GROUP BY RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10)
      HAVING COUNT(*) > 1
    `);

    let removedCount = 0;
    const idsToDelete: string[] = [];

    for (const group of dupPhoneGroups) {
      const rows = await q<{ id: string }>(`
        SELECT id
        FROM leads
        WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = $1
        ORDER BY 
          (CASE WHEN converted_client_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
          (CASE WHEN assigned_agent_id IS NOT NULL OR owner_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
          (CASE WHEN status != 'New' AND status != 'DNC' THEN 1 ELSE 0 END) DESC,
          score DESC,
          created_at ASC
      `, [group.phone_10]);

      if (rows.length > 1) {
        // Keep the first (primary) one, delete the clones
        const toRemove = rows.slice(1).map(r => r.id);
        idsToDelete.push(...toRemove);
      }
    }

    // Also check duplicates by email where phone is missing or less than 10 digits
    const dupEmailGroups = await q<{ clean_email: string; count: number }>(`
      SELECT LOWER(TRIM(email)) AS clean_email, COUNT(*)::int AS count
      FROM leads
      WHERE email IS NOT NULL AND TRIM(email) != '' AND (phone IS NULL OR LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) < 10)
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    `);

    for (const group of dupEmailGroups) {
      const rows = await q<{ id: string }>(`
        SELECT id
        FROM leads
        WHERE LOWER(TRIM(email)) = $1
        ORDER BY 
          (CASE WHEN assigned_agent_id IS NOT NULL OR owner_id IS NOT NULL THEN 1 ELSE 0 END) DESC,
          score DESC,
          created_at ASC
      `, [group.clean_email]);

      if (rows.length > 1) {
        const toRemove = rows.slice(1).map(r => r.id).filter(id => !idsToDelete.includes(id));
        idsToDelete.push(...toRemove);
      }
    }

    if (idsToDelete.length > 0) {
      await q(`DELETE FROM activities WHERE related_type = 'lead' AND related_id = ANY($1)`, [idsToDelete]);
      await q(`DELETE FROM soas WHERE lead_id = ANY($1)`, [idsToDelete]);
      await q(`DELETE FROM opportunities WHERE lead_id = ANY($1)`, [idsToDelete]);
      const deleted = await q(`DELETE FROM leads WHERE id = ANY($1) RETURNING id`, [idsToDelete]);
      removedCount = deleted.length;
    }

    await audit(req.user!.id, 'cleanup_duplicates', 'leads', '', {
      removed_count: removedCount,
    });

    const totalGroups = dupPhoneGroups.length + dupEmailGroups.length;

    res.json({
      success: true,
      removed_duplicates: removedCount,
      duplicates_removed: removedCount,
      duplicate_groups_found: totalGroups,
      message: removedCount > 0 
        ? `Successfully removed ${removedCount.toLocaleString()} duplicate prospect(s). Primary records preserved.` 
        : `No duplicate prospects found. Your database is clean!`,
    });
  } catch (err: any) {
    console.error('Cleanup duplicates error:', err);
    res.status(500).json({ error: err.message || 'Failed to cleanup duplicates' });
  }
});

/** Admin ability to scan CRM database and permanently scrub all prospects without valid 10-digit phone numbers - ADMIN ONLY */
records.post('/leads/scrub-no-phones', async (req, res) => {
  try {
    if (!isLeadAdmin(req.user) && !isManager(req.user)) {
      return res.status(403).json({ error: 'Only administrators can scrub prospects' });
    }

    // Clean up dependent child activities, soas, opportunities for leads without valid 10-digit phone numbers
    await q(`DELETE FROM activities WHERE related_type = 'lead' AND related_id IN (
      SELECT id FROM leads WHERE phone IS NULL OR trim(phone) = '' OR length(regexp_replace(phone, '\\D', '', 'g')) < 10
    )`);
    await q(`DELETE FROM soas WHERE lead_id IN (
      SELECT id FROM leads WHERE phone IS NULL OR trim(phone) = '' OR length(regexp_replace(phone, '\\D', '', 'g')) < 10
    )`);
    await q(`DELETE FROM opportunities WHERE lead_id IN (
      SELECT id FROM leads WHERE phone IS NULL OR trim(phone) = '' OR length(regexp_replace(phone, '\\D', '', 'g')) < 10
    )`);
    const deleted = await q<{ id: string }>(`
      DELETE FROM leads 
      WHERE phone IS NULL OR trim(phone) = '' OR length(regexp_replace(phone, '\\D', '', 'g')) < 10
      RETURNING id
    `);

    const deletedCount = deleted.length;
    await audit(req.user!.id, 'scrub_no_phones', 'leads', '', {
      deleted_count: deletedCount,
    });

    res.json({
      success: true,
      deleted_count: deletedCount,
      message: deletedCount > 0
        ? `Successfully scrubbed and removed ${deletedCount.toLocaleString()} prospect(s) without phone numbers.`
        : `All prospects currently have verified phone numbers. No records needed scrubbing!`,
    });
  } catch (err: any) {
    console.error('Scrub no phones error:', err);
    res.status(500).json({ error: err.message || 'Failed to scrub prospects' });
  }
});

/** Outbound Schedulers explicitly assign a lead to King Amen Ra or a licensed agent */
records.post('/leads/:id/assign-agent', async (req, res) => {
  try {
    const { agent_id, status = 'Appointment Set', notes } = req.body;
    const leadId = req.params.id;
    const lead = await one<any>('SELECT * FROM leads WHERE id = $1', [leadId]);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (agent_id === '__unassign__' || agent_id === 'unassign') {
      if (!isLeadAdmin(req.user)) {
        return res.status(403).json({ error: 'Only administrators can unassign prospects' });
      }
      const updated = await update('leads', leadId, {
        owner_id: null,
        assigned_agent_id: null,
        updated_at: new Date(),
      });
      await insert('activities', {
        type: 'system',
        subject: 'Prospect Unassigned by Administrator',
        body: `Prospect was unassigned by ${req.user!.name} (${req.user!.email}) and returned to the Master List Bank unassigned pool.`,
        related_type: 'lead',
        related_id: leadId,
        user_id: req.user!.id,
        completed: true,
        meta: { unassigned_by_user_id: req.user!.id, source: 'admin_unassign_dropdown' },
      });
      return res.json({
        success: true,
        lead: updated,
        unassigned: true,
        message: 'Prospect unassigned and returned to Master List Bank',
      });
    }

    const targetAgentId = agent_id || 'u_principal';
    const agent = await one('SELECT * FROM users WHERE id = $1 AND active', [targetAgentId]);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const updated = await update('leads', leadId, {
      assigned_agent_id: agent.id,
      status: status || lead.status,
      last_contacted_at: new Date(),
    });

    const isKing = agent.id === 'u_principal' || agent.email?.toLowerCase() === 'king@iwillglobal.com';
    const agentLabel = isKing ? '👑 King Amen Ra (Principal Broker)' : agent.name;

    await insert('activities', {
      type: 'system',
      subject: `Lead Assigned to ${agentLabel}`,
      body: `Assigned by outbound scheduler ${req.user!.name} (${req.user!.email}). Notes: ${notes || 'Assigned via Scheduler Workspace'}.`,
      related_type: 'lead',
      related_id: leadId,
      user_id: req.user!.id,
      assigned_to: agent.id,
      completed: true,
      meta: { assigned_agent_id: agent.id, booked_by_user_id: req.user!.id, source: 'scheduler_assignment' },
    });

    const { notify } = await import('../services/automation.ts');
    await notify(
      agent.id,
      `Lead Assigned by ${req.user!.name}`,
      `Prospect ${lead.first_name} ${lead.last_name} (${lead.state || 'AZ'}, phone: ${lead.phone || 'N/A'}) has been assigned to you.`,
      `/leads/${leadId}`,
    );

    res.json({
      success: true,
      lead: updated,
      assigned_agent: {
        id: agent.id,
        name: agent.name,
        email: agent.email,
        title: agent.title,
        npn: agent.npn,
        is_principal: isKing,
      },
    });
  } catch (err: any) {
    console.error('Assign agent error:', err);
    res.status(500).json({ error: err.message || 'Failed to assign agent' });
  }
});

// ==========================================
// BOOK OF BUSINESS & CARRIER SEPARATION ENGINE
// ==========================================

function normalizeCarrierName(raw: any): string {
  if (!raw) return 'Other Carrier';
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower.includes('united') || lower.includes('uhc') || lower.includes('aarp')) return 'UnitedHealthcare';
  if (lower.includes('humana')) return 'Humana';
  if (lower.includes('aetna') || lower.includes('cvs')) return 'Aetna Medicare';
  if (lower.includes('wellcare') || lower.includes('centene') || lower.includes('allwell')) return 'Wellcare';
  if (lower.includes('cigna') || lower.includes('healthspring')) return 'Cigna Healthcare';
  if (lower.includes('blue cross') || lower.includes('blue shield') || lower.includes('bcbs') || lower.includes('anthem') || lower.includes('elevance')) return 'Blue Cross Blue Shield / Anthem';
  if (lower.includes('mutual') || lower.includes('omaha')) return 'Mutual of Omaha';
  if (lower.includes('devoted')) return 'Devoted Health';
  if (lower.includes('kaiser')) return 'Kaiser Permanente';
  if (lower.includes('molina')) return 'Molina Healthcare';
  if (lower.includes('silverscript')) return 'SilverScript';
  if (lower.includes('clover')) return 'Clover Health';
  if (lower.includes('scan')) return 'SCAN Health Plan';
  return s;
}

function normalizePlanType(raw: any): string {
  if (!raw) return 'Medicare Advantage';
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower.includes('supp') || lower.includes('medigap') || lower.includes('plan g') || lower.includes('plan n') || lower.includes('plan f')) return 'Medicare Supplement';
  if (lower.includes('pdp') || lower.includes('part d') || lower.includes('drug') || lower.includes('rx')) return 'Part D (PDP)';
  if (lower.includes('mapd') || lower.includes('advantage') || lower.includes('part c') || lower.includes('hmo') || lower.includes('ppo')) return 'Medicare Advantage';
  if (lower.includes('aca') || lower.includes('individual') || lower.includes('under 65') || lower.includes('obamacare') || lower.includes('marketplace')) return 'ACA / Individual Health';
  if (lower.includes('dental') || lower.includes('vision') || lower.includes('hearing') || lower.includes('dvh')) return 'Dental / Vision';
  if (lower.includes('life') || lower.includes('annuity') || lower.includes('iul') || lower.includes('final expense')) return 'Life / Annuity';
  return s || 'Medicare Advantage';
}

function normalizeDateStr(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    if (val > 25000 && val < 60000) {
      const d = new Date(Math.round((val - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let year = m[3];
    if (year.length === 2) year = Number(year) > 40 ? `19${year}` : `20${year}`;
    const month = m[1].padStart(2, '0');
    const day = m[2].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  return null;
}

function cleanPremium(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.round(val * 100) / 100;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

function getCarrierColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('united') || n.includes('uhc')) return '#002677';
  if (n.includes('humana')) return '#00754a';
  if (n.includes('aetna')) return '#d2092b';
  if (n.includes('wellcare')) return '#00843d';
  if (n.includes('cigna')) return '#0097a9';
  if (n.includes('blue') || n.includes('anthem')) return '#005596';
  if (n.includes('mutual') || n.includes('omaha')) return '#0b4ea2';
  if (n.includes('devoted')) return '#632ca6';
  if (n.includes('kaiser')) return '#0067a3';
  if (n.includes('molina')) return '#1c3f94';
  if (n.includes('silver')) return '#cc0000';
  return '#3b82f6';
}

/** Enriched Book of Business Route with Carrier Breakdown & Metrics */
records.get('/policies/book-of-business', async (req, res) => {
  try {
    const { carrier, plan_type, status, q: searchQ, limit: rawLimit, offset: rawOffset } = req.query;
    const user = req.user!;

    const conditions: string[] = [];
    const params: any[] = [];

    // Role-based scoping: licensed agents see only their own policies, managers/admins see all
    if (user.role === 'licensed_agent') {
      params.push(user.id);
      conditions.push(`(p.agent_id = $${params.length} OR p.agent_id IS NULL)`);
    }

    // Carrier separation filter
    if (carrier && carrier !== 'All') {
      params.push(carrier);
      conditions.push(`p.carrier = $${params.length}`);
    }

    // Plan Type filter
    if (plan_type && plan_type !== 'All') {
      params.push(plan_type);
      conditions.push(`p.plan_type = $${params.length}`);
    }

    // Status filter
    if (status && status !== 'All') {
      params.push(status);
      conditions.push(`p.status = $${params.length}`);
    }

    // Search query
    if (searchQ) {
      params.push(`%${String(searchQ).trim()}%`);
      const qIdx = params.length;
      conditions.push(`(
        c.first_name ILIKE $${qIdx} OR 
        c.last_name ILIKE $${qIdx} OR 
        (c.first_name || ' ' || c.last_name) ILIKE $${qIdx} OR
        p.policy_number ILIKE $${qIdx} OR 
        p.plan_name ILIKE $${qIdx} OR 
        p.carrier ILIKE $${qIdx} OR
        c.phone ILIKE $${qIdx} OR
        c.city ILIKE $${qIdx}
      )`);
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(Number(rawLimit) || 50, 500);
    const offset = Number(rawOffset) || 0;

    // 1. Main Data Query with joined Client and Agent details
    const listSql = `
      SELECT 
        p.id,
        p.client_id,
        p.agent_id,
        p.carrier,
        p.plan_name,
        p.plan_type,
        p.policy_number,
        p.status,
        p.effective_date,
        p.term_date,
        p.premium,
        p.created_at,
        c.first_name,
        c.last_name,
        (c.first_name || ' ' || c.last_name) AS client_name,
        c.phone AS client_phone,
        c.email AS client_email,
        c.city AS client_city,
        c.state AS client_state,
        c.dob AS client_dob,
        c.mbi_last4,
        u.name AS agent_name
      FROM policies p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN users u ON u.id = p.agent_id
      ${whereSql}
      ORDER BY p.effective_date DESC NULLS LAST, p.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const rows = await q(listSql, params);

    // 2. Total Count matching current filters
    const countSql = `
      SELECT count(*)::int AS n
      FROM policies p
      LEFT JOIN clients c ON c.id = p.client_id
      ${whereSql}
    `;
    const countRes = await one<{ n: number }>(countSql, params);

    // 3. Carrier Summary Breakdown (scoped by role, across all records so tabs are complete)
    const scopeCarrierParams: any[] = [];
    let scopeCarrierWhere = '';
    if (user.role === 'licensed_agent') {
      scopeCarrierParams.push(user.id);
      scopeCarrierWhere = `WHERE (agent_id = $1 OR agent_id IS NULL)`;
    }

    const carrierSummarySql = `
      SELECT 
        c.name AS carrier,
        coalesce(count(p.id), 0)::int AS total_count,
        coalesce(count(p.id) FILTER (WHERE p.status = 'Active'), 0)::int AS active_count,
        coalesce(sum(p.premium) FILTER (WHERE p.status = 'Active'), 0)::float AS total_premium
      FROM carriers c
      LEFT JOIN policies p ON LOWER(p.carrier) = LOWER(c.name) ${user.role === 'licensed_agent' ? `AND (p.agent_id = $1 OR p.agent_id IS NULL)` : ''}
      GROUP BY c.name
      ORDER BY total_count DESC, c.name ASC
    `;
    const carrierBreakdown = await q(carrierSummarySql, scopeCarrierParams);

    // 4. Overall Totals
    const overallSql = `
      SELECT 
        count(*)::int AS total_policies,
        count(*) FILTER (WHERE status = 'Active')::int AS active_policies,
        coalesce(sum(premium) FILTER (WHERE status = 'Active'), 0)::float AS monthly_premium,
        count(DISTINCT client_id)::int AS total_clients,
        count(DISTINCT carrier)::int AS total_carriers
      FROM policies
      ${scopeCarrierWhere}
    `;
    const overall = await one<any>(overallSql, scopeCarrierParams);

    res.json({
      rows,
      total: countRes?.n ?? 0,
      carrier_breakdown: carrierBreakdown || [],
      summary: overall || {
        total_policies: 0,
        active_policies: 0,
        monthly_premium: 0,
        total_clients: 0,
        total_carriers: 0,
      },
    });
  } catch (err: any) {
    console.error('Book of business query error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch book of business' });
  }
});

/** Dedicated Book of Business Ingestion (separated by carrier) */
records.post('/batch-import/book-of-business', async (req, res) => {
  try {
    const { rows: rawRows, default_carrier, default_agent_id } = req.body;
    if (!Array.isArray(rawRows) || !rawRows.length) {
      return res.status(400).json({ error: 'No book of business records provided' });
    }

    const carrierCounts: Record<string, number> = {};
    let totalImported = 0;
    const clientCache = new Map<string, string>(); // key -> client_id

    for (const raw of rawRows) {
      // 1. Parse client info
      const phone = cleanPhone(raw.phone || raw.Phone || raw['Phone Number'] || raw.mobile || raw['Cell Phone'] || '');
      let firstName = String(raw.first_name || raw.firstName || raw.FirstName || raw['First Name'] || '').trim();
      let lastName = String(raw.last_name || raw.lastName || raw.LastName || raw['Last Name'] || '').trim();
      
      const fullName = String(raw.name || raw.Name || raw['Client Name'] || raw['Insured Name'] || raw['Member Name'] || raw['Policyholder'] || '').trim();
      if ((!firstName || firstName === 'Client') && fullName) {
        const parts = fullName.split(' ');
        firstName = parts[0] || 'Client';
        lastName = parts.slice(1).join(' ') || 'Policyholder';
      }
      if (!firstName) firstName = 'Client';
      if (!lastName) lastName = 'Policyholder';

      const email = raw.email || raw.Email || raw['Email Address'] || null;
      const city = raw.city || raw.City || null;
      const state = String(raw.state || raw.State || raw.ST || 'AZ').toUpperCase();
      const zip = raw.zip || raw.Zip || raw['Zip Code'] || raw['ZIP'] || null;
      const county = raw.county || raw.County || null;
      const address = raw.address || raw.Address || raw['Street Address'] || null;
      const dob = normalizeDateStr(raw.dob || raw.DOB || raw['Date of Birth'] || raw['Birth Date']);
      const mbiRaw = raw.mbi_last4 || raw.mbi || raw.MBI || raw['Medicare Number'] || raw['MBI'] || '';
      const mbiLast4 = mbiRaw ? String(mbiRaw).slice(-4) : null;

      // 2. Resolve Client ID
      const cacheKey = phone ? `p_${phone}` : (email ? `e_${email}` : `n_${firstName.toLowerCase()}_${lastName.toLowerCase()}_${state}`);
      let clientId = clientCache.get(cacheKey) || '';

      if (!clientId) {
        let existingClient: any = null;
        if (phone) {
          existingClient = await one('SELECT id FROM clients WHERE phone = $1 LIMIT 1', [phone]);
        }
        if (!existingClient && email) {
          existingClient = await one('SELECT id FROM clients WHERE email = $1 LIMIT 1', [email]);
        }
        if (!existingClient && firstName && lastName) {
          existingClient = await one(
            'SELECT id FROM clients WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) AND state = $3 LIMIT 1',
            [firstName, lastName, state]
          );
        }

        if (existingClient) {
          clientId = existingClient.id;
        } else {
          clientId = uid();
          await insert('clients', {
            id: clientId,
            first_name: firstName,
            last_name: lastName,
            phone: phone || null,
            email: email || null,
            dob: dob || null,
            address: address || null,
            city: city || null,
            state: state || 'AZ',
            zip: zip || null,
            county: county || null,
            mbi_last4: mbiLast4 || null,
            status: 'Active',
            source: 'Book of Business Import',
            owner_id: default_agent_id || req.user!.id,
            tcpa_consent: true,
          });
        }
        clientCache.set(cacheKey, clientId);
      }

      // 3. Parse & Normalize Policy Details
      const rawCarrier = raw.carrier || raw.Carrier || raw.company || raw.Company || raw.payer || raw.Payer || raw['Carrier Name'] || raw['Company Name'] || default_carrier || 'Other Carrier';
      const carrier = normalizeCarrierName(rawCarrier);
      const planName = String(raw.plan_name || raw.plan || raw['Plan Name'] || raw.product || raw['Product Name'] || raw['Plan'] || `${carrier} Medicare Plan`).trim();
      const planType = normalizePlanType(raw.plan_type || raw['Plan Type'] || raw.line || raw['Line of Business'] || raw['Product Type'] || '');
      const policyNumber = String(raw.policy_number || raw.policy_no || raw['Policy Number'] || raw['Policy #'] || raw.member_id || raw['Member ID'] || raw.contract_id || raw['Contract ID'] || '').trim() || null;
      const effectiveDate = normalizeDateStr(raw.effective_date || raw.eff_date || raw['Effective Date'] || raw['Start Date'] || raw['Coverage Start']);
      const termDate = normalizeDateStr(raw.term_date || raw['Term Date'] || raw['Termination Date'] || raw['End Date']);
      const premium = cleanPremium(raw.premium || raw['Monthly Premium'] || raw['Premium'] || raw.rate || raw['Rate'] || 0);

      const rawStatus = String(raw.status || raw.Status || raw['Policy Status'] || raw['Status'] || 'Active').toLowerCase();
      let status = 'Active';
      if (rawStatus.includes('term') || rawStatus.includes('canc') || rawStatus.includes('lapse')) status = 'Terminated';
      else if (rawStatus.includes('pend') || rawStatus.includes('sub')) status = 'Pending';

      const agentId = raw.agent_id || default_agent_id || req.user!.id;

      // 4. Insert Policy
      const policyId = uid();
      await insert('policies', {
        id: policyId,
        client_id: clientId,
        agent_id: agentId,
        carrier,
        plan_name: planName,
        plan_type: planType,
        policy_number: policyNumber,
        status,
        effective_date: effectiveDate,
        term_date: termDate,
        premium,
        submitted_at: effectiveDate ? new Date(effectiveDate) : new Date(),
      });

      // 5. Track Carrier Counts & Ensure Carrier Registry
      carrierCounts[carrier] = (carrierCounts[carrier] || 0) + 1;
      totalImported++;

      const carrierSlug = 'c_' + carrier.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
      try {
        await q(`
          INSERT INTO carriers (id, name, lines, color)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO NOTHING
        `, [carrierSlug, carrier, JSON.stringify(['MA', 'MAPD', 'Medigap', 'PDP']), getCarrierColor(carrier)]);
      } catch {
        // ignore conflict
      }
    }

    await audit(req.user!.id, 'book_of_business_import', 'policies', '', {
      total: totalImported,
      carriers: carrierCounts,
      default_carrier: default_carrier || 'Auto-Detected',
    });

    res.json({
      success: true,
      imported: totalImported,
      carriers_breakdown: carrierCounts,
    });
  } catch (err: any) {
    console.error('Book of business import error:', err);
    res.status(500).json({ error: err.message || 'Failed to import book of business' });
  }
});

function getDef(name: string, user: AuthUser): ObjectDef {
  const def = OBJECTS[name];
  if (!def) throw Object.assign(new Error(`Unknown object '${name}'`), { status: 404 });
  if (!def.roles.includes(user.role)) throw Object.assign(new Error('Your role cannot access this object'), { status: 403 });
  return def;
}

const colRe = /^[a-z_]+$/;

/** Build WHERE clause from query params: q, f_<col>, f_<col>__gte/__lte/__null/__ne. */
export function buildWhere(def: ObjectDef, user: AuthUser, query: Record<string, any>) {
  const where: string[] = [];
  const params: any[] = [];
  const p = (v: any) => { params.push(v); return `$${params.length}`; };
  const scope = def.scope?.(user);
  if (scope) where.push(scope.replaceAll('$U', p(user.id)));
  const allowed = filterableColumns(def);
  for (const [key, raw] of Object.entries(query)) {
    if (!key.startsWith('f_')) continue;
    const [col, op] = key.slice(2).split('__');
    if (!colRe.test(col) || !allowed.has(col)) continue;
    const val = String(raw);
    if (op === 'gte') where.push(`t."${col}" >= ${p(val)}`);
    else if (op === 'lte') where.push(`t."${col}" <= ${p(val)}`);
    else if (op === 'ne') where.push(`t."${col}" IS DISTINCT FROM ${p(val)}`);
    else if (op === 'null') where.push(`t."${col}" IS ${val === 'true' ? '' : 'NOT '}NULL`);
    else if (val.includes(',')) where.push(`t."${col}"::text = ANY(${p(val.split(','))})`);
    else if (val === 'true' || val === 'false') where.push(`t."${col}" = ${p(val === 'true')}`);
    else where.push(`t."${col}"::text = ${p(val)}`);
  }
  if (query.q && def.search.length) {
    const term = p(`%${String(query.q).trim()}%`);
    const parts = def.search.map((c) => `t."${c}"::text ILIKE ${term}`);
    if (def.search.includes('first_name')) parts.push(`(t.first_name || ' ' || t.last_name) ILIKE ${term}`);
    where.push(`(${parts.join(' OR ')})`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

records.get('/:object', async (req, res) => {
  const def = getDef(req.params.object, req.user!);
  const { sql, params } = buildWhere(def, req.user!, req.query as any);
  let sort = def.defaultSort;
  const s = String(req.query.sort || '');
  if (s) {
    const [col, dir] = s.split(':');
    if (colRe.test(col) && filterableColumns(def).has(col)) sort = `"${col}" ${dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST`;
  }
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const rows = await q(`SELECT t.* FROM ${def.table} t ${sql} ORDER BY ${sort} LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${def.table} t ${sql}`, params);
  res.json({ rows: rows.map((r) => redact(def, r, req.user!)), total: total?.n ?? 0 });
});

async function fetchScoped(def: ObjectDef, user: AuthUser, id: string) {
  const { sql, params } = buildWhere(def, user, {});
  params.push(id);
  const cond = sql ? `${sql} AND t.id = $${params.length}` : `WHERE t.id = $${params.length}`;
  return one(`SELECT t.* FROM ${def.table} t ${cond}`, params);
}

records.get('/:object/:id', async (req, res) => {
  const def = getDef(req.params.object, req.user!);
  const row = await fetchScoped(def, req.user!, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(redact(def, row, req.user!));
});

/** Related lists + activity timeline for a record page. */
records.get('/:object/:id/related', async (req, res) => {
  const def = getDef(req.params.object, req.user!);
  const row = await fetchScoped(def, req.user!, req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const id = req.params.id;
  const type = req.params.object.replace(/s$/, '').replace(/ie$/, 'y'); // leads->lead, opportunities->opportunity
  const out: Record<string, any> = {};
  const relatedIds = [id];
  if (def.table === 'clients' && row.lead_id) relatedIds.push(row.lead_id);
  if (def.table === 'leads' && row.converted_client_id) relatedIds.push(row.converted_client_id);
  out.activities = await q(
    `SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.related_id = ANY($1) ORDER BY COALESCE(a.due_at, a.created_at) DESC LIMIT 200`, [relatedIds]);
  out.feed = await q(
    `SELECT f.*, u.name AS user_name FROM feed_posts f LEFT JOIN users u ON u.id = f.user_id
     WHERE f.related_id = $1 ORDER BY f.created_at DESC`, [id]);
  out.soas = await q(`SELECT * FROM soas WHERE lead_id = ANY($1) OR client_id = ANY($1) ORDER BY created_at DESC`, [relatedIds]);
  const licensed = req.user!.role !== 'scheduler';
  if (def.table === 'clients' && licensed) {
    out.policies = await q(`SELECT * FROM policies WHERE client_id=$1 ORDER BY effective_date DESC`, [id]);
    out.opportunities = await q(`SELECT * FROM opportunities WHERE client_id=$1 ORDER BY updated_at DESC`, [id]);
    out.health_items = await q(`SELECT * FROM health_items WHERE client_id=$1 ORDER BY kind, name`, [id]);
    out.commissions = await q(
      `SELECT c.* FROM commissions c JOIN policies p ON p.id=c.policy_id WHERE p.client_id=$1 ORDER BY c.period DESC`, [id]);
  }
  if (def.table === 'opportunities' && licensed) {
    out.policies = await q(`SELECT * FROM policies WHERE opportunity_id=$1`, [id]);
    if (row.client_id) out.client = await one(`SELECT * FROM clients WHERE id=$1`, [row.client_id]);
  }
  if (def.table === 'leads' && row.campaign_id) out.campaign = await one(`SELECT * FROM campaigns WHERE id=$1`, [row.campaign_id]);
  out.type = type;
  res.json(out);
});

function pick(def: ObjectDef, body: any) {
  const data: Record<string, any> = {};
  for (const f of def.fields) if (body[f] !== undefined) data[f] = body[f] === '' ? null : body[f];
  return data;
}

function assertWritable(def: ObjectDef, user: AuthUser) {
  if (def.readOnlyFor?.includes(user.role)) throw Object.assign(new Error('Read-only for your role'), { status: 403 });
}

records.post('/:object', async (req, res) => {
  const def = getDef(req.params.object, req.user!);
  assertWritable(def, req.user!);
  const data = pick(def, req.body);
  // Default ownership
  if (['leads', 'clients', 'opportunities'].includes(def.table) && !data.owner_id) data.owner_id = req.user!.id;
  if (def.table === 'policies' && !data.agent_id) data.agent_id = req.user!.id;
  if (def.table === 'soas' && !data.agent_id) data.agent_id = req.user!.id;
  if (def.table === 'activities') data.user_id = req.user!.id;
  if (def.table === 'leads') Object.assign(data, scoreLead({ ...data, attempts: 0 }));
  if (def.table === 'soas') data.token = crypto.randomUUID().replace(/-/g, '');
  const row = await insert(def.table, data);
  await audit(req.user!.id, 'create', def.table, row.id);
  res.status(201).json(row);
});

records.patch('/:object/:id', async (req, res) => {
  const def = getDef(req.params.object, req.user!);
  assertWritable(def, req.user!);
  const existing = await fetchScoped(def, req.user!, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const data = pick(def, req.body);
  if (def.table === 'opportunities' && data.stage && data.stage !== existing.stage) data.stage_changed_at = new Date();
  if (def.table === 'leads') Object.assign(data, scoreLead({ ...existing, ...data }));
  if (def.table === 'leads' && data.tcpa_consent === true && !existing.tcpa_consent) data.consent_at = new Date();
  const row = await update(def.table, req.params.id, data);
  await audit(req.user!.id, 'update', def.table, req.params.id, { fields: Object.keys(data) });
  res.json(row);
});

records.delete('/:object/:id', async (req, res) => {
  const def = getDef(req.params.object, req.user!);
  assertWritable(def, req.user!);
  if (def.table === 'leads' && !isLeadAdmin(req.user)) {
    return res.status(403).json({ error: 'Only administrators can delete or remove leads' });
  }
  if (!isManager(req.user) && ['clients', 'policies', 'commissions'].includes(def.table)) {
    return res.status(403).json({ error: 'Only managers can delete this record' });
  }
  const existing = await fetchScoped(def, req.user!, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (def.table === 'leads') {
    await q(`DELETE FROM activities WHERE related_type = 'lead' AND related_id = $1`, [req.params.id]);
    await q(`DELETE FROM soas WHERE lead_id = $1`, [req.params.id]);
    await q(`DELETE FROM opportunities WHERE lead_id = $1`, [req.params.id]);
  }
  await q(`DELETE FROM ${def.table} WHERE id=$1`, [req.params.id]);
  await audit(req.user!.id, 'delete', def.table, req.params.id);
  res.json({ ok: true });
});

/** Bulk update (assign owner, change status) — managers or own records. */
records.post('/:object/bulk', async (req, res) => {
  const def = getDef(req.params.object, req.user!);
  assertWritable(def, req.user!);
  const ids: string[] = req.body.ids || [];
  const data = pick(def, req.body.data || {});
  let n = 0;
  for (const id of ids) {
    if (await fetchScoped(def, req.user!, id)) { await update(def.table, id, data); n++; }
  }
  await audit(req.user!.id, 'bulk_update', def.table, '', { count: n, fields: Object.keys(data) });
  res.json({ updated: n });
});

/** Mask sensitive fields for roles that should not see them. */
function redact(def: ObjectDef, row: any, user: AuthUser) {
  if (def.table === 'clients' && user.role === 'scheduler') {
    return { ...row, mbi_last4: row.mbi_last4 ? '••••' : null, medicaid_level: null, notes: null };
  }
  return row;
}
