#!/bin/sh
set -e

PERL_VERSION="${PERL_VERSION:-5.44.0}"
BUILD_EXIFTOOL="${BUILD_EXIFTOOL:-true}"
TRIM="${TRIM:-true}"
NATIVE_DIR="${NATIVE_DIR:-/build/native}"
REPO_DIR="${REPO_DIR:-/build/repo}"
NPROC="${NPROC:-$(nproc)}"

rm -rf /zeroperl/bin

if [ "${BUILD_CPANFILE:-true}" = "true" ]; then
    SITE_PERL="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION"
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi"
    cp -R "$SITE_PERL"/* "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/"
    for archdir in "$SITE_PERL"/*-*; do
        [ -d "$archdir" ] || continue
        cp -R "$archdir"/. "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/"
    done
fi

# The complete core POSIX extension is excluded for WASI, but zeroperl
# provides its commonly used strftime entry point as a built-in XS function.
install -Dm 644 "$REPO_DIR/stubs/POSIX.pm" \
    "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/POSIX.pm"

find /zeroperl -type f \( -name "*.so" -o -name "*.a" -o -name "*.ld" -o -name "*.pod" -o -name "*.h" -o -executable \) -delete

if [ "$BUILD_EXIFTOOL" = "true" ]; then
    SITE_PERL="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION"
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File"
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/Image"
    cp -R "$SITE_PERL/File/"* "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File/" 2>/dev/null || true
    cp -R "$SITE_PERL/Image/"* "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/Image/"
fi

node "$REPO_DIR/tools/delete.js" "$REPO_DIR/tools/delete.txt" /zeroperl "$PERL_VERSION"

if [ "$TRIM" = "true" ]; then
    export PATH="$NATIVE_DIR/prefix/bin:$PATH"
    find /zeroperl -type f \( -name '*.pl' -o -name '*.pm' \) -exec chmod u+w {} \;
    find /zeroperl -type f \( -name '*.pl' -o -name '*.pm' \) -print0 | \
        xargs -0 -P "$NPROC" -I {} sh -c \
        "perltidy --delete-block-comments --delete-side-comments --delete-pod --backup-and-modify-in-place --backup-file-extension='/' '{}'"
fi

mkdir -p "$REPO_DIR/gen"
node "$REPO_DIR/tools/sfs.js" -i /zeroperl -o "$REPO_DIR/gen/zeroperl.h" --prefix /zeroperl
