package Pagi::WebDyne;

use strict;
use warnings;

use Future::IO;
use Future::IO::Impl::ZeroPerl;

#  WebDyne::PAGI deliberately localizes %ENV to a small request-safe set while
#  rendering a page. Register the runtime-owned temporary directory before that
#  module captures its environment baseline, so File::Temp and application code
#  continue to see TMPDIR during every HTTP, SSE, and WebSocket request.
#
BEGIN {
    $ENV{'TMPDIR'}='/tmp' unless defined($ENV{'TMPDIR'});

    #  Loading the PAGI constants before WebDyne::PAGI would otherwise make
    #  WebDyne's normal module-presence probe observe a partially initialized
    #  runtime. This public environment override states the known host mode.
    #
    $ENV{'WEBDYNE_PAGI'}='1' unless defined($ENV{'WEBDYNE_PAGI'});
    require WebDyne::PAGI::Constant;
    $WebDyne::PAGI::Constant::Constant{'WEBDYNE_PAGI_ENV_SET'}->{'TMPDIR'}=$ENV{'TMPDIR'};
}

use WebDyne::PAGI;

#  Install the Worker timer backend before any PSP can call PAGI::SSE->every().
#
Future::IO->override_impl('Future::IO::Impl::ZeroPerl');

#  The Worker sets this package variable before loading this file. It is a
#  runtime-bootstrap binding, intentionally not a per-request application
#  input: one persistent interpreter owns one WebDyne application instance.
#
use vars qw($CONFIG);
$CONFIG={} unless defined($CONFIG);

my %callback;
foreach my $phase (qw(startup shutdown)) {
    next unless defined($CONFIG->{$phase});
    die "Configured lifespan callbacks require updated WebDyne::PAGI; update the WASM runtime or provide a Perl library overlay\n"
        unless WebDyne::PAGI->can('lifespan_callback');
    $callback{$phase}=resolve_callback($CONFIG->{$phase});
}

#  The root is inside the ZeroPerl virtual filesystem. No filename override is
#  supplied, so WebDyne performs its normal request-path to PSP-file dispatch.
#
my $app_cr=WebDyne::PAGI->new(
    root   => defined($CONFIG->{'root'}) ? $CONFIG->{'root'} : '/app',
    index  => defined($CONFIG->{'index'}) ? $CONFIG->{'index'} : 'app.psp',
    static => defined($CONFIG->{'static'}) ? $CONFIG->{'static'} : 1,
    conf   => defined($CONFIG->{'conf'}) ? $CONFIG->{'conf'} : 0,
    %callback,
)->to_app();


sub resolve_callback {

    my ($name)=@_;
    die "Lifespan callback must be a qualified Perl function name without parentheses\n"
        unless (!ref($name)&&($name=~/\A([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)::([A-Za-z_][A-Za-z0-9_]*)\z/));
    my $module=$1;
    my $module_fn=$module;
    $module_fn=~s{::}{/}g;
    $module_fn.='.pm';
    eval { require $module_fn; 1 } or die "Unable to load lifespan callback $name: $@";
    no strict 'refs';
    my $callback_cr=*{$name}{'CODE'} or die "Lifespan callback $name is not defined\n";
    return $callback_cr;
}


sub application {

    #  WebDyne 3.023 can retain a caught API exception in its global error
    #  stack. A new request must not inherit that diagnostic from an earlier
    #  request served by this persistent interpreter.
    #
    WebDyne::Util::errclr();
    return $app_cr->(@_);
}

1;
