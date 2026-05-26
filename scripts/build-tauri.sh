#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
APP_DIR="$TAURI_DIR/target/release/bundle/macos/Recording Dashboard.app"
RESOURCES_DIR="$APP_DIR/Contents/Resources"

VERSION=$(node -e "console.log(require('$PROJECT_ROOT/package.json').version)")
DMG_NAME="Recording Dashboard_${VERSION}_aarch64.dmg"

echo "Installing dependencies..."
cd "$PROJECT_ROOT"
npm install --omit=dev 2>&1

echo "Building Tauri app..."
cd "$TAURI_DIR"
cargo tauri build

echo "Copying backend resources into .app bundle..."
mkdir -p "$RESOURCES_DIR"
cp -R "$PROJECT_ROOT/src" "$RESOURCES_DIR/"
cp -R "$PROJECT_ROOT/public" "$RESOURCES_DIR/"
cp -R "$PROJECT_ROOT/scripts" "$RESOURCES_DIR/"
cp -R "$PROJECT_ROOT/node_modules" "$RESOURCES_DIR/"
cp "$PROJECT_ROOT/package.json" "$RESOURCES_DIR/"
[ -f "$PROJECT_ROOT/.env" ] && cp "$PROJECT_ROOT/.env" "$RESOURCES_DIR/" || true
[ -f "$PROJECT_ROOT/package-lock.json" ] && cp "$PROJECT_ROOT/package-lock.json" "$RESOURCES_DIR/" || true
mkdir -p "$RESOURCES_DIR/data"
mkdir -p "$RESOURCES_DIR/recordings"

echo "Rebuilding DMG..."
rm -f "$TAURI_DIR/target/release/bundle/dmg/$DMG_NAME"
hdiutil create -volname "Recording Dashboard" \
  -srcfolder "$APP_DIR" \
  -ov -format UDZO \
  "$TAURI_DIR/target/release/bundle/dmg/$DMG_NAME"

echo "Done!"
echo "  .app: $APP_DIR"
echo "  DMG:  $TAURI_DIR/target/release/bundle/dmg/$DMG_NAME"
