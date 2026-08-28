# Build and runtime notes

## Perl version and artifact layout

- The default Perl source version is now **5.44.0** in the Docker build,
  pipeline scripts, and build documentation.
- A successful 5.44.0 build produces `zeroperl.wasm`,
  `zeroperl_reactor.wasm`, `config.h`, and `perl-wasi-prefix/` in `output/`.
- The prefix is part of the runtime artifact: it contains the Perl `.pm`
  files and must be mounted at `/zeroperl` by the WASI host.

## cpanfile and XS support

- `BUILD_CPANFILE` (default `true`) installs the project `cpanfile` into the
  native prefix, copies its Perl modules into the WASI prefix, builds the
  needed XS distributions as static archives, and links them into the wasm.
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

  The current runtime intentionally fails this probe with `RuntimeError:
  unreachable`; no Asyncify release-path fix has been included yet. The test
  is the regression coverage to run after that fix.

## Verified build

- The complete Docker build for Perl 5.44.0 completed with ExifTool disabled.
- The resulting wasm passed the Socket and mro static-bootstrap runtime
  checks under Node WASI.
