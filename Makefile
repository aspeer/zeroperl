include release/defaults.mk

.PHONY: cpanfile.snapshot cpanfile.snapshot-update
cpanfile.snapshot:
	PERL_VERSION="$(PERL_VERSION)" bash tools/cpan-snapshot.sh lock

cpanfile.snapshot-update:
	PERL_VERSION="$(PERL_VERSION)" bash tools/cpan-snapshot.sh update

.PHONY: release
release:
	node tools/release.mjs prepare

.PHONY: licence-review licence-adopt licence-commit
LICENCE_REVIEW_ARGS = --perl-version "$(PERL_VERSION)" $(if $(LICENCE_MANIFEST),--manifest "$(LICENCE_MANIFEST)") $(if $(LICENCE_BASELINE),--baseline "$(LICENCE_BASELINE)")
licence-review:
	python3 -B tools/licence-review.py $(LICENCE_REVIEW_ARGS)

licence-adopt:
	python3 -B tools/licence-review.py $(LICENCE_REVIEW_ARGS) --adopt

# Explicit scope includes the review tooling's initial installation. Never use
# git add -A: unrelated application changes must remain outside this commit.
LICENCE_COMMIT_FILES = Makefile tools/licence-review.py tools/prepare-npm-package.mjs \
	t/test_licence_review.py t.js/artifact-inventory.test.mjs \
	release/licences/$(PERL_VERSION).json release/licences/README.md \
	.github/workflows/zeroperl-webdyne-release.yml PLANS.md BACKLOG.md DECISIONS.md \
	cpanfile $(wildcard cpanfile.snapshot.*)
licence-commit:
	@git diff --cached --quiet || { echo "Commit or unstage existing staged changes first." >&2; exit 1; }
	$(MAKE) licence-adopt
	git diff --check
	git add -- $(LICENCE_COMMIT_FILES)
	@if git diff --cached --quiet; then echo "Licence changes are already committed."; else git commit -m "Qualify runtime licences and automate inventory review"; fi
