package Core::XSCompatibility;

use strict;
use warnings;

sub run {
    require B;
    require Sub::Name;
    require Params::Util;
    XSLoader->VERSION('0.22');
    require Class::XSAccessor;
    require Class::XSAccessor::Array;
    require Text::CSV_XS;
    require Variable::Magic;

    #  Exercise native entry points, including modules with a Pure Perl fallback.
    #
    foreach my $code_cr (\&Sub::Name::subname, \&Params::Util::_HASH,
        \&Text::CSV_XS::Parse, \&Variable::Magic::cast) {
        die "expected XS implementation" unless B::svref_2object($code_cr)->XSUB();
    }

    my $named_cr=Sub::Name::subname('Core::XSCompatibility::named', sub { return (caller(0))[3] });
    die "subroutine name" unless $named_cr->() eq 'Core::XSCompatibility::named';
    my $hash_hr={value => 0};
    die "hash parameter" unless Params::Util::_HASH($hash_hr)==$hash_hr;
    die "invalid hash parameter" if defined(Params::Util::_HASH([]));
    die "false numeric parameter" unless defined(Params::Util::_NUMBER('0'));

    Class::XSAccessor->import(class => 'Core::XSCompatibility::HashObject',
        replace => 1, constructor => 'new', accessors => {value => 'value'});
    my $hash_or=Core::XSCompatibility::HashObject->new(value => 42);
    die "hash accessor read" unless $hash_or->value()==42;
    $hash_or->value(0);
    die "hash accessor write" unless $hash_or->value()==0;
    die "hash accessor XS" unless B::svref_2object($hash_or->can('value'))->XSUB();

    Class::XSAccessor::Array->import(class => 'Core::XSCompatibility::ArrayObject',
        replace => 1, accessors => {value => 0});
    my $array_or=bless([42], 'Core::XSCompatibility::ArrayObject');
    $array_or->value('');
    die "array accessor write" unless $array_or->value() eq '';

    my $csv_or=Text::CSV_XS->new({binary => 1});
    my @fields=('a,b', 'a"b', "line\nbreak", "\x{263a}", "\0", '', '0');
    $csv_or->combine(@fields) || die "CSV combine";
    $csv_or->parse($csv_or->string()) || die "CSV parse";
    my @decoded=$csv_or->fields();
    die "CSV field count" unless @decoded==@fields;
    foreach my $ix (0..$#fields) {
        die "CSV field $ix" unless $decoded[$ix] eq $fields[$ix];
    }
    die "CSV malformed quote accepted" if $csv_or->parse('"unterminated');
    die "CSV error diagnostic" unless scalar($csv_or->error_diag());

    #  Repeated attach, detach and scope cleanup catch retained callback state.
    #  Lazy loading requires explicit references and bypassing the prototypes.
    #
    my ($writes, $freed)=(0, 0);
    my $wizard_ref=Variable::Magic::wizard(
        set => sub { ++$writes; return 0 },
        free => sub { ++$freed; return 0 });
    foreach my $ix (1..20) {
        my $value=0;
        &Variable::Magic::cast(\$value, $wizard_ref);
        $value=$ix;
    }
    die "magic write callback" unless $writes==20;
    die "magic scope cleanup" unless $freed==20;
    {
        my $value=0;
        &Variable::Magic::cast(\$value, $wizard_ref);
        &Variable::Magic::dispell(\$value, $wizard_ref);
        $value=1;
    }
    die "magic detach" unless $writes==20 && $freed==20;
    return 1;
}

1;
