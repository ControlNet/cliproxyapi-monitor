#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-all}"

if [[ "$MODE" != "all" && "$MODE" != "pass" && "$MODE" != "fail" ]]; then
  echo "Usage: $0 [all|pass|fail]" >&2
  exit 2
fi

PROJECT_NAME="${T15_PROJECT_NAME:-cliproxyapi-monitor-t15smoke}"
find_free_port() {
  node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { process.stdout.write(String(server.address().port)); server.close(); });'
}

DASHBOARD_PORT="${T15_DASHBOARD_HOST_PORT:-$(find_free_port)}"
CLIPROXY_PORT="${T15_CLIPROXY_HOST_PORT:-$(find_free_port)}"
DASHBOARD_IMAGE="${T15_DASHBOARD_IMAGE:-${PROJECT_NAME}-dashboard-local}"
EVIDENCE_DIR="${T15_EVIDENCE_DIR:-.sisyphus/evidence}"
PASS_EVIDENCE_FILE="${T15_PASS_EVIDENCE_FILE:-$EVIDENCE_DIR/task-T15-smoke-pass.txt}"
FAIL_EVIDENCE_FILE="${T15_FAIL_EVIDENCE_FILE:-$EVIDENCE_DIR/task-T15-smoke-fail.txt}"

KEEP_STACK="${T15_KEEP_STACK:-0}"
mkdir -p /tmp/opencode
TEMP_ROOT="$(mktemp -d "/tmp/opencode/${PROJECT_NAME}.XXXXXX")"
ENV_FILE="$(mktemp "$TEMP_ROOT/.t15-smoke-env.XXXXXX")"
CONFIG_FILE="$TEMP_ROOT/config.yaml"
AUTH_DIR="$TEMP_ROOT/auths"
LOGS_DIR="$TEMP_ROOT/logs"
POSTGRES_DATA_DIR="$TEMP_ROOT/dashboard-data"
BACKUP_ROOT_DIR="$TEMP_ROOT/backups/postgres"

mkdir -p "$EVIDENCE_DIR"
mkdir -p "$AUTH_DIR" "$LOGS_DIR" "$POSTGRES_DATA_DIR" "$BACKUP_ROOT_DIR"

cat >"$ENV_FILE" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-postgres
POSTGRES_DB=cliproxy
DATABASE_URL=postgresql://postgres:change-me-postgres@postgres:5432/cliproxy
CLIPROXY_SECRET_KEY=change-me-key
MANAGEMENT_PASSWORD=change-me-management-password
CLIPROXY_MANAGEMENT_KEY=change-me-management-password
CLIPROXY_USAGE_QUEUE_SOURCE=auto
PASSWORD=
CRON_SECRET=change-me-cron
AUTH_COOKIE_SECURE=false
BACKUP_RETENTION_DAYS=7
DASHBOARD_HOST_PORT=${DASHBOARD_PORT}
CLIPROXY_API_HOST_PORT=${CLIPROXY_PORT}
DASHBOARD_IMAGE=${DASHBOARD_IMAGE}
CLIPROXY_CONFIG_BIND_MOUNT=${CONFIG_FILE}
CLIPROXY_AUTHS_BIND_MOUNT=${AUTH_DIR}
CLIPROXY_LOGS_BIND_MOUNT=${LOGS_DIR}
POSTGRES_DATA_BIND_MOUNT=${POSTGRES_DATA_DIR}
EOF

compose() {
  docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" "$@"
}

set -a
source "$ENV_FILE"
set +a

prepare_config() {
  cat >"$CONFIG_FILE" <<EOF
port: 8317
remote-management:
  allow-remote: true
  secret-key: "${MANAGEMENT_PASSWORD}"
api-keys:
  - "${CLIPROXY_SECRET_KEY}"
auth-dir: "~/.cli-proxy-api"
debug: false
logging-to-file: false
usage-statistics-enabled: true
redis-usage-queue-retention-seconds: 60
auth:
  providers: []
EOF
}

prepare_config

cleanup() {
  if [[ "$KEEP_STACK" != "1" ]]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  if [[ "$KEEP_STACK" != "1" ]]; then
    if ! rm -rf "$TEMP_ROOT" 2>/dev/null; then
      docker run --rm -v "$TEMP_ROOT:/cleanup" alpine:3.20 sh -c 'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true' >/dev/null 2>&1 || true
      rm -rf "$TEMP_ROOT" 2>/dev/null || true
    fi
  fi

  rm -f "$ENV_FILE"
}

run_check() {
  local name="$1"
  shift
  echo
  echo "### $name"
  set +e
  "$@"
  local rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    echo "CHECK_RESULT|$name|PASS"
    return 0
  fi

  echo "CHECK_RESULT|$name|FAIL|exit=$rc"
  return "$rc"
}

build_dashboard_image() {
  docker build -t "$DASHBOARD_IMAGE" .
}

read_json_field() {
  local json_file="$1"
  local field_name="$2"
  node -e '
    const fs = require("node:fs");
    const [filePath, fieldName] = process.argv.slice(1);
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    const value = json[fieldName];
    process.stdout.write(value === undefined || value === null ? "" : String(value));
  ' "$json_file" "$field_name"
}

wait_for_login() {
  local max_attempts=40
  local i
  for ((i = 1; i <= max_attempts; i++)); do
    local code
    code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${DASHBOARD_PORT}/login" || true)"
    if [[ "$code" == "200" ]]; then
      echo "WAIT_LOGIN|attempt=$i|status=200"
      return 0
    fi
    sleep 2
  done
  echo "WAIT_LOGIN|status=timeout"
  return 1
}

run_pass() {
  local failures=0
  local login_code
  local management_code
  local sync_code
  local backup_count
  local backup_subdir
  local basic_auth
  local login_value
  local sync_source

  echo "TASK=T15"
  echo "MODE=pass"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "DASHBOARD_PORT=$DASHBOARD_PORT"
  echo "CLIPROXY_API_HOST_PORT=$CLIPROXY_PORT"
  echo "DASHBOARD_IMAGE=$DASHBOARD_IMAGE"
  echo "TEMP_ROOT=$TEMP_ROOT"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  run_check "pnpm-lint" pnpm lint || failures=$((failures + 1))
  run_check "pnpm-build" pnpm build || failures=$((failures + 1))
  run_check "docker-build-dashboard" build_dashboard_image || failures=$((failures + 1))
  run_check "compose-config" compose config --quiet || failures=$((failures + 1))
  run_check "compose-up" compose up -d || failures=$((failures + 1))
  run_check "wait-login-ready" wait_for_login || failures=$((failures + 1))
  run_check "migrate" compose exec -T dashboard node /app/scripts/migrate.mjs || failures=$((failures + 1))

  login_value="${PASSWORD:-$CLIPROXY_SECRET_KEY}"
  basic_auth="Basic $(printf ':%s' "$login_value" | base64 | tr -d '\n')"

  login_code="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${DASHBOARD_PORT}/login" || true)"
  echo "LOGIN_STATUS=$login_code"
  if [[ "$login_code" == "200" ]]; then
    echo "CHECK_RESULT|login-200|PASS"
  else
    echo "CHECK_RESULT|login-200|FAIL|status=$login_code"
    failures=$((failures + 1))
  fi

  local management_body
  local management_tmp
  management_tmp="$(mktemp)"
  management_code="$(curl --silent --show-error --output "$management_tmp" --write-out '%{http_code}' --header "Authorization: ${basic_auth}" "http://127.0.0.1:${DASHBOARD_PORT}/api/management-url" || true)"
  management_body="$(cat "$management_tmp")"
  rm -f "$management_tmp"
  echo "MANAGEMENT_URL_STATUS=$management_code"
  echo "MANAGEMENT_URL_BODY=$management_body"
  if [[ "$management_code" == "200" && "$management_body" == *"management.html"* ]]; then
    echo "CHECK_RESULT|management-url|PASS"
  else
    echo "CHECK_RESULT|management-url|FAIL|status=$management_code"
    failures=$((failures + 1))
  fi

  local sync_tmp
  sync_tmp="$(mktemp)"
  sync_code="$(curl --silent --show-error --output "$sync_tmp" --write-out '%{http_code}' --request POST --header 'Authorization: Bearer change-me-cron' --header 'Content-Type: application/json' "http://127.0.0.1:${DASHBOARD_PORT}/api/sync" || true)"
  echo "AUTHORIZED_SYNC_STATUS=$sync_code"
  echo "AUTHORIZED_SYNC_BODY=$(cat "$sync_tmp")"
  sync_source="$(read_json_field "$sync_tmp" source 2>/dev/null || true)"
  echo "AUTHORIZED_SYNC_SOURCE=$sync_source"
  rm -f "$sync_tmp"
  if [[ "$sync_code" != "401" && "$sync_code" != "403" && "$sync_code" != "000" ]]; then
    echo "CHECK_RESULT|authorized-sync|PASS|status=$sync_code"
  else
    echo "CHECK_RESULT|authorized-sync|FAIL|status=$sync_code"
    failures=$((failures + 1))
  fi

  if [[ "$sync_source" == "resp" || "$sync_source" == "http-usage-queue" || "$sync_source" == "legacy-usage" ]]; then
    echo "CHECK_RESULT|authorized-sync-source-reported|PASS|source=$sync_source"
  else
    echo "CHECK_RESULT|authorized-sync-source-reported|FAIL|source=$sync_source"
    failures=$((failures + 1))
  fi

  backup_subdir="${PROJECT_NAME}-retention"
  run_check "pg-backup" docker run --rm --network "${PROJECT_NAME}_default" -e POSTGRES_HOST=postgres -e POSTGRES_PORT=5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=change-me-postgres -e POSTGRES_DB=cliproxy -e "BACKUP_DIR=/backups/postgres/${backup_subdir}" -e "BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-7}" -v "$PWD/scripts/pg-backup.sh:/scripts/pg-backup.sh:ro" -v "${BACKUP_ROOT_DIR}:/backups/postgres" postgres:16-alpine sh /scripts/pg-backup.sh || failures=$((failures + 1))

  if [[ -d "${BACKUP_ROOT_DIR}/${backup_subdir}" ]]; then
    backup_count="$(find "${BACKUP_ROOT_DIR}/${backup_subdir}" -maxdepth 1 -type f -name '*.sql.gz' | wc -l | tr -d ' ')"
  else
    backup_count="-1"
  fi
  echo "BACKUP_FILE_COUNT=$backup_count"
  echo "BACKUP_CHECK_DIR=${BACKUP_ROOT_DIR}/${backup_subdir}"
  if [[ "$backup_count" =~ ^[0-9]+$ ]] && (( backup_count >= 1 && backup_count <= 7 )); then
    echo "CHECK_RESULT|backup-retention-lte7|PASS"
  else
    echo "CHECK_RESULT|backup-retention-lte7|FAIL|count=$backup_count"
    failures=$((failures + 1))
  fi

  echo
  echo "ACCEPTANCE_SUMMARY_BEGIN"
  echo "- pnpm lint: $( [[ $failures -ge 0 ]] && echo SEE_CHECK_RESULT )"
  echo "- pnpm build: $( [[ $failures -ge 0 ]] && echo SEE_CHECK_RESULT )"
  echo "- docker compose up -d: $( [[ $failures -ge 0 ]] && echo SEE_CHECK_RESULT )"
  echo "- /login == 200: status=$login_code"
  echo "- /api/management-url == 200: status=$management_code"
  echo "- authorized /api/sync reachable (not 401/403): status=$sync_code"
  echo "- /api/sync source is reported: source=$sync_source"
  echo "- pg-backup: SEE_CHECK_RESULT"
  echo "- retention <= 7: count=$backup_count"
  echo "ACCEPTANCE_SUMMARY_END"

  if (( failures > 0 )); then
    echo "VERDICT=FAIL"
    return 1
  fi

  echo "VERDICT=PASS"
}

run_fail() {
  local failures=0
  local wrong_token_code
  local upstream_code
  local wrong_tmp
  local upstream_tmp
  local upstream_source
  local upstream_error
  local invalid_marker
  local invalid_auth_header
  local cron_auth_header

  echo "TASK=T15"
  echo "MODE=fail"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "DASHBOARD_PORT=$DASHBOARD_PORT"
  echo "CLIPROXY_API_HOST_PORT=$CLIPROXY_PORT"
  echo "DASHBOARD_IMAGE=$DASHBOARD_IMAGE"
  echo "TEMP_ROOT=$TEMP_ROOT"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  run_check "docker-build-dashboard" build_dashboard_image || failures=$((failures + 1))
  run_check "compose-up" compose up -d || failures=$((failures + 1))
  run_check "wait-login-ready" wait_for_login || failures=$((failures + 1))

  invalid_marker="definitely-wrong-token"
  invalid_auth_header="Authorization: Bearer ${invalid_marker}"
  cron_auth_header="Authorization: Bearer change-me-cron"

  wrong_tmp="$(mktemp)"
  wrong_token_code="$(curl --silent --show-error --output "$wrong_tmp" --write-out '%{http_code}' --request POST --header "$invalid_auth_header" --header 'Content-Type: application/json' "http://127.0.0.1:${DASHBOARD_PORT}/api/sync" || true)"
  echo "WRONG_TOKEN_STATUS=$wrong_token_code"
  echo "WRONG_TOKEN_BODY=$(cat "$wrong_tmp")"
  rm -f "$wrong_tmp"
  if [[ "$wrong_token_code" == "401" || "$wrong_token_code" == "403" ]]; then
    echo "CHECK_RESULT|wrong-token-rejected|PASS|status=$wrong_token_code"
  else
    echo "CHECK_RESULT|wrong-token-rejected|FAIL|status=$wrong_token_code"
    failures=$((failures + 1))
  fi

  run_check "stop-upstream-cli-proxy-api" compose stop cli-proxy-api || failures=$((failures + 1))

  upstream_tmp="$(mktemp)"
  upstream_code="$(curl --silent --show-error --output "$upstream_tmp" --write-out '%{http_code}' --request POST --header "$cron_auth_header" --header 'Content-Type: application/json' "http://127.0.0.1:${DASHBOARD_PORT}/api/sync" || true)"
  echo "UPSTREAM_UNAVAILABLE_STATUS=$upstream_code"
  echo "UPSTREAM_UNAVAILABLE_BODY=$(cat "$upstream_tmp")"
  upstream_source="$(read_json_field "$upstream_tmp" source 2>/dev/null || true)"
  upstream_error="$(read_json_field "$upstream_tmp" error 2>/dev/null || true)"
  echo "UPSTREAM_UNAVAILABLE_SOURCE=$upstream_source"
  echo "UPSTREAM_UNAVAILABLE_ERROR=$upstream_error"
  rm -f "$upstream_tmp"
  if [[ "$upstream_code" =~ ^5 ]]; then
    echo "CHECK_RESULT|upstream-unavailable-path|PASS|status=$upstream_code"
  else
    echo "CHECK_RESULT|upstream-unavailable-path|FAIL|status=$upstream_code"
    failures=$((failures + 1))
  fi

  if [[ -n "$upstream_error" ]]; then
    echo "CHECK_RESULT|upstream-error-body|PASS|source=$upstream_source"
  else
    echo "CHECK_RESULT|upstream-error-body|FAIL|source=$upstream_source"
    failures=$((failures + 1))
  fi

  echo
  echo "DASHBOARD_LOG_TAIL_BEGIN"
  compose logs --no-color dashboard | tail -n 120 || true
  echo "DASHBOARD_LOG_TAIL_END"

  if compose logs --no-color dashboard | grep -E '\[sync\] legacy usage fetch failed|Failed to fetch usage queue|Failed to fetch usage|Upstream usage request timed out' >/dev/null 2>&1; then
    echo "CHECK_RESULT|traceable-upstream-log|PASS"
  else
    echo "CHECK_RESULT|traceable-upstream-log|FAIL"
    failures=$((failures + 1))
  fi

  if (( failures > 0 )); then
    echo "VERDICT=FAIL"
    return 1
  fi

  echo "VERDICT=PASS"
}

execute_case() {
  local case_name="$1"
  local output_file="$2"
  shift 2

  echo "Writing evidence: $output_file"
  set +e
  "$@" > >(tr -d '\000' | tee "$output_file") 2>&1
  local rc=$?
  set -e
  return "$rc"
}

set +e
case "$MODE" in
  pass)
    execute_case "pass" "$PASS_EVIDENCE_FILE" run_pass
    ;;
  fail)
    execute_case "fail" "$FAIL_EVIDENCE_FILE" run_fail
    ;;
  all)
    execute_case "pass" "$PASS_EVIDENCE_FILE" run_pass
    execute_case "fail" "$FAIL_EVIDENCE_FILE" run_fail
    ;;
esac
CASE_RC=$?
set -e

cleanup
exit "$CASE_RC"
