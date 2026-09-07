# WebDyne application bootstrap

`webdyne-app.pl` constructs the persistent WebDyne PAGI application and exposes
`Pagi::WebDyne::application` to the session runner. The JavaScript runtime sets
`$Pagi::WebDyne::CONFIG` before loading the file. This is bootstrap configuration,
not request input.

`root`, `index`, `static` and `conf` retain the normal WebDyne meanings.
Optional `startup` and `shutdown` values are qualified Perl function names such
as `My::App::startup`, with no parentheses or arguments. Their modules must be
available in `@INC`. The bootstrap requires the module, resolves the function
and passes its coderef into `WebDyne::PAGI->new`. It does not evaluate callback
names as Perl source. Invalid names, missing modules/functions and an older
WebDyne without callback support fail bootstrap.

WebDyne invokes callbacks as `($app_or, $scope_hr)` when the host sends the
corresponding lifespan event. Synchronous returns succeed; returned Futures are
awaited; exceptions and failed Futures produce the matching failure event.
The current Worker sends startup only, so shutdown configuration does not yet
cause a shutdown invocation. No shared state or Cloudflare capability lifetime
change is implied.

`Future::IO` timer setup precedes callback module loading. Existing WebDyne
environment setup and per-request diagnostic clearing remain in this bootstrap.
