#!/usr/bin/env perl
use strict;
use warnings;
use Carton::Snapshot;
use JSON::PP;
use Digest::SHA qw(sha256_hex);
use File::Path qw(make_path);
use File::Basename qw(dirname);
use File::Find ();
use Module::CoreList;

#  Operate on Carton's parsed snapshot, never a second version selection.
#
my ($mode, $root, $recipes_fn)=@ARGV;
die "usage: cpan-lock.pl record|verify|fetch|installed|recipes ROOT RECIPES\n" unless $recipes_fn;
my $snapshot_fn="$root/cpanfile.snapshot";
my $snapshot_or=Carton::Snapshot->new(path => $snapshot_fn);
$snapshot_or->load();
my $recipes_ar=decode_json(read_file($recipes_fn));
my @recipes=grep { !$_->{'before'} || $]<$_->{'before'} } @{$recipes_ar};
foreach my $recipe_hr (@recipes) {
    die "snapshot lacks target XS module $recipe_hr->{'module'}\n"
        unless $snapshot_or->find($recipe_hr->{'module'});
}
#  Refuse silently discarded native XS libraries without a target recipe.
#  Core extensions are supplied by the selected Perl source tree.
#
if ($mode eq 'record' || $mode eq 'installed') {
    my %target=map { $_->{'module'} => 1 } @recipes;
    my $local_dn="$root/local/lib/perl5";
    if (-d $local_dn) {
        File::Find::find({no_chdir => 1, wanted => sub {
            return unless $File::Find::name=~m{/auto/(.+)/[^/]+\.so\z};
            my $module=$1;
            $module=~s{/}{::}g;
            die "native XS module $module has no WASM recipe; add one before locking/building\n"
                unless $target{$module} || exists($Module::CoreList::version{$]}{$module});
        }}, $local_dn);
    }
}
my $meta_fn="$snapshot_fn.meta.json";
my $meta_hr;
if ($mode ne 'record') {
    $meta_hr=decode_json(read_file($meta_fn));
    die "snapshot inputs changed; run make cpanfile.snapshot PERL_VERSION=$ENV{'PERL_VERSION'}\n"
        unless $meta_hr->{'schema'}==1 && $meta_hr->{'perl'} eq sprintf('%vd', $^V)
        && $meta_hr->{'cpanfile_sha256'} eq sha256_hex(read_file("$root/cpanfile"))
        && $meta_hr->{'snapshot_sha256'} eq sha256_hex(read_file($snapshot_fn));
}
my %sources;
foreach my $dist_or ($snapshot_or->distributions()) {
    my $path=$dist_or->pathname();
    die "unsafe CPAN archive path: $path\n"
        unless $path=~m{\A[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_.+-]+\.(?:tar\.gz|tgz|tar\.bz2|zip)\z};
    my $archive_fn="$root/vendor/cache/authors/id/$path";
    if ($mode eq 'fetch' && !-f $archive_fn) {
        make_path(dirname($archive_fn));
        system('curl', '-fL', '--retry', '3', '-o', "$archive_fn.tmp", "https://cpan.metacpan.org/authors/id/$path")==0
            or die "cannot fetch locked archive $path\n";
        rename("$archive_fn.tmp", $archive_fn) or die "rename $archive_fn: $!\n";
    }
    if ($mode eq 'record' || $mode eq 'fetch') {
        $sources{$path}=sha256_hex(read_file($archive_fn));
        die "checksum mismatch for $path\n"
            if $mode eq 'fetch' && ($meta_hr->{'sources'}->{$path} || '') ne $sources{$path};
    }
    elsif (!exists($meta_hr->{'sources'}->{$path})) {
        die "missing archive checksum for $path\n";
    }
}
if ($mode eq 'record') {
    $meta_hr={schema => 1, perl => sprintf('%vd', $^V),
        cpanfile_sha256 => sha256_hex(read_file("$root/cpanfile")),
        snapshot_sha256 => sha256_hex(read_file($snapshot_fn)), sources => \%sources};
    open(my $out_fh, '>', $meta_fn) or die "$meta_fn: $!\n";
    print {$out_fh} JSON::PP->new()->canonical()->pretty()->encode($meta_hr);
    close($out_fh) or die "$meta_fn: $!\n";
}
elsif ($mode eq 'fetch') {
    make_path("$root/vendor/cache/modules");
    $snapshot_or->write_index("$root/vendor/cache/modules/02packages.details.txt");
}
elsif ($mode eq 'recipes') {
    foreach my $recipe_hr (@recipes) {
        my $dist_or=$snapshot_or->find($recipe_hr->{'module'});
        print join("\t", $dist_or->pathname(), $recipe_hr->{'builder'},
            $recipe_hr->{'archive'}, $recipe_hr->{'destination'}, $recipe_hr->{'patch'} || '-'), "\n";
    }
}
elsif ($mode ne 'verify' && $mode ne 'installed') {
    die "unknown mode: $mode\n";
}

sub read_file {
    my ($fn)=@_;
    open(my $in_fh, '<', $fn) or die "$fn: $!\n";
    binmode($in_fh);
    local $/;
    return scalar(<$in_fh>);
}
