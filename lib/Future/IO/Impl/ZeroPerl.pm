package Future::IO::Impl::ZeroPerl;

use strict;
use warnings;
use Future;

# This implementation deliberately supplies only timer support. It is the
# portion PAGI::SSE uses for ->every(); Workers do not expose the filehandles
# or polling primitives required by Future::IO's socket-oriented methods.
# JavaScript owns the timeout and later resumes this Future through the PAGI
# session scheduler, so timer and receive Futures can be pending concurrently.

sub sleep {
    my ($class, $seconds) = @_;
    die "Future::IO sleep duration must be a non-negative number\n"
        unless defined($seconds) && $seconds =~ /\A(?:\d+(?:\.\d*)?|\.\d+)\z/ && $seconds >= 0;

    my $session_id = Pagi::ZeroPerl::Runner::current_session_id();
    my $timer_id = main::worker_timer_start($session_id, int($seconds * 1000));
    my $future = Future->new;
    Pagi::ZeroPerl::Runner::register_timer($session_id, $timer_id, $future);

    # Future::wait_any() cancels the losing timer when a disconnect wins. The
    # host owns the actual timeout, so cancellation must be relayed to it.
    $future->on_cancel(sub {
        main::worker_timer_cancel($session_id, $timer_id);
        return;
    });

    return $future;
}

1;
