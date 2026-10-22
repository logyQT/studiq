#!/usr/bin/env bash
# StudiQ QA Dashboard launcher.
#
#   ./run.sh           start (idempotent if already running)
#   ./run.sh restart   stop the old PID, then start
#   ./run.sh stop      stop
#   ./run.sh status    show PID / port status
#   ./run.sh logs      tail the log
#
set -euo pipefail
cd "$(dirname "$0")"

PORT=4000
PIDFILE=".pid"
LOG="dashboard.log"

port_open() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$PORT" 2>/dev/null | tail -n +2 | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    # Last resort: bash /dev/tcp probe (only proves something answers).
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

start() {
  local pid
  pid="$(read_pid)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Dashboard already running (pid $pid). Use ./run.sh restart to restart."
    exit 0
  fi

  if port_open; then
    echo "Port $PORT is already in use by another process; refusing to start." >&2
    echo "Find it with: ss -ltnp 'sport = :$PORT'" >&2
    exit 1
  fi

  echo "Starting dashboard on 0.0.0.0:$PORT ..."
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup bun run server.ts >>"$LOG" 2>&1 </dev/null &
  else
    nohup bun run server.ts >>"$LOG" 2>&1 </dev/null &
  fi
  echo $! >"$PIDFILE"

  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
      echo "Dashboard is up: http://localhost:$PORT/  (pid $(cat "$PIDFILE"))"
      echo "Log: $(pwd)/$LOG"
      return 0
    fi
    if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Dashboard process exited during startup. Last log lines:" >&2
      tail -n 30 "$LOG" >&2 || true
      rm -f "$PIDFILE"
      exit 1
    fi
    sleep 0.1
  done

  echo "Dashboard did not answer /healthz within 5s. Check $LOG" >&2
  exit 1
}

case "${1:-start}" in
  start)
    start
    ;;
  restart)
    stop_pid "$(read_pid)"
    rm -f "$PIDFILE"
    if port_open; then
      echo "Port $PORT is still in use by another process; refusing to start." >&2
      exit 1
    fi
    start
    ;;
  stop)
    stop_pid "$(read_pid)"
    rm -f "$PIDFILE"
    echo "Stopped."
    ;;
  status)
    pid="$(read_pid)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "running (pid $pid) on 0.0.0.0:$PORT"
    else
      echo "not running"
      [ -n "$pid" ] && echo "(stale pidfile: $pid)"
      exit 1
    fi
    ;;
  logs)
    tail -n 100 -f "$LOG"
    ;;
  *)
    echo "Usage: $0 [start|restart|stop|status|logs]" >&2
    exit 2
    ;;
esac
