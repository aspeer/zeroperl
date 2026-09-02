package Pagi::WebDyne;

use strict;
use warnings;

use Future::IO;
use Future::IO::Impl::ZeroPerl;

# WebDyne::PAGI deliberately localizes %ENV to a small request-safe set while
# rendering a page. Register the runtime-owned temporary directory before that
# module captures its environment baseline, so File::Temp and application code
# continue to see TMPDIR during every HTTP, SSE, and WebSocket request.
BEGIN {
    $ENV{TMPDIR} //= '/tmp';
    # Loading the PAGI constants before WebDyne::PAGI would otherwise make
    # WebDyne's normal module-presence probe observe a partially initialized
    # runtime. This public environment override states the known host mode.
    $ENV{WEBDYNE_PAGI} //= '1';
    require WebDyne::PAGI::Constant;
    $WebDyne::PAGI::Constant::Constant{'WEBDYNE_PAGI_ENV_SET'}->{'TMPDIR'}=$ENV{TMPDIR};
}

use WebDyne::PAGI;

# Install the Worker timer backend before any PSP can call PAGI::SSE->every().
Future::IO->override_impl('Future::IO::Impl::ZeroPerl');

# The Worker sets this package variable before loading this file. It is a
# runtime-bootstrap binding, intentionally not a per-request application
# input: one persistent interpreter owns one WebDyne application instance.
our $CONFIG;
$CONFIG //= {};

# The root is inside the ZeroPerl virtual filesystem. No filename override is
# supplied, so WebDyne performs its normal request-path to PSP-file dispatch.
my $app = WebDyne::PAGI->new(
    root   => $CONFIG->{root}   // '/app',
    index  => $CONFIG->{index}  // 'app.psp',
    static => $CONFIG->{static} // 1,
    conf   => $CONFIG->{conf}   // 0,
)->to_app;

sub application {
    return $app->(@_);
}

1;
