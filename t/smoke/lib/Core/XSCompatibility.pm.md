# Core::XSCompatibility

Shared native/WASM functional checks for the base CPAN XS additions.

`run()` returns true or throws a diagnostic. It checks actual XS entry points,
subroutine naming, parameter validation, generated hash/array accessors, CSV
Unicode/binary round trips and malformed input, and Variable::Magic write,
detach and scope-cleanup callbacks. Calling it twice checks interpreter reuse.

`t/cpan/xs-runtime.t` runs it with native Perl through `prove`.
`Core::TestMod` runs the same cases in the existing WASM smoke harness.
