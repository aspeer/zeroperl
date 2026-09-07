use strict;
use warnings;
use FindBin;
use lib "$FindBin::Bin/../smoke/lib";
use Test::More;
use Core::XSCompatibility;

ok(Core::XSCompatibility::run(), 'base XS modules execute native operations');
ok(Core::XSCompatibility::run(), 'base XS modules can be reused in one interpreter');
done_testing();
