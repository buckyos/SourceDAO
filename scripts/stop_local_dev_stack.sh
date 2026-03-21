#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DAO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PID_DIR="${SOURCE_DAO_ROOT}/.local-dev/pids"

stop_pid_file() {
    local pid_file="$1"
    if [[ ! -f "${pid_file}" ]]; then
        return 0
    fi

    local pid
    pid="$(cat "${pid_file}")"
    if kill -0 "${pid}" 2>/dev/null; then
        kill "${pid}" 2>/dev/null || true
        for _ in $(seq 1 20); do
            if ! kill -0 "${pid}" 2>/dev/null; then
                break
            fi
            sleep 1
        done
        if kill -0 "${pid}" 2>/dev/null; then
            kill -9 "${pid}" 2>/dev/null || true
        fi
    fi
    rm -f "${pid_file}"
}

stop_pid_file "${PID_DIR}/frontend.pid"
stop_pid_file "${PID_DIR}/backend.pid"
stop_pid_file "${PID_DIR}/hardhat.pid"

echo "Stopped local dev stack processes started by SourceDAO/scripts/local_dev_stack.sh"
