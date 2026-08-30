# ZeroPerl implementation plan

1. Consolidate the divergent runtime forks into this canonical repository.
2. Build and validate standard artifacts for Perl 5.18.4, 5.24.4, 5.36.3,
   and 5.44.0.
3. Measure a Perl 5.44.0 mini artifact and retain the target only if it passes
   the 30% compressed-size gate and the WebDyne compatibility checks.
4. Supply the verified artifacts to `zeroperl-ts` and the Cloudflare
   `wasm-WebDyne-PAGI` integration.

Release publication, pushes, and repository merges require separate approval.
