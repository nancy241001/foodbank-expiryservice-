#!/usr/bin/env bash
# Packages Nancy's backend (src + production node_modules) -> infra/floci/alerts-service.zip
# The same zip is used by two Lambdas: the API (apiHandler) and the daily scan (expiryScanHandler).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$(mktemp -d)"

SVC="$ROOT/services/alerts-reporting-service"
cp -r "$SVC/src" "$SVC/package.json" "$SVC/package-lock.json" "$BUILD/"
(cd "$BUILD" && npm ci --omit=dev --silent)
(cd "$BUILD" && rm -f "$ROOT/infra/floci/alerts-service.zip" && zip -qr "$ROOT/infra/floci/alerts-service.zip" src node_modules package.json)
rm -rf "$BUILD"
echo "built infra/floci/alerts-service.zip"
