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

build_static() {
    dist="$1"
    archive="$2"
    destination="$3"

    cd "$WORK/$dist"
    # Older ExtUtils::MakeMaker releases load B while generating a Makefile.
    # Use the matching full native Perl so native core XS modules remain
    # available; target Config and module sources still come first in @INC,
    # and wasimake performs the actual target compilation below.
    "$NATIVE_DIR/perl" -I"$WASM_DIR/lib" -I"$WASM_DIR" Makefile.PL LINKTYPE=static
    wasimake make -j"$NPROC"
    mkdir -p "$(dirname "$WASM_DIR/$destination")"
    cp "$(find blib -type f -name "$archive" -print -quit)" "$WASM_DIR/$destination"
    # Keep generated Perl companions paired with their target XS implementation.
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi"
    cp -R blib/lib/. "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/"
    cd "$WORK"
}

build_module_build_static() {
    dist="$1"
    archive="$2"
    destination="$3"

    cd "$WORK/$dist"
    # Put installed site modules before the Perl source tree.  This matters on
    # older releases whose bundled Module::Build is too old for current XS
    # distributions, while cpanm has installed a compatible build-time copy.
    WASIC_FORCE_HOST=1 \
    WASIC_HOST_CC=/usr/bin/cc \
    WASIC_HOST_CXX=/usr/bin/c++ \
    PERL5LIB="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION:$NATIVE_DIR/lib" \
        "$NATIVE_DIR/perl" Build.PL \
        --config linktype=static \
        --config cc=wasic \
        --config ld=wasic \
        --config archlib="$WASM_DIR" \
        --config installarchlib="$WASM_DIR" \
        --config extra_compiler_flags="-I$WASM_DIR/CORE"
    WASI_PERL_CORE="/zeroperl/lib/$PERL_VERSION/wasm32-wasi/CORE" \
    PERL5LIB="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION:$NATIVE_DIR/lib" \
        "$NATIVE_DIR/perl" -MModule::Build Build
    mkdir -p "$(dirname "$WASM_DIR/$destination")"
    built_archive="$(find blib -type f -name "$archive" -print -quit)"
    if [ -z "$built_archive" ]; then
        built_archive="$(find blib -type f -name '*.so' -print -quit)"
    fi
    cp "$built_archive" "$WASM_DIR/$destination"
    # Keep generated Perl companions paired with their target XS implementation.
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi"
    cp -R blib/lib/. "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/"
    cd "$WORK"
}

# Resolve every source archive from the same snapshot used by Carton.
PERL5LIB="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION" \
"$NATIVE_DIR/prefix/bin/perl" "$REPO_DIR/pipeline/cpan-lock.pl" recipes \
    /build/cpan-project "$REPO_DIR/pipeline/cpan-xs.json" > "$WORK/recipes.tsv"
while IFS="$(printf '\t')" read -r source builder archive destination patch_name; do
    source_archive="/build/cpan-project/vendor/cache/authors/id/$source"
    dist_dir="$(basename "$source" | sed 's/\.tar\.gz$//; s/\.tgz$//; s/\.tar\.bz2$//')"
    mkdir -p "$WORK/$dist_dir"
    tar xf "$source_archive" --strip-components=1 -C "$WORK/$dist_dir"
    if [ "$patch_name" != - ]; then
        (cd "$WORK/$dist_dir" && patch -p1 < "$REPO_DIR/patches/$patch_name")
    fi
    case "$builder" in
        makemaker) build_static "$dist_dir" "$archive" "$destination" ;;
        modulebuild) build_module_build_static "$dist_dir" "$archive" "$destination" ;;
        *) echo "Unsupported XS builder: $builder" >&2; exit 1 ;;
    esac
done < "$WORK/recipes.tsv"
