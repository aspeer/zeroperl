# ZeroPerl WebDyne decisions

## D001: Supported Perl release lines

Standard artifacts target the last releases of Perl 5.18, 5.24, 5.36, and
5.44: 5.18.4, 5.24.4, 5.36.3, and 5.44.0.

## D002: WebDyne compatibility takes precedence

The canonical runtime statically builds the XS modules required by WebDyne and
WebDyne::PAGI. Generic PAGI compatibility is useful but is not a release gate.

## D003: Bridge ownership

JavaScript/Perl marshalling and Asyncify-aware resource disposal belong in
`zeroperl-ts`; Perl runtime and static-XS behaviour belong in this repository.

## D004: Mini artifact gate

A mini artifact will only be retained if its compressed WASM is at least 30%
smaller than the equivalent standard artifact while retaining required WebDyne
modules. The experiment begins with Perl 5.44.0.

## D005: POSIX compatibility surface

The WASM runtime supplies the `POSIX::strftime` surface used by WebDyne without
claiming support for the complete core `POSIX` XS module.
