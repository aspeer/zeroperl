#!/usr/bin/env perl
use strict;
use warnings;
use Config;
use Cwd qw(abs_path);
use Digest::SHA qw(sha256_hex);
use File::Basename qw(dirname);
use File::Find ();
use File::Path qw(make_path);
use JSON::PP;

#  This is a build-time helper, never a WASM application module. JavaScript
#  supplies one JSON request filename; stdout is a JSON result, stderr errors.
#  Inputs are read-only. The caller owns a fresh temporary output directory and
#  removes it even on failure. See the adjacent .md for the request contract.
#
exit(main());

sub main {
    die "usage: stage-perl-libraries.pl REQUEST.json\n" unless @ARGV==1;
    my $request_hr=decode_json(read_file($ARGV[0]));
    my $sources_ar=$request_hr->{'libraries'};
    die "libraries must be an array\n" unless ref($sources_ar) eq 'ARRAY';
    my $destination_dn=abs_path($request_hr->{'destination'});
    die "destination must be an existing empty directory\n" unless $destination_dn && -d $destination_dn;
    opendir(my $directory_fh, $destination_dn) or die "open $destination_dn: $!\n";
    my @existing=grep { $_ ne '.' && $_ ne '..' } readdir($directory_fh);
    closedir($directory_fh);
    die "destination must be empty\n" if @existing;

    my $embedded_hr=$request_hr->{'embeddedFiles'} || {};
    my $inventory_hr=$request_hr->{'sourceInventory'} || {};
    my $source_hash_hr=$inventory_hr->{'sourceFiles'} || {};
    my $native_hr=$inventory_hr->{'nativeModules'} || {};
    my $report_hr={schema => 1, runtime => $request_hr->{'runtime'},
        inventory_sha256 => sha256_hex(JSON::PP->new()->canonical()->encode([$embedded_hr, $inventory_hr])),
        minify => $request_hr->{'minify'} ? JSON::PP::true : JSON::PP::false,
        files => [], input_bytes => 0, output_bytes => 0, documentation_bytes => 0};
    my (@candidate, @native);

    #  Discover architecture roots before applying exclusions: Carton commonly
    #  keeps install.json and packlists below the host architecture directory.
    #  Never drop arbitrary paths just because their names contain "darwin".
    #  Reject symlinks even in excluded trees, so staging cannot read outside a
    #  supplied library. A destination inside a source would recurse forever.
    #
    foreach my $source_dn (@{$sources_ar}) {
        $source_dn=abs_path($source_dn);
        die "library directory does not exist\n" unless $source_dn && -d $source_dn;
        die "staging destination overlaps a library\n"
            if inside($source_dn, $destination_dn) || inside($destination_dn, $source_dn);
        my @files;
        File::Find::find({no_chdir => 1, wanted => sub {
            my $filename=$File::Find::name;
            die "Perl library symlinks are not portable: $filename\n" if -l $filename;
            return if -d $filename;
            die "unsupported library entry: $filename\n" unless -f $filename;
            push(@files, substr($filename, length($source_dn)+1));
        }}, $source_dn);
        my %architecture=($Config{'archname'} => 1);
        my %owners;
        foreach my $relative (@files) {
            $architecture{$1}=1 if $relative=~m{\A([^/]+)/\.meta/[^/]+/install\.json\z};
            if ($relative=~m{(?:\A|/)\.meta/[^/]+/install\.json\z}) {
                my $metadata_hr=decode_json(read_file("$source_dn/$relative"));
                foreach my $module (keys(%{$metadata_hr->{'provides'} || {}})) {
                    $owners{$module}=$metadata_hr->{'pathname'} || $metadata_hr->{'dist'};
                }
            }
        }

        #  Within one library the architecture-specific copy takes precedence,
        #  as in local::lib. Across libraries, preserve the archive builder's
        #  existing last-root-wins behaviour. Never transform source files.
        #
        foreach my $relative (sort {
            (($architecture{(split(m{/}, $a))[0]} || 0) <=>
             ($architecture{(split(m{/}, $b))[0]} || 0)) || $a cmp $b
        } @files) {
            my $content=read_file("$source_dn/$relative");
            my $path=$relative;
            $path=~s{\A([^/]+)/}{$architecture{$1} ? '' : "$1/"}e;
            my $entry_hr={source => "$source_dn/$relative", path => $path,
                input_bytes => length($content), source_sha256 => sha256_hex($content)};
            $report_hr->{'input_bytes'}+=length($content);
            push(@{$report_hr->{'files'}}, $entry_hr);
            my $excluded=exclusion($path);
            if ($excluded) {
                $entry_hr->{'action'}='omitted';
                $entry_hr->{'reason'}=$excluded;
                next;
            }
            if ($path=~/\.(?:a|bs|bundle|dll|dylib|o|so)\z/i) {
                my ($module)=$path=~m{\Aauto/(.+)/[^/]+\.[^/]+\z};
                if (defined($module)) {
                    $module=~s{/}{::}g;
                    $entry_hr->{'distribution'}=$owners{$module};
                }
                push(@native, $entry_hr);
                next;
            }
            $entry_hr->{'content'}=$content;
            $entry_hr->{'flattened'}=JSON::PP::true if $path ne $relative;
            push(@candidate, $entry_hr);
        }
    }

    #  Compare original bytes against both the final embedded files and the
    #  source inventory captured BEFORE runtime minification. Matching a CPAN
    #  version alone is not proof: locally patched modules must survive.
    #  A differing candidate at any precedence level prevents deduplication.
    #
    my (%effective, %overrides, %identical);
    foreach my $entry_hr (@candidate) {
        my $path=$entry_hr->{'path'};
        my $matches=exists($embedded_hr->{$path}) &&
            ($entry_hr->{'source_sha256'} eq $embedded_hr->{$path} ||
             $entry_hr->{'source_sha256'} eq ($source_hash_hr->{$path} || ''));
        $entry_hr->{'embedded_match'}=$matches ? JSON::PP::true : JSON::PP::false;
        $matches ? $identical{$path}++ : $overrides{$path}++;
        if ($effective{$path}) {
            $effective{$path}->{'action'}='omitted';
            $effective{$path}->{'reason'}='superseded by later library precedence';
        }
        $effective{$path}=$entry_hr;
    }

    #  A host XS object can be omitted only when the release explicitly names
    #  its target implementation, distribution identity matches, AND the
    #  companion Perl module is unchanged. Version equality alone is not enough.
    #  Unsupported or modified XS must fail here, not later in a Worker.
    #  Empty .bs files are MakeMaker bookkeeping, not executable payloads.
    #
    foreach my $entry_hr (@native) {
        my $path=$entry_hr->{'path'};
        if ($path=~/\.bs\z/i && !$entry_hr->{'input_bytes'}) {
            $entry_hr->{'action'}='omitted';
            $entry_hr->{'reason'}='empty bootstrap metadata';
            next;
        }
        my ($module)=$path=~m{\Aauto/(.+)/[^/]+\.(?:a|bundle|dll|dylib|o|so|bs)\z}i;
        my $companion=defined($module) ? "$module.pm" : '';
        die "Native Perl artifacts cannot run in the WASM runtime: $entry_hr->{'source'}; " .
            "no unchanged companion with a verified target XS implementation\n"
            unless ref($native_hr->{$companion}) eq 'HASH' && $identical{$companion} && !$overrides{$companion}
                && $entry_hr->{'distribution'}
                && $entry_hr->{'distribution'} eq ($native_hr->{$companion}->{'distribution'} || '');
        $entry_hr->{'action'}='omitted';
        $entry_hr->{'reason'}="host XS supplied by runtime: $companion";
    }

    #  Use one known formatter version; never load the target's Config.pm in
    #  host Perl or silently skip requested compaction when tooling is missing.
    #  Basic/no-library npm applications never invoke this helper.
    #
    if ($request_hr->{'minify'}) {
        eval { require Perl::Tidy; 1 } or die "minification requires Perl::Tidy 20260826; " .
            "install with cpanm Perl::Tidy\@20260826 or set webdyne.perlMinify=false\n";
        die "minification requires Perl::Tidy 20260826 (found $Perl::Tidy::VERSION)\n"
            unless $Perl::Tidy::VERSION eq '20260826';
        $report_hr->{'perltidy_version'}=$Perl::Tidy::VERSION;
    }
    my @omitted;
    my $documentation='';
    foreach my $path (sort(keys(%effective))) {
        my $entry_hr=$effective{$path};
        if ($identical{$path} && !$overrides{$path}) {
            $entry_hr->{'action'}='omitted';
            $entry_hr->{'reason'}='identical embedded module or recorded source';
            push(@omitted, "perl5/lib/$path");
            next;
        }
        my $content=$entry_hr->{'content'};
        if ($request_hr->{'minify'} && $path=~/\.(?:pm|pl)\z/i) {
            ($content, my $pod, my $status)=compact_source($content);
            $entry_hr->{'minification'}=$status;
            #  Retain removed documentation outside @INC, including any licence
            #  and attribution sections. Measure these bytes in net savings.
            $documentation.="\n===== $path =====\n$pod" if length($pod);
        }
        write_file("$destination_dn/lib/$path", $content);
        $entry_hr->{'action'}='included';
        $entry_hr->{'reason'}=exists($embedded_hr->{$path}) ? 'application override retained' : 'application library';
        $entry_hr->{'output_bytes'}=length($content);
        $entry_hr->{'output_sha256'}=sha256_hex($content);
        $report_hr->{'output_bytes'}+=length($content);
    }
    make_path("$destination_dn/lib");
    if (length($documentation)) {
        write_file("$destination_dn/PERL-LIBRARY-DOCUMENTATION.txt", $documentation);
        $report_hr->{'documentation_bytes'}=length($documentation);
        $report_hr->{'output_bytes'}+=length($documentation);
    }
    delete($_->{'content'}) foreach @{$report_hr->{'files'}};
    $report_hr->{'saved_bytes'}=$report_hr->{'input_bytes'}-$report_hr->{'output_bytes'};
    print(JSON::PP->new()->canonical()->pretty()->encode({report => $report_hr, omittedEmbeddedFiles => \@omitted}));
    return 0;
}


#  Limit exclusions to deployment-only files. WebDyne/Install.pm is separate
#  from its companion directory; excluding only the directory leaves a stub.
#
sub exclusion {
    my ($path)=@_;
    return 'installation metadata' if $path=~m{(?:\A|/)(?:\.meta|\.packlist)(?:/|\z)};
    return 'standalone POD' if $path=~/\.pod\z/i;
    return 'WebDyne installer' if $path=~m{\AWebDyne/Install(?:\.pm\z|/)};
    return;
}


#  Source/data boundaries and line-sensitive code are deliberately untouched.
#  The old heredoc regex was a heuristic, not a parser; skipping the complete
#  file is safer than retrying a failed transformation with different flags.
#  Perl::Tidy parses source; it does not execute BEGIN blocks or load modules.
#
sub compact_source {
    my ($input)=@_;
    return ($input, '', 'skipped: data, heredoc or line-sensitive source')
        if $input=~/^__(?:DATA|END)__\b/m || $input=~/<</ || $input=~/\b__LINE__\b|^#\s*line\b/m;
    my $pod='';
    while ($input=~/(^=[A-Za-z][^\n]*\n.*?(?:^=cut[^\n]*(?:\n|\z)|\z))/msg) { $pod.=$1; }
    my ($output, $errors, $stderr)=('', '', '');
    my $status=Perl::Tidy::perltidy(source => \$input, destination => \$output,
        stderr => \$stderr, errorfile => \$errors,
        argv => '-npro -mangle -delete-pod -ndbc -ndsc');
    die "Perl::Tidy failed: $errors$stderr\n" if $status;
    return ($output, $pod, 'compacted');
}


sub inside {
    my ($parent, $child)=@_;
    return $parent eq $child || index($child, "$parent/")==0;
}


sub read_file {
    my ($filename)=@_;
    open(my $input_fh, '<:raw', $filename) or die "read $filename: $!\n";
    local $/;
    my $content=<$input_fh>;
    close($input_fh) or die "close $filename: $!\n";
    return $content;
}


sub write_file {
    my ($filename, $content)=@_;
    make_path(dirname($filename));
    open(my $output_fh, '>:raw', $filename) or die "write $filename: $!\n";
    print {$output_fh} $content;
    close($output_fh) or die "close $filename: $!\n";
}
