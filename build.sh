#!/usr/bin/env bash
# End-to-end build: container build → versioned WebDyne artifacts.

set -euo pipefail

# Detect platform: Apple Containers on macOS, Docker elsewhere
if command -v container >/dev/null 2>&1; then
  CONTAINER_CMD="container"
elif command -v docker >/dev/null 2>&1; then
  CONTAINER_CMD="docker"
else
  echo "Error: neither 'container' (Apple Containers) nor 'docker' found" >&2
  exit 1
fi

show_help() {
  cat <<'EOF'
Usage: ./build.sh run [shrink-mode]

End-to-end build: container build → artifact extract.

Arguments:
  run              Required to execute the build (prevents accidental runs)
  shrink-mode      Optional: off or full (default: off)

Environment variables:
  PERL_VERSION         Perl version to build (default: 5.44.0)
  BUILD_NUMBER         WebDyne build number (default: release/versions.json)
  ZEROPERL_OVERWRITE   Replace the exact version/build output (default: false)
  EXIFTOOL_VERSION     ExifTool version (default: 13.55)
  ZLIB_VERSION         zlib version (default: 1.3.2)
  ZEROPERL_NO_CACHE    Pass --no-cache to container build (default: false)
  ZEROPERL_EMBED_PREFIX Embed @INC prefix in wasm (default: true)
  CONTAINER_BUILD_MEMORY Memory limit for container builder (default: 5G)

Examples:
  ./build.sh run              # Build with defaults
  ./build.sh run full         # Build with full shrink mode
  BUILD_EXIFTOOL=false ./build.sh run off  # Standard WebDyne build
  PERL_VERSION=5.36.3 BUILD_NUMBER=2 ./build.sh run off
EOF
}

if [ "$#" -eq 0 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  show_help
  exit 0
fi

if [ "$1" != "run" ]; then
  echo "Error: first argument must be 'run'. Use -h for help." >&2
  exit 1
fi

shift

if [ "$#" -gt 1 ]; then
  echo "usage: $0 run [shrink-mode]" >&2
  exit 1
fi

ZEROPERL_SHRINK="${1:-off}"
ZEROPERL_SFS_COMPRESS="${ZEROPERL_SFS_COMPRESS:-}"
PERL_VERSION="${PERL_VERSION:-5.44.0}"
BUILD_NUMBER="$(node tools/release-metadata.mjs build-number "${PERL_VERSION}" "${BUILD_NUMBER:-}")"
ZLIB_VERSION="${ZLIB_VERSION:-1.3.2}"
EXIFTOOL_VERSION="${EXIFTOOL_VERSION:-13.55}"
ZEROPERL_NO_CACHE="${ZEROPERL_NO_CACHE:-false}"
ZEROPERL_EMBED_PREFIX="${ZEROPERL_EMBED_PREFIX:-true}"
ZEROPERL_OVERWRITE="${ZEROPERL_OVERWRITE:-false}"
BUILD_EXIFTOOL="${BUILD_EXIFTOOL:-false}"

RELEASE_ID="${PERL_VERSION}-${BUILD_NUMBER}"
ARTIFACT_BASE="zeroperl-webdyne-${RELEASE_ID}"
WASM_NAME="${ARTIFACT_BASE}.wasm"
REACTOR_NAME="zeroperl-webdyne-reactor-${RELEASE_ID}.wasm"
CONFIG_NAME="config-${RELEASE_ID}.h"
PREFIX_NAME="perl-wasi-prefix-${RELEASE_ID}"
MANIFEST_NAME="manifest-${RELEASE_ID}.json"
CHECKSUMS_NAME="SHA256SUMS-${RELEASE_ID}"
EXIFTOOL_NAME="exiftool-${RELEASE_ID}.min.pl"
VERSION_OUTPUT_DIR="${PWD}/output/${PERL_VERSION}"

FINAL_PATHS=(
  "${VERSION_OUTPUT_DIR}/${WASM_NAME}"
  "${VERSION_OUTPUT_DIR}/${REACTOR_NAME}"
  "${VERSION_OUTPUT_DIR}/${CONFIG_NAME}"
  "${VERSION_OUTPUT_DIR}/${PREFIX_NAME}"
  "${VERSION_OUTPUT_DIR}/${MANIFEST_NAME}"
  "${VERSION_OUTPUT_DIR}/${CHECKSUMS_NAME}"
)
if [ "${BUILD_EXIFTOOL}" = "true" ]; then
  FINAL_PATHS+=("${VERSION_OUTPUT_DIR}/${EXIFTOOL_NAME}")
fi

for path in "${FINAL_PATHS[@]}"; do
  if [ -e "${path}" ] && [ "${ZEROPERL_OVERWRITE}" != "true" ]; then
    echo "Error: ${path} already exists; increment BUILD_NUMBER or set ZEROPERL_OVERWRITE=true" >&2
    exit 1
  fi
done

echo "PERL_VERSION = ${PERL_VERSION}"
echo "BUILD_NUMBER = ${BUILD_NUMBER}"
echo "ZEROPERL_NO_CACHE = ${ZEROPERL_NO_CACHE}"
echo "ZEROPERL_EMBED_PREFIX = ${ZEROPERL_EMBED_PREFIX}"

if [ -z "${ZEROPERL_SFS_COMPRESS}" ]; then
  if [ "${ZEROPERL_SHRINK}" = "full" ]; then
    ZEROPERL_SFS_COMPRESS="true"
  else
    ZEROPERL_SFS_COMPRESS="false"
  fi
fi

# wasm-opt flags: GUFA only for full shrink; other optimizations always present.
WASM_OPT_FLAGS='--generate-global-effects --low-memory-unused -Oz --enable-bulk-memory --enable-sign-ext --enable-reference-types --enable-multivalue --disable-extended-const --strip-producers'
if [ "${ZEROPERL_SHRINK}" = "full" ]; then
  WASM_OPT_FLAGS="--gufa ${WASM_OPT_FLAGS}"
fi

# Optional: container builder RAM. See README / container build --help.
CONTAINER_BUILD_MEMORY="${CONTAINER_BUILD_MEMORY:-5G}"
BUILD_MEM=()
if [ -n "${CONTAINER_BUILD_MEMORY}" ]; then
  BUILD_MEM=(--memory "${CONTAINER_BUILD_MEMORY}")
fi

CONTAINER_BUILD_PARAMETERS=()
if [ "${ZEROPERL_NO_CACHE}" = "true" ]; then
  CONTAINER_BUILD_PARAMETERS=(--no-cache)
fi

${CONTAINER_CMD} build \
  ${BUILD_MEM[@]+"${BUILD_MEM[@]}"} \
  --build-arg "PERL_VERSION=${PERL_VERSION}" \
  --build-arg "BUILD_EXIFTOOL=${BUILD_EXIFTOOL}" \
  --build-arg "EXIFTOOL_VERSION=${EXIFTOOL_VERSION}" \
  --build-arg "ZLIB_VERSION=${ZLIB_VERSION}" \
  --build-arg "WASM_OPT_FLAGS=${WASM_OPT_FLAGS}" \
  --build-arg "ZEROPERL_SHRINK=${ZEROPERL_SHRINK}" \
  --build-arg "ZEROPERL_SFS_COMPRESS=${ZEROPERL_SFS_COMPRESS}" \
  --build-arg "ZEROPERL_EMBED_PREFIX=${ZEROPERL_EMBED_PREFIX}" \
  "${CONTAINER_BUILD_PARAMETERS[@]}" \
  -t "zeroperl-webdyne:${RELEASE_ID}" \
  .

mkdir -p "${VERSION_OUTPUT_DIR}"

if [ "${ZEROPERL_OVERWRITE}" = "true" ]; then
  for path in "${FINAL_PATHS[@]}"; do
    rm -rf -- "${path}"
  done
fi

STAGING_DIR="$(mktemp -d "${VERSION_OUTPUT_DIR}/.staging-${RELEASE_ID}.XXXXXX")"
cleanup() {
  rm -rf -- "${STAGING_DIR}"
}
trap cleanup EXIT

${CONTAINER_CMD} run --rm "zeroperl-webdyne:${RELEASE_ID}" \
  sh -c 'cd /artifacts && tar cf - .' | tar xf - -C "${STAGING_DIR}"

# Core smoke test: wasm-smoke.mjs runs core + core-mod (+ ExifTool if available)
if [ "${ZEROPERL_EMBED_PREFIX}" = "true" ]; then
  node tools/wasm-smoke.mjs "${STAGING_DIR}/zeroperl.wasm"
else
  node tools/wasm-smoke.mjs \
    "${STAGING_DIR}/zeroperl.wasm" \
    "${STAGING_DIR}/perl-wasi-prefix"
fi

mv "${STAGING_DIR}/zeroperl.wasm" "${VERSION_OUTPUT_DIR}/${WASM_NAME}"
mv "${STAGING_DIR}/zeroperl_reactor.wasm" "${VERSION_OUTPUT_DIR}/${REACTOR_NAME}"
mv "${STAGING_DIR}/config.h" "${VERSION_OUTPUT_DIR}/${CONFIG_NAME}"
mv "${STAGING_DIR}/perl-wasi-prefix" "${VERSION_OUTPUT_DIR}/${PREFIX_NAME}"
if [ -f "${STAGING_DIR}/exiftool.min.pl" ]; then
  mv "${STAGING_DIR}/exiftool.min.pl" "${VERSION_OUTPUT_DIR}/${EXIFTOOL_NAME}"
fi

SOURCE_REVISION="$(git rev-parse HEAD)"
SUBMODULE_REVISION="$(git rev-parse HEAD:zeroperl-ts)"
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
  SOURCE_DIRTY="true"
else
  SOURCE_DIRTY="false"
fi
node tools/create-release-manifest.mjs \
  --artifact-dir "${VERSION_OUTPUT_DIR}" \
  --perl-version "${PERL_VERSION}" \
  --build-number "${BUILD_NUMBER}" \
  --wasm "${WASM_NAME}" \
  --reactor "${REACTOR_NAME}" \
  --config "${CONFIG_NAME}" \
  --prefix "${PREFIX_NAME}" \
  --manifest "${MANIFEST_NAME}" \
  --source-revision "${SOURCE_REVISION}" \
  --source-dirty "${SOURCE_DIRTY}" \
  --submodule-revision "${SUBMODULE_REVISION}" \
  --shrink "${ZEROPERL_SHRINK}" \
  --embed-prefix "${ZEROPERL_EMBED_PREFIX}" \
  --build-exiftool "${BUILD_EXIFTOOL}" \
  --exiftool "${EXIFTOOL_NAME}"

(
  cd "${VERSION_OUTPUT_DIR}"
  shasum -a 256 \
    "${WASM_NAME}" \
    "${REACTOR_NAME}" \
    "${CONFIG_NAME}" \
    "${MANIFEST_NAME}" > "${CHECKSUMS_NAME}"
  if [ -f "${EXIFTOOL_NAME}" ]; then
    shasum -a 256 "${EXIFTOOL_NAME}" >> "${CHECKSUMS_NAME}"
  fi
)

cleanup
trap - EXIT

echo "Done: ${VERSION_OUTPUT_DIR}"
find "${VERSION_OUTPUT_DIR}" -maxdepth 1 -mindepth 1 -print | sort
