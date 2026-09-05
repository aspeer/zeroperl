#!/bin/sh
set -eu
mode=${1:?expected lock, update or install}
export PATH="$NATIVE_DIR/prefix/bin:$PATH"
export PERL_MM_USE_DEFAULT=1
# A clean local::lib prevents preinstalled build tools influencing the snapshot.
root=/build/cpan-project
mkdir -p "$root"
cp "$REPO_DIR/cpanfile" "$root/cpanfile"
cd "$root"
helper="$REPO_DIR/pipeline/cpan-lock.pl"
recipes="$REPO_DIR/pipeline/cpan-xs.json"
case "$mode" in
    install)
        for suffix in '' .meta.json; do
            source="$REPO_DIR/cpanfile.snapshot.$PERL_VERSION$suffix"
            if [ ! -s "$source" ]; then
                echo "Missing $source; run make cpanfile.snapshot PERL_VERSION=$PERL_VERSION" >&2
                exit 1
            fi
            cp "$source" "cpanfile.snapshot$suffix"
        done
        perl "$helper" fetch "$root" "$recipes"
        carton install --deployment --cached
        perl "$helper" installed "$root" "$recipes"
        # Existing cross-build tools expect site_perl in the native prefix.
        # The packaged CPAN files are taken from the isolated tree below.
        site="$NATIVE_DIR/prefix/lib/perl5/site_perl/$PERL_VERSION"
        mkdir -p "$site"
        cp -R local/lib/perl5/. "$site/"
        ;;
    lock|update)
        if [ "$mode" = lock ] && [ -s "$REPO_DIR/cpanfile.snapshot.$PERL_VERSION" ]; then
            cp "$REPO_DIR/cpanfile.snapshot.$PERL_VERSION" cpanfile.snapshot
        fi
        carton install
        carton bundle
        perl "$helper" record "$root" "$recipes"
        mkdir -p /snapshot-output
        cp cpanfile.snapshot "/snapshot-output/cpanfile.snapshot.$PERL_VERSION"
        cp cpanfile.snapshot.meta.json "/snapshot-output/cpanfile.snapshot.$PERL_VERSION.meta.json"
        ;;
    *) echo "Unknown snapshot operation: $mode" >&2; exit 1 ;;
esac
