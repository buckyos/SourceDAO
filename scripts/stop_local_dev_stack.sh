#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DAO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PID_DIR="${SOURCE_DAO_ROOT}/.local-dev/pids"
FRONTEND_ROOT="$(cd "${SOURCE_DAO_ROOT}/../buckydaowww/src" && pwd)"
BACKEND_ROOT="$(cd "${SOURCE_DAO_ROOT}/../SourceDAOBackend" && pwd)"
FRONTEND_PORT="${SOURCE_DAO_FRONTEND_PORT:-3000}"
BACKEND_LISTEN="${SOURCE_DAO_BACKEND_LISTEN:-127.0.0.1:3333}"
BACKEND_PORT="${BACKEND_LISTEN##*:}"
HARDHAT_PORT="${SOURCE_DAO_HARDHAT_PORT:-8545}"
STOP_HARDHAT=0

usage() {
    cat <<EOF
Usage:
  bash scripts/stop_local_dev_stack.sh [--all]

Options:
  --all     Also stop the managed Hardhat node
  --help    Show this message
EOF
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

    for _ in $(seq 1 20); do
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

stop_managed_listener_on_port() {
    local port="$1"
    local root="$2"
    local label="$3"
    local pid

    while read -r pid; do
        [[ -z "${pid}" ]] && continue
        if process_or_ancestor_matches_root "${pid}" "${root}"; then
            echo "Stopping stale ${label} process on port ${port} (pid ${pid})..."
            stop_pid "${pid}"
        fi
    done < <(find_listen_pids "${port}")
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --all)
            STOP_HARDHAT=1
            shift
            ;;
        --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

stop_pid_file "${PID_DIR}/frontend.pid"
stop_pid_file "${PID_DIR}/backend.pid"
stop_managed_listener_on_port "${FRONTEND_PORT}" "${FRONTEND_ROOT}" "frontend"
stop_managed_listener_on_port "${BACKEND_PORT}" "${BACKEND_ROOT}" "backend"

if [[ "${STOP_HARDHAT}" == "1" ]]; then
    stop_pid_file "${PID_DIR}/hardhat.pid"
    stop_managed_listener_on_port "${HARDHAT_PORT}" "${SOURCE_DAO_ROOT}" "hardhat"
    echo "Stopped frontend, backend, and managed Hardhat local dev processes"
else
    echo "Stopped frontend and backend local dev processes. Hardhat was preserved."
fi
