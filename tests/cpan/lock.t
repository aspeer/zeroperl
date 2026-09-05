use strict;
use warnings;
use Test::More;
use File::Temp qw(tempdir);
use File::Path qw(make_path);
use FindBin;
use Carton::Snapshot;
use Carton::Dist;
use JSON::PP;

my $root=tempdir(CLEANUP => 1);
my $helper="$FindBin::Bin/../../tools/cpan-lock.pl";
my $recipes_fn="$root/recipes.json";
my $snapshot_or=Carton::Snapshot->new(path => "$root/cpanfile.snapshot");
$snapshot_or->add_distribution(Carton::Dist->new(name => 'Example-1.0',
    pathname => 'A/AB/ABC/Example-1.0.tar.gz',
    provides => {'Example' => {version => '1.0'}}));
$snapshot_or->save();
make_path("$root/vendor/cache/authors/id/A/AB/ABC");
write_file("$root/cpanfile", "requires 'Example';\n");
write_file($recipes_fn, '[{"module":"Example","builder":"makemaker","archive":"Example.a","destination":"lib/auto/Example/Example.a"}]');
my $archive_fn="$root/vendor/cache/authors/id/A/AB/ABC/Example-1.0.tar.gz";
write_file($archive_fn, 'original archive');
local $ENV{'PERL_VERSION'}=sprintf('%vd', $^V);
is(run_helper('record'), 0, 'record a locked distribution and its source checksum');
is(run_helper('verify'), 0, 'accept unchanged inputs');
is(run_helper('fetch'), 0, 'reuse a matching cached source without network');
ok(-f "$root/vendor/cache/modules/02packages.details.txt", 'write the locked CPAN index');
is(run_helper('recipes'), 0, 'resolve the XS recipe through the snapshot');
write_file($archive_fn, 'changed archive');
isnt(run_helper('fetch'), 0, 'reject changed source bytes');
write_file($archive_fn, 'original archive');
write_file("$root/cpanfile", "requires 'Example', '2';\n");
isnt(run_helper('verify'), 0, 'reject a stale cpanfile');
write_file("$root/cpanfile", "requires 'Example';\n");
write_file($recipes_fn, '[{"module":"Missing"}]');
isnt(run_helper('verify'), 0, 'reject an XS recipe absent from the snapshot');
write_file($recipes_fn, '[{"module":"Example","builder":"makemaker","archive":"Example.a","destination":"lib/auto/Example/Example.a"}]');
make_path("$root/local/lib/perl5/auto/Unsupported");
write_file("$root/local/lib/perl5/auto/Unsupported/Unsupported.so", 'native binary');
isnt(run_helper('installed'), 0, 'reject a native XS module with no WASM recipe');
unlink("$root/local/lib/perl5/auto/Unsupported/Unsupported.so");
make_path("$root/local/lib/perl5/auto/Example");
write_file("$root/local/lib/perl5/auto/Example/Example.so", 'native binary');
is(run_helper('installed'), 0, 'accept native XS with an explicit WASM recipe');
done_testing();

sub run_helper {
    my ($mode)=@_;
    return system($^X, $helper, $mode, $root, $recipes_fn);
}

sub write_file {
    my ($fn, $content)=@_;
    open(my $out_fh, '>', $fn) or die "$fn: $!";
    print {$out_fh} $content;
    close($out_fh) or die "$fn: $!";
}
