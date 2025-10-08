# Contributing to OpalMind

Thanks for taking the time to improve OpalMind! This guide walks you through the workflows we use for local development, testing, and shipping changes across the API and SDK packages.

## Prerequisites

- Node.js 20.x (LTS) and npm 10.x
- Docker (optional, used for local container builds)
- A GitHub account with access to this repository

> Tip: Run `node -v` and `npm -v` after installing to verify your toolchain.

## Getting Started

1. **Fork and clone**
   - If you have write access, clone the canonical repo:
     ```bash
     git clone https://github.com/authorityab/OpalMind.git
     cd OpalMind
     ```
   - Otherwise, fork the repository on GitHub first, then clone your fork (`https://github.com/<your-username>/OpalMind.git`) and add the `authorityab/OpalMind` repository as `upstream`.

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Copy the deployment template if you plan to run the API locally:
     ```bash
     cp deploy/opalmind.env.example deploy/opalmind.env
     ```
   - Create a `.env` file or export the same variables when running the API with `npm run dev --workspace @opalmind/api`.

4. **Build all workspaces**
   ```bash
   npm run build --workspaces
   ```

5. **Run the API locally (optional)**
   ```bash
  npm run dev --workspace @opalmind/api
   ```
   The server listens on `PORT` (`3000` by default). Update the bearer token and Matomo credentials before testing endpoints.

## Development Workflow

- The repository uses a TypeScript monorepo layout with two packages:
  - `@opalmind/sdk` — typed Matomo client helpers
  - `@opalmind/api` — Express/Opal service that wraps the SDK
- Keep changes scoped and incremental. If you touch both packages, split the work into focused commits when possible.
- Update the `.assistant/` planning artifacts if you add roadmap items or change priorities.

## Coding Standards

- Linting: `npm run lint --workspaces`
- Type checks: `npm run typecheck --workspaces`
- Formatting: The project relies on Prettier defaults. When editing files, run `npx prettier --write <files>` as needed.
- Tests: Always run the affected workspace tests before opening a PR.
  ```bash
  npm run test --workspace @opalmind/sdk -- --run
  npm run test --workspace @opalmind/api -- --run
  ```
- Add or update tests for new features and bug fixes. Integration tests for the API live in `packages/api/test/`, while SDK unit tests live in `packages/sdk/test/`.
- Avoid committing generated output (e.g., `dist/`, coverage reports, `.tsbuildinfo`).

## Commit Messages & Pull Requests

- Use [Conventional Commits](https://www.conventionalcommits.org/) for clarity (e.g., `feat(api): add ecommerce series endpoint`).
- Rebase onto `main` before submitting your PR to minimize merge conflicts.
- Each PR should include:
  - A summary of the change and reasoning
  - Testing evidence (`npm run test …`) in the description
  - Documentation updates when behavior or configuration changes
- Request review from a maintainer and respond to feedback promptly.

## Security & Secrets

- Never commit credentials or tokens. Use `.env` files that are ignored by Git.
- If you discover a security issue, please email the maintainers rather than opening a public issue. Include reproduction steps and impacted components.

## Releasing

- Merges to `main` trigger the Docker build workflow that publishes `ghcr.io/authorityab/opalmind-api`.
- When cutting a release, update package versions and changelog entries in tandem. The SDK and API should be published in lockstep so their interfaces remain compatible.

## Need Help?

- Open a discussion or issue describing the problem, current behavior, and desired outcome.
- For questions about Matomo integrations or Opal tool expectations, see `README.md` and the documents under `.assistant/`.

Thanks again for contributing!
