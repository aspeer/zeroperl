#!/bin/sh
set -e

PERL_VERSION="${PERL_VERSION:-5.44.0}"
# Post-process the installed Perl prefix (/zeroperl) for embedding into
# the WASM binary as a Single File System (SFS).
#
# Pipeline position: runs after build-wasi-perl.sh and optionally
# build-exiftool.sh.
# Tasks:
#   - Copy ExifTool site-lib files into the prefix (if built)
#   - Strip binaries, .so, .a, .pod, and headers
#   - Remove dead code via delete.js (tools/delete.txt manifest)
#   - Restore generated unicore/Heavy.pl when the Perl release requires it
#   - Install File::Glob shim if missing
#   - Strip unicore tables for full-shrink builds
#   - Run perltidy over all .pm/.pl files (optional TRIM step)
#   - Generate the SFS header (zeroperl.h) via sfs.js

BUILD_EXIFTOOL="${BUILD_EXIFTOOL:-false}"
TRIM="${TRIM:-true}"
NATIVE_DIR="${NATIVE_DIR:-/build/native}"
REPO_DIR="${REPO_DIR:-/build/repo}"
NPROC="${NPROC:-$(nproc)}"
ZEROPERL_SHRINK="${ZEROPERL_SHRINK:-off}"
ZEROPERL_SFS_COMPRESS="${ZEROPERL_SFS_COMPRESS:-}"
ZEROPERL_EMBED_PREFIX="${ZEROPERL_EMBED_PREFIX:-true}"

if [ -z "$ZEROPERL_SFS_COMPRESS" ]; then
    if [ "$ZEROPERL_SHRINK" = "full" ]; then
        ZEROPERL_SFS_COMPRESS="true"
    else
        ZEROPERL_SFS_COMPRESS="false"
    fi
fi

rm -rf /zeroperl/bin

copy_site_file() {
    src="$1"
    rel="$2"
    target_arch="/zeroperl/lib/$PERL_VERSION/wasm32-wasi"
    target_core="/zeroperl/lib/$PERL_VERSION"

    # The native dependency resolver may upgrade a core XS distribution (for
    # example Encode on Perl 5.24).  Its .pm file must not shadow the version
    # paired with the statically linked target object.  New CPAN modules have
    # no target-core counterpart and are copied normally.
    if [ -e "$target_arch/$rel" ] || [ -e "$target_core/$rel" ]; then
        return
    fi
    mkdir -p "$(dirname "$target_arch/$rel")"
    cp "$src" "$target_arch/$rel"
}

if [ "${BUILD_CPANFILE:-true}" = "true" ]; then
    SITE_PERL="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION"
    NATIVE_ARCH=$("$NATIVE_DIR/prefix/bin/perl" -MConfig -e 'print $Config{archname}')
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi"

    # Copy architecture-independent site files without descending into the
    # native architecture directories at the root of site_perl.
    for entry in "$SITE_PERL"/*; do
        [ -e "$entry" ] || continue
        [ "$entry" != "$SITE_PERL/$NATIVE_ARCH" ] || continue
        if [ -d "$entry" ]; then
            find "$entry" -type f | while IFS= read -r src; do
                copy_site_file "$src" "${src#"$SITE_PERL"/}"
            done
        elif [ -f "$entry" ]; then
            copy_site_file "$entry" "${entry#"$SITE_PERL"/}"
        fi
    done

    # Flatten native architecture directories, but retain the same core-file
    # collision rule.  Their .so files are removed below after companion Perl
    # sources for deliberately cross-compiled XS modules have been retained.
    for archdir in "$SITE_PERL/$NATIVE_ARCH"; do
        [ -d "$archdir" ] || continue
        find "$archdir" -type f | while IFS= read -r src; do
            copy_site_file "$src" "${src#"$archdir"/}"
        done
    done

    PERL_MINOR=$(echo "$PERL_VERSION" | cut -d. -f2)
    if [ "$PERL_MINOR" -lt 24 ]; then
        # Scalar-List-Utils is deliberately cross-compiled after the core
        # Perl build for 5.18. Override the old core Perl sources with the
        # same 1.70 sources as the replacement static List::Util archive.
        for rel in List/Util.pm List/Util/XS.pm Sub/Util.pm Scalar/List/Utils.pm; do
            for site_root in "$SITE_PERL/$NATIVE_ARCH" "$SITE_PERL"; do
                [ -f "$site_root/$rel" ] || continue
                install -Dm 644 "$site_root/$rel" \
                    "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/$rel"
                break
            done
        done
    fi
fi

# The complete core POSIX extension is excluded for WASI, but zeroperl
# provides its commonly used strftime entry point as a built-in XS function.
install -Dm 644 "$REPO_DIR/stubs/POSIX.pm" \
    "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/POSIX.pm"

find /zeroperl -type f \( -name "*.so" -o -name "*.a" -o -name "*.ld" -o -name "*.pod" -o -name "*.h" -o -executable \) -delete

copy_traced_site_files() {
    list_file="$1"
    site_root="$2"
    while IFS= read -r relpath; do
        [ -n "$relpath" ] || continue
        case "$relpath" in
            "lib/$PERL_VERSION/wasm32-wasi/"*)
                src_rel=${relpath#lib/$PERL_VERSION/wasm32-wasi/}
                src_path="$site_root/$src_rel"
                [ -f "$src_path" ] || continue
                copy_site_file "$src_path" "$src_rel"
                ;;
        esac
    done < "$list_file"
}

if [ "$BUILD_EXIFTOOL" = "true" ]; then
    SITE_PERL="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION"
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File"
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/Image"
    if [ "$ZEROPERL_SHRINK" = "off" ]; then
        for tree in File Image; do
            [ -d "$SITE_PERL/$tree" ] || continue
            find "$SITE_PERL/$tree" -type f | while IFS= read -r src; do
                copy_site_file "$src" "${src#"$SITE_PERL"/}"
            done
        done
    else
        if [ ! -s "$REPO_DIR/gen/traced-files.txt" ]; then
            echo "error: missing or empty traced file list: $REPO_DIR/gen/traced-files.txt" >&2
            exit 1
        fi
        rm -rf "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File" "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/Image"
        mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File" "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/Image"
        copy_traced_site_files "$REPO_DIR/gen/traced-files.txt" "$SITE_PERL"
    fi
fi

node "$REPO_DIR/tools/delete.js" "$REPO_DIR/tools/delete.txt" /zeroperl "$PERL_VERSION"

# delete.js removes the complete generated unicore tree. Perl 5.18 and 5.24
# still load its generated Heavy.pl when a version feature bundle enables
# Unicode semantics; later releases do not generate this file. Use the build
# output itself as the compatibility test instead of guessing a version range.
HEAVY_SRC="$WASM_DIR/lib/unicore/Heavy.pl"
if [ -f "$HEAVY_SRC" ]; then
    mkdir -p "/zeroperl/lib/$PERL_VERSION/unicore"
    cp "$HEAVY_SRC" "/zeroperl/lib/$PERL_VERSION/unicore/Heavy.pl"
    echo "Restored unicore/Heavy.pl for Perl $PERL_VERSION"
fi

if [ -f "$REPO_DIR/tools/file-glob-shim.pm" ] && \
   [ ! -f "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File/Glob.pm" ] && \
   [ ! -f "/zeroperl/lib/$PERL_VERSION/File/Glob.pm" ]; then
    mkdir -p "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File"
    cp "$REPO_DIR/tools/file-glob-shim.pm" \
       "/zeroperl/lib/$PERL_VERSION/wasm32-wasi/File/Glob.pm"
fi

if [ "$ZEROPERL_SHRINK" = "full" ] && [ -x "$REPO_DIR/tools/unicore-strip.pl" ]; then
    perl "$REPO_DIR/tools/unicore-strip.pl" "/zeroperl/lib/$PERL_VERSION"
fi

if [ "$TRIM" = "true" ]; then
    export PATH="$NATIVE_DIR/prefix/bin:$PATH"
    find /zeroperl -type f \( -name '*.pl' -o -name '*.pm' \) -exec chmod u+w {} \;
    SKIP_FILE="$REPO_DIR/tools/perltidy-skip.txt"
    TIDY_LIST="$(mktemp)"
    find /zeroperl -type f \( -name '*.pl' -o -name '*.pm' \) | sort > "$TIDY_LIST"
    while IFS= read -r file; do
        rel="${file#/zeroperl/}"
        skip=""
        if [ -f "$SKIP_FILE" ]; then
            while IFS= read -r pattern; do
                case "$pattern" in
                    ''|\#*) continue ;;
                esac
                case "$rel" in
                    $pattern) skip=1; break ;;
                esac
            done < "$SKIP_FILE"
        fi
        [ -z "$skip" ] || continue
        if ! perltidy --noprofile --mangle --delete-all-comments \
            --backup-and-modify-in-place --backup-file-extension='/' "$file"; then
            echo "error: perltidy failed for $file" >&2
            rm -f "$TIDY_LIST"
            exit 1
        fi
    done < "$TIDY_LIST"
    rm -f "$TIDY_LIST"
fi

mkdir -p "$REPO_DIR/gen"

if [ "$ZEROPERL_EMBED_PREFIX" = "false" ]; then
    echo "ZEROPERL_EMBED_PREFIX=false: generating empty SFS (no embedded prefix)"
    node "$REPO_DIR/tools/sfs.js" --empty -o "$REPO_DIR/gen/zeroperl.h" --prefix /zeroperl
    exit 0
fi

SFS_COMPRESS_FLAG=""
if [ "$ZEROPERL_SFS_COMPRESS" = "true" ]; then
    SFS_COMPRESS_FLAG="--compress"
fi
node "$REPO_DIR/tools/sfs.js" -i /zeroperl -o "$REPO_DIR/gen/zeroperl.h" --prefix /zeroperl $SFS_COMPRESS_FLAG
