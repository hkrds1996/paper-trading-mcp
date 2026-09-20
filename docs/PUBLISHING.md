# Publishing

The user has requested a public npm release under `@hkrds1996/paper-trading-mcp`. Publication requires an npm account authorized for that scope. Do not put registry credentials in the repository.

1. Run `npm login` interactively and verify `npm whoami`.
2. Run `npm ci`, `npm test`, and `npm pack --dry-run`; inspect the package file list.
3. Run `npm publish --access public`. `prepublishOnly` runs the tests again. Complete any npm authentication or OTP prompt in the terminal.
4. Confirm `npm view @hkrds1996/paper-trading-mcp@<version> version` and `npx -y @hkrds1996/paper-trading-mcp@<version> --version`, with `<version>` the one just published.
5. Remove the pending-publication notice from the README and update the dashboard configuration examples only after registry verification.

**The registry reports a successful publish before the version is readable, so a 404 here does not mean the publish failed.** The 0.4.0 release ended with npm printing `Your package is being processed and may take a few minutes to become available.` followed by the version line, `PUT` accepted with 202, and exit 0; `npm view @hkrds1996/paper-trading-mcp@0.4.0` and `dist-tags` still 404'd and still showed the previous `latest` for some minutes afterwards. The publish log is the authority on whether the publish succeeded — read the whole log, not its tail, because the eventual `PUT` and `notice` lines sit after a long polling loop. A genuinely failed publish exits non-zero and prints an error code such as `EOTP`.

Keep `UNLICENSED` until the owner chooses a source license; public distribution does not grant an open-source license. No license change is part of this release.

The npm package uses an explicit files allowlist. Provider keys and user tokens are never bundled. Use a new version for later releases; registry versions cannot be overwritten.
