use strict;
use warnings;
use Test::More;
use File::Temp qw(tempdir);
use FindBin;
use lib "$FindBin::Bin/../../lib";
use PAGI::Test::Client;

BEGIN {
    $ENV{'WEBDYNE_CONF'}='.';
    $ENV{'WEBDYNE_ERROR_TEXT'}=1;
}

my $root_dn=tempdir(CLEANUP => 1);
for my $entry_ar (
    ['app.psp', '<start_html><p>clean request</p>'],
    ['caught.psp', <<'PAGE'],
<api handler="caught" pattern="/" canonical>
__PERL__
sub caught {
    eval {die "handled application error\n"};
    return {recovered => 1};
}
PAGE
    ['failed.psp', '<perl>die "current request failure"</perl>'],
) {
    open(my $out_fh, '>', "$root_dn/$entry_ar->[0]") or die $!;
    print {$out_fh} $entry_ar->[1];
    close($out_fh) or die $!;
}
{ no warnings 'once'; $Pagi::WebDyne::CONFIG={root => $root_dn, static => 0}; }
require "$FindBin::Bin/../../bin/webdyne-app.pl";
my $client_or=PAGI::Test::Client->new(app => \&Pagi::WebDyne::application);
for (1..3) {
    my $caught_or=$client_or->get('/caught');
    is($caught_or->status(), 200, 'caught API exception returns success');
    my $clean_or=$client_or->get('/app.psp');
    is($clean_or->status(), 200, 'next page does not inherit the handled error');
    like($clean_or->content(), qr/clean request/, 'next page renders its own body');
}
my $failed_or=$client_or->get('/failed.psp');
is($failed_or->status(), 500, 'uncaught current request error remains an error');
like($failed_or->content(), qr/current request failure/i, 'current error remains visible');
is($client_or->get('/app.psp')->status(), 200, 'normal request recovers after uncaught error');
done_testing();
