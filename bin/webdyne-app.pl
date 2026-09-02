package Pagi::WebDyne;

use strict;
use warnings;

use Future::IO;
use Future::IO::Impl::ZeroPerl;
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
    root   => $CONFIG->{root}   // '/htdocs',
    index  => $CONFIG->{index}  // 'index.psp',
    static => $CONFIG->{static} // 0,
    conf   => $CONFIG->{conf}   // 0,
)->to_app;

sub application {
    return $app->(@_);
}

1;
