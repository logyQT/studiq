#!/usr/bin/env bash
# Discord QA control surface — lifecycle helper.
set -euo pipefail
cd "$(dirname "$0")"

PID_FILE=.pid
LOG_FILE=discord.log
COMMAND=${1:-status}

running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "$COMMAND" in
  start)
    if running; then
      echo "already running (pid $(cat "$PID_FILE"))"
      exit 0
    fi
    if [ ! -f .env ]; then
      echo "missing .env — copy .env.example and fill it (see SETUP.md)"
      exit 1
    fi
    nohup bun src/index.ts >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    sleep 2
    if running; then
      echo "started (pid $(cat "$PID_FILE")) — logs: $LOG_FILE"
    else
      echo "failed to start; last log lines:"
      tail -n 30 "$LOG_FILE" || true
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;

  stop)
    if ! running; then
      echo "not running"
      rm -f "$PID_FILE"
      exit 0
    fi
    pid=$(cat "$PID_FILE")
    kill "$pid"
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "still alive after 10s, sending SIGKILL"
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    echo "stopped"
    ;;

  restart)
    "$0" stop
    "$0" start
    ;;

  status)
    if running; then
      echo "running (pid $(cat "$PID_FILE"))"
      ps -o pid,etime,args -p "$(cat "$PID_FILE")" || true
    else
      echo "stopped"
    fi
    ;;

  logs)
    tail -n 200 -f "$LOG_FILE"
    ;;

  check)
    bun src/index.ts --check
    ;;

  dry-run)
    bun src/index.ts --dry-run
    ;;

  *)
    cat <<EOF
usage: ./run.sh <start|stop|restart|status|logs|check|dry-run>

  start     start in the background (writes .pid and discord.log)
  stop      graceful SIGINT, SIGKILL after 10s
  restart   stop + start
  status    pid and uptime
  logs      tail -f discord.log
  check     validate env, tokens, channels and local services, then exit
  dry-run   poll and log actions without posting to Discord
EOF
    ;;
esac
