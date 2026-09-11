# Explicit target XS distributions. Versions are resolved in the per-Perl snapshot.
requires 'HTML::Parser';
requires 'Clone';
requires 'Sub::Name';
requires 'Params::Util';
requires 'Class::XSAccessor';
requires 'Text::CSV_XS';
requires 'Variable::Magic';
requires 'Cpanel::JSON::XS';
requires 'XS::Parse::Sublike';
requires 'XS::Parse::Keyword';
if ( $] < 5.024 ) {
    requires 'List::Util', '1.70';
}

requires 'CGI::Simple';
requires 'Capture::Tiny';
requires 'Crypt::URandom';
requires 'Devel::Confess';
requires 'Digest::MD5';
requires 'Env::Path';
requires 'File::Temp';
requires 'Future::AsyncAwait';
requires 'Future::IO';
if ( $] < 5.024 ) {
    requires 'Future::XS', '== 0.07';
}
else {
    requires 'Future::XS';
}
requires 'HTML::Element';
requires 'HTML::Entities';
requires 'HTML::Tagset';
requires 'HTML::Tiny';
requires 'HTML::TreeBuilder';
requires 'HTTP::Status';
requires 'HTTP::Headers::Fast';
requires 'HTTP::Headers::Util';
requires 'HTTP::Negotiate';
requires 'HTTP::AcceptLanguage';
requires 'HTTP::Request';
requires 'HTTP::Request::Common';
requires 'Hash::MultiValue';
requires 'IO::String';
requires 'JSON';
requires 'PAGI::Tools', '== 0.002002';
requires 'Plack::Request';
requires 'Router::Simple';
requires 'Storable';
requires 'Sub::Util';
requires 'Term::ANSIColor';
requires 'Text::Template';
requires 'Tie::IxHash';
requires 'Time::HiRes';
requires 'URI';
requires 'URI::Escape';
requires 'WebDyne', '== 3.029';
requires 'perl', '5.018';

on configure => sub {
    requires 'ExtUtils::MakeMaker';
    requires 'Tie::File';
};

on test => sub {
    requires 'Algorithm::Diff';
    requires 'Test::Deep';
    requires 'Test::Differences';
    requires 'Test::More', '0.88';
    requires 'Text::Diff';
};
