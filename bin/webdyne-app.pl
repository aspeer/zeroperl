package Pagi::WebDyne;

use strict;
use warnings;

use Future::IO;
use Future::IO::Impl::ZeroPerl;

#  Install the Worker timer backend before any PSP can call PAGI::SSE->every().
#
Future::IO->override_impl('Future::IO::Impl::ZeroPerl');

#  The Worker sets this package variable before loading this file. It is a
#  runtime-bootstrap binding, intentionally not a per-request application
#  input: one persistent interpreter owns one WebDyne application instance.
#
use vars qw($CONFIG);
$CONFIG={} unless defined($CONFIG);

my $root=defined($CONFIG->{'root'}) ? $CONFIG->{'root'} : '/app';
my $index=defined($CONFIG->{'index'}) ? $CONFIG->{'index'} : 'app.psp';
my $app_cr;
if ($index=~/\.pagi\z/) {
    require File::Spec;
    require Scalar::Util;
    my $app_fn=File::Spec->rel2abs($index, $root);
    $app_cr=do $app_fn;
    die "Unable to load PAGI application $app_fn: $@" if $@;
    die "Unable to load PAGI application $app_fn: $!\n" unless defined($app_cr);
    die "PAGI application $app_fn must return a coderef\n"
        unless (Scalar::Util::reftype($app_cr) || '') eq 'CODE';
}
else {
    #  Register TMPDIR before WebDyne captures its request environment.
    #
    $ENV{'TMPDIR'}='/tmp' unless defined($ENV{'TMPDIR'});
    $ENV{'WEBDYNE_PAGI'}='1' unless defined($ENV{'WEBDYNE_PAGI'});
    require WebDyne::PAGI::Constant;
    $WebDyne::PAGI::Constant::Constant{'WEBDYNE_PAGI_ENV_SET'}->{'TMPDIR'}=$ENV{'TMPDIR'};
    require WebDyne::PAGI;
    my %callback;
    foreach my $phase (qw(startup shutdown)) {
        next unless defined($CONFIG->{$phase});
        die "Configured lifespan callbacks require updated WebDyne::PAGI; update the WASM runtime or provide a Perl library overlay\n"
            unless WebDyne::PAGI->can('lifespan_callback');
        $callback{$phase}=resolve_callback($CONFIG->{$phase});
    }
    $app_cr=WebDyne::PAGI->new(
        root   => $root,
        index  => $index,
        static => defined($CONFIG->{'static'}) ? $CONFIG->{'static'} : 1,
        conf   => defined($CONFIG->{'conf'}) ? $CONFIG->{'conf'} : 0,
        %callback,
    )->to_app();
}

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

    return $app_cr->(@_);
}

1;
