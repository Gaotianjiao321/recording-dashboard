#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
APP_DIR="$TAURI_DIR/target/release/bundle/macos/Recording Dashboard.app"
RESOURCES_DIR="$APP_DIR/Contents/Resources"

VERSION=$(grep -o '"version": *"[^"]*"' "$TAURI_DIR/tauri.conf.json" | head -1 | sed 's/.*"version": *"\([^"]*\)"/\1/')
DMG_NAME="Recording Dashboard_${VERSION}_aarch64.dmg"
DMG_PATH="$TAURI_DIR/target/release/bundle/dmg/$DMG_NAME"

echo "Building Tauri app (v${VERSION})..."
cd "$TAURI_DIR"
cargo tauri build

echo "Copying backend resources into .app bundle..."
mkdir -p "$RESOURCES_DIR"
cp -R "$PROJECT_ROOT/src" "$RESOURCES_DIR/"
cp -R "$PROJECT_ROOT/public" "$RESOURCES_DIR/"
cp -R "$PROJECT_ROOT/scripts" "$RESOURCES_DIR/"
cp "$PROJECT_ROOT/package.json" "$RESOURCES_DIR/"
[ -f "$PROJECT_ROOT/.env" ] && cp "$PROJECT_ROOT/.env" "$RESOURCES_DIR/" || true
[ -f "$PROJECT_ROOT/package-lock.json" ] && cp "$PROJECT_ROOT/package-lock.json" "$RESOURCES_DIR/" || true
mkdir -p "$RESOURCES_DIR/data"
mkdir -p "$RESOURCES_DIR/recordings"

echo "Rebuilding DMG..."
rm -f "$TAURI_DIR/target/release/bundle/dmg/"Recording\ Dashboard_*.dmg
hdiutil create -volname "Recording Dashboard" \
  -srcfolder "$APP_DIR" \
  -ov -format UDZO \
  "$DMG_PATH"

echo "Done!"
echo "  .app: $APP_DIR"
echo "  DMG:  $DMG_PATH"
