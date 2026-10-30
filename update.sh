#!/usr/bin/env bash
# ARTEX update script: (1) Docker update (rebuild the image and recreate)  (2) local build update (rebuild the binary)
# Counterpart of install.sh: install handles the first deployment, update upgrades to a new version.
# No manual DB migration is needed: artex idempotently re-runs schema.sql on every start (with ADD COLUMN/CREATE
# INDEX IF NOT EXISTS), so "restart = migrate". Data (the pgdata volume, ./data, ./skills) is not affected.
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

info(){ printf '\033[36m[*]\033[0m %s\n' "$*"; }
ok(){   printf '\033[32m[+]\033[0m %s\n' "$*"; }
warn(){ printf '\033[33m[!]\033[0m %s\n' "$*"; }
die(){  printf '\033[31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
ask(){  local p="$1" d="${2:-}" a; read -rp "$p${d:+ [$d]}: " a; echo "${a:-$d}"; }

# ── optional: sync the repo to the latest code (compose files/scripts/local build sources are updated this way) ───────
sync_repo(){
  [ -d .git ] && command -v git >/dev/null 2>&1 || { warn "not a git working copy, skipping git pull"; return; }
  [ "$(ask 'Pull the latest code (git pull --ff-only)? (y/n)' y)" = y ] || return
  if ! git pull --ff-only; then
    warn "git pull could not fast-forward (local changes or diverged branch) - resolve it manually and retry; continuing with the current code this time"
  fi
}

# ── (1) Docker update ───────────────────────────────
update_docker(){
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 \
    || die "docker / docker compose not found, please deploy with ./install.sh first"
  [ -f .env ] || die ".env not found, please run ./install.sh first to complete the initial deployment"

  # The English fork builds its image from this checkout (the published tomicdd/artex image is the upstream
  # Chinese build), so updating = rebuild from the code just pulled.
  # Only touch artex: postgres is pinned to 16-alpine and does not need upgrading (pulling it just wastes bandwidth,
  # and a major version change carries compatibility risk). artex declares depends_on postgres, so `up` with the service name
  # starts pg automatically if it is not running, and leaves an already running one as is (not recreated).
  info "Rebuilding the artex image from the current code..."
  docker compose build artex
  info "Restarting (artex migrates the schema automatically on restart)..."
  docker compose up -d artex
  ok "Update complete -> http://localhost:8787"
  info "View logs: docker compose logs -f artex"
  info "Clean up old images (optional): docker image prune -f"
}

# ── (2) local build update ──────────────────────────────
update_local(){
  command -v go >/dev/null 2>&1 || die "Go (>=1.26) not found: https://go.dev/dl/"
  [ -f config.json ] || warn "config.json not found - for a first-time deployment use ./install.sh instead"
  ok "Go: $(go version)"

  if command -v npm >/dev/null 2>&1; then
    info "Rebuilding frontend static assets..."
    ( cd web && npm ci && npm run build:static )
    rm -rf server/webui/dist && cp -r web/out server/webui/dist
    info "Recompiling the embedded single binary..."
    CGO_ENABLED=0 go build -tags embedui -trimpath -o artex ./cmd/artex
  else
    warn "npm not found: building the backend **without the embedded frontend** (run the frontend separately with npm run dev)"
    CGO_ENABLED=0 go build -o artex ./cmd/artex
  fi
  ok "Build complete -> ./artex"
  warn "Restart the running artex process to apply the update (the schema is migrated automatically on restart)"
}

echo "=============================="
echo "  ARTEX Update"
echo "  1) Docker update (rebuild the image from the code)"
echo "  2) Local update (rebuild with go)"
echo "=============================="
case "$(ask 'Choose' 1)" in
  1) sync_repo; update_docker ;;
  2) sync_repo; update_local ;;
  *) die "invalid choice" ;;
esac
