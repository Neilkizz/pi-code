#!/bin/sh
set -eu

# macOS 27 beta Command Line Tools can emit proc-macro dylibs whose LINKEDIT
# string table is only 4-byte aligned. The macOS 27 dyld requires pointer-size
# alignment and reports the failure later as Cargo E0463. Rust's bundled
# ld64.lld produces a dyld-safe layout and is tied to the active toolchain.
rust_sysroot="$(rustc --print sysroot)"
rust_lld="$rust_sysroot/lib/rustlib/aarch64-apple-darwin/bin/rust-lld"

if [ -x "$rust_lld" ]; then
  exec "$rust_lld" "$@"
fi

# Homebrew/Rustup installations can omit the target-local rust-lld binary.
# The Apple linker accepts the same ld64 invocation used above and remains a
# safe development fallback; release CI still verifies the bundled linker when
# it is present.
apple_ld="$(xcrun --find ld 2>/dev/null || true)"
if [ -n "$apple_ld" ] && [ -x "$apple_ld" ]; then
  echo "Pi Desktop: bundled rust-lld unavailable; using Apple ld fallback" >&2
  # `linker-flavor=ld64.lld` makes rustc pass this lld-only preamble. Apple
  # ld otherwise accepts the remaining Darwin linker arguments unchanged.
  if [ "${1:-}" = "-flavor" ] && [ "${2:-}" = "darwin" ]; then
    shift 2
  fi
  exec "$apple_ld" "$@"
fi

echo "Pi Desktop build error: neither bundled ld64.lld nor Apple ld is available" >&2
exit 1
