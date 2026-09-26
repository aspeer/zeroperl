# Contributing to ZeroPerl

Bug reports and focused contributions are welcome. Search the
[GitHub issues](https://github.com/aspeer/zeroperl/issues) before opening a new
one, and include a minimal reproduction where possible.

Fork the [GitHub repository](https://github.com/aspeer/zeroperl), create a
topic branch, keep changes focused, and submit a GitHub pull request. For
changes outside the native/WASM build itself, install the locked dependencies
and run the focused checks described in [TESTS.md](TESTS.md), including:

```sh
npm ci
npm --prefix tools ci
npm run test:cloudflare-package
python3 -B t/test_compact_notices.py
python3 -B t/test_runtime_notices.py
python3 -B t/test_licence_review.py
```

Runtime, toolchain, or release-package changes require the applicable build and
artifact checks documented in [BUILD.md](BUILD.md) and [RELEASING.md](RELEASING.md).
Do not publish packages or create releases as part of a contribution.

Do not include credentials or private data. Report potential vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).
