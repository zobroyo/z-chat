#!/usr/bin/env bash
# Back up the black box to Google Drive via rclone (remote: gdrive,
# OAuth scope drive.file, config at /root/.config/rclone/rclone.conf).
set -euo pipefail

export RCLONE_CONFIG="/root/.config/rclone/rclone.conf"
REMOTE="gdrive:BlackBox-Backup"
RCLONE_LOG="/home/user/zchat/backup.log"

if rclone sync /home/user "${REMOTE}/home" \
    --exclude ".cache/**" \
    --exclude ".local/share/**" \
    --exclude ".npm/**" \
    --exclude ".gradle/**" \
    --exclude ".java/**" \
    --exclude "**/node_modules/**" \
    --exclude "**/venv/**" \
    --exclude "**/.venv/**" \
    --exclude "**/__pycache__/**" \
    --exclude "**/.git/objects/**" \
    --exclude "snap/**" \
    --exclude "kryptex_kaspa/bzminer_v*/**" \
    --transfers 8 --checkers 16 --fast-list --drive-use-trash=false \
    --log-file "${RCLONE_LOG}" --log-level INFO \
  && rclone sync /etc/systemd/system "${REMOTE}/etc/systemd-system" \
    --transfers 8 --checkers 16 --fast-list --drive-use-trash=false \
    --log-file "${RCLONE_LOG}" --log-level INFO \
  && rclone copyto /etc/fstab "${REMOTE}/etc/fstab" \
  && rclone copyto /etc/hosts "${REMOTE}/etc/hosts" \
  && rclone copyto /etc/environment "${REMOTE}/etc/environment" \
  && rclone copy "${RCLONE_CONFIG}" "${REMOTE}/etc/rclone.conf"
then
  echo "BACKUP OK $(date -Is)"
else
  echo "BACKUP FAILED"
  exit 1
fi
