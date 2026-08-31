# Build and runtime notes

## Perl version and artifact layout

- The default Perl source version is now **5.44.0** in the Docker build,
  pipeline scripts, and build documentation.
- A successful 5.44.0 build produces `zeroperl.wasm`,
  `zeroperl_reactor.wasm`, `config.h`, and `perl-wasi-prefix/` in `output/`.
- The prefix is embedded in `zeroperl.wasm`. The extracted
  `perl-wasi-prefix/` is retained for inventory, comparison, and optional
  application-module staging; a consumer does not mount it for normal use.
- Qualified standard artifacts are Perl 5.18.4, 5.36.3, and 5.44.0. Perl
  5.24.4 is excluded because real WebDyne Chain/Template execution traps in
  `_asyncjmp_longjmp` even though its low-level async probes pass.

## cpanfile and XS support

- `BUILD_CPANFILE` (default `true`) installs the project `cpanfile`, including
  WebDyne 3.023 and PAGI::Tools 0.002002, into the native prefix; copies its
  runtime modules into the WASI prefix; builds the needed XS distributions as
  static archives; and links and embeds the complete prefix in the wasm.
- The static CPAN XS extensions are HTML::Parser, Clone, Cpanel::JSON::XS,
  Crypt::URandom, XS::Parse::Sublike, XS::Parse::Keyword, Future::XS, and
  Future::AsyncAwait. Future::IO is pure Perl and is included through the
  copied prefix.
- `wasi-bin/wasic` supports Module::Build distributions by replacing the
  native Perl CORE include path with the WASI one and packaging the produced
  objects as static archives.
- `Crypt::URandom` is patched to obtain entropy with `__wasi_random_get`.

## Core extensions and compatibility surface

- The static wasm link and XS bootstrap registry include mro, B, Socket,
  Storable, and the CPAN XS extensions above.
- PerlIO::scalar is linked explicitly through Perl 5.36 for
  WebDyne::Compile's scalar-backed source handles. Perl 5.44 folds this layer
  into the interpreter. Perl 5.18 also links Tie::Hash::NamedCapture, required
  through WebDyne::Session's Crypt::URandom dependency path.
- Socket is built as a static core extension. The Socket WASI patch disables
  the Unix-domain socket pack/unpack code because WASI does not provide a
  complete `sockaddr_un` definition.
- The complete core POSIX extension remains excluded. Instead, zeroperl
  supplies a small `POSIX.pm` facade and built-in `POSIX::strftime`, using
  Perl's `sv_strftime_ints` helper. This supports
  `use POSIX qw(strftime)` without linking the entire POSIX XS module.

## Local smoke tests

- `node tools/smoke-socket.mjs` loads the standard artifact under Node WASI
  and verifies Socket's static bootstrap and `inet_aton`.
- `node tools/smoke-asyncify-free.mjs` is a regression probe for Perl value
  release across an asynchronous host callback. It covers `value_free`,
  `decref`, `result_free`, array free/clear, and hash free/clear/delete.
  Use `--case=<name>` to run one release path, for example:

  ```sh
  node tools/smoke-asyncify-free.mjs --case=value_free
  ```

  All eight release paths pass on each qualified standard artifact.

## Verified build

- Complete Perl 5.18.4, 5.36.3, and 5.44.0 builds completed with ExifTool
  disabled and the WebDyne/PAGI runtime embedded.
- Each resulting wasm passed the core and static-XS smoke, embedded `@INC`,
  all eight async-disposal probes, and a 115-request persistent Worker
  Chain/Template regression with an empty optional-module archive.
- The Asyncify capture buffer is 64 KiB. This did not repair Perl 5.24.4, but
  it passed every retained version and provides headroom for complex pages;
  the WebAssembly execution stack remains a separate 8 MiB allocation.
