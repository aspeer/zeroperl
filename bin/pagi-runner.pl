package Pagi::ZeroPerl::Runner;

use strict;
use warnings;
use Future;
use Future::AsyncAwait;
use Cpanel::JSON::XS ();
use MIME::Base64 qw(decode_base64 encode_base64);
use Encode qw(decode encode FB_CROAK);

#  Reuse the bundled XS codec across synchronous JSON operations. The bridge
#  passes character strings, so leave utf8 disabled and retain canonical keys.
#  No incremental parsing or application callbacks are installed on this codec.
#
my $json_or=Cpanel::JSON::XS->new()->canonical()->allow_nonref();

#  `/tmp` is created as a writable directory by the provider-neutral runtime.
#  Keep temporary-file behaviour out of provider configuration and available to
#  modules loaded before the first application request.
#
$ENV{'TMPDIR'}='/tmp' unless defined($ENV{'TMPDIR'});

#  One interpreter serves many sessions; every bridge-owned Future is keyed by
#  Worker-assigned session ID. Applications keep the ordinary PAGI signature.
#
use vars qw(%SESSION $CURRENT_SESSION);


#  Return the session ID active during application startup or a resumed
#  Future. The ZeroPerl Future::IO sleep adapter uses it to associate timers
#  with the calling application; die if called outside an active session.
#
sub current_session_id {

    die "No active PAGI session\n" unless defined($CURRENT_SESSION);
    return $CURRENT_SESSION;
}


#  Look up the shared state for a session ID. Receive, timer and disconnect
#  registration use the returned hashref to retain their pending Futures;
#  die for an unknown session rather than attach work to missing state.
#
sub session {

    my ($session_id)=@_;
    my $session_hr=$SESSION{$session_id};
    return $session_hr if $session_hr;
    die "Unknown PAGI session $session_id\n";
}


package Pagi::ZeroPerl::Connection;


#  Create the connection object installed in the PAGI scope by start_session().
#  Return a blessed object holding the session ID, an initially connected
#  state and the callbacks to notify when a disconnect is observed.
#
sub new {

    my ($class, $session_id)=@_;
    my $self=bless({
        session_id => $session_id,
        connected  => 1,
        callbacks  => [],
        reason     => undef,
    }, $class);
    return $self;
}


#  Poll the JavaScript host for current connection state on behalf of the
#  connection accessors and disconnect waiters. Record a newly observed
#  disconnect through disconnect(); callers use the updated object state,
#  not a return value. Already disconnected objects need no further polling.
#
sub refresh {

    my ($self)=@_;
    return unless $self->{'connected'};
    my $state_hr=$json_or->decode(main::worker_connection_status($self->{'session_id'}));
    $self->disconnect($state_hr->{'reason'}) unless $state_hr->{'connected'};
}


#  Latch a disconnect reported by refresh(), deliver_receive() or
#  deliver_disconnect(), retaining the supplied reason or client_disconnect.
#  Notify registered callbacks once, suppressing their exceptions; this
#  updates connection state and has no meaningful return value.
#
sub disconnect {

    my ($self, $reason)=@_;
    return unless $self->{'connected'};
    $self->{'connected'}=0;
    $self->{'reason'}=defined($reason) ? $reason : 'client_disconnect';
    foreach my $callback_cr (@{$self->{'callbacks'}}) {
        eval { $callback_cr->($self->{'reason'}); 1 };
    }
}


#  Refresh the host state and return 1 while the connection remains open,
#  otherwise 0. Applications can query this through pagi.connection, and
#  the send callback uses it to reject output after disconnection.
#
sub is_connected {

    my $self=shift();
    $self->refresh();
    return $self->{'connected'} ? 1 : 0;
}

#  Refresh the connection and return its recorded disconnect reason, or
#  undef while none is recorded. Applications and the send callback use
#  this to explain why the connection has closed.
#
sub disconnect_reason {

    my $self=shift();
    $self->refresh();
    return $self->{'reason'};
}


#  Register an application callback through the scope's pagi.connection
#  object. Refresh first, then retain the coderef while connected or invoke
#  it immediately with the recorded reason if already disconnected. Reject
#  non-coderefs and return no value after successful registration or delivery.
#
sub on_disconnect {

    my ($self, $callback_cr)=@_;
    die "on_disconnect requires a coderef\n" unless ref($callback_cr) eq 'CODE';
    $self->refresh();
    $self->{'connected'} ? push(@{ $self->{'callbacks'} }, $callback_cr) : $callback_cr->($self->{'reason'});
    return;
}


#  Provide applications with a Future for connection closure. Return an
#  already completed Future with the reason if disconnected; otherwise
#  register a host waiter and retain its Future for deliver_disconnect().
#  Cancelling that Future removes both the Perl and host registrations.
#
sub disconnect_future {

    my ($self)=@_;
    $self->refresh();
    return Future->done($self->{'reason'}) unless $self->{'connected'};
    my $session_hr=Pagi::ZeroPerl::Runner::session($self->{'session_id'});
    my $future_or=Future->new();
    my $id=main::worker_disconnect_register($self->{'session_id'});
    $session_hr->{'disconnect'}{$id}=[$future_or, $self];
    $future_or->on_cancel(sub {
        delete $session_hr->{'disconnect'}{$id};
        main::worker_disconnect_cancel($self->{'session_id'}, $id);
        return;
    });
    return $future_or;
}


#  Handle a JavaScript runtime notification for a registered disconnect
#  waiter. Remove the pending entry, update the connection and resume its
#  Future with the reason under the owning session. Ignore stale session
#  or waiter IDs and return no value.
#
sub deliver_disconnect {

    my ($session_id, $id, $reason)=@_;
    my $session_hr=$Pagi::ZeroPerl::Runner::SESSION{$session_id} or return;
    my $entry_ar=delete $session_hr->{'disconnect'}{$id} or return;
    my ($future_or, $self)=@$entry_ar;
    $self->disconnect($reason);
    Pagi::ZeroPerl::Runner::resume_future($session_id, 'disconnect', sub {
        $future_or->done($reason) unless $future_or->is_ready();
    });
    return;
}


package Pagi::ZeroPerl::Runner;


#  Convert an outgoing PAGI event hashref into canonical JSON for the host.
#  The send callback and send_file_event() use this to preserve byte fields
#  as base64 and encode WebSocket text as UTF-8. Return the wire JSON without
#  modifying the original hash, or die on the validation errors checked here.
#
sub encode_send_event {

    my ($event_hr)=@_;
    die "PAGI \$send requires an event hashref\n" unless ref($event_hr) eq 'HASH';
    my %wire=%$event_hr;
    if ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '')=~/\A(?:http\.response\.(?:start|trailers)|sse\.(?:start|http\.response\.start)|websocket\.http\.response\.start)\z/) {
        my $headers_ar=delete $wire{'headers'};
        $headers_ar=[] unless defined($headers_ar);
        die "PAGI response headers must be an arrayref\n" unless ref($headers_ar) eq 'ARRAY';
        $wire{'headers_base64'}=[map {
            die "PAGI response header must be a [name, value] pair\n" unless ref($_) eq 'ARRAY'&&@$_==2;
            [map { encode_base64($_, '') } @$_];
        } @$headers_ar];
    }
    elsif ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '')=~/\A(?:http\.response|websocket\.http\.response)\.body\z/) {
        die "PAGI response body requires body\n" unless exists($event_hr->{'body'});
        $wire{'body_base64'}=encode_base64(delete $wire{'body'}, '');
    }
    elsif ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '') eq 'sse.send') {
        die "PAGI SSE send requires data\n" unless exists($event_hr->{'data'});
        foreach my $field (qw(data event id)) {
            next unless exists($wire{$field})&&defined($wire{$field});
            $wire{"${field}_base64"}=encode_base64(delete $wire{$field}, '');
        }
    }
    elsif ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '') eq 'sse.comment') {
        my $comment=delete $wire{'comment'};
        $wire{'comment_base64'}=encode_base64(defined($comment) ? $comment : '', '');
    }
    elsif ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '') eq 'sse.keepalive') {
        if (exists($wire{'comment'})) {
            my $comment=delete $wire{'comment'};
            $wire{'comment_base64'}=encode_base64(defined($comment) ? $comment : '', '');
        }
    }
    elsif ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '') eq 'websocket.accept'&&exists($wire{'headers'})) {
        my $headers_ar=delete $wire{'headers'};
        die "PAGI WebSocket accept headers must be an arrayref\n" unless ref($headers_ar) eq 'ARRAY';
        $wire{'headers_base64'}=[map {
            die "PAGI WebSocket accept header must be a [name, value] pair\n" unless ref($_) eq 'ARRAY'&&@$_==2;
            [map { encode_base64($_, '') } @$_];
        } @$headers_ar];
    }
    elsif ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '') eq 'websocket.send') {
        my $has_text=exists($wire{'text'});
        my $has_bytes=exists($wire{'bytes'});
        die "PAGI WebSocket send requires exactly one of text or bytes\n" unless $has_text!=$has_bytes;
        $has_text
            ? ($wire{'text_base64'}=encode_base64(encode('UTF-8', delete $wire{'text'}, FB_CROAK), ''))
            : ($wire{'bytes_base64'}=encode_base64(delete $wire{'bytes'}, ''));
    }
    return $json_or->encode(\%wire);
}


#  Expand a file-backed HTTP body event for the callback built by make_send().
#  Validate the path, offset, length and more flag, read the selected bytes
#  into chunks, then send encoded body events to the host with the requested
#  final more flag. Send an empty body for an empty selection; return no
#  value, or die on invalid input or an open, seek or read failure.
#
sub send_file_event {

    my ($connection_or, $event_hr)=@_;
    die "PAGI response body cannot contain both body and file\n"
        if exists($event_hr->{'body'})&&exists($event_hr->{'file'});
    die "PAGI response file must be a non-empty path\n"
        unless defined($event_hr->{'file'})&&!ref($event_hr->{'file'})&&length($event_hr->{'file'});

    my $offset=exists($event_hr->{'offset'}) ? $event_hr->{'offset'} : 0;
    die "PAGI response file offset must be a non-negative integer\n"
        unless defined($offset)&&$offset=~/\A\d+\z/;
    my $length=$event_hr->{'length'};
    die "PAGI response file length must be a non-negative integer\n"
        if defined($length)&&$length!~/\A\d+\z/;
    my $final_more=exists($event_hr->{'more'}) ? $event_hr->{'more'} : 0;
    die "PAGI response body more must be 0 or 1\n"
        unless $final_more==0||$final_more==1;

    open(my $file_fh, '<:raw', $event_hr->{'file'})
        or die "Unable to open PAGI response file $event_hr->{'file'}: $!\n";
    sysseek($file_fh, $offset, 0)
        or die "Unable to seek PAGI response file $event_hr->{'file'}: $!\n";

    #  The Fetch response sink currently buffers ordinary HTTP bodies, but
    #  chunking here avoids one second full-file copy inside the Perl bridge and
    #  preserves the native PAGI file/offset/length response semantics.
    #
    my $chunk_size=64*1024;
    my $remaining=$length;
    my @chunk;
    while (!defined($remaining)||$remaining>0) {
        my $wanted=defined($remaining)&&$remaining<$chunk_size ? $remaining : $chunk_size;
        last unless $wanted;
        my $read=read($file_fh, my $bytes, $wanted);
        die "Unable to read PAGI response file $event_hr->{'file'}: $!\n" unless defined($read);
        last unless $read;
        $remaining-=$read if defined($remaining);
        push(@chunk, $bytes);
    }
    close($file_fh);

    #  A zero-byte file still needs the terminal body event. Copy only the
    #  protocol fields that apply to an ordinary body event; file-specific
    #  fields must not cross the PAGI wire boundary.
    #
    my $chunk_count=@chunk||1;
    foreach my $index (0..$chunk_count-1) {
        my %body_event=%$event_hr;
        delete @body_event{qw(file offset length)};
        $body_event{'body'}=defined($chunk[$index]) ? $chunk[$index] : '';
        $body_event{'more'}=$index<$#chunk ? 1 : $final_more;
        main::worker_send_event($connection_or->{'session_id'}, encode_send_event(\%body_event));
    }
    return;
}


#  Build the application's PAGI send callback for start_session(). Return a
#  coderef that checks the connection and sends each event through the host,
#  expanding file bodies when needed. Each call returns a completed Future
#  on success or a failed Future for disconnection or a caught send error.
#
sub make_send {

    my ($connection_or)=@_;
    return sub {
        my ($event_hr)=@_;
        my $future_or=Future->new();
        unless ($connection_or->is_connected()) {
            my $reason=$connection_or->disconnect_reason();
            $reason='unknown' unless defined($reason);
            return $future_or->fail('PAGI connection closed: '.$reason, 'pagi.disconnected');
        }
        my $ok=eval {
            if ((defined($event_hr->{'type'}) ? $event_hr->{'type'} : '') eq 'http.response.body'&&exists($event_hr->{'file'})) {
                send_file_event($connection_or, $event_hr);
            }
            else {
                main::worker_send_event($connection_or->{'session_id'}, encode_send_event($event_hr));
            }
            1;
        };
        return $ok ? $future_or->done() : $future_or->fail($@);
    };
}


#  Build the application's PAGI receive callback for start_session(). Return
#  a coderef whose calls register a host receive waiter and return a pending
#  Future for deliver_receive() to complete with an event hashref. Registration
#  errors fail the Future; cancellation removes the Perl and host waiter.
#
sub make_receive {

    my ($connection_or)=@_;
    return sub {
        my $future_or=Future->new();
        my $ok=eval {
            my $session_hr=session($connection_or->{'session_id'});
            my $id=main::worker_receive_register($connection_or->{'session_id'});
            die "Duplicate PAGI receive registration $id\n" if $session_hr->{'receive'}{$id};
            $session_hr->{'receive'}{$id}=[$future_or, $connection_or];
            $future_or->on_cancel(sub {
                delete $session_hr->{'receive'}{$id};
                main::worker_receive_cancel($connection_or->{'session_id'}, $id);
                return;
            });
            1;
        };
        return $future_or->fail($@) unless $ok;
        return $future_or;
    };
}


#  Retain a timer Future under its host-assigned ID in the owning session.
#  The ZeroPerl Future::IO sleep adapter calls this after host registration
#  so deliver_timer() can find the Future later. Return no value, rejecting
#  unknown sessions, non-Futures and duplicate timer IDs with an exception.
#
sub register_timer {

    my ($session_id, $id, $future_or)=@_;
    my $session_hr=session($session_id);
    die "PAGI timer registration requires a Future\n" unless $future_or&&$future_or->isa('Future');
    die "Duplicate PAGI timer registration $id\n" if $session_hr->{'timer'}{$id};
    $session_hr->{'timer'}{$id}=$future_or;
    return;
}


#  Deliver a JavaScript runtime event to the matching pending receive.
#  Remove the waiter, decode wire JSON and base64 payloads, restore UTF-8
#  WebSocket text and record disconnect events on the connection. Resume the
#  Future with the event hashref; report caught errors as session failures.
#  Stale session or waiter IDs are ignored and no value is returned.
#
sub deliver_receive {

    my ($session_id, $id, $event_json)=@_;
    my $session_hr=$SESSION{$session_id} or return;
    my $entry_ar=delete $session_hr->{'receive'}{$id} or return;
    my ($future_or, $connection_or)=@$entry_ar;
    my $ok=eval {
        my $event_hr=$json_or->decode($event_json);
        $event_hr->{'body'}=decode_base64(delete $event_hr->{'body_base64'}) if exists($event_hr->{'body_base64'});
        $event_hr->{'bytes'}=decode_base64(delete $event_hr->{'bytes_base64'}) if exists($event_hr->{'bytes_base64'});
        $event_hr->{'text'}=decode('UTF-8', decode_base64(delete $event_hr->{'text_base64'}), FB_CROAK) if exists($event_hr->{'text_base64'});
        $connection_or->disconnect($event_hr->{'reason'}) if (defined($event_hr->{'type'}) ? $event_hr->{'type'} : '')=~/\A(?:http|sse|websocket)\.disconnect\z/;
        resume_future($session_id, 'receive', sub { $future_or->done($event_hr) unless $future_or->is_ready(); });
        1;
    };
    report_application_failure($session_id, $@, 'receive') unless $ok;
    return;
}


#  Handle a timer expiry from the JavaScript runtime. Remove the registered
#  Future and complete it without result values under its owning session,
#  allowing the awaiting application to continue. Ignore stale session or
#  timer IDs and return no value.
#
sub deliver_timer {

    my ($session_id, $id)=@_;
    my $session_hr=$SESSION{$session_id} or return;
    my $future_or=delete $session_hr->{'timer'}{$id} or return;
    resume_future($session_id, 'timer', sub { $future_or->done() unless $future_or->is_ready(); });
    return;
}

#  Run a completion callback for receive, timer or disconnect delivery with
#  the owning session ID active, so resumed application code registers new
#  work against that session. Future completion can synchronously execute
#  user callbacks; report their exceptions as application failures instead
#  of letting them escape the host call. Return true on success, undef on error.
#
sub resume_future {

    my ($session_id, $phase, $resume_cr)=@_;
    my $ok=eval {
        local $CURRENT_SESSION=$session_id;
        $resume_cr->();
        1;
    };
    report_application_failure($session_id, $@, $phase) unless $ok;
    return $ok;
}


#  Report exceptions caught during startup, receive delivery, Future
#  resumption or completion handling. Remove the session and notify the host
#  once with JSON containing done, error and phase; suppress host callback
#  exceptions so recovery does not create another escaping bridge error.
#  Missing or already reported sessions are ignored; return no value.
#
sub report_application_failure {

    my ($session_id, $error, $phase)=@_;
    my $session_hr=$SESSION{$session_id} or return;
    return if $session_hr->{'failure_reported'}++;
    delete $SESSION{$session_id};
    my %status=(
        done  => Cpanel::JSON::XS::true(),
        error => "$error",
        phase => $phase,
    );
    #  This is a JS host callback, so it must itself not turn a recovered Perl
    #  exception back into an escaping bridge exception.
    #
    eval { main::worker_application_finished($session_id, $json_or->encode(\%status)); 1 };
    return;
}


#  Handle the application's on_ready callback installed by start_session().
#  Remove the session and send the host a JSON completion status, including
#  an error for a failed or cancelled Future. Return no value for completion
#  or a session already removed; host errors propagate to the caller's guard.
#
sub finish_application {

    my ($session_id, $future_or)=@_;
    return unless $SESSION{$session_id};
    my %status=(done => Cpanel::JSON::XS::true());
    if ($future_or->is_failed()) {
        my ($error)=$future_or->failure();
        $status{'error'}="$error";
        $status{'phase'}='application';
    }
    elsif ($future_or->is_cancelled()) {
        $status{'error'}='PAGI application was cancelled';
    }
    delete $SESSION{$session_id};
    main::worker_application_finished($session_id, $json_or->encode(\%status));
    return;
}

#  Drop the Perl session state when the JavaScript runtime aborts startup
#  or a bridge operation before normal application cleanup can run. Return
#  no value; this only removes the registry entry, leaving host cleanup to
#  the caller rather than sending an application completion notification.
#
sub abort_session {

    my ($session_id)=@_;
    delete $SESSION{$session_id};
    return;
}

#  Start an application at the JavaScript runtime's request without waiting
#  for completion. Resolve the named entrypoint, decode the scope and create
#  the session, connection and PAGI receive/send callbacks. Retain the returned
#  application Future and arrange for finish_application() when it is ready;
#  later host events resume pending work in this persistent interpreter.
#  Return no value, report caught application startup errors to the host and
#  let validation errors before application invocation propagate to the caller.
#
sub start_session {

    my ($session_id, $scope_json, $entrypoint)=@_;
    die "Duplicate PAGI session $session_id\n" if $SESSION{$session_id};
    no strict 'refs';
    my $app_cr=*{$entrypoint}{'CODE'} or die "PAGI application entry point $entrypoint is not defined\n";
    my $scope_hr=$json_or->decode($scope_json);
    die "PAGI scope must decode to a hash\n" unless ref($scope_hr) eq 'HASH';
    my $connection_or=Pagi::ZeroPerl::Connection->new($session_id);
    $scope_hr->{'pagi.connection'}=$connection_or;
    my $session_hr=$SESSION{$session_id}={
        connection => $connection_or,
        receive    => {},
        timer      => {},
        disconnect => {},
    };
    local $CURRENT_SESSION=$session_id;
    my $application_or;
    my $ok=eval {
        $application_or=$app_cr->($scope_hr, make_receive($connection_or), make_send($connection_or));
        die "PAGI application must return a Future\n" unless $application_or&&$application_or->isa('Future');
        1;
    };
    unless ($ok) {
        report_application_failure($session_id, $@, 'start');
        return;
    }
    $session_hr->{'application'}=$application_or;
    $application_or->on_ready(sub {
        my $finish_ok=eval { finish_application($session_id, $application_or); 1 };
        report_application_failure($session_id, $@, 'finish') unless $finish_ok;
    });
    return;
}

1;
