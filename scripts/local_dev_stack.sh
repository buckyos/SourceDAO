#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DAO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKEND_ROOT="$(cd "${SOURCE_DAO_ROOT}/../SourceDAOBackend" && pwd)"
FRONTEND_ROOT="$(cd "${SOURCE_DAO_ROOT}/../buckydaowww/src" && pwd)"
STATE_DIR="${SOURCE_DAO_ROOT}/.local-dev"
LOG_DIR="${STATE_DIR}/logs"
PID_DIR="${STATE_DIR}/pids"
FRONTEND_HOST="${SOURCE_DAO_FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${SOURCE_DAO_FRONTEND_PORT:-3000}"
BACKEND_LISTEN="${SOURCE_DAO_BACKEND_LISTEN:-127.0.0.1:3333}"
BACKEND_BIND_HOST="${BACKEND_LISTEN%:*}"
BACKEND_PORT="${BACKEND_LISTEN##*:}"
BACKEND_HOST="${BACKEND_BIND_HOST}"
if [[ "${BACKEND_HOST}" == "0.0.0.0" ]]; then
    BACKEND_HOST="127.0.0.1"
fi
BACKEND_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"

mkdir -p "${LOG_DIR}" "${PID_DIR}"

source_nvm() {
    unset npm_config_prefix
    unset NPM_CONFIG_PREFIX
    if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
        # shellcheck disable=SC1090
        source "${HOME}/.nvm/nvm.sh"
    fi
}

run_in_dir() {
    local workdir="$1"
    shift
    (
        source_nvm
        cd "${workdir}"
        "$@"
    )
}

run_bg() {
    local name="$1"
    local workdir="$2"
    local pid_file="${PID_DIR}/${name}.pid"
    local log_file="${LOG_DIR}/${name}.log"
    shift 2

    (
        source_nvm
        cd "${workdir}"
        if command -v setsid >/dev/null 2>&1; then
            exec setsid "$@"
        fi
        exec "$@"
    ) >"${log_file}" 2>&1 &
    local pid=$!
    echo "${pid}" > "${pid_file}"
}

process_group_alive() {
    local pid="$1"
    if command -v pgrep >/dev/null 2>&1; then
        pgrep -g "${pid}" >/dev/null 2>&1
        return
    fi
    kill -0 "${pid}" 2>/dev/null
}

parent_pid() {
    local pid="$1"
    ps -o ppid= -p "${pid}" 2>/dev/null | tr -d ' ' || true
}

process_cwd() {
    local pid="$1"
    if [[ -e "/proc/${pid}/cwd" ]]; then
        readlink -f "/proc/${pid}/cwd" 2>/dev/null || true
    fi
}

process_command() {
    local pid="$1"
    ps -o command= -p "${pid}" 2>/dev/null || true
}

process_or_ancestor_matches_root() {
    local pid="$1"
    local root="$2"
    local current="${pid}"
    local cwd
    local cmd

    while [[ -n "${current}" && "${current}" != "0" && "${current}" != "1" ]]; do
        cwd="$(process_cwd "${current}")"
        cmd="$(process_command "${current}")"
        if [[ -n "${cwd}" && ( "${cwd}" == "${root}" || "${cwd}" == "${root}/"* ) ]]; then
            return 0
        fi
        if [[ -n "${cmd}" && "${cmd}" == *"${root}"* ]]; then
            return 0
        fi
        current="$(parent_pid "${current}")"
    done

    return 1
}

stop_pid() {
    local pid="$1"
    local pgid

    pgid="$(ps -o pgid= -p "${pid}" 2>/dev/null | tr -d ' ' || true)"
    if ! kill -0 "${pid}" 2>/dev/null; then
        return 0
    fi

    if [[ -n "${pgid}" && "${pgid}" != "0" ]]; then
        kill -- "-${pgid}" 2>/dev/null || true
    else
        kill "${pid}" 2>/dev/null || true
    fi

    for _ in $(seq 1 30); do
        if [[ -n "${pgid}" && "${pgid}" != "0" ]]; then
            if command -v pgrep >/dev/null 2>&1; then
                if ! pgrep -g "${pgid}" >/dev/null 2>&1; then
                    return 0
                fi
            elif ! kill -0 "${pid}" 2>/dev/null; then
                return 0
            fi
        elif ! kill -0 "${pid}" 2>/dev/null; then
            return 0
        fi
        sleep 1
    done

    if [[ -n "${pgid}" && "${pgid}" != "0" ]]; then
        kill -9 -- "-${pgid}" 2>/dev/null || true
    elif kill -0 "${pid}" 2>/dev/null; then
        kill -9 "${pid}" 2>/dev/null || true
    fi
}

stop_pid_file() {
    local pid_file="$1"
    if [[ ! -f "${pid_file}" ]]; then
        return 0
    fi

    local pid
    pid="$(cat "${pid_file}")"
    stop_pid "${pid}"
    rm -f "${pid_file}"
}

find_listen_pids() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -tiTCP:"${port}" -sTCP:LISTEN -n -P 2>/dev/null || true
        return 0
    fi
    if command -v ss >/dev/null 2>&1; then
        ss -ltnp "( sport = :${port} )" 2>/dev/null \
            | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
            | sort -u
    fi
}

wait_for_http() {
    local url="$1"
    local label="$2"
    for _ in $(seq 1 90); do
        if curl -fsS "${url}" >/dev/null 2>&1; then
            echo "${label} is ready: ${url}"
            return 0
        fi
        sleep 1
    done
    echo "Timed out waiting for ${label}: ${url}" >&2
    return 1
}

wait_for_jsonrpc() {
    local url="$1"
    for _ in $(seq 1 90); do
        if curl -fsS -H 'Content-Type: application/json' \
            --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
            "${url}" >/dev/null 2>&1; then
            echo "Hardhat node is ready: ${url}"
            return 0
        fi
        sleep 1
    done
    echo "Timed out waiting for Hardhat node: ${url}" >&2
    return 1
}

port_in_use() {
    local port="$1"
    find_listen_pids "${port}" | grep -q '^[0-9]'
}

reclaim_managed_port() {
    local port="$1"
    local root="$2"
    local label="$3"
    local pid
    local reclaimed=0

    while read -r pid; do
        [[ -z "${pid}" ]] && continue
        if process_or_ancestor_matches_root "${pid}" "${root}"; then
            echo "Stopping stale ${label} process on port ${port} (pid ${pid})..."
            stop_pid "${pid}"
            reclaimed=1
        fi
    done < <(find_listen_pids "${port}")

    if [[ "${reclaimed}" == "1" ]]; then
        sleep 1
        ! port_in_use "${port}"
        return
    fi

    return 1
}

ensure_port_available_or_owned() {
    local port="$1"
    local pid_file="$2"
    local label="$3"
    local root="$4"
    if ! port_in_use "${port}"; then
        return 0
    fi
    if [[ -f "${pid_file}" ]]; then
        return 0
    fi
    if reclaim_managed_port "${port}" "${root}" "${label}"; then
        return 0
    fi
    echo "${label} port ${port} is already in use by another process." >&2
    echo "Stop that process first, or use the existing service manually." >&2
    return 1
}

print_summary() {
    cat <<EOF

Local dev stack is ready.

URLs:
  Frontend : http://${FRONTEND_HOST}:${FRONTEND_PORT}
  Backend  : ${BACKEND_URL}
  Hardhat  : http://127.0.0.1:8545

Logs:
  Frontend : ${LOG_DIR}/frontend.log
  Backend  : ${LOG_DIR}/backend.log
  Hardhat  : ${LOG_DIR}/hardhat.log

State:
  Frontend env  : ${FRONTEND_ROOT}/.env.local
  Backend config: ${BACKEND_ROOT}/src/config.local.toml

Stop:
  cd ${SOURCE_DAO_ROOT}
  npm run stack:local:stop
EOF
}

main() {
    local hardhat_pid_file="${PID_DIR}/hardhat.pid"
    local backend_pid_file="${PID_DIR}/backend.pid"
    local frontend_pid_file="${PID_DIR}/frontend.pid"
    local rpc_url="http://127.0.0.1:8545"

    ensure_port_available_or_owned "${BACKEND_PORT}" "${backend_pid_file}" "Backend" "${BACKEND_ROOT}"
    ensure_port_available_or_owned "${FRONTEND_PORT}" "${frontend_pid_file}" "Frontend" "${FRONTEND_ROOT}"

    stop_pid_file "${backend_pid_file}"
    stop_pid_file "${frontend_pid_file}"
    stop_pid_file "${hardhat_pid_file}"

    if curl -fsS -H 'Content-Type: application/json' \
        --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
        "${rpc_url}" >/dev/null 2>&1; then
        echo "Reusing existing Hardhat node at ${rpc_url}"
    else
        echo "Starting Hardhat node..."
        run_bg "hardhat" "${SOURCE_DAO_ROOT}" npm run node:local
        wait_for_jsonrpc "${rpc_url}"
    fi

    echo "Deploying local SourceDAO stack and writing frontend .env.local..."
    run_in_dir "${SOURCE_DAO_ROOT}" env FRONTEND_BACKEND_URL="${BACKEND_URL}" npm run deploy:frontend-local:write

    echo "Starting backend..."
    run_bg "backend" "${BACKEND_ROOT}" env SOURCE_DAO_BACKEND_LISTEN="${BACKEND_LISTEN}" ./scripts/backend_local_dev.sh --reset-sqlite
    wait_for_http "${BACKEND_URL}/status" "Backend"

    echo "Starting frontend..."
    if [[ ! -d "${FRONTEND_ROOT}/node_modules" ]]; then
        run_in_dir "${FRONTEND_ROOT}" npm i
    fi
    run_bg "frontend" "${FRONTEND_ROOT}" env NEXT_PUBLIC_SERVER="${BACKEND_URL}" npm run dev -- --hostname "${FRONTEND_HOST}" --port "${FRONTEND_PORT}"
    wait_for_http "http://${FRONTEND_HOST}:${FRONTEND_PORT}" "Frontend"

    print_summary
}

main "$@"
