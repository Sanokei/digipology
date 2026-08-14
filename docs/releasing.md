# Releasing npm packages

Digipology publishes its library workspaces as public, unscoped `digipology-*` packages. Releases are manual and evidence-gated: prepare the release on `main`, then use the **Publish npm package** GitHub Actions workflow. Never publish from a laptop.

The workflow requires the repository secret `NPM_TOKEN`, containing an npm automation token for the `sanokei` account. Creating or rotating that secret is an operator task. Never commit a token, `.npmrc`, or other credential file.

## Release preconditions

Complete this checklist in a release-preparation pull request and merge it before dispatching the workflow:

- Confirm the normal CI workflow is green on the latest `main` commit.
- Bump `packages/<package>/package.json` to the exact release version. While packages are `0.x`, a breaking change increments the minor version; every other release increments the patch version. Never reuse an npm version.
- Add the release to `packages/<package>/CHANGELOG.md`. If the package has no changelog yet, create it in the release-preparation pull request. Use a keep-a-changelog-lite structure: an `Unreleased` section plus a dated `[0.x.y] - YYYY-MM-DD` section, with only the relevant `Added`, `Changed`, `Fixed`, `Deprecated`, `Removed`, or `Security` headings.
- Confirm `packages/<package>/README.md` and `packages/<package>/LICENSE` exist and are current.
- Inspect the package payload with `npm pack --dry-run ./packages/<package>`. If the manifest has a `files` field, confirm it includes all runtime files plus the README and license. Without a `files` field, inspect npm's default include/exclude result carefully. For a package such as `lua` that publishes `dist`, also confirm its build produces every exported file.
- Confirm a current `bun.lock` is committed and agrees with all workspace manifests. Publishing deliberately uses `bun install --frozen-lockfile`; it will not generate or repair a lockfile. The repository's bootstrap-era ignore rule for Bun lockfiles must be retired in a separately scoped change before the first release.
- Confirm the public GitHub repository location has not changed. npm provenance requires repository metadata matching the public source repository. The workflow adds matching monorepo `repository` metadata to the runner's publish manifest when the source manifest omits it, and rejects conflicting metadata.

The publish workflow runs the repository-wide typecheck and test suites. This intentionally includes the selected package's workspace dependencies; it can be optimized only after an equally strong scoped check exists.

## Package order

Publish dependencies before dependents:

1. Publish `canonical-json` and `prng` before any `kernel` version that depends on them. Their order relative to each other does not matter.
2. Publish `kernel` only after the exact local versions of both workspace dependencies are on npm.

`protocol` is independent and may be published at any point. `lua` is also independent of the other Digipology packages; its allowed runtime dependency is `wasmoon`.

Published manifests must not contain `workspace:*` or another `workspace:` range. During a workflow run, the release gate replaces a workspace range with the matching version from the dependency's local `package.json`, then requires that exact dependency version to exist on npm. It rejects a missing local workspace, a declared/local version mismatch, or an unpublished dependency. The rewrite exists only in the runner's checkout; release-preparation changes remain reviewable in the repository.

## Run the workflow

The workflow is available from the default branch and has no push, pull-request, or tag trigger.

1. Open the repository on GitHub and choose **Actions**.
2. Select **Publish npm package**.
3. Choose **Run workflow**, select the package directory name, and enter the exact version from `packages/<package>/package.json`.
4. Run it from `main` and watch every guard and test complete. Do not rerun with altered inputs until the failure is understood.

The workflow rejects:

- a selected package directory or manifest that does not exist (`kernel` remains selectable ahead of its creation, but cannot publish yet);
- a manifest name other than `digipology-<package>`;
- an input version that differs from the manifest version;
- a package/version already present on npm;
- a registry error that prevents the workflow from proving the version is unused;
- failed frozen installation, typecheck, tests, or package build;
- runtime dependencies outside the package policy: none for `canonical-json`, `prng`, and `protocol`; only `digipology-canonical-json` and `digipology-prng` for `kernel`; only `wasmoon` for `lua`;
- unresolved, version-mismatched, or unpublished workspace dependencies; and
- provenance repository metadata that points anywhere other than this GitHub repository.

Only after those checks pass does npm run `npm publish --provenance --access public`. The workflow uses npm rather than Bun for this step, Node 22, the npm registry configured by `actions/setup-node`, the `NPM_TOKEN` secret, and GitHub's short-lived OIDC identity token.

## Verify the release

Use the exact values shown in the workflow summary:

```sh
npm view digipology-canonical-json@0.1.0 name version dist-tags repository
npm view digipology-canonical-json@0.1.0 dist.tarball
```

Open the version page on npmjs.com and confirm the version, `latest` dist-tag, repository link, and provenance badge/attestation are present. Follow the provenance link from the workflow summary and confirm it identifies the expected GitHub repository, workflow, commit, and GitHub-hosted runner.

Finally, test the package from an empty scratch directory so no monorepo workspace resolution can hide packaging errors:

```sh
scratch_dir="$(mktemp -d)"
cd "$scratch_dir"
npm init -y
npm install digipology-canonical-json@0.1.0
npm ls digipology-canonical-json
```

For Bun compatibility, repeat with `bun add digipology-canonical-json@0.1.0`. `bunx --package <name>@<version> <command>` is appropriate only for a future package that declares a command-line binary; the current libraries are installation-smoked rather than executed with `bunx`.

## Bad releases and deprecation

npm versions are immutable. Fix a bad release, add a changelog entry, and publish a new patch version. Do not overwrite or reuse the bad version.

Deprecate the affected version with an actionable replacement message:

```sh
npm deprecate "digipology-canonical-json@0.1.0" "Known defect; use 0.1.1 or later."
```

Prefer deprecation to unpublishing even during npm's short unpublish window, because consumers and lockfiles may already refer to the release. Never unpublish after 24 hours. Coordinate any exceptional action with the repository and npm account owners.

## First publication of a package

- Check the unscoped name before release: `npm view digipology-<package>`. A 404 means it is currently unused, not reserved. Confirm immediately before the first publish that the name remains available and that the `sanokei` account is authorized to claim it.
- Unscoped npm packages are public by default, but the workflow passes `--access public` explicitly for first-publish clarity and consistent logs.
- Provenance requires npm CLI 9.5 or newer, `id-token: write`, a public package whose repository metadata matches the public repository, and a supported cloud-hosted runner. This workflow uses GitHub's default `ubuntu-latest` runner; do not move publishing to a self-hosted runner.
- Confirm the npm automation token is valid before scheduling the first release. The token authenticates publication; GitHub OIDC supplies the identity used to create the provenance attestation.
