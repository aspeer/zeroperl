#!/bin/sh
# Cross-compile the XS distributions in cpanfile as static Perl extensions.
set -e

WASM_DIR="${WASM_DIR:-/build/wasm}"
NATIVE_DIR="${NATIVE_DIR:-/build/native}"
REPO_DIR="${REPO_DIR:-/build/repo}"
PERL_VERSION="${PERL_VERSION:-5.44.0}"
NPROC="${NPROC:-$(nproc)}"
WORK="${WORK:-/build/cpan-xs}"

export PATH="$REPO_DIR/wasi-bin:$PATH"
# MakeMaker is configured against the target tree below. Module::Build itself
# loads IO while generating its Build script, however, and miniperl cannot load
# that target extension dynamically. Its configuration step therefore uses the
# native Perl plus explicit target compiler and header overrides.
export PERL5LIB="$WASM_DIR/lib:$WASM_DIR"
export WASI_TARGET=1

mkdir -p "$WORK"
cd "$WORK"

fetch() {
    url="$1"
    curl -fsSL "$url" | tar -xzf -
}

build_static() {
    dist="$1"
    archive="$2"
    destination="$3"

    cd "$WORK/$dist"
    "$NATIVE_DIR/miniperl" -I"$WASM_DIR/lib" -I"$WASM_DIR" Makefile.PL LINKTYPE=static
    wasimake make -j"$NPROC"
    mkdir -p "$(dirname "$WASM_DIR/$destination")"
    cp "$(find blib -type f -name "$archive" -print -quit)" "$WASM_DIR/$destination"
    cd "$WORK"
}

build_module_build_static() {
    dist="$1"
    archive="$2"
    destination="$3"

    cd "$WORK/$dist"
    WASIC_FORCE_HOST=1 \
    PERL5LIB="$NATIVE_DIR/lib:$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION" \
        "$NATIVE_DIR/perl" Build.PL \
        --config linktype=static \
        --config cc=wasic \
        --config ld=wasic \
        --config archlib="$WASM_DIR" \
        --config installarchlib="$WASM_DIR" \
        --config extra_compiler_flags="-I$WASM_DIR/CORE"
    WASI_PERL_CORE="/zeroperl/lib/$PERL_VERSION/wasm32-wasi/CORE" \
    PERL5LIB="$NATIVE_DIR/lib:$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION" \
        "$NATIVE_DIR/perl" Build
    mkdir -p "$(dirname "$WASM_DIR/$destination")"
    built_archive="$(find blib -type f -name "$archive" -print -quit)"
    if [ -z "$built_archive" ]; then
        built_archive="$(find blib -type f -name '*.so' -print -quit)"
    fi
    cp "$built_archive" "$WASM_DIR/$destination"
    cd "$WORK"
}

fetch "https://www.cpan.org/authors/id/O/OA/OALDERS/HTML-Parser-3.85.tar.gz"
build_static "HTML-Parser-3.85" "Parser.a" "lib/auto/HTML/Parser/Parser.a"

fetch "https://www.cpan.org/authors/id/A/AT/ATOOMIC/Clone-0.50.tar.gz"
build_static "Clone-0.50" "Clone.a" "lib/auto/Clone/Clone.a"

fetch "https://www.cpan.org/authors/id/R/RU/RURBAN/Cpanel-JSON-XS-4.43.tar.gz"
build_static "Cpanel-JSON-XS-4.43" "XS.a" "lib/auto/Cpanel/JSON/XS/XS.a"

fetch "https://www.cpan.org/authors/id/D/DD/DDICK/Crypt-URandom-0.55.tar.gz"
cd "$WORK/Crypt-URandom-0.55"
patch -p1 < "$REPO_DIR/patches/crypt-urandom-wasi.patch"
cd "$WORK"
build_static "Crypt-URandom-0.55" "URandom.a" "lib/auto/Crypt/URandom/URandom.a"

fetch "https://www.cpan.org/authors/id/P/PE/PEVANS/XS-Parse-Sublike-0.41.tar.gz"
build_module_build_static "XS-Parse-Sublike-0.41" "Sublike.a" "lib/auto/XS/Parse/Sublike/Sublike.a"

fetch "https://www.cpan.org/authors/id/P/PE/PEVANS/XS-Parse-Keyword-0.49.tar.gz"
build_module_build_static "XS-Parse-Keyword-0.49" "Keyword.a" "lib/auto/XS/Parse/Keyword/Keyword.a"

fetch "https://www.cpan.org/authors/id/P/PE/PEVANS/Future-XS-0.15.tar.gz"
build_module_build_static "Future-XS-0.15" "XS.a" "lib/auto/Future/XS/XS.a"

fetch "https://www.cpan.org/authors/id/P/PE/PEVANS/Future-AsyncAwait-0.71.tar.gz"
build_module_build_static "Future-AsyncAwait-0.71" "AsyncAwait.a" "lib/auto/Future/AsyncAwait/AsyncAwait.a"
