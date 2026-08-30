#!/usr/bin/perl
# Core smoke test — exercises core Perl modules available across all
# supported Perl versions (5.18.4+) in the zeroperl WASM build.
# Prints "CORE_SMOKE_OK" on success, dies with diagnostics on failure.
#
# Standard and mini WebDyne artifacts retain these core modules. A missing or
# unusable module is therefore a compatibility failure, not a skip.

use strict;
use warnings;
$| = 1;

my @errors;

print "perl version: $^V\n";

# ── Required core surface ───────────────────────────────────────────────────

# Digest::MD5 (XS, core since 5.8)
eval {
    require Digest::MD5;
    my $md5 = Digest::MD5::md5_hex('zeroperl');
    die "Digest::MD5" unless length($md5) == 32;
    1;
} or push @errors, "Digest::MD5: $@";

# List::Util (XS, core since 5.8)
eval {
    require List::Util;
    my $sum = List::Util::sum(1, 2, 3, 4, 5);
    die "List::Util::sum" unless $sum == 15;
    1;
} or push @errors, "List::Util: $@";

# Cwd (XS, core since 5.4)
eval {
    require Cwd;
    my $cwd = Cwd::getcwd();
    die "Cwd::getcwd" unless defined $cwd && length($cwd) > 0;
    1;
} or push @errors, "Cwd: $@";

# Fcntl (XS, core since 5.4)
eval {
    require Fcntl;
    my $ok = defined &Fcntl::O_RDONLY;
    die "Fcntl::O_RDONLY" unless $ok;
    1;
} or push @errors, "Fcntl: $@";

# MIME::Base64 (XS, core since 5.8)
eval {
    require MIME::Base64;
    my $enc = MIME::Base64::encode_base64('hello');
    my $dec = MIME::Base64::decode_base64($enc);
    die "MIME::Base64 roundtrip" unless $dec eq 'hello';
    1;
} or push @errors, "MIME::Base64: $@";

# The WASI POSIX facade deliberately guarantees the strftime surface used by
# WebDyne without attempting to emulate the complete platform-specific module.
eval {
    require POSIX;
    my $date = POSIX::strftime('%Y-%m-%d', 0, 0, 0, 1, 0, 124);
    die "POSIX::strftime" unless $date eq '2024-01-01';
    1;
} or push @errors, "POSIX::strftime: $@";

# Basic regex and string ops (core language, no module needed)
eval {
    my $s = "Hello, World!";
    die "regex match" unless $s =~ /World/;
    my $r = $s =~ s/World/Perl/r;
    die "regex subst" unless $r eq "Hello, Perl!";
    die "split/join" unless join(':', split(/,/, "a,b,c")) eq "a:b:c";
    1;
} or push @errors, "regex/string: $@";

# File::Spec — core since 5.5.
eval {
    require File::Spec;
    my $cat = File::Spec->catfile('a', 'b', 'c');
    die "File::Spec->catfile" unless $cat && $cat =~ m{a};
    1;
} or push @errors, "File::Spec: $@";

# Numeric formatting is used while loading and running Data::Dumper. Keep a
# separate diagnostic here so a libc/Configure regression is not misreported
# as a module-loading failure.
eval {
    my $s = sprintf('%.6g', 5.021_010);
    die "sprintf" unless length $s;
    1;
} or push @errors, "numeric formatting: $@";

# Data::Dumper — core since 5.6 and a required static XS module. Test loading,
# the pure-Perl implementation and the XS implementation independently.
my $dumper_loaded = eval {
    require Data::Dumper;
    1;
};
push @errors, "Data::Dumper load: $@" unless $dumper_loaded;

if ($dumper_loaded) {
    eval {
        local $Data::Dumper::Useperl = 1;
        my $s = Data::Dumper::Dumper([1, 2, 3]);
        die "Data::Dumper pure Perl" unless $s && $s =~ /\d/;
        1;
    } or push @errors, "Data::Dumper pure Perl: $@";

    eval {
        local $Data::Dumper::Useperl = 0;
        my $s = Data::Dumper::Dumper([1, 2, 3]);
        die "Data::Dumper XS" unless $s && $s =~ /\d/;
        1;
    } or push @errors, "Data::Dumper XS: $@";
}

# IO::File — core since 5.4, but new_tmpfile does not work in WASI (no tmpdir).
# Test file I/O via in-memory write/read on an explicit file path instead.
eval {
    require IO::File;
    my $fh = IO::File->new('/work/_smoke_tmp', 'w');
    die "IO::File->new(w)" unless $fh;
    print $fh "test\n";
    $fh->close;
    $fh = IO::File->new('/work/_smoke_tmp', 'r');
    die "IO::File->new(r)" unless $fh;
    my $line = <$fh>;
    $fh->close;
    die "IO::File roundtrip" unless $line eq "test\n";
    1;
} or push @errors, "IO::File: $@";

# Encode — core since 5.8 and retained in WebDyne artifacts.
eval {
    require Encode;
    my $enc = Encode::encode('UTF-8', 'hello');
    my $dec = Encode::decode('UTF-8', $enc);
    die "Encode roundtrip" unless $dec eq 'hello';
    1;
} or push @errors, "Encode: $@";

# File::Glob — core since 5.6 and a required static XS module.
eval {
    require File::Glob;
    my @files = File::Glob::bsd_glob('*');
    die "File::Glob" unless @files >= 0;
    1;
} or push @errors, "File::Glob: $@";

# ── Report ───────────────────────────────────────────────────────────────────

if (@errors) {
    print STDERR "CORE_SMOKE_ERRORS:\n";
    print STDERR "  $_\n" for @errors;
    exit 1;
}

print "CORE_SMOKE_OK\n";
