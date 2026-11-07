#!/bin/sh
# Daily pg_dump of the ForeverTracker database, run by the `backup` service of docker-compose.yml.
#
# - One custom-format dump per day at BACKUP_HOUR (UTC): $BACKUP_DIR/ft-<UTC timestamp>.dump
# - Dumps older than BACKUP_RETENTION_DAYS days are deleted after each successful dump.
# - At start, a dump is taken right away when none is younger than 24 h (first start, long outage).
# - `pg-backup.sh once` takes one dump, rotates and exits (manual backup, tests).
# Connection comes from the standard libpq variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) pg-backup: $*"; }

dump() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  partial="$BACKUP_DIR/.ft-$ts.dump.partial"
  if pg_dump --format=custom --no-owner --file="$partial"; then
    mv "$partial" "$BACKUP_DIR/ft-$ts.dump"
    log "wrote ft-$ts.dump ($(du -h "$BACKUP_DIR/ft-$ts.dump" | cut -f1))"
    # -mtime +N matches files at least N+1 full days old: keeps BACKUP_RETENTION_DAYS dumps.
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ft-*.dump' \
      -mtime +"$((BACKUP_RETENTION_DAYS - 1))" -print -delete | sed 's/^/  rotated out: /'
  else
    rm -f "$partial"
    log "ERROR: pg_dump failed, next attempt at the next scheduled time"
    return 1
  fi
}

seconds_until_next_run() {
  now=$(date -u +%s)
  next=$(date -u -d "today ${BACKUP_HOUR}:00" +%s)
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  echo $((next - now))
}

# PID 1 ignores SIGTERM without a handler: stop promptly on `docker compose stop`.
trap 'log "stopping"; exit 0' TERM INT

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "once" ]; then
  dump
  exit $?
fi

log "daily dump at ${BACKUP_HOUR}:00 UTC into $BACKUP_DIR, kept ${BACKUP_RETENTION_DAYS} days"
if [ -z "$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ft-*.dump' -mmin -1440)" ]; then
  log "no dump younger than 24 h, dumping now"
  dump || true
fi

while true; do
  sleep "$(seconds_until_next_run)" &
  wait $!  # interruptible by SIGTERM (docker compose stop)
  dump || true
done
