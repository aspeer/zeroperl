use strict;
use warnings;
use Test::More;
use File::Temp qw(tempdir);
use FindBin;
use lib "$FindBin::Bin/../../lib";

my $root=tempdir(CLEANUP => 1);
open(my $app_fh, '>', "$root/app.pagi") or die $!;
print {$app_fh} <<'APP';
my $calls=0;
sub {
    my ($scope_hr, $receive_cr, $send_cr)=@_;
    return [$scope_hr, $receive_cr, $send_cr, ++$calls];
};
APP
close($app_fh) or die $!;
{ no warnings 'once'; $Pagi::WebDyne::CONFIG={root => $root, index => 'app.pagi', startup => 'Missing::Module::startup'}; }
require "$FindBin::Bin/../../bin/webdyne-app.pl";
my $calls=0;
foreach my $type (qw(lifespan http sse websocket)) {
    my $scope_hr={type => $type, path => '/arbitrary/deep/path'};
    my $receive_cr=sub {};
    my $send_cr=sub {};
    my $result_ar=Pagi::WebDyne::application($scope_hr, $receive_cr, $send_cr);
    is_deeply($result_ar, [$scope_hr, $receive_cr, $send_cr, ++$calls], "$type receives unchanged arguments and retained app state");
}
ok(!grep(m{\AWebDyne(?:/|\.pm)}, keys(%INC)), 'no WebDyne modules loaded');
done_testing();
