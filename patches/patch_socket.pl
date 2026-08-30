#!/usr/bin/env perl
use strict;
use warnings;

# Perl's Socket source changed its UNIX-domain feature guard between the older
# and newer supported release lines. WASI exposes enough socket headers for
# Configure to define I_SYS_UN, but does not provide a usable sockaddr_un.
# Disable that surface without relying on source line numbers or indentation.

my $path = 'cpan/Socket/Socket.xs';
open my $in, '<', $path or die "open $path: $!";
my $source = do { local $/; <$in> };
close $in;

my $changed = 0;
$changed += $source =~ s{
    ^\#ifdef[ ]+I_NETDB$
}{#if defined(I_NETDB) && !defined(__wasi__)}gmx;
$changed += $source =~ s{
    ^\#ifdef[ ]+I_SYS_UN$
}{#if defined(I_SYS_UN) && !defined(__wasi__)}gmx;
$changed += $source =~ s{
    ^\#if[ ]+defined\(I_SYS_UN\)[ ]+\|\|[ ]+defined\(WIN32\)$
}{#if (defined(I_SYS_UN) || defined(WIN32)) && !defined(__wasi__)}gmx;

die "unexpected Socket.xs layout: changed $changed guards, expected 4\n"
  unless $changed == 4;

# Socket bundled with Perl 5.18 and 5.24 predates the HAS_GETHOSTBYNAME
# guard used by newer releases. This script is applied only to the WASI source
# tree, where hostname lookup is unavailable. Remove that fallback and its
# hostent declaration while retaining the preceding numeric inet_aton path.
# Newer releases already guard the fallback, but removing it there as well
# keeps the target source deterministic and avoids depending on generated XS
# compilation preserving a target-specific preprocessor macro.
my $host_lookup_changed = 0;
$host_lookup_changed += $source =~ s{
    ^([ \t]*)struct[ ]+hostent[ ]+\*[ ]*phe;$
}{}gmx;
$host_lookup_changed += $source =~ s{
    ^([ \t]*)phe[ ]*=[ ]*gethostbyname\(host\);\n
    (?<block>
      \1if[ ]*\(phe[ ]*&&[ ]*phe->h_addrtype[ ]*==[ ]*AF_INET[ ]*&&[ ]*phe->h_length[ ]*==[ ]*4\)[ ]*\{\n
      \1[ \t]+ST\(0\)[ ]*=[ ]*sv_2mortal\(newSVpvn\(\(char[ ]*\*\)phe->h_addr,[ ]*phe->h_length\)\);\n
      \1[ \t]+XSRETURN\(1\);\n
      \1\}
    )
}{}gmx;

die "unexpected Socket.xs hostname layout: changed $host_lookup_changed blocks, expected 2\n"
  unless $host_lookup_changed == 2;

# Perl 5.36 and 5.44 wrap that fallback in HAS_GETHOSTBYNAME. Removing the
# fallback above intentionally leaves an empty wrapper, but xsubpp rejects an
# otherwise valid empty preprocessor branch. Remove the wrapper on those two
# source layouts; the older releases have no such guard.
my $empty_host_guard_changed = $source =~ s{
    ^\#ifdef[ ]+HAS_GETHOSTBYNAME\n
    [ \t]*/\*[ ]+gethostbyname[ ]+is[ ]+not[ ]+thread-safe[ ]+\*/\n
    \n
    ^\#endif[ ]*/\*[ ]+HAS_GETHOSTBYNAME[ ]+\*/\n
}{}gmx;

die "unexpected Socket.xs hostname guard layout: changed "
  . "$empty_host_guard_changed guards, expected 0 or 1\n"
  unless $empty_host_guard_changed == 0 || $empty_host_guard_changed == 1;

open my $out, '>', $path or die "open $path for writing: $!";
print {$out} $source;
close $out;

print "Socket WASI guards applied successfully.\n";
