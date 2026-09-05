package Pagi::ZeroPerl::Runner;

use strict;
use warnings;
use Future;
use Future::AsyncAwait;
use JSON::PP;
use MIME::Base64 qw(decode_base64 encode_base64);
use Encode qw(decode encode FB_CROAK);

#  `/tmp` is created as a writable directory by the provider-neutral runtime.
#  Keep temporary-file behaviour out of provider configuration and available to
#  modules loaded before the first application request.
#
$ENV{'TMPDIR'}='/tmp' unless defined($ENV{'TMPDIR'});

#  One interpreter serves many sessions; every bridge-owned Future is keyed by
#  Worker-assigned session ID. Applications keep the ordinary PAGI signature.
#
use vars qw(%SESSION $CURRENT_SESSION);


sub current_session_id {

    die "No active PAGI session\n" unless defined($CURRENT_SESSION);
    return $CURRENT_SESSION;
}


sub session {

    my ($session_id)=@_;
    my $session_hr=$SESSION{$session_id};
    return $session_hr if $session_hr;
    die "Unknown PAGI session $session_id\n";
}


package Pagi::ZeroPerl::Connection;


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


sub refresh {

    my ($self)=@_;
    return unless $self->{'connected'};
    my $state_hr=JSON::PP->new()->decode(main::worker_connection_status($self->{'session_id'}));
    $self->disconnect($state_hr->{'reason'}) unless $state_hr->{'connected'};
}


sub disconnect {

    my ($self, $reason)=@_;
    return unless $self->{'connected'};
    $self->{'connected'}=0;
    $self->{'reason'}=defined($reason) ? $reason : 'client_disconnect';
    foreach my $callback_cr (@{$self->{'callbacks'}}) {
        eval { $callback_cr->($self->{'reason'}); 1 };
    }
}


sub is_connected {

    my $self=shift();
    $self->refresh();
    return $self->{'connected'} ? 1 : 0;
}

sub disconnect_reason {

    my $self=shift();
    $self->refresh();
    return $self->{'reason'};
}


sub on_disconnect {

    my ($self, $callback_cr)=@_;
    die "on_disconnect requires a coderef\n" unless ref($callback_cr) eq 'CODE';
    $self->refresh();
    $self->{'connected'} ? push(@{ $self->{'callbacks'} }, $callback_cr) : $callback_cr->($self->{'reason'});
    return;
}


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
    return JSON::PP->new()->canonical()->encode(\%wire);
}


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


sub register_timer {

    my ($session_id, $id, $future_or)=@_;
    my $session_hr=session($session_id);
    die "PAGI timer registration requires a Future\n" unless $future_or&&$future_or->isa('Future');
    die "Duplicate PAGI timer registration $id\n" if $session_hr->{'timer'}{$id};
    $session_hr->{'timer'}{$id}=$future_or;
    return;
}


sub deliver_receive {

    my ($session_id, $id, $event_json)=@_;
    my $session_hr=$SESSION{$session_id} or return;
    my $entry_ar=delete $session_hr->{'receive'}{$id} or return;
    my ($future_or, $connection_or)=@$entry_ar;
    my $ok=eval {
        my $event_hr=JSON::PP->new()->decode($event_json);
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


sub deliver_timer {

    my ($session_id, $id)=@_;
    my $session_hr=$SESSION{$session_id} or return;
    my $future_or=delete $session_hr->{'timer'}{$id} or return;
    resume_future($session_id, 'timer', sub { $future_or->done() unless $future_or->is_ready(); });
    return;
}

#  Completing a Future can synchronously execute user async callbacks. Do not
#  let their exceptions escape the ZeroPerl host call: report one application
#  failure and allow the JavaScript bridge to finish that session cleanly.
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


sub report_application_failure {

    my ($session_id, $error, $phase)=@_;
    my $session_hr=$SESSION{$session_id} or return;
    return if $session_hr->{'failure_reported'}++;
    delete $SESSION{$session_id};
    my %status=(
        done  => JSON::PP::true(),
        error => "$error",
        phase => $phase,
    );
    #  This is a JS host callback, so it must itself not turn a recovered Perl
    #  exception back into an escaping bridge exception.
    #
    eval { main::worker_application_finished($session_id, JSON::PP->new()->canonical()->encode(\%status)); 1 };
    return;
}


sub finish_application {

    my ($session_id, $future_or)=@_;
    return unless $SESSION{$session_id};
    my %status=(done => JSON::PP::true());
    if ($future_or->is_failed()) {
        my ($error)=$future_or->failure();
        $status{'error'}="$error";
        $status{'phase'}='application';
    }
    elsif ($future_or->is_cancelled()) {
        $status{'error'}='PAGI application was cancelled';
    }
    delete $SESSION{$session_id};
    main::worker_application_finished($session_id, JSON::PP->new()->canonical()->encode(\%status));
    return;
}

#  JavaScript calls this only when startup or a bridge operation has failed
#  before the application's own completion callback can clean the session.
#
sub abort_session {

    my ($session_id)=@_;
    delete $SESSION{$session_id};
    return;
}

#  Start without waiting: later Worker events resume the right Future while the
#  persistent interpreter remains available for another session's short turn.
#
sub start_session {

    my ($session_id, $scope_json, $entrypoint)=@_;
    die "Duplicate PAGI session $session_id\n" if $SESSION{$session_id};
    no strict 'refs';
    my $app_cr=*{$entrypoint}{'CODE'} or die "PAGI application entry point $entrypoint is not defined\n";
    my $scope_hr=JSON::PP->new()->decode($scope_json);
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
