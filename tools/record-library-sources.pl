#!/usr/bin/env perl

#  Check core dependencies before any use statement can abort compilation.
#  This bootstrap deliberately needs no modules itself. Collect load failures,
#  including broken installations, and retain their original diagnostics.
#  Keep this list aligned with the required use statements below; optional
#  Perl::Tidy is handled separately by the staging minification policy.
#
BEGIN {
    my (@missing, @errors);
    foreach my $module (qw(strict warnings Digest::SHA File::Find JSON::PP)) {
        my $filename=$module;
        $filename=~s{::}{/}g;
        $filename.='.pm';
        unless (eval { require $filename; 1 }) {
            push(@missing, $module);
            push(@errors, "$module: $@");
        }
    }
    if (@missing) {
        print STDERR "Cannot record Perl library sources: host Perl could not load required core modules:\n  " .
            join("\n  ", @missing) . "\n\nInstall a complete Perl distribution or your operating system's " .
            "packages providing these modules, then retry.\n\nLoad errors:\n" . join("\n", @errors);
        exit(2);
    }
}

use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use File::Find ();
use JSON::PP;

#  Record source bytes before prepare-prefix.sh minifies the target libraries.
#  The caller keeps this JSON outside /zeroperl until AFTER SFS generation,
#  then adds it to the exported prefix. It is checksummed with that artifact,
#  packaged for the host tooling, and never embedded in the WASM filesystem.
#
#  usage: record-library-sources.pl PREFIX PERL_VERSION CPAN_XS_RECIPES.json
#  stdout: JSON source hashes and explicitly built CPAN XS implementations.
#  Core XS absent from this recipe list remains conservatively unsupported by
#  host-library stripping; merely finding Foo.pm does not prove Foo's XS exists.
#
my ($prefix_dn, $version, $recipes_fn)=@ARGV;
die "usage: record-library-sources.pl PREFIX PERL_VERSION RECIPES.json\n" unless @ARGV==3;
my (%files, %owners);
foreach my $root_dn ("$prefix_dn/lib/$version/wasm32-wasi", "$prefix_dn/lib/$version") {
    next unless -d $root_dn;
    File::Find::find({no_chdir => 1, wanted => sub {
        my $filename=$File::Find::name;
        return unless -f $filename;
        if ($filename=~m{/\.meta/[^/]+/install\.json\z}) {
            my $metadata_hr=decode_json(read_file($filename));
            foreach my $module (keys(%{$metadata_hr->{'provides'} || {}})) {
                $owners{$module}=$metadata_hr->{'pathname'} || $metadata_hr->{'dist'};
            }
            return;
        }
        return unless $filename=~/\.(?:pm|pl)\z/;
        my $path=substr($filename, length($root_dn)+1);
        return if $path=~m{(?:\A|/)(?:\.meta|wasm32-wasi)(?:/|\z)};
        #  Architecture-specific companions have @INC precedence.
        $files{$path}=sha256_hex(read_file($filename)) unless exists($files{$path});
    }}, $root_dn);
}
my $recipes_ar=decode_json(read_file($recipes_fn));
my %native;
my @version=split(/\./, $version);
my $numeric_version=sprintf('%d.%03d%03d', @version);
foreach my $recipe_hr (@{$recipes_ar}) {
    next if $recipe_hr->{'before'} && $numeric_version>=$recipe_hr->{'before'};
    my $path=$recipe_hr->{'module'};
    $path=~s{::}{/}g;
    $path.='.pm';
    $native{$path}={distribution => $owners{$recipe_hr->{'module'}}}
        if exists($files{$path}) && $owners{$recipe_hr->{'module'}};
}
print(JSON::PP->new()->canonical()->pretty()->encode({schema => 1,
    perlVersion => $version, sourceFiles => \%files, nativeModules => \%native}));


sub read_file {
    my ($filename)=@_;
    open(my $input_fh, '<:raw', $filename) or die "read $filename: $!\n";
    local $/;
    my $content=<$input_fh>;
    close($input_fh) or die "close $filename: $!\n";
    return $content;
}
