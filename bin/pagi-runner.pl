package Pagi::ZeroPerl::Runner;

use strict;
use warnings;
use Future;
use Future::AsyncAwait;
use JSON::PP;
use MIME::Base64 qw(decode_base64 encode_base64);
use Encode qw(decode encode FB_CROAK);

# One interpreter serves many sessions; every bridge-owned Future is keyed by
# Worker-assigned session ID. Applications keep the ordinary PAGI signature.
our %SESSION;
our $CURRENT_SESSION;

sub current_session_id {
    die "No active PAGI session\n" unless defined $CURRENT_SESSION;
    return $CURRENT_SESSION;
}

sub _session {
    my ($session_id) = @_;
    my $session = $SESSION{$session_id};
    return $session if $session;
    die "Unknown PAGI session $session_id\n";
}

package Pagi::ZeroPerl::Connection;

sub new {
    my ($class, $session_id) = @_;
    return bless { session_id => $session_id, connected => 1, callbacks => [], reason => undef }, $class;
}

sub _refresh {
    my ($self) = @_;
    return unless $self->{connected};
    my $state = JSON::PP->new->decode(main::worker_connection_status($self->{session_id}));
    $self->_disconnect($state->{reason}) unless $state->{connected};
}

sub _disconnect {
    my ($self, $reason) = @_;
    return unless $self->{connected};
    $self->{connected} = 0;
    $self->{reason} = $reason // 'client_disconnect';
    for my $callback (@{ $self->{callbacks} }) { eval { $callback->($self->{reason}); 1 }; }
}

sub is_connected { my $self = shift; $self->_refresh; return $self->{connected} ? 1 : 0; }
sub disconnect_reason { my $self = shift; $self->_refresh; return $self->{reason}; }

sub on_disconnect {
    my ($self, $callback) = @_;
    die "on_disconnect requires a coderef\n" unless ref $callback eq 'CODE';
    $self->_refresh;
    $self->{connected} ? push(@{ $self->{callbacks} }, $callback) : $callback->($self->{reason});
    return;
}

sub disconnect_future {
    my ($self) = @_;
    $self->_refresh;
    return Future->done($self->{reason}) unless $self->{connected};
    my $session = Pagi::ZeroPerl::Runner::_session($self->{session_id});
    my $future = Future->new;
    my $id = main::worker_disconnect_register($self->{session_id});
    $session->{disconnect}{$id} = [$future, $self];
    $future->on_cancel(sub {
        delete $session->{disconnect}{$id};
        main::worker_disconnect_cancel($self->{session_id}, $id);
        return;
    });
    return $future;
}

sub deliver_disconnect {
    my ($session_id, $id, $reason) = @_;
    my $session = $Pagi::ZeroPerl::Runner::SESSION{$session_id} or return;
    my $entry = delete $session->{disconnect}{$id} or return;
    my ($future, $self) = @$entry;
    $self->_disconnect($reason);
    Pagi::ZeroPerl::Runner::_resume_future($session_id, 'disconnect', sub {
        $future->done($reason) unless $future->is_ready;
    });
    return;
}

package Pagi::ZeroPerl::Runner;

sub encode_send_event {
    my ($event) = @_;
    die "PAGI \$send requires an event hashref\n" unless ref $event eq 'HASH';
    my %wire = %$event;
    if (($event->{type} // '') =~ /\A(?:http\.response\.(?:start|trailers)|sse\.(?:start|http\.response\.start)|websocket\.http\.response\.start)\z/) {
        my $headers = delete $wire{headers} // [];
        die "PAGI response headers must be an arrayref\n" unless ref $headers eq 'ARRAY';
        $wire{headers_base64} = [map {
            die "PAGI response header must be a [name, value] pair\n" unless ref $_ eq 'ARRAY' && @$_ == 2;
            [map { encode_base64($_, '') } @$_];
        } @$headers];
    }
    elsif (($event->{type} // '') =~ /\A(?:http\.response|websocket\.http\.response)\.body\z/) {
        die "PAGI response body requires body\n" unless exists $event->{body};
        $wire{body_base64} = encode_base64(delete $wire{body}, '');
    }
    elsif (($event->{type} // '') eq 'sse.send') {
        die "PAGI SSE send requires data\n" unless exists $event->{data};
        for my $field (qw(data event id)) {
            next unless exists $wire{$field} && defined $wire{$field};
            $wire{"${field}_base64"} = encode_base64(delete $wire{$field}, '');
        }
    }
    elsif (($event->{type} // '') eq 'sse.comment') {
        $wire{comment_base64} = encode_base64(delete $wire{comment} // '', '');
    }
    elsif (($event->{type} // '') eq 'sse.keepalive') {
        $wire{comment_base64} = encode_base64(delete $wire{comment} // '', '') if exists $wire{comment};
    }
    elsif (($event->{type} // '') eq 'websocket.accept' && exists $wire{headers}) {
        my $headers = delete $wire{headers};
        die "PAGI WebSocket accept headers must be an arrayref\n" unless ref $headers eq 'ARRAY';
        $wire{headers_base64} = [map {
            die "PAGI WebSocket accept header must be a [name, value] pair\n" unless ref $_ eq 'ARRAY' && @$_ == 2;
            [map { encode_base64($_, '') } @$_];
        } @$headers];
    }
    elsif (($event->{type} // '') eq 'websocket.send') {
        my $has_text = exists $wire{text};
        my $has_bytes = exists $wire{bytes};
        die "PAGI WebSocket send requires exactly one of text or bytes\n" unless $has_text != $has_bytes;
        $has_text
            ? ($wire{text_base64} = encode_base64(encode('UTF-8', delete $wire{text}, FB_CROAK), ''))
            : ($wire{bytes_base64} = encode_base64(delete $wire{bytes}, ''));
    }
    return JSON::PP->new->canonical->encode(\%wire);
}

sub send_file_event {
    my ($connection, $event) = @_;
    die "PAGI response body cannot contain both body and file\n"
        if exists($event->{body}) && exists($event->{file});
    die "PAGI response file must be a non-empty path\n"
        unless defined($event->{file}) && !ref($event->{file}) && length($event->{file});

    my $offset = exists($event->{offset}) ? $event->{offset} : 0;
    die "PAGI response file offset must be a non-negative integer\n"
        unless defined($offset) && $offset =~ /\A\d+\z/;
    my $length = $event->{length};
    die "PAGI response file length must be a non-negative integer\n"
        if defined($length) && $length !~ /\A\d+\z/;
    my $final_more = exists($event->{more}) ? $event->{more} : 0;
    die "PAGI response body more must be 0 or 1\n"
        unless $final_more == 0 || $final_more == 1;

    open my $fh, '<:raw', $event->{file}
        or die "Unable to open PAGI response file $event->{file}: $!\n";
    sysseek($fh, $offset, 0)
        or die "Unable to seek PAGI response file $event->{file}: $!\n";

    # Cloudflare's response sink currently buffers ordinary HTTP bodies, but
    # chunking here avoids one second full-file copy inside the Perl bridge and
    # preserves the native PAGI file/offset/length response semantics.
    my $chunk_size = 64 * 1024;
    my $remaining = $length;
    my @chunk;
    while (!defined($remaining) || $remaining > 0) {
        my $wanted = defined($remaining) && $remaining < $chunk_size ? $remaining : $chunk_size;
        last unless $wanted;
        my $read = read($fh, my $bytes, $wanted);
        die "Unable to read PAGI response file $event->{file}: $!\n" unless defined($read);
        last unless $read;
        $remaining -= $read if defined($remaining);
        push @chunk, $bytes;
    }
    close $fh;

    # A zero-byte file still needs the terminal body event. Copy only the
    # protocol fields that apply to an ordinary body event; file-specific
    # fields must not cross the PAGI wire boundary.
    my $chunk_count = @chunk || 1;
    for my $index (0 .. $chunk_count - 1) {
        my %body_event = %$event;
        delete @body_event{qw(file offset length)};
        $body_event{body} = $chunk[$index] // '';
        $body_event{more} = $index < $#chunk ? 1 : $final_more;
        main::worker_send_event($connection->{session_id}, encode_send_event(\%body_event));
    }
    return;
}

sub make_send {
    my ($connection) = @_;
    return sub {
        my ($event) = @_;
        my $future = Future->new;
        return $future->fail('PAGI connection closed: ' . ($connection->disconnect_reason // 'unknown'), 'pagi.disconnected')
            unless $connection->is_connected;
        my $ok = eval {
            if (($event->{type} // '') eq 'http.response.body' && exists($event->{file})) {
                send_file_event($connection, $event);
            }
            else {
                main::worker_send_event($connection->{session_id}, encode_send_event($event));
            }
            1;
        };
        return $ok ? $future->done : $future->fail($@);
    };
}

sub make_receive {
    my ($connection) = @_;
    return sub {
        my $future = Future->new;
        my $ok = eval {
            my $session = _session($connection->{session_id});
            my $id = main::worker_receive_register($connection->{session_id});
            die "Duplicate PAGI receive registration $id\n" if $session->{receive}{$id};
            $session->{receive}{$id} = [$future, $connection];
            $future->on_cancel(sub { delete $session->{receive}{$id}; main::worker_receive_cancel($connection->{session_id}, $id); return; });
            1;
        };
        return $future->fail($@) unless $ok;
        return $future;
    };
}

sub register_timer {
    my ($session_id, $id, $future) = @_;
    my $session = _session($session_id);
    die "PAGI timer registration requires a Future\n" unless $future && $future->isa('Future');
    die "Duplicate PAGI timer registration $id\n" if $session->{timer}{$id};
    $session->{timer}{$id} = $future;
    return;
}

sub deliver_receive {
    my ($session_id, $id, $event_json) = @_;
    my $session = $SESSION{$session_id} or return;
    my $entry = delete $session->{receive}{$id} or return;
    my ($future, $connection) = @$entry;
    my $ok = eval {
        my $event = JSON::PP->new->decode($event_json);
        $event->{body} = decode_base64(delete $event->{body_base64}) if exists $event->{body_base64};
        $event->{bytes} = decode_base64(delete $event->{bytes_base64}) if exists $event->{bytes_base64};
        $event->{text} = decode('UTF-8', decode_base64(delete $event->{text_base64}), FB_CROAK) if exists $event->{text_base64};
        $connection->_disconnect($event->{reason}) if ($event->{type} // '') =~ /\A(?:http|sse|websocket)\.disconnect\z/;
        _resume_future($session_id, 'receive', sub { $future->done($event) unless $future->is_ready; });
        1;
    };
    _report_application_failure($session_id, $@, 'receive') unless $ok;
    return;
}

sub deliver_timer {
    my ($session_id, $id) = @_;
    my $session = $SESSION{$session_id} or return;
    my $future = delete $session->{timer}{$id} or return;
    _resume_future($session_id, 'timer', sub { $future->done unless $future->is_ready; });
    return;
}

# Completing a Future can synchronously execute user async callbacks. Do not
# let their exceptions escape the ZeroPerl host call: report one application
# failure and allow the JavaScript bridge to finish that session cleanly.
sub _resume_future {
    my ($session_id, $phase, $resume) = @_;
    my $ok = eval {
        local $CURRENT_SESSION = $session_id;
        $resume->();
        1;
    };
    _report_application_failure($session_id, $@, $phase) unless $ok;
    return $ok;
}

sub _report_application_failure {
    my ($session_id, $error, $phase) = @_;
    my $session = $SESSION{$session_id} or return;
    return if $session->{failure_reported}++;
    delete $SESSION{$session_id};
    my %status = (
        done  => JSON::PP::true,
        error => "$error",
        phase => $phase,
    );
    # This is a JS host callback, so it must itself not turn a recovered Perl
    # exception back into an escaping bridge exception.
    eval { main::worker_application_finished($session_id, JSON::PP->new->canonical->encode(\%status)); 1 };
    return;
}

sub _finish_application {
    my ($session_id, $future) = @_;
    return unless $SESSION{$session_id};
    my %status = (done => JSON::PP::true);
    if ($future->is_failed) { my ($error) = $future->failure; $status{error} = "$error"; $status{phase} = 'application'; }
    elsif ($future->is_cancelled) { $status{error} = 'PAGI application was cancelled'; }
    delete $SESSION{$session_id};
    main::worker_application_finished($session_id, JSON::PP->new->canonical->encode(\%status));
    return;
}

# JavaScript calls this only when startup or a bridge operation has failed
# before the application's own completion callback can clean the session.
sub abort_session {
    my ($session_id) = @_;
    delete $SESSION{$session_id};
    return;
}

# Start without waiting: later Worker events resume the right Future while the
# persistent interpreter remains available for another session's short turn.
sub start_session {
    my ($session_id, $scope_json, $entrypoint) = @_;
    die "Duplicate PAGI session $session_id\n" if $SESSION{$session_id};
    no strict 'refs';
    my $app = *{$entrypoint}{CODE} or die "PAGI application entry point $entrypoint is not defined\n";
    my $scope = JSON::PP->new->decode($scope_json);
    die "PAGI scope must decode to a hash\n" unless ref $scope eq 'HASH';
    my $connection = Pagi::ZeroPerl::Connection->new($session_id);
    $scope->{'pagi.connection'} = $connection;
    my $session = $SESSION{$session_id} = { connection => $connection, receive => {}, timer => {}, disconnect => {} };
    local $CURRENT_SESSION = $session_id;
    my $application;
    my $ok = eval {
        $application = $app->($scope, make_receive($connection), make_send($connection));
        die "PAGI application must return a Future\n" unless $application && $application->isa('Future');
        1;
    };
    unless ($ok) {
        _report_application_failure($session_id, $@, 'start');
        return;
    }
    $session->{application} = $application;
    $application->on_ready(sub {
        my $finish_ok = eval { _finish_application($session_id, $application); 1 };
        _report_application_failure($session_id, $@, 'finish') unless $finish_ok;
    });
    return;
}

1;
