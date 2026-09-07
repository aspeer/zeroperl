package RunnerBench;
use strict;
use warnings;
use JSON::PP ();
use Time::HiRes qw(time);

my $small_hr={type => 'sse.send', data => 'stream update', id => '42'};
my $body_hr={type => 'http.response.body', body => ("\0\xffhello\n" x 8192), more => JSON::PP::false()};
my $scope='{"type":"http","path":"/hello","method":"GET","headers":[["accept","text/html"]],"extensions":{}}';
my $connection_or=Pagi::ZeroPerl::Connection->new(1);
my %case=(
    sse => sub { Pagi::ZeroPerl::Runner::encode_send_event($small_hr); },
    body64k => sub { Pagi::ZeroPerl::Runner::encode_send_event($body_hr); },
    poll => sub { $connection_or->refresh(); },
    lifecycle => sub { Pagi::ZeroPerl::Runner::start_session(1, $scope, 'RunnerBench::app'); },
);

sub app {
    my ($scope_hr, $receive_cr, $send_cr)=@_;
    $send_cr->({type => 'http.response.start', status => 200, headers => []})->get();
    $send_cr->({type => 'http.response.body', body => 'hello', more => 0})->get();
    return Future->done();
}

sub run {
    my ($name, $count)=@_;
    my $case_cr=$case{$name} or die "Unknown benchmark $name";
    $case_cr->() for 1..($name eq 'body64k' ? 100 : 5000);
    my @sample;
    foreach (1..5) {
        my $start=time();
        $case_cr->() for 1..$count;
        push(@sample, (time()-$start)*1e6/$count);
    }
    print(JSON::PP->new()->encode({case => $name, iterations => $count,
        perl => "$^V", samples_us => \@sample}), "\n");
}

package main;
sub worker_connection_status { return '{"connected":true}'; }
sub worker_send_event { return; }
sub worker_application_finished { return; }
1;
