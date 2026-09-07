use strict;
use warnings;
use Test::More;
use FindBin;
use JSON::PP ();
use MIME::Base64 qw(encode_base64);
use Encode qw(encode);
require($ENV{'PAGI_RUNNER'} || "$FindBin::Bin/../../bin/pagi-runner.pl");
my $json_or=JSON::PP->new()->canonical();
my $text="hello \x{3c0} \x{1f600}";
my $bytes="\0\xff\r\n";
foreach my $fixture_ar (
    [{type => 'http.response.start', status => 200, headers => [['x-test', $bytes]]},
     {type => 'http.response.start', status => 200, headers_base64 => [[encode_base64('x-test', ''), encode_base64($bytes, '')]]}],
    [{type => 'http.response.body', body => $bytes, more => JSON::PP::false()},
     {type => 'http.response.body', body_base64 => encode_base64($bytes, ''), more => JSON::PP::false()}],
    [{type => 'websocket.send', text => $text},
     {type => 'websocket.send', text_base64 => encode_base64(encode('UTF-8', $text), '')}],
    [{type => 'websocket.send', bytes => $bytes},
     {type => 'websocket.send', bytes_base64 => encode_base64($bytes, '')}],
    [{type => 'sse.send', data => $bytes, id => '001'},
     {type => 'sse.send', data_base64 => encode_base64($bytes, ''), id_base64 => encode_base64('001', '')}],
    [{type => 'lifespan.startup.failed', message => $text},
     {type => 'lifespan.startup.failed', message => $text}],
) {
    my ($event_hr, $expected_hr)=@$fixture_ar;
    my $before=$json_or->encode($event_hr);
    is(Pagi::ZeroPerl::Runner::encode_send_event($event_hr), $json_or->encode($expected_hr), "$event_hr->{'type'} retains wire JSON");
    is($json_or->encode($event_hr), $before, 'input remains unchanged');
}
my @finished;
my $reason=$text;
sub worker_connection_status { return $json_or->encode({connected => JSON::PP::false(), reason => $reason}); }
sub worker_application_finished { push(@finished, $json_or->decode($_[1])); }
my $connection_or=Pagi::ZeroPerl::Connection->new(9);
$connection_or->refresh();
is($connection_or->disconnect_reason(), $text, 'connection status retains Unicode');

my $received_hr;
my $application_or;
sub fixture_app {
    my ($scope_hr, $receive_cr)=@_;
    is($scope_hr->{'path'}, $text, 'scope retains Unicode');
    my $receive_or=$receive_cr->();
    $receive_or->on_done(sub { $received_hr=$_[0]; });
    return $application_or=Future->new();
}
sub worker_receive_register { return 1; }
sub worker_receive_cancel { return; }
Pagi::ZeroPerl::Runner::start_session(1, $json_or->encode({type => 'http', path => $text}), 'main::fixture_app');
Pagi::ZeroPerl::Runner::deliver_receive(1, 1, '{broken');
like($finished[-1]{'error'}, qr/./, 'invalid JSON reports a failure');
is($finished[-1]{'phase'}, 'receive', 'failure phase retained');
ok($finished[-1]{'done'}, 'failure completion boolean');
Pagi::ZeroPerl::Runner::start_session(2, $json_or->encode({type => 'http', path => $text}), 'main::fixture_app');
Pagi::ZeroPerl::Runner::deliver_receive(2, 1, $json_or->encode({type => 'websocket.receive', text_base64 => encode_base64(encode('UTF-8', $text), ''), more => JSON::PP::false()}));
is($received_hr->{'text'}, $text, 'codec recovers after invalid input and restores text');
ok(JSON::PP::is_bool($received_hr->{'more'}), 'decoded boolean remains interoperable');
$application_or->done();
ok($finished[-1]{'done'}, 'success completion boolean');
is(scalar(@finished), 2, 'one completion per session');
done_testing();
