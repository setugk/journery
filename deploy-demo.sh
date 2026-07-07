#!/bin/zsh
# Deploy the public DEMO (clipboard-demo, port 5053). Builds journery:latest and
# starts the demo container with DEMO_MODE=1. No data volume / no seed — every
# visitor's data lives only in their own browser (static/demo.js).
# Copy to ~/.journery/deploy-demo.sh. Usage: zsh ~/.journery/deploy-demo.sh

NAS="Setu@10.0.0.10"
JOUR="/Users/setugk/Seafile/Projects/journery"
BUILD="/volume1/docker/journery-build"
SOCK="/tmp/journery-demo.sock"

log() { echo "$(date '+%H:%M:%S') $1"; }

log "Connecting to NAS..."
ssh -M -S "$SOCK" -fN "$NAS" || { log "SSH connection failed"; exit 1; }

upload() {
  ssh -S "$SOCK" "$NAS" "cat > $1" < "$2" && log "  uploaded: $(basename $1)"
}

log "Uploading source files..."
upload "$BUILD/app.py"               "$JOUR/app.py"
upload "$BUILD/db.py"                "$JOUR/db.py"
upload "$BUILD/Dockerfile"           "$JOUR/Dockerfile"
upload "$BUILD/templates/index.html" "$JOUR/templates/index.html"
upload "$BUILD/static/style.css"     "$JOUR/static/style.css"
upload "$BUILD/static/app.js"        "$JOUR/static/app.js"
upload "$BUILD/static/demo.js"       "$JOUR/static/demo.js"
upload "$BUILD/rebuild-demo.sh"      "$JOUR/rebuild-demo.sh"

ssh -S "$SOCK" -O exit "$NAS" 2>/dev/null

log "Building image and starting demo..."
ssh -t "$NAS" "sudo chmod +x $BUILD/rebuild-demo.sh && sudo $BUILD/rebuild-demo.sh"

log "Done. Demo → http://10.0.0.10:5053"
