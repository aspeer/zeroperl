#!/bin/sh
set -e

PERL_VERSION="${PERL_VERSION:-5.44.0}"
# Build a native (host-architecture) Perl in /build/native.
# This native perl is used during cross-compilation as hostperl/miniperl
# and to run generate_uudmap.  It also provides a CPAN client for
# installing Module::ScanDeps and any other build-time dependencies.

URLPERL="https://www.cpan.org/src/5.0/perl-${PERL_VERSION}.tar.gz"
NATIVE_DIR="${NATIVE_DIR:-/build/native}"
NPROC="${NPROC:-$(nproc)}"

mkdir -p "$NATIVE_DIR"
curl -fsSL "$URLPERL" | tar -xzf - --strip-components=1 --directory="$NATIVE_DIR"

# perl build variables
PERL_MAJOR=$(echo "$PERL_VERSION" | cut -d. -f1)
PERL_MINOR=$(echo "$PERL_VERSION" | cut -d. -f2)

if [ "$PERL_MAJOR" -lt 5 ] || { [ "$PERL_MAJOR" -eq 5 ] && [ "$PERL_MINOR" -lt 18 ]; }; then
    echo "error: Perl $PERL_VERSION is not supported. Minimum supported release line is 5.18." >&2
    exit 1
fi

PERL_OPTIMIZE="-Oz"
PERL_LIBS="-lm -lcrypt"
PERL_CC="${PERL_CC:-cc}"

cd "$NATIVE_DIR"

# Perl 5.18's Linux ELF probe predates C99 and declares main() without a
# return type. GCC 14 rejects that probe, which makes the hints select obsolete
# dld/.o loading even though the host is ELF. Modernize only the probe itself.
if [ "$PERL_MAJOR" -eq 5 ] && [ "$PERL_MINOR" -le 18 ]; then
    perl -pi -e 's/^main\(\) \{/int main() {/' hints/linux.sh
fi


# The host Perl is a build tool, not part of the WASM artifact. Let Configure
# build its normal dynamically loadable core extensions so CPAN can safely
# upgrade build-time XS dependencies. The target Perl remains fully static.

sh +x ./Configure \
    -sde \
    -Dprefix="$NATIVE_DIR/prefix" \
    -Dusedevel \
    -Uversiononly \
    -Duselargefiles \
    -Uuse64bitint \
    -Uusethreads \
    -Uuseithreads \
    -Uusemultiplicity \
    -Uusesfio \
    -Uuseshrplib \
    -Dusedl \
    -Dd_dlopen \
    -Ddlext=so \
    -Dso=so \
    -Dcccdlflags=-fPIC \
    -Dccdlflags=-Wl,-E \
    -Dlddlflags="-shared -L/usr/local/lib" \
    -Dcc="$PERL_CC" \
    -Doptimize="$PERL_OPTIMIZE" \
    -Dlibs="$PERL_LIBS" \
    -Uusevendorprefix \
    -Uman1dir \
    -Uman3dir \
    -Usiteman1dir \
    -Usiteman3dir \
    -Duseperlio \

make -j"$NPROC"
make install

export PATH="$NATIVE_DIR/prefix/bin:$PATH"

export PERL_MM_USE_DEFAULT=1

# Install Module::ScanDeps: use older version for 5.18 and earlier (latest requires List::Util 1.33+)
if [ "$PERL_MAJOR" -lt 5 ] || { [ "$PERL_MAJOR" -eq 5 ] && [ "$PERL_MINOR" -le 18 ]; }; then
    # Old cpan clients (e.g. v1.9800 in 5.16.3) don't support -T and fail to
    # resolve AUTHOR/Dist-Version to .tar.gz, so install manually.
    curl -fsSL "https://cpan.metacpan.org/authors/id/R/RS/RSCHUPP/Module-ScanDeps-1.31.tar.gz" | tar -xzf - -C /tmp
    cd /tmp/Module-ScanDeps-1.31
    "$NATIVE_DIR/prefix/bin/perl" Makefile.PL
    make
    make install
    cd -
    rm -rf /tmp/Module-ScanDeps-1.31
else
    cpan -T Module::ScanDeps
fi

# Verify installation; fail the build if the module is missing
"$NATIVE_DIR/prefix/bin/perl" -MModule::ScanDeps -e1 || {
    echo "error: Module::ScanDeps is not installed" >&2
    exit 1
}

if [ "${BUILD_CPANFILE:-true}" = "true" ]; then
    echo "yes" | cpan App::cpanminus
    if ! cpanm --installdeps --notest "$REPO_DIR"; then
        echo "error: cpanfile dependency installation failed; recent cpanm logs follow" >&2
        find /root/.cpanm/work -name build.log -type f -exec \
            grep -n -E 'error:|Error|ERROR|failed|FAIL|not supported|undefined' {} \; >&2
        find /root/.cpanm/work -name build.log -type f -exec tail -n 200 {} \; >&2
        exit 1
    fi
fi
