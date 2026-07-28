#!/usr/bin/env bash
# ============================================================================
# Pi Code — 可重复构建脚本
#
# 用法：
#   chmod +x docs/build-script.sh
#   ./docs/build-script.sh
#
# 环境要求：
#   - Node.js >= 18
#   - npm >= 9
#   - （可选）@vscode/vsce — 用于打包 VSIX
# ============================================================================
set -euo pipefail

echo "============================================"
echo "  Pi Code Build Script"
echo "============================================"
echo "  Node:  $(node --version)"
echo "  NPM:   $(npm --version)"
echo "  OS:    $(uname -s)"
echo "  PWD:   $(pwd)"
echo "============================================"
echo ""

START_TS=$(date +%s)

# Step 1: Clean install
echo "[1/5] Installing dependencies (npm ci)..."
npm ci
echo "Done."
echo ""

# Step 2: TypeScript type check
echo "[2/5] TypeScript compilation check (tsc --noEmit)..."
npm run compile
echo "TypeScript compilation: OK (zero errors)"
echo ""

# Step 3: Webpack build
echo "[3/5] Webpack build (extension + webview)..."
npm run build

if [ -f dist/extension.js ]; then
	EXT_SIZE=$(wc -c <dist/extension.js | tr -d ' ')
	echo "Extension bundle: dist/extension.js (${EXT_SIZE} bytes)"
else
	echo "ERROR: dist/extension.js not found!"
	exit 1
fi

WEBVIEW_OUT=$(ls webview/out/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$WEBVIEW_OUT" -gt 0 ]; then
	echo "Webview bundle: webview/out/ (${WEBVIEW_OUT} files)"
else
	echo "ERROR: webview/out/ is empty!"
	exit 1
fi
echo "Done."
echo ""

# Step 4: Run unit tests
echo "[4/5] Running unit tests (mocha)..."
npm run test:unit
echo "All unit tests passed."
echo ""

# Step 5: Package VSIX (optional)
echo "[5/5] Packaging VSIX (optional, requires @vscode/vsce)..."
if command -v npx 1>/dev/null 2>&1; then
	echo "Attempting VSIX packaging..."
	if npx --yes @vscode/vsce package; then
		VSIX_FILE=""
		for f in pi-code-*.vsix; do
			VSIX_FILE="$f"
			break
		done
		if [ -n "$VSIX_FILE" ]; then
			echo "VSIX package: ${VSIX_FILE}"
			ls -lh "$VSIX_FILE"
		fi
	else
		echo "NOTE: vsce packaging failed, skipping VSIX."
		echo "Install with: npm install -g @vscode/vsce"
	fi
else
	echo "NOTE: npx not available, skipping VSIX packaging."
fi
echo ""

# Summary
END_TS=$(date +%s)
DURATION=$((END_TS - START_TS))
MIN=$((DURATION / 60))
SEC=$((DURATION % 60))

echo "============================================"
echo "  Build Complete"
echo "  Duration: ${MIN}m ${SEC}s"
echo "============================================"
echo ""
echo "  Outputs:"
echo "    - dist/extension.js    (extension bundle)"
echo "    - webview/out/         (webview bundle)"
echo "    - pi-code-*.vsix       (VSIX package, if created)"
echo ""
