#!/bin/sh
set -eu

CONFIG_PATH="${CLIPROXY_CONFIG_PATH:-/app/config.yaml}"

trim_yaml_scalar() {
  printf '%s' "$1" | sed -e 's/[[:space:]]*#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e "s/^['\"]//" -e "s/['\"]$//"
}

extract_port_from_config() {
  file_path="$1"

  if [ ! -f "$file_path" ]; then
    return 0
  fi

  port_line="$(awk '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*port:[[:space:]]*/ { print; exit }
  ' "$file_path")"

  if [ -z "$port_line" ]; then
    return 0
  fi

  port_value="${port_line#*:}"
  port_value="$(trim_yaml_scalar "$port_value")"

  if [ -n "$port_value" ]; then
    printf '%s' "$port_value"
  fi
}

extract_first_api_key_from_config() {
  file_path="$1"

  if [ ! -f "$file_path" ]; then
    return 0
  fi

  api_key_line="$(awk '
    BEGIN { in_api_keys = 0 }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*api-keys:[[:space:]]*$/ { in_api_keys = 1; next }
    in_api_keys && /^[^[:space:]]/ { in_api_keys = 0 }
    in_api_keys && /^[[:space:]]*-[[:space:]]*/ { print; exit }
  ' "$file_path")"

  if [ -z "$api_key_line" ]; then
    return 0
  fi

  api_key_value="${api_key_line#*-}"
  api_key_value="$(trim_yaml_scalar "$api_key_value")"

  if [ -n "$api_key_value" ]; then
    printf '%s' "$api_key_value"
  fi
}

if [ -z "${CLIPROXY_SECRET_KEY:-}" ]; then
  secret_from_file="$(extract_first_api_key_from_config "$CONFIG_PATH" || true)"
  if [ -n "$secret_from_file" ]; then
    export CLIPROXY_SECRET_KEY="$secret_from_file"
  fi
fi

if [ -z "${CLIPROXY_API_BASE_URL:-}" ]; then
  upstream_port="$(extract_port_from_config "$CONFIG_PATH" || true)"
  if [ -z "$upstream_port" ]; then
    upstream_port="8317"
  fi
  export CLIPROXY_API_BASE_URL="http://cli-proxy-api:${upstream_port}"
fi

if [ -z "${PASSWORD:-}" ] && [ -n "${CLIPROXY_SECRET_KEY:-}" ]; then
  export PASSWORD="$CLIPROXY_SECRET_KEY"
fi

run_migrations_with_retry() {
  max_attempts=20
  attempt=1

  while [ "$attempt" -le "$max_attempts" ]; do
    echo "[startup] running database migrations (attempt ${attempt}/${max_attempts})"
    if pnpm run migrate; then
      echo "[startup] migrations completed"
      return 0
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      echo "[startup] migrations failed after ${max_attempts} attempts" >&2
      return 1
    fi

    echo "[startup] migration attempt ${attempt} failed, retrying in 2s..." >&2
    attempt=$((attempt + 1))
    sleep 2
  done
}

run_migrations_with_retry

exec pnpm start
