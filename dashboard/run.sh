#!/usr/bin/env bash
# StudiQ QA Dashboard launcher (Phase 2: live Chromium tiles).
#
#   ./run.sh                 start dashboard + browsers (idempotent)
#   ./run.sh up              alias for start
#   ./run.sh restart         restart dashboard and browsers
#   ./run.sh stop            stop dashboard and browsers
#   ./run.sh status          dashboard + browser status
#   ./run.sh logs            tail the dashboard log
#   ./run.sh browsers <cmd>  pass through to browsers.ts
#                            (start|stop|restart|status [--force] [--deep])
#
set -euo pipefail
cd "$(dirname "$0")"

PORT=5000
PIDFILE=".pid"
LOG="dashboard.log"

port_open() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$PORT" 2>/dev/null | tail -n +2 | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1
  fi
}

read_pid() {
  [ -f "$PIDFILE" ] && cat "$PIDFILE" 2>/dev/null || true
}

stop_pid() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping dashboard (pid $pid)..."
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "pid $pid did not exit; sending SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
}

browsers() {
  bun run browsers.ts "$@"
}

start_browsers() {
  echo "Starting QA Chromium browsers (9221-9228)..."
  if ! browsers start; then
    echo "WARNING: one or more browsers failed to start; dashboard chat still works." >&2
    echo "         Check dashboard/logs/chrome-qa-env-*.log and ./run.sh browsers status" >&2
    return 0
  fi
}

stop_browsers() {
  echo "Stopping QA Chromium browsers..."
  browsers stop >/dev/null || true
}

start_dashboard() {
  local pid
  pid="$(read_pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Dashboard already running (pid $pid)."
    return 0
  fi

  if port_open; then
    echo "Port $PORT is already in use by another process; refusing to start." >&2
    echo "Find it with: ss -ltnp 'sport = :$PORT'" >&2
    return 1
  fi

  echo "Starting dashboard on 0.0.0.0:$PORT ..."
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bun run server.ts >>"$LOG" 2>&1 </dev/null &
  else
    nohup bun run server.ts >>"$LOG" 2>&1 </dev/null &
  fi
  echo $! >"$PIDFILE"

  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
      echo "Dashboard is up: http://localhost:$PORT/  (pid $(cat "$PIDFILE"))"
      echo "Log: $(pwd)/$LOG"
      return 0
    fi
    if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Dashboard process exited during startup. Last log lines:" >&2
      tail -n 30 "$LOG" >&2 || true
      rm -f "$PIDFILE"
      return 1
    fi
    sleep 0.1
  done

  echo "Dashboard did not answer /healthz within 6s. Check $LOG" >&2
  return 1
}

case "${1:-start}" in
  start|up)
    start_browsers
    start_dashboard
    ;;
  restart)
    stop_pid "$(read_pid)"
    rm -f "$PIDFILE"
    if port_open; then
      echo "Port $PORT is still in use by another process; refusing to start." >&2
      exit 1
    fi
    stop_browsers
    start_browsers
    start_dashboard
    ;;
  stop)
    stop_pid "$(read_pid)"
    rm -f "$PIDFILE"
    stop_browsers
    echo "Stopped."
    ;;
  status)
    pid="$(read_pid)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "dashboard: running (pid $pid) on 0.0.0.0:$PORT"
    else
      echo "dashboard: not running"
      [ -n "$pid" ] && echo "(stale pidfile: $pid)"
    fi
    echo "browsers:"
    browsers status
    ;;
  logs)
    tail -n 100 -f "$LOG"
    ;;
  browsers)
    shift
    browsers "$@"
    ;;
  *)
    echo "Usage: $0 [start|up|restart|stop|status|logs|browsers <cmd>]" >&2
    exit 2
    ;;
esac
