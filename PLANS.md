# ZeroPerl implementation plan

1. Consolidate the divergent runtime forks into this canonical repository.
2. Build and validate standard artifacts for Perl 5.18.4, 5.36.3, and 5.44.0;
   exclude 5.24.4 after its approved 64 KiB experiment.
3. Measure a Perl 5.44.0 mini artifact and retain the target only if it passes
   the 30% compressed-size gate and the WebDyne compatibility checks.
4. Supply the verified artifacts to `zeroperl-ts` and the Cloudflare
   `wasm-WebDyne-PAGI` integration.
5. [x] Define versioned local output names and independent build numbers for
   each retained Perl release.
6. [x] Replace the legacy matrix release design with per-version GitHub release
   and npm-candidate workflows whose publishing steps are guarded or disabled.
7. [x] Validate the new workflows on GitHub in nonpublishing mode.
8. [ ] Configure the public binary distribution repository and npm Trusted
   Publisher after their external names and permissions are supplied.
9. [x] Make the versioned npm distribution self-contained for WebDyne on
   Cloudflare by including the compiled bridge, portable PAGI runtime, default
   provider adapter, Perl launchers, and application VFS/deployment tooling.
10. [x] Prove the package contract from the independent `psp-WebDyne-Time`
    example before enabling npm publication.
11. [x] Split the Worker into a portable runtime and Fetch transport with a
    small default Cloudflare adapter; adopt `/app`, `/perl5`, and writable
    `/tmp` VFS conventions and optional root-cpanfile installation.

Release creation, npm publication, and repository merges require separate
approval. Feature-branch pushes and nonpublishing workflow runs are approved
for the current release-pipeline work.
