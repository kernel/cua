# npm releases

`@onkernel/cua-ai` and `@onkernel/cua-agent` publish from package-specific tags:

- `cua-ai/v0.1.0` runs `.github/workflows/release-cua-ai.yml`
- `cua-agent/v0.1.0` runs `.github/workflows/release-cua-agent.yml`

The tag version must match the target package's `package.json` version, and the
tagged commit must be contained in `main`.

## Trusted publishing setup

Configure each package on npm with a GitHub Actions trusted publisher:

| package | organization | repository | workflow filename | environment |
| --- | --- | --- | --- | --- |
| `@onkernel/cua-ai` | `kernel` | `cua` | `release-cua-ai.yml` | leave blank |
| `@onkernel/cua-agent` | `kernel` | `cua` | `release-cua-agent.yml` | leave blank |

The same configuration can be created from the npm CLI:

```sh
npm install -g npm@^11.10.0
npm trust github @onkernel/cua-ai --repo kernel/cua --file release-cua-ai.yml
npm trust github @onkernel/cua-agent --repo kernel/cua --file release-cua-agent.yml
```

npm requires packages to exist before a trusted publisher can be configured. If
the package has not been published yet, either publish the first version manually
and use trusted publishing for later versions, or publish a bootstrap version
first, configure trusted publishing, then release `0.1.0` from tags.

## Releasing 0.1.0

Publish `@onkernel/cua-ai` first because `@onkernel/cua-agent` depends on it:

```sh
git checkout main
git pull --ff-only
git tag cua-ai/v0.1.0
git push origin cua-ai/v0.1.0
```

After `@onkernel/cua-ai@0.1.0` is available on npm:

```sh
git tag cua-agent/v0.1.0
git push origin cua-agent/v0.1.0
```
