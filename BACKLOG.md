# Backlog

- Configure the binary distribution repository and add its GitHub App-scoped
  promotion job after the repository is supplied.
- Bootstrap the public `@webdyne` npm package names, configure npm Trusted
  Publishing for `zeroperl-webdyne-npm.yml`, and replace the deliberately
  disabled final publication message with an approved OIDC publish step.
- Rebuild and requalify final build-numbered artifacts for Perl 5.18.4 and
  5.36.3 after the 5.44.0 release workflow is proven.
- Automate refreshing `js/zeroperl.js` from the canonical `zeroperl-ts`
  submodule and fail CI if the generated bridge is stale.
- Decide whether a future package should expose convenience TypeScript types;
  the package currently exposes the compiled bridge and Worker factory only.
