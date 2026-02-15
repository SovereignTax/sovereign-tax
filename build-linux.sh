#!/bin/bash
# Sovereign Tax — Linux Build & Package
# Usage: ./build-linux.sh
# NOTE: Must be run on Linux (Ubuntu 22.04+ recommended). Cannot run on macOS.
# Prerequisites: Node.js, Rust, libwebkit2gtk-4.1-dev, libappindicator3-dev, librsvg2-dev, patchelf

set -e

APPIMAGE_NAME="SovereignTax-Linux.AppImage"
BUNDLE_DIR="src-tauri/target/release/bundle/appimage"
OUTPUT_DIR="../cloudflare-package/downloads"
BUILDS_DIR="../builds"

echo "================================================"
echo "  Sovereign Tax — Linux Build Pipeline"
echo "================================================"
echo ""

# Step 1: Install dependencies
echo "[1/3] Installing Node dependencies..."
npm ci
echo "  ✓ Dependencies installed"
echo ""

# Step 2: Build
echo "[2/3] Building Tauri app (this may take a few minutes)..."
npx tauri build
echo "  ✓ Build complete"
echo ""

# Step 3: Copy AppImage
echo "[3/3] Packaging AppImage..."
APPIMAGE_FILE=$(find "$BUNDLE_DIR" -name "*.AppImage" | head -n 1)

if [ -z "$APPIMAGE_FILE" ]; then
  echo "  ✗ ERROR: No AppImage found in $BUNDLE_DIR"
  echo "  Check the build output above for errors."
  exit 1
fi

# Copy to output
if [ -d "$OUTPUT_DIR" ]; then
  cp "$APPIMAGE_FILE" "$OUTPUT_DIR/$APPIMAGE_NAME"
  echo "  → $OUTPUT_DIR/$APPIMAGE_NAME"
fi

# Create versioned backup
VERSION=$(date +%Y-%m-%d_%H%M)
mkdir -p "$BUILDS_DIR/$VERSION"
cp "$APPIMAGE_FILE" "$BUILDS_DIR/$VERSION/$APPIMAGE_NAME"
echo "  → $BUILDS_DIR/$VERSION/$APPIMAGE_NAME"

# Also copy .deb if it was built
DEB_FILE=$(find "src-tauri/target/release/bundle/deb" -name "*.deb" 2>/dev/null | head -n 1)
if [ -n "$DEB_FILE" ]; then
  cp "$DEB_FILE" "$BUILDS_DIR/$VERSION/"
  echo "  → $BUILDS_DIR/$VERSION/$(basename "$DEB_FILE")"
fi

echo ""
echo "================================================"
echo "  ✓ Done! AppImage ready for deployment."
echo "  Deploy cloudflare-package to go live."
echo "================================================"
