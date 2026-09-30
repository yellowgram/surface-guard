#!/bin/sh
set -eu
# Fly volume mounts arrive root-owned; ensure the app user can write entitlements.
if [ -d /data ]; then
  chown -R surfaceguard:surfaceguard /data 2>/dev/null || true
  chmod u+rwX /data 2>/dev/null || true
fi
exec runuser -u surfaceguard -- node dist/src/server.js
