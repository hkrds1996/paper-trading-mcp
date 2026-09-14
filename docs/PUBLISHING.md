# Publishing

The user has requested a public npm release under `@krh1996/paper-trading-mcp`. Publication requires an npm account authorized for that scope. Do not put registry credentials in the repository.

1. Run `npm login` interactively and verify `npm whoami`.
2. Run `npm ci`, `npm test`, and `npm pack --dry-run`; inspect the package file list.
3. Run `npm publish --access public`. `prepublishOnly` runs the tests again. Complete any npm authentication or OTP prompt in the terminal.
4. Confirm `npm view @krh1996/paper-trading-mcp@0.2.1 version` and `npx -y @krh1996/paper-trading-mcp@0.2.1 --version`.
5. Remove the pending-publication notice from the README and update the dashboard configuration examples only after registry verification.

Keep `UNLICENSED` until the owner chooses a source license; public distribution does not grant an open-source license. No license change is part of this release.

The npm package uses an explicit files allowlist. Provider keys and user tokens are never bundled. Use a new version for later releases; registry versions cannot be overwritten.
