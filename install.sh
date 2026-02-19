#!/bin/sh
# granola-cli installer — downloads the latest release from GitHub.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/joelhooks/granola-cli/main/install.sh | sh
#
# Requires: curl, tar, uname

set -e

REPO="joelhooks/granola-cli"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) PLATFORM="darwin" ;;
  linux)  PLATFORM="linux" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

ASSET="granola-${PLATFORM}-${ARCH}.tar.gz"

# Get latest release tag
TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)

if [ -z "$TAG" ]; then
  echo "Failed to determine latest release"
  exit 1
fi

URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"

echo "🥣 Installing granola-cli $TAG ($PLATFORM/$ARCH)..."

# Download and extract
TMPDIR=$(mktemp -d)
curl -fsSL "$URL" -o "$TMPDIR/$ASSET"
tar -xzf "$TMPDIR/$ASSET" -C "$TMPDIR"

# Install
mkdir -p "$INSTALL_DIR"
mv "$TMPDIR/granola" "$INSTALL_DIR/granola"
chmod +x "$INSTALL_DIR/granola"
rm -rf "$TMPDIR"

echo "✅ Installed to $INSTALL_DIR/granola"

# Check PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "⚠️  Add $INSTALL_DIR to your PATH:"; echo "   export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac

echo ""
echo "Next steps:"
echo "  1. Install mcporter:  npm install -g mcporter"
echo "  2. Authenticate:      granola auth"
echo "  3. List meetings:     granola meetings"
