.PHONY: help install typecheck build clean pack check publish patch minor major _require-clean

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install:  ## Install dev dependencies
	npm install

typecheck:  ## Run TypeScript type-check (no emit)
	npm run typecheck

build:  ## Build the dist/ output
	npm run build

clean:  ## Remove dist/ and node_modules/
	rm -rf dist node_modules

pack:  ## Preview the publish tarball contents (npm pack --dry-run)
	npm pack --dry-run

check: typecheck build pack  ## typecheck + build + tarball preview

# ──────────────────────────────────────────────────────────────
# Release / publish flow
# ──────────────────────────────────────────────────────────────

_require-clean:
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "✗ working tree dirty — commit or stash first"; exit 1; \
	fi
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "main" ]; then \
		echo "✗ not on main (on $$branch)"; exit 1; \
	fi
	@echo "✓ git clean, on main"

# `make publish` republishes the CURRENT version. Use for re-runs after a
# failed publish, or when you've manually bumped the version. For normal
# releases use `patch` / `minor` / `major`.
publish: _require-clean check  ## Publish the current version as-is
	npm publish

# Standard release: bumps version + git commit + tag, publishes, pushes tag.
# If `npm publish` fails partway through (e.g. OTP timeout), you'll need to
# manually undo the bump:
#   git tag -d vX.Y.Z && git reset --hard HEAD^
patch: _require-clean check  ## Bump patch, publish, push tag
	npm version patch
	npm publish
	git push --follow-tags

minor: _require-clean check  ## Bump minor, publish, push tag
	npm version minor
	npm publish
	git push --follow-tags

major: _require-clean check  ## Bump major, publish, push tag
	npm version major
	npm publish
	git push --follow-tags
