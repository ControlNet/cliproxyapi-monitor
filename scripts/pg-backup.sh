#!/bin/sh
set -eu

log() {
  printf '[pg-backup] %s\n' "$1"
}

error() {
  printf '[pg-backup] %s\n' "$1" >&2
}

require_env() {
  var_name="$1"
  eval "var_value=\${${var_name}:-}"

  if [ -z "$var_value" ]; then
    error "${var_name} is required"
    exit 1
  fi
}

require_env "POSTGRES_HOST"
require_env "POSTGRES_PORT"
require_env "POSTGRES_USER"
require_env "POSTGRES_PASSWORD"
require_env "POSTGRES_DB"

BACKUP_DIR="${BACKUP_DIR:-/backups/postgres}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

case "$BACKUP_RETENTION_DAYS" in
  ''|*[!0-9]*)
    error "BACKUP_RETENTION_DAYS must be a positive integer"
    exit 1
    ;;
esac

if [ "$BACKUP_RETENTION_DAYS" -lt 1 ]; then
  error "BACKUP_RETENTION_DAYS must be >= 1"
  exit 1
fi

if ! mkdir -p "$BACKUP_DIR"; then
  error "cannot create backup directory: $BACKUP_DIR"
  exit 1
fi

write_probe="$BACKUP_DIR/.write-test-$$"
if ! (umask 077 && : > "$write_probe"); then
  error "backup directory is not writable: $BACKUP_DIR"
  exit 1
fi
rm -f "$write_probe"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_file="$BACKUP_DIR/${POSTGRES_DB}_${timestamp}.sql.gz"
tmp_plain="$BACKUP_DIR/.${POSTGRES_DB}_${timestamp}.sql"

log "starting backup for database ${POSTGRES_DB} on ${POSTGRES_HOST}:${POSTGRES_PORT}"

export PGPASSWORD="$POSTGRES_PASSWORD"

if pg_dump \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --file "$tmp_plain"; then
  :
else
  rc=$?
  rm -f "$tmp_plain"
  error "pg_dump failed (exit ${rc})"
  exit "$rc"
fi

if gzip -9 "$tmp_plain"; then
  :
else
  rc=$?
  rm -f "$tmp_plain" "${tmp_plain}.gz"
  error "gzip failed (exit ${rc})"
  exit "$rc"
fi

if mv "${tmp_plain}.gz" "$final_file"; then
  :
else
  rc=$?
  rm -f "${tmp_plain}.gz"
  error "failed to finalize backup file ${final_file} (exit ${rc})"
  exit "$rc"
fi

retention_threshold=$((BACKUP_RETENTION_DAYS - 1))

log "backup created: ${final_file}"
log "pruning backups older than ${BACKUP_RETENTION_DAYS} day(s)"

pruned_any=0
while IFS= read -r stale_file; do
  [ -n "$stale_file" ] || continue
  pruned_any=1
  log "pruning stale backup: ${stale_file}"
done <<EOF
$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql.gz' -mtime "+${retention_threshold}" -print)
EOF

if ! find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql.gz' -mtime "+${retention_threshold}" -delete; then
  error "failed to prune stale backups from ${BACKUP_DIR}"
  exit 1
fi

if [ "$pruned_any" -eq 0 ]; then
  log "no stale backups to prune"
fi

backup_count="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.sql.gz' | wc -l | tr -d ' ')"
log "backup completed successfully (retention=${BACKUP_RETENTION_DAYS} days, files=${backup_count})"
