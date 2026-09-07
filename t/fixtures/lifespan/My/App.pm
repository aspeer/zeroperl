package My::App;
use strict;
use warnings;
use Future::AsyncAwait;
use Future::IO;
use vars qw($STARTS $STOPS);
$STARTS=0;
$STOPS=0;

async sub startup {
    my ($app_or, $scope_hr)=@_;
    die "invalid callback context\n" unless ($app_or->isa('WebDyne::PAGI')&&($scope_hr->{'type'} eq 'lifespan'));
    die "callback fixture failed\n" if $ENV{'WEBDYNE_TEST_STARTUP_FAIL'};
    await Future::IO->sleep(0.01) if $ENV{'WEBDYNE_TEST_STARTUP_DELAY'};
    $STARTS++;
    return;
}

sub shutdown {
    my ($app_or, $scope_hr)=@_;
    die "invalid shutdown context\n" unless ($app_or->isa('WebDyne::PAGI')&&($scope_hr->{'type'} eq 'lifespan'));
    $STOPS++;
    return;
}
1;
