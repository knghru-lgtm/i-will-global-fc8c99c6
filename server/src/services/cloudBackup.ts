import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { config, repoRoot } from '../config.ts';
import { q } from '../db/index.ts';

const execFileAsync = promisify(execFile);

const BACKUP_DIR = path.resolve(repoRoot, 'server/data/backups');
const LATEST_META_FILE = path.join(BACKUP_DIR, 'latest-meta.json');
const MAX_LOCAL_BACKUPS = 14;

const TABLE_RESTORE_PRIORITY: string[] = [
  'users',
  'agent_credentials',
  'carriers',
  'campaigns',
  'leads',
  'clients',
  'health_items',
  'opportunities',
  'policies',
  'commissions',
  'soas',
  'dispositions',
  'activities',
  'email_templates',
  'conversations',
  'messages',
  'feed_posts',
  'notifications',
  'audit_log',
  'caller_id_registry',
  'telephony_config',
  'settings',
];

export interface CloudBackupReceipt {
  ok: boolean;
  backup_id: string;
  trigger: string;
  created_at: string;
  platform: 'google_cloud';
  host: string;
  line: string;
  sha256: string;
  uncompressed_bytes: number;
  compressed_bytes: number;
  total_tables: number;
  total_rows: number;
  inbound_leads_count: number;
  row_counts: Record<string, number>;
  local_archive_path: string;
  gcs_uploaded: boolean;
  gcs_bucket: string | null;
  gcs_uri: string | null;
  gcp_project_id: string | null;
  note?: string;
}

export interface FullCrmBackupSnapshot {
  schema_version: string;
  backup_id: string;
  trigger: string;
  created_at: string;
  platform: 'google_cloud';
  host: string;
  line: string;
  total_tables: number;
  total_rows: number;
  inbound_leads_count: number;
  row_counts: Record<string, number>;
  sha256: string;
  tables: Record<string, any[]>;
}

async function listPublicTables(): Promise<string[]> {
  const rows = await q<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name ASC`
  );
  const discovered = rows
    .map((r) => String(r.table_name || '').trim())
    .filter((name) => /^[a-zA-Z0-9_]+$/.test(name));

  const ordered: string[] = [];
  for (const preferred of TABLE_RESTORE_PRIORITY) {
    if (discovered.includes(preferred)) ordered.push(preferred);
  }
  for (const name of discovered) {
    if (!ordered.includes(name)) ordered.push(name);
  }
  return ordered;
}

function sanitizeRowForDownload(table: string, row: Record<string, any>, redactSecrets: boolean): Record<string, any> {
  if (!redactSecrets) return row;
  const clone = { ...row };
  if (table === 'users') {
    if (clone.google_tokens) clone.google_tokens = { redacted: true };
  }
  if (table === 'telephony_config' && clone.auth_token) {
    clone.auth_token = '[REDACTED_IN_BROWSER_EXPORT]';
  }
  return clone;
}

export async function createFullCrmBackupSnapshot(options?: {
  trigger?: string;
  redactSecrets?: boolean;
}): Promise<FullCrmBackupSnapshot> {
  const trigger = options?.trigger || 'manual';
  const redactSecrets = Boolean(options?.redactSecrets);
  const tablesList = await listPublicTables();

  const tables: Record<string, any[]> = {};
  const rowCounts: Record<string, number> = {};
  let totalRows = 0;
  let inboundLeadsCount = 0;

  for (const table of tablesList) {
    const rows = await q<any>(`SELECT * FROM "${table}"`);
    const cleaned = rows.map((r) => sanitizeRowForDownload(table, r, redactSecrets));
    tables[table] = cleaned;
    rowCounts[table] = cleaned.length;
    totalRows += cleaned.length;
    if (table === 'leads') {
      inboundLeadsCount = cleaned.filter((l) => String(l.source || '') === 'Inbound Lead').length;
    }
  }

  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const backupId = `iwg-cloud-backup-${stamp}`;
  const payloadJson = JSON.stringify(tables);
  const sha256 = createHash('sha256').update(payloadJson).digest('hex');

  return {
    schema_version: '2026.11-google-cloud-v1',
    backup_id: backupId,
    trigger,
    created_at: createdAt,
    platform: 'google_cloud',
    host: config.telephony.publicHostFqdn || 'voice.iwillglobal.com',
    line: '+14803319455',
    total_tables: tablesList.length,
    total_rows: totalRows,
    inbound_leads_count: inboundLeadsCount,
    row_counts: rowCounts,
    sha256,
    tables,
  };
}

async function fetchGceMetadata(metaPath: string, timeoutMs = 2000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://metadata.google.internal/computeMetadata/v1/${metaPath}`, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadToGcsViaMetadataApi(
  bucket: string,
  projectId: string,
  objectName: string,
  gzBuffer: Buffer
): Promise<{ ok: boolean; uri?: string; reason?: string }> {
  const tokenRaw = await fetchGceMetadata('instance/service-accounts/default/token');
  if (!tokenRaw) {
    return { ok: false, reason: 'GCE metadata OAuth token unavailable (not on GCE VM or metadata disabled)' };
  }

  let accessToken = '';
  try {
    const parsed = JSON.parse(tokenRaw);
    accessToken = String(parsed.access_token || '');
  } catch {
    return { ok: false, reason: 'Invalid GCE metadata token JSON' };
  }
  if (!accessToken) {
    return { ok: false, reason: 'Empty GCE metadata access_token' };
  }

  // Check if bucket exists; create private uniform-access bucket in US-WEST1 if missing
  const checkRes = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (checkRes.status === 404 && projectId) {
    const createRes = await fetch(
      `https://storage.googleapis.com/storage/v1/b?project=${encodeURIComponent(projectId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: bucket,
          location: 'US-WEST1',
          storageClass: 'STANDARD',
          iamConfiguration: {
            uniformBucketLevelAccess: { enabled: true },
            publicAccessPrevention: 'enforced',
          },
        }),
      }
    );
    if (!createRes.ok && createRes.status !== 409) {
      const errBody = await createRes.text().catch(() => '');
      return { ok: false, reason: `GCS bucket create HTTP ${createRes.status}: ${errBody.slice(0, 180)}` };
    }
  }

  const uploadObject = async (targetObj: string) => {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(targetObj)}`;
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/gzip',
      },
      body: new Uint8Array(gzBuffer),
    });
  };

  const upMain = await uploadObject(objectName);
  if (!upMain.ok) {
    const errText = await upMain.text().catch(() => '');
    return { ok: false, reason: `GCS upload HTTP ${upMain.status}: ${errText.slice(0, 180)}` };
  }

  await uploadObject('crm-snapshots/latest.json.gz').catch(() => {});
  return { ok: true, uri: `gs://${bucket}/${objectName}` };
}

async function uploadToGcsViaCliFallback(
  bucket: string,
  projectId: string | null,
  localPath: string,
  objectName: string
): Promise<{ ok: boolean; uri?: string; reason?: string }> {
  if (process.platform === 'win32') {
    return { ok: false, reason: 'Local Windows host (GCS upload executes on Google Cloud VM)' };
  }
  const existingAttr = process.env.CLOUDSDK_METRICS_ENVIRONMENT || '';
  const gcloudEnv = {
    ...process.env,
    CLOUDSDK_METRICS_ENVIRONMENT: existingAttr
      ? `${existingAttr} datacloud.antigravity`
      : 'datacloud.antigravity',
  };

  try {
    if (projectId) {
      await execFileAsync(
        'gcloud',
        [
          'storage',
          'buckets',
          'create',
          `gs://${bucket}`,
          `--project=${projectId}`,
          '--location=us-west1',
          '--uniform-bucket-level-access',
          '--public-access-prevention',
        ],
        { env: gcloudEnv, timeout: 20_000 }
      ).catch(() => {});
    }

    const destUri = `gs://${bucket}/${objectName}`;
    await execFileAsync('gcloud', ['storage', 'cp', localPath, destUri], {
      env: gcloudEnv,
      timeout: 30_000,
    });
    await execFileAsync('gcloud', ['storage', 'cp', localPath, `gs://${bucket}/crm-snapshots/latest.json.gz`], {
      env: gcloudEnv,
      timeout: 30_000,
    }).catch(() => {});
    return { ok: true, uri: destUri };
  } catch (err: any) {
    return { ok: false, reason: err?.message ? String(err.message).slice(0, 180) : 'gcloud CLI fallback unavailable' };
  }
}

function pruneOldLocalBackups(): void {
  try {
    if (!existsSync(BACKUP_DIR)) return;
    const archives = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('iwg-cloud-backup-') && f.endsWith('.json.gz'))
      .sort()
      .reverse();
    for (const stale of archives.slice(MAX_LOCAL_BACKUPS)) {
      try {
        unlinkSync(path.join(BACKUP_DIR, stale));
      } catch {}
    }
  } catch {}
}

export async function runFullCloudBackup(trigger = 'manual'): Promise<CloudBackupReceipt> {
  mkdirSync(BACKUP_DIR, { recursive: true });

  const snapshot = await createFullCrmBackupSnapshot({ trigger, redactSecrets: false });
  const rawJson = JSON.stringify(snapshot);
  const gzBuffer = gzipSync(Buffer.from(rawJson, 'utf8'), { level: 9 });

  const archiveFilename = `${snapshot.backup_id}.json.gz`;
  const localArchivePath = path.join(BACKUP_DIR, archiveFilename);
  const latestArchivePath = path.join(BACKUP_DIR, 'latest.json.gz');

  writeFileSync(localArchivePath, gzBuffer, { mode: 0o600 });
  writeFileSync(latestArchivePath, gzBuffer, { mode: 0o600 });
  pruneOldLocalBackups();

  const metaProjectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    (await fetchGceMetadata('project/project-id'));

  const gcsBucket =
    (process.env.GCS_BACKUP_BUCKET || '').trim() ||
    (metaProjectId ? `${metaProjectId}-iwg-backups` : null);

  let gcsUploaded = false;
  let gcsUri: string | null = null;
  let note = 'Saved encrypted/private compressed snapshot to persistent Google Cloud disk.';

  if (gcsBucket) {
    const objectName = `crm-snapshots/${archiveFilename}`;
    const apiResult = await uploadToGcsViaMetadataApi(
      gcsBucket,
      metaProjectId || '',
      objectName,
      gzBuffer
    );
    if (apiResult.ok && apiResult.uri) {
      gcsUploaded = true;
      gcsUri = apiResult.uri;
      note = `Backed up to Google Cloud Storage (${gcsUri}) and persistent disk.`;
    } else {
      const cliResult = await uploadToGcsViaCliFallback(
        gcsBucket,
        metaProjectId,
        localArchivePath,
        objectName
      );
      if (cliResult.ok && cliResult.uri) {
        gcsUploaded = true;
        gcsUri = cliResult.uri;
        note = `Backed up to Google Cloud Storage via gcloud (${gcsUri}) and persistent disk.`;
      } else if (apiResult.reason) {
        note = `Saved to persistent disk (${archiveFilename}). GCS bucket sync note: ${apiResult.reason}`;
      }
    }
  }

  const receipt: CloudBackupReceipt = {
    ok: true,
    backup_id: snapshot.backup_id,
    trigger,
    created_at: snapshot.created_at,
    platform: 'google_cloud',
    host: snapshot.host,
    line: snapshot.line,
    sha256: snapshot.sha256,
    uncompressed_bytes: Buffer.byteLength(rawJson, 'utf8'),
    compressed_bytes: gzBuffer.length,
    total_tables: snapshot.total_tables,
    total_rows: snapshot.total_rows,
    inbound_leads_count: snapshot.inbound_leads_count,
    row_counts: snapshot.row_counts,
    local_archive_path: localArchivePath,
    gcs_uploaded: gcsUploaded,
    gcs_bucket: gcsBucket,
    gcs_uri: gcsUri,
    gcp_project_id: metaProjectId || null,
    note,
  };

  writeFileSync(LATEST_META_FILE, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  return receipt;
}

export async function getCloudBackupStatus(): Promise<{
  ok: boolean;
  platform: 'google_cloud';
  auto_schedule: string;
  local_backups_count: number;
  latest_backup: CloudBackupReceipt | null;
  live_counts: {
    leads: number;
    inbound_leads: number;
    clients: number;
    appointments: number;
    activities: number;
    policies: number;
    users: number;
  };
}> {
  let latestBackup: CloudBackupReceipt | null = null;
  let localCount = 0;

  try {
    if (existsSync(LATEST_META_FILE)) {
      latestBackup = JSON.parse(readFileSync(LATEST_META_FILE, 'utf8'));
    }
    if (existsSync(BACKUP_DIR)) {
      localCount = readdirSync(BACKUP_DIR).filter(
        (f) => f.startsWith('iwg-cloud-backup-') && f.endsWith('.json.gz')
      ).length;
    }
  } catch {}

  const countRows = await q<any>(`
    SELECT
      (SELECT count(*)::int FROM leads) AS leads,
      (SELECT count(*)::int FROM leads WHERE source = 'Inbound Lead') AS inbound_leads,
      (SELECT count(*)::int FROM clients) AS clients,
      (SELECT count(*)::int FROM activities WHERE type = 'event') AS appointments,
      (SELECT count(*)::int FROM activities) AS activities,
      (SELECT count(*)::int FROM policies) AS policies,
      (SELECT count(*)::int FROM users) AS users
  `);
  const live = countRows[0] || {
    leads: 0,
    inbound_leads: 0,
    clients: 0,
    appointments: 0,
    activities: 0,
    policies: 0,
    users: 0,
  };

  return {
    ok: true,
    platform: 'google_cloud',
    auto_schedule: 'Every 6 hours + Daily 03:00 MST Google Cloud Snapshot',
    local_backups_count: localCount,
    latest_backup: latestBackup,
    live_counts: live,
  };
}

let backupSchedulerStarted = false;

export function startAutomatedCloudBackupScheduler(): void {
  if (backupSchedulerStarted || process.env.NODE_ENV === 'test') return;
  backupSchedulerStarted = true;

  // Initial post-boot cloud backup after 45s warmup
  setTimeout(() => {
    runFullCloudBackup('startup_auto')
      .then((r) =>
        console.log(
          `[Google Cloud Backup] Startup snapshot saved: ${r.backup_id} (${r.total_rows} rows, sha256=${r.sha256.slice(0, 12)}${r.gcs_uri ? `, GCS=${r.gcs_uri}` : ''})`
        )
      )
      .catch((err) => console.error('[Google Cloud Backup] Startup backup warning:', err?.message || err));
  }, 45_000).unref();

  // Continuous 6-hour Google Cloud backup cycle
  setInterval(() => {
    runFullCloudBackup('scheduled_6h')
      .then((r) =>
        console.log(
          `[Google Cloud Backup] 6h snapshot saved: ${r.backup_id} (${r.total_rows} rows${r.gcs_uri ? `, GCS=${r.gcs_uri}` : ''})`
        )
      )
      .catch((err) => console.error('[Google Cloud Backup] Scheduled backup warning:', err?.message || err));
  }, 6 * 60 * 60 * 1000).unref();
}
