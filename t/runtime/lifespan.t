use strict;
use warnings;
use Test::More;
use FindBin;
use lib "$FindBin::Bin/../../lib";
use JSON::PP;

{ no warnings 'once'; $Pagi::WebDyne::CONFIG={root => '/tmp', static => 0}; }
require "$FindBin::Bin/../../bin/pagi-runner.pl";
require "$FindBin::Bin/../../bin/webdyne-app.pl";

my @event;
my @completed;
my $receive_id=0;
sub worker_connection_status { return '{"connected":true}'; }
sub worker_receive_register { return ++$receive_id; }
sub worker_receive_cancel { return; }
sub worker_send_event { push(@event, decode_json($_[1])); return; }
sub worker_application_finished { push(@completed, decode_json($_[1])); return; }

Pagi::ZeroPerl::Runner::start_session(1,
    '{"type":"lifespan","pagi":{"version":"0.4","spec_version":"0.3"}}',
    'Pagi::WebDyne::application');
is($receive_id, 1, 'WebDyne waits for a lifespan event');
is(scalar(@event), 0, 'no acknowledgement before startup delivery');
Pagi::ZeroPerl::Runner::deliver_receive(1, 1, '{"type":"lifespan.startup"}');
is_deeply(\@event, [{type => 'lifespan.startup.complete'}], 'actual WebDyne stub acknowledges startup');
is($receive_id, 2, 'WebDyne waits for the next lifecycle event');
is(scalar(@completed), 0, 'startup does not finish the lifespan application');
Pagi::ZeroPerl::Runner::abort_session(1);
{ no warnings 'once'; is(scalar(keys(%Pagi::ZeroPerl::Runner::SESSION)), 0, 'retirement removes the lifespan session'); }
done_testing();
