#!/bin/bash
# Fedora Setup Script for Sovereign Tax Linux Build
# Installs all dependencies required to run ./build-linux.sh
# Tested on: Fedora 39+
# Usage: sudo bash setup-fedora.sh

set -e

echo "================================================"
echo "  Sovereign Tax — Fedora Setup Script"
echo "================================================"
echo ""

# Detect Fedora version
FEDORA_VERSION=$(grep VERSION_ID /etc/os-release | cut -d= -f2)
echo "Detected Fedora $FEDORA_VERSION"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run with sudo"
   exit 1
fi

echo "[1/5] Updating system packages..."
dnf update -y > /dev/null
echo "  ✓ System packages updated"
echo ""

echo "[2/5] Installing build tools and development libraries..."
dnf install -y \
  gcc \
  gcc-c++ \
  make \
  pkg-config \
  openssl-devel \
  gzip \
  zip \
  curl \
  git \
  > /dev/null
echo "  ✓ Build tools installed"
echo ""

echo "[3/5] Installing GTK and Tauri Linux dependencies..."
dnf install -y \
  gtk3-devel \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  patchelf \
  at-spi2-core-devel \
  > /dev/null
echo "  ✓ GTK/Tauri dependencies installed"
echo ""

echo "[4/5] Installing Node.js (LTS)..."
# Install Node.js LTS from NodeSource (Fedora's default is older)
dnf install -y nodejs npm > /dev/null
NODE_VERSION=$(node --version)
echo "  ✓ Node.js $NODE_VERSION installed"
echo ""

echo "[5/5] Installing Rust toolchain..."
# Check if Rust is already installed
if ! command -v cargo &> /dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y > /dev/null 2>&1
  source "$HOME/.cargo/env"
  echo "  ✓ Rust installed via rustup"
else
  echo "  ✓ Rust already installed"
fi

RUST_VERSION=$(rustc --version)
CARGO_VERSION=$(cargo --version)
echo "    $RUST_VERSION"
echo "    $CARGO_VERSION"
echo ""
echo "install linux deploy"
# Download and install linuxdeploy
wget https://github.com/linuxdeploy/linuxdeploy/releases/download/continuous/linuxdeploy-x86_64.AppImage
chmod +x linuxdeploy-x86_64.AppImage
sudo mv linuxdeploy-x86_64.AppImage /usr/local/bin/linuxdeploy

# Also install linuxdeploy-plugin-appimage (often needed)
wget https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage
chmod +x linuxdeploy-plugin-appimage-x86_64.AppImage
sudo mv linuxdeploy-plugin-appimage-x86_64.AppImage /usr/local/bin/linuxdeploy-plugin-appimage
echo "================================================"
echo "  ✓ All dependencies installed!"
echo "================================================"
echo ""
echo "Next steps:"
echo "./build-linux.sh"
echo ""