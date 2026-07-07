#!/bin/zsh
# Journery deploy — upload source to NAS, rebuild shared image, restart all instances.
# Copy to ~/.journery/deploy.sh on local disk.
# Usage: zsh ~/.journery/deploy.sh

NAS="Setu@10.0.0.10"
JOUR="/Users/setugk/Seafile/Projects/journery"
BUILD="/volume1/docker/journery-build"
SOCK="/tmp/journery-deploy.sock"

log() { echo "$(date '+%H:%M:%S') $1"; }

# Open a single SSH master connection — one password prompt for all uploads.
log "Connecting to NAS..."
ssh -M -S "$SOCK" -fN "$NAS" || { log "SSH connection failed"; exit 1; }

upload() {
  ssh -S "$SOCK" "$NAS" "cat > $1" < "$2" && log "  uploaded: $1"
}

log "Uploading source files..."
upload "$BUILD/app.py"               "$JOUR/app.py"
upload "$BUILD/db.py"                "$JOUR/db.py"
upload "$BUILD/Dockerfile"           "$JOUR/Dockerfile"
upload "$BUILD/templates/index.html" "$JOUR/templates/index.html"
upload "$BUILD/static/style.css"     "$JOUR/static/style.css"
upload "$BUILD/static/app.js"        "$JOUR/static/app.js"
upload "$BUILD/static/demo.js"       "$JOUR/static/demo.js"
upload "$BUILD/rebuild.sh"           "$JOUR/rebuild.sh"

ssh -S "$SOCK" -O exit "$NAS" 2>/dev/null

# Interactive sudo — prompts once, no password stored in script.
log "Building image and restarting instances (sudo password required)..."
ssh -t "$NAS" "sudo chmod +x $BUILD/rebuild.sh && sudo $BUILD/rebuild.sh"

log "Done."
