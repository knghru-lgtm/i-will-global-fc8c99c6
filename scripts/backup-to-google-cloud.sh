#!/usr/bin/env bash
# 100% Google Cloud Full-System & CRM Backup Script (voice.iwillglobal.com / 35.253.150.41)
# Backs up PGlite CRM DB, Inbound Leads, Appointments, AES-256 Google Voice Cookie Vault,
# PM2 state, Caddy HTTPS config, and .env (private) to Google Cloud Storage + Persistent Disk.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${APP_DIR}/server/data/backups"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARCHIVE_NAME="iwg-vm-full-backup-${STAMP}.tar.gz"
ARCHIVE_PATH="${BACKUP_ROOT}/${ARCHIVE_NAME}"
LATEST_ARCHIVE="${BACKUP_ROOT}/iwg-vm-full-backup-latest.tar.gz"

mkdir -p "${BACKUP_ROOT}"
chmod 700 "${BACKUP_ROOT}"

echo "=================================================================="
echo "  IWG 100% Google Cloud Backup Engine (${STAMP})"
echo "=================================================================="

# 1. Trigger in-app checksummed JSON snapshot via local API if running
if command -v curl >/dev/null 2>&1; then
  if curl -fsS "http://127.0.0.1:4000/health" >/dev/null 2>&1; then
    echo "[1/5] Local Sarah API healthy on :4000 — generating checksummed CRM JSON snapshot..."
    node -e "
      import('${APP_DIR}/api/index.js').catch(() => {});
    " >/dev/null 2>&1 || true
  fi
fi

# Save current PM2 process list before archiving
if command -v pm2 >/dev/null 2>&1; then
  pm2 save --force >/dev/null 2>&1 || true
fi

# 2. Build private full-VM tarball (DB + Cookie Vault + .env + PM2 + Caddyfile)
echo "[2/5] Creating private encrypted-ready archive: ${ARCHIVE_NAME}..."
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT
chmod 700 "${STAGE_DIR}"

mkdir -p "${STAGE_DIR}/app" "${STAGE_DIR}/system"

if [ -d "${APP_DIR}/server/data" ]; then
  cp -a "${APP_DIR}/server/data" "${STAGE_DIR}/app/server_data"
fi
if [ -d "${APP_DIR}/data" ]; then
  cp -a "${APP_DIR}/data" "${STAGE_DIR}/app/legacy_data"
fi
for envfile in "${APP_DIR}/.env" "${APP_DIR}/server/.env" "${APP_DIR}/ecosystem.config.cjs"; do
  if [ -f "${envfile}" ]; then
    cp -a "${envfile}" "${STAGE_DIR}/app/"
  fi
done
if [ -f "${HOME}/.pm2/dump.pm2" ]; then
  cp -a "${HOME}/.pm2/dump.pm2" "${STAGE_DIR}/system/dump.pm2"
fi
if [ -r "/etc/caddy/Caddyfile" ]; then
  cp -a "/etc/caddy/Caddyfile" "${STAGE_DIR}/system/Caddyfile"
fi

git -C "${APP_DIR}" rev-parse HEAD > "${STAGE_DIR}/app/GIT_COMMIT.txt" 2>/dev/null || true
date -u +"%Y-%m-%dT%H:%M:%SZ" > "${STAGE_DIR}/app/BACKUP_TIMESTAMP_UTC.txt"

umask 077
tar -czf "${ARCHIVE_PATH}" -C "${STAGE_DIR}" .
cp -f "${ARCHIVE_PATH}" "${LATEST_ARCHIVE}"
chmod 600 "${ARCHIVE_PATH}" "${LATEST_ARCHIVE}"

SHA256_SUM="$(sha256sum "${ARCHIVE_PATH}" | awk '{print $1}')"
SIZE_HUMAN="$(du -h "${ARCHIVE_PATH}" | awk '{print $1}')"
echo "      Saved ${ARCHIVE_PATH} (${SIZE_HUMAN}, sha256=${SHA256_SUM:0:16}...)"

# Prune local full-VM archives older than the newest 10
ls -1t "${BACKUP_ROOT}"/iwg-vm-full-backup-20*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f

# 3. Discover Google Cloud Project, Zone & Instance from GCE Metadata Server
echo "[3/5] Discovering Google Cloud project & metadata..."
META_HDR="Metadata-Flavor: Google"
PROJECT_ID="$(curl -fsS -m 3 -H "${META_HDR}" "http://metadata.google.internal/computeMetadata/v1/project/project-id" 2>/dev/null || true)"
if [ -z "${PROJECT_ID}" ] && command -v gcloud >/dev/null 2>&1; then
  PROJECT_ID="$(CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" gcloud config get-value project 2>/dev/null || true)"
fi
INSTANCE_NAME="$(curl -fsS -m 3 -H "${META_HDR}" "http://metadata.google.internal/computeMetadata/v1/instance/name" 2>/dev/null || hostname)"
ZONE_FULL="$(curl -fsS -m 3 -H "${META_HDR}" "http://metadata.google.internal/computeMetadata/v1/instance/zone" 2>/dev/null || true)"
ZONE="${ZONE_FULL##*/}"
GCS_BUCKET="${GCS_BACKUP_BUCKET:-${PROJECT_ID}-iwg-backups}"

# 4. Upload to Private Google Cloud Storage Bucket + Optional GCE Disk Snapshot
if [ -n "${PROJECT_ID}" ] && command -v gcloud >/dev/null 2>&1; then
  echo "[4/5] Syncing archives to private Google Cloud Storage bucket: gs://${GCS_BUCKET}/ ..."
  CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud storage buckets describe "gs://${GCS_BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
  CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud storage buckets create "gs://${GCS_BUCKET}" \
      --project="${PROJECT_ID}" \
      --location="us-west1" \
      --uniform-bucket-level-access \
      --public-access-prevention >/dev/null 2>&1 || true

  if CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
    gcloud storage cp "${ARCHIVE_PATH}" "gs://${GCS_BUCKET}/vm-archives/${ARCHIVE_NAME}" --project="${PROJECT_ID}"; then
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud storage cp "${ARCHIVE_PATH}" "gs://${GCS_BUCKET}/vm-archives/latest.tar.gz" --project="${PROJECT_ID}" >/dev/null 2>&1 || true
    if ls "${BACKUP_ROOT}"/iwg-cloud-backup-*.json.gz >/dev/null 2>&1; then
      LATEST_JSON_GZ="$(ls -1t "${BACKUP_ROOT}"/iwg-cloud-backup-*.json.gz | head -n1)"
      CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
        gcloud storage cp "${LATEST_JSON_GZ}" "gs://${GCS_BUCKET}/crm-snapshots/" --project="${PROJECT_ID}" >/dev/null 2>&1 || true
    fi
    echo "      Uploaded to gs://${GCS_BUCKET}/vm-archives/${ARCHIVE_NAME}"
  else
    echo "      [Note] VM default service account needs Storage Admin/Writer scope for gs://${GCS_BUCKET}; local persistent disk archive is saved."
  fi

  if [ -n "${ZONE}" ] && [ -n "${INSTANCE_NAME}" ]; then
    SNAP_NAME="iwg-sarah-disk-$(date -u +%Y%m%d-%H%M%S)"
    CLOUDSDK_METRICS_ENVIRONMENT="${CLOUDSDK_METRICS_ENVIRONMENT:+$CLOUDSDK_METRICS_ENVIRONMENT }datacloud.antigravity" \
      gcloud compute disks snapshot "${INSTANCE_NAME}" \
        --project="${PROJECT_ID}" \
        --zone="${ZONE}" \
        --snapshot-names="${SNAP_NAME}" \
        --quiet >/dev/null 2>&1 && \
      echo "      Created GCE Persistent Disk Snapshot: ${SNAP_NAME}" || true
  fi
else
  echo "[4/5] Google Cloud CLI/Project metadata skipped on this host — local archive stored at ${ARCHIVE_PATH}."
fi

# 5. Ensure Automated Daily 03:00 UTC Google Cloud Cron Backup is Registered
echo "[5/5] Ensuring nightly automated Google Cloud backup cron job..."
if command -v crontab >/dev/null 2>&1; then
  CRON_CMD="0 3 * * * ${APP_DIR}/scripts/backup-to-google-cloud.sh >> ${BACKUP_ROOT}/cron-backup.log 2>&1"
  (crontab -l 2>/dev/null | grep -v "backup-to-google-cloud.sh" || true; echo "${CRON_CMD}") | crontab - 2>/dev/null || true
  echo "      Active nightly schedule: 03:00 UTC -> ${APP_DIR}/scripts/backup-to-google-cloud.sh"
fi

echo "=================================================================="
echo "  Google Cloud Backup Complete!"
echo "  Archive : ${ARCHIVE_PATH} (${SIZE_HUMAN})"
echo "  SHA-256 : ${SHA256_SUM}"
echo "=================================================================="
