#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-all}"

if [[ "$MODE" != "all" && "$MODE" != "pass" && "$MODE" != "fail" ]]; then
  echo "Usage: $0 [all|pass|fail]" >&2
  exit 2
fi

PROJECT_NAME="${T15_PROJECT_NAME:-cliproxyapi-monitor-t15smoke}"
DASHBOARD_PORT="8318"
CLIPROXY_PORT="${T15_CLIPROXY_HOST_PORT:-18527}"
EVIDENCE_DIR="${T15_EVIDENCE_DIR:-.sisyphus/evidence}"
PASS_EVIDENCE_FILE="${T15_PASS_EVIDENCE_FILE:-$EVIDENCE_DIR/task-T15-smoke-pass.txt}"
FAIL_EVIDENCE_FILE="${T15_FAIL_EVIDENCE_FILE:-$EVIDENCE_DIR/task-T15-smoke-fail.txt}"

ENV_FILE="$(mktemp .t15-smoke-env.XXXXXX)"
KEEP_STACK="${T15_KEEP_STACK:-0}"
CONFIG_FILE="${T15_CONFIG_FILE:-config.yaml}"
CONFIG_BACKUP_FILE=""
CONFIG_CREATED=0

mkdir -p "$EVIDENCE_DIR"

cat >"$ENV_FILE" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=change-me-postgres
POSTGRES_DB=cliproxy
DATABASE_URL=postgresql://postgres:change-me-postgres@postgres:5432/cliproxy
CLIPROXY_SECRET_KEY=change-me-key
PASSWORD=
CRON_SECRET=change-me-cron
AUTH_COOKIE_SECURE=false
BACKUP_RETENTION_DAYS=7
CLIPROXY_API_HOST_PORT=${CLIPROXY_PORT}
EOF

compose() {
  docker compose -p "$PROJECT_NAME" --env-file "$ENV_FILE" "$@"
}

set -a
source "$ENV_FILE"
set +a

prepare_config() {
  if [[ -f "$CONFIG_FILE" ]]; then
    CONFIG_BACKUP_FILE="$(mktemp .t15-config-backup.XXXXXX)"
    cp "$CONFIG_FILE" "$CONFIG_BACKUP_FILE"
  else
    CONFIG_CREATED=1
  fi

  cat >"$CONFIG_FILE" <<EOF
port: 8317
api-keys:
  - "${CLIPROXY_SECRET_KEY}"
auth-dir: "~/.cli-proxy-api"
debug: false
logging-to-file: false
usage-statistics-enabled: true
auth:
  providers: []
EOF
}

prepare_config

cleanup() {
  if [[ "$KEEP_STACK" != "1" ]]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi

  if [[ -n "$CONFIG_BACKUP_FILE" && -f "$CONFIG_BACKUP_FILE" ]]; then
    cp "$CONFIG_BACKUP_FILE" "$CONFIG_FILE"
    rm -f "$CONFIG_BACKUP_FILE"
  elif [[ "$CONFIG_CREATED" == "1" ]]; then
    rm -f "$CONFIG_FILE"
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
  local dashboard_password

  echo "TASK=T15"
  echo "MODE=pass"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "DASHBOARD_PORT=$DASHBOARD_PORT"
  echo "CLIPROXY_API_HOST_PORT=$CLIPROXY_PORT"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  run_check "pnpm-lint" pnpm lint || failures=$((failures + 1))
  run_check "pnpm-build" pnpm build || failures=$((failures + 1))
  run_check "compose-config" compose config --quiet || failures=$((failures + 1))
  run_check "compose-up" compose up -d || failures=$((failures + 1))
  run_check "wait-login-ready" wait_for_login || failures=$((failures + 1))
  run_check "migrate" docker run --rm --network "${PROJECT_NAME}_default" -e "DATABASE_URL=${DATABASE_URL}" controlnet/cliproxyapi-monitor:latest pnpm run migrate || failures=$((failures + 1))

  dashboard_password="${PASSWORD:-$CLIPROXY_SECRET_KEY}"
  basic_auth="Basic $(printf ':%s' "$dashboard_password" | base64 | tr -d '\n')"

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
  rm -f "$sync_tmp"
  if [[ "$sync_code" != "401" && "$sync_code" != "403" && "$sync_code" != "000" ]]; then
    echo "CHECK_RESULT|authorized-sync|PASS|status=$sync_code"
  else
    echo "CHECK_RESULT|authorized-sync|FAIL|status=$sync_code"
    failures=$((failures + 1))
  fi

  backup_subdir="${PROJECT_NAME}-retention"
  run_check "pg-backup" compose run --rm -e "BACKUP_DIR=/backups/postgres/${backup_subdir}" pg-backup || failures=$((failures + 1))

  if [[ -d "backups/postgres/${backup_subdir}" ]]; then
    backup_count="$(find "backups/postgres/${backup_subdir}" -maxdepth 1 -type f -name '*.sql.gz' | wc -l | tr -d ' ')"
  else
    backup_count="-1"
  fi
  echo "BACKUP_FILE_COUNT=$backup_count"
  echo "BACKUP_CHECK_DIR=backups/postgres/${backup_subdir}"
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

  echo "TASK=T15"
  echo "MODE=fail"
  echo "PROJECT_NAME=$PROJECT_NAME"
  echo "DASHBOARD_PORT=$DASHBOARD_PORT"
  echo "CLIPROXY_API_HOST_PORT=$CLIPROXY_PORT"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  run_check "compose-up" compose up -d || failures=$((failures + 1))
  run_check "wait-login-ready" wait_for_login || failures=$((failures + 1))

  wrong_tmp="$(mktemp)"
  wrong_token_code="$(curl --silent --show-error --output "$wrong_tmp" --write-out '%{http_code}' --request POST --header 'Authorization: Bearer definitely-wrong-token' --header 'Content-Type: application/json' "http://127.0.0.1:${DASHBOARD_PORT}/api/sync" || true)"
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
  upstream_code="$(curl --silent --show-error --output "$upstream_tmp" --write-out '%{http_code}' --request POST --header 'Authorization: Bearer change-me-cron' --header 'Content-Type: application/json' "http://127.0.0.1:${DASHBOARD_PORT}/api/sync" || true)"
  echo "UPSTREAM_UNAVAILABLE_STATUS=$upstream_code"
  echo "UPSTREAM_UNAVAILABLE_BODY=$(cat "$upstream_tmp")"
  rm -f "$upstream_tmp"
  if [[ "$upstream_code" =~ ^5 ]]; then
    echo "CHECK_RESULT|upstream-unavailable-path|PASS|status=$upstream_code"
  else
    echo "CHECK_RESULT|upstream-unavailable-path|FAIL|status=$upstream_code"
    failures=$((failures + 1))
  fi

  echo
  echo "DASHBOARD_LOG_TAIL_BEGIN"
  compose logs --no-color dashboard | tail -n 120 || true
  echo "DASHBOARD_LOG_TAIL_END"

  if compose logs --no-color dashboard | grep -E '\[sync\] usage fetch failed|Failed to fetch usage|Upstream usage request timed out' >/dev/null 2>&1; then
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
