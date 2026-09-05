#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PERL_VERSION=${PERL_VERSION:-$(sed -n 's/^PERL_VERSION ?= //p' release/defaults.mk)}
case "$PERL_VERSION" in
  ''|*[!0-9.]*) echo "Invalid PERL_VERSION: $PERL_VERSION" >&2; exit 1 ;;
esac
mode=${1:-lock}
case "$mode" in lock|update) ;; *) echo 'Expected lock or update' >&2; exit 1 ;; esac
if [[ -z ${CONTAINER_CMD:-} ]]; then
  if command -v container >/dev/null; then CONTAINER_CMD=container; else CONTAINER_CMD=docker; fi
fi
image="zeroperl-cpan-tools:$PERL_VERSION"
build_args=()
if [[ $CONTAINER_CMD == container ]]; then build_args+=(--memory "${CONTAINER_BUILD_MEMORY:-5G}"); fi
"$CONTAINER_CMD" build ${build_args[@]+"${build_args[@]}"} --target native-perl-tools \
  --build-arg "PERL_VERSION=$PERL_VERSION" -t "$image" .
staging=$(mktemp -d "${TMPDIR:-/tmp}/zeroperl-snapshot.XXXXXX")
trap 'rm -rf "$staging"' EXIT
# Send just the inputs through stdin; no writable repository mount is needed.
inputs=(cpanfile)
if [[ $mode == lock && -s cpanfile.snapshot.$PERL_VERSION ]]; then
  inputs+=("cpanfile.snapshot.$PERL_VERSION")
fi
COPYFILE_DISABLE=1 tar cf - "${inputs[@]}" | "$CONTAINER_CMD" run --rm -i "$image" sh -c \
  'tar xf - -C "$REPO_DIR" && sh "$REPO_DIR/pipeline/cpan-snapshot.sh" "$1" >&2 && tar cf - -C /snapshot-output .' sh "$mode" \
  | tar xf - -C "$staging"
for suffix in '' .meta.json; do
  test -s "$staging/cpanfile.snapshot.$PERL_VERSION$suffix"
done
for suffix in '' .meta.json; do
  cp "$staging/cpanfile.snapshot.$PERL_VERSION$suffix" "cpanfile.snapshot.$PERL_VERSION$suffix"
done
printf 'Updated cpanfile.snapshot.%s and its integrity metadata; review the diff before committing.\n' "$PERL_VERSION"
