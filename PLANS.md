# Current plan

The WebDyne/PAGI runtime, plain PAGI loading and named lifespan callbacks are
on main. This source tree targets release 1.0.6 with WebDyne 3.028.

Completed for the announcement documentation:

- Keep the fork introduction and original upstream README together.
- Make WEBDYNE.md the application guide, starting with a working quick start.
- Keep service configuration and Perl APIs in the WebDyne::Cloudflare README.
- Replace completed development diaries with maintained build, test and
  release instructions. Git history retains the old evidence.
- Checked examples, links and current configuration against source; native,
  JavaScript and focused WASM tests passed.

Optional PAGI lifespan is implemented: applications can decline startup support
without preventing HTTP requests. Verification covers 53 JavaScript tests, 62
native runtime assertions and the lifespan, plain PAGI and callback WASM checks.

Further implementation work is tracked in [BACKLOG.md](BACKLOG.md).
Release preparation and staging are described in [RELEASING.md](RELEASING.md).
A documentation merge does not publish a package.
