include release/defaults.mk

.PHONY: cpanfile.snapshot cpanfile.snapshot-update
cpanfile.snapshot:
	PERL_VERSION="$(PERL_VERSION)" bash tools/cpan-snapshot.sh lock

cpanfile.snapshot-update:
	PERL_VERSION="$(PERL_VERSION)" bash tools/cpan-snapshot.sh update
