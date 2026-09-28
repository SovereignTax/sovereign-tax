#!/bin/bash
# Sovereign Tax — macOS Build, Sign, Notarize & Package
# Usage: ./build-mac.sh [upload-name.dmg]
#   Builds a UNIVERSAL app (Apple Silicon + Intel), signs it, packages a DMG,
#   notarizes and staples it. With an argument, the DMG is copied into the
#   Cloudflare downloads folder under that name (the UUID file name listed in
#   version.json); without one it keeps the default SovereignTax-macOS.dmg.

set -e

SIGN_ID="Developer ID Application: Joshua Himmelspach (4K84Q4TST4)"
PROFILE="SovereignTax"
APP_NAME="Sovereign Tax"
DMG_NAME="SovereignTax-macOS.dmg"
TARGET="universal-apple-darwin"
BUNDLE_DIR="src-tauri/target/$TARGET/release/bundle/macos"
UPLOAD_NAME="${1:-$DMG_NAME}"
OUTPUT_DIR="/Users/joshuahimmelspach/Desktop/Sovereign Tax Final/cloudflare-package/downloads"
BUILDS_DIR="/Users/joshuahimmelspach/Desktop/Sovereign Tax Final/builds"

echo "================================================"
echo "  Sovereign Tax — macOS Build Pipeline"
echo "================================================"
echo ""

# Step 1: Build — universal, so the one DMG runs on Apple Silicon and Intel Macs.
# (A plain `npm run tauri build` only targets this Mac's own architecture.)
echo "[1/5] Building universal app (Apple Silicon + Intel)..."
if command -v rustup >/dev/null 2>&1; then
    rustup target add aarch64-apple-darwin x86_64-apple-darwin
fi
npm run tauri build -- --target "$TARGET"
EXECUTABLE=$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$BUNDLE_DIR/$APP_NAME.app/Contents/Info.plist")
ARCHS=$(lipo -archs "$BUNDLE_DIR/$APP_NAME.app/Contents/MacOS/$EXECUTABLE")
if [[ "$ARCHS" != *arm64* || "$ARCHS" != *x86_64* ]]; then
    echo "[ERROR] Expected a universal binary (arm64 + x86_64), got: $ARCHS"
    exit 1
fi
echo "  ✓ Build complete ($ARCHS)"
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
cp /tmp/$DMG_NAME "$OUTPUT_DIR/$UPLOAD_NAME"
echo "  → $OUTPUT_DIR/$UPLOAD_NAME"

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
