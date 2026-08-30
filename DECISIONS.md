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
modules. The Perl 5.44.0 safe experiment retained the standard module and XS
surface and used compressed SFS embedding. It was 16.1% smaller raw but 7.3%
larger after gzip, so Milestone 1 does not publish a mini artifact. Repairing
the older trace-based XS-pruning path is out of scope because the product
requirement is to retain required WebDyne XS and nearly all core XS modules.

## D005: POSIX compatibility surface

The WASM runtime supplies the `POSIX::strftime` surface used by WebDyne without
claiming support for the complete core `POSIX` XS module.

## D006: Legacy XS ABI compatibility

Perl 5.18, 5.24, and 5.36 retain the core mathoms compatibility layer because
current WebDyne XS dependencies use legacy Perl ABI symbols on those releases.
Newer releases continue to build with `NO_MATHOMS`.

## D007: ExifTool is opt-in

ExifTool is not part of the WebDyne runtime deliverable and is excluded from
all standard artifacts. `BUILD_EXIFTOOL=true` remains available solely for
special-purpose builds and is not a release gate.
