#!/bin/bash
# Sovereign Tax — macOS Build, Sign, Notarize & Package
# Usage: ./build-mac.sh

set -e

SIGN_ID="Developer ID Application: Joshua Himmelspach (4K84Q4TST4)"
PROFILE="SovereignTax"
APP_NAME="Sovereign Tax"
DMG_NAME="SovereignTax-macOS.dmg"
BUNDLE_DIR="src-tauri/target/release/bundle/macos"
OUTPUT_DIR="/Users/joshuahimmelspach/Desktop/Sovereign Tax Final/cloudflare-package/downloads"
BUILDS_DIR="/Users/joshuahimmelspach/Desktop/Sovereign Tax Final/builds"

echo "================================================"
echo "  Sovereign Tax — macOS Build Pipeline"
echo "================================================"
echo ""

# Step 1: Build
echo "[1/5] Building app..."
npm run tauri build
echo "  ✓ Build complete"
echo ""

# Step 2: Sign
echo "[2/5] Signing with Developer ID..."
codesign --deep --force --options runtime --sign "$SIGN_ID" "$BUNDLE_DIR/$APP_NAME.app"
codesign --verify --deep --strict "$BUNDLE_DIR/$APP_NAME.app"
echo "  ✓ Signed and verified"
echo ""

# Step 3: Create DMG (with Applications shortcut for drag-to-install)
echo "[3/5] Creating DMG..."
rm -f /tmp/$DMG_NAME
STAGING=/tmp/dmg-staging
rm -rf "$STAGING"
mkdir -p "$STAGING"
cp -R "$BUNDLE_DIR/$APP_NAME.app" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGING" -ov -format UDZO /tmp/$DMG_NAME
rm -rf "$STAGING"
echo "  ✓ DMG created (with Applications shortcut)"
echo ""

# Step 4: Notarize
echo "[4/5] Submitting to Apple for notarization (this may take a few minutes)..."
xcrun notarytool submit /tmp/$DMG_NAME --keychain-profile "$PROFILE" --wait
echo ""

# Step 5: Staple
echo "[5/5] Stapling notarization ticket..."
xcrun stapler staple /tmp/$DMG_NAME
echo "  ✓ Stapled"
echo ""

# Copy to output locations
echo "Copying to output folders..."
cp /tmp/$DMG_NAME "$OUTPUT_DIR/$DMG_NAME"
echo "  → $OUTPUT_DIR/$DMG_NAME"

# Create versioned backup
VERSION=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BUILDS_DIR/$VERSION"
cp /tmp/$DMG_NAME "$BUILDS_DIR/$VERSION/$DMG_NAME"
echo "  → $BUILDS_DIR/$VERSION/$DMG_NAME"

echo ""
echo "================================================"
echo "  ✓ Done! Signed & notarized DMG ready."
echo "  Deploy cloudflare-package to go live."
echo "================================================"
