use strict;
use warnings;
use Test::More;
use FindBin;
use lib "$FindBin::Bin/../../lib", "$FindBin::Bin/../fixtures/lifespan";
use Future;
use WebDyne::PAGI;

plan(skip_all => 'requires WebDyne with lifespan callbacks') unless WebDyne::PAGI->can('lifespan_callback');
{ no warnings 'once'; $Pagi::WebDyne::CONFIG={root => '.', static => 0, startup => 'My::App::startup', shutdown => 'My::App::shutdown'}; }
require "$FindBin::Bin/../../bin/webdyne-app.pl";
my (@receive, @event);
my $future_or=Pagi::WebDyne::application({type => 'lifespan'},
    sub { my $receive_or=Future->new(); push(@receive, $receive_or); return $receive_or },
    sub { push(@event, $_[0]); return Future->done() },
);
shift(@receive)->done({type => 'lifespan.startup'});
{ no warnings 'once'; is($My::App::STARTS, 1, 'named startup module loaded and invoked'); }
is($event[0]{'type'}, 'lifespan.startup.complete', 'startup acknowledged');
shift(@receive)->done({type => 'lifespan.shutdown'});
{ no warnings 'once'; is($My::App::STOPS, 1, 'named shutdown invoked'); }
is($event[1]{'type'}, 'lifespan.shutdown.complete', 'shutdown acknowledged');
ok($future_or->is_done(), 'lifespan finishes');
foreach my $name ('startup', 'My::App::startup()', 'My::App;die', 'My/App::startup') {
    my $ok=eval { Pagi::WebDyne::resolve_callback($name); 1 };
    ok(!$ok, 'reject callback expression or malformed name');
    like($@, qr/qualified Perl function name/, 'invalid name diagnostic');
}
my $ok=eval { Pagi::WebDyne::resolve_callback('My::App::missing'); 1 };
ok(!$ok, 'missing function fails');
like($@, qr/not defined/, 'missing function diagnostic');
$ok=eval { Pagi::WebDyne::resolve_callback('Missing::LifespanFixture::startup'); 1 };
ok(!$ok, 'missing module fails');
like($@, qr/Unable to load lifespan callback/, 'missing module diagnostic');
done_testing();
