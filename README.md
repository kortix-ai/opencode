# OpenCode (Kortix Fork)

> **This is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode).**
> It is not built by or affiliated with the OpenCode team.

This fork adds features missing from upstream: **file mutation endpoints**, **project scanning**, and a **publishable CLI binary**. These additions enable external clients (like [Kortix Computer](https://github.com/kortix-ai/computer)) to manage project files through the OpenCode API.

### Install

```bash
# CLI (includes all platform binaries)
npm install -g @kortix/opencode-ai

# SDK (for programmatic access)
npm install @kortix/opencode-sdk
```

---

## Changelog (vs upstream `anomalyco/opencode`)

### New REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/file/upload` | Upload one or more files via `multipart/form-data`. Supports single file, batch upload, and an optional `path` field to specify a target directory. Binary-safe. |
| `DELETE` | `/file` | Delete a file or directory recursively. JSON body: `{ "path": "relative/path" }` |
| `POST` | `/file/mkdir` | Create a directory (recursive, idempotent). JSON body: `{ "path": "relative/path" }` |
| `POST` | `/file/rename` | Rename or move a file/directory. Creates missing parent dirs. JSON body: `{ "from": "old", "to": "new" }` |

All endpoints enforce path traversal protection via `Instance.containsPath()` and emit `file.edited` events via the bus for real-time UI updates.

### New Business Logic Functions

Added to `packages/opencode/src/file/index.ts` inside the `File` namespace:

- **`File.upload(file, data)`** — Write a file from `ArrayBuffer | Uint8Array | Blob | string`. Auto-creates parent directories.
- **`File.remove(file)`** — Delete a file or directory recursively. Throws on nonexistent paths.
- **`File.mkdir(dir)`** — Create directories recursively. Idempotent.
- **`File.rename(from, to)`** — Move/rename a file or directory. Creates target parent directories.

### Project Scanning

- **`Project.scan(paths?)`** — Discovers all git repositories under given directories (defaults to `$KORTIX_WORKSPACE` or `$HOME`). Skips common non-project directories (node_modules, .git, vendor, etc.).

### SDK (`@kortix/opencode-sdk`)

The generated TypeScript SDK (`packages/sdk/js/`) includes matching client methods on the `File` class:

```ts
import { File } from "@kortix/opencode-sdk/v2"

const client = new File({ baseUrl: "http://localhost:4096" })

// Upload
await client.upload(/* multipart form data via fetch */)

// Delete
await client.delete({ path: "src/old-file.ts" })

// Mkdir
await client.mkdir({ path: "src/new-dir" })

// Rename
await client.rename({ from: "old-name.ts", to: "new-name.ts" })
```

### Tests

25 end-to-end tests in `packages/opencode/test/file/write.test.ts` covering:

- `File.upload` — text, binary (ArrayBuffer), nested paths, overwrite, path traversal rejection, roundtrip with `File.read`
- `File.remove` — file deletion, recursive directory deletion, nonexistent file error, path traversal rejection
- `File.mkdir` — creation, recursive nesting, idempotency, path traversal rejection
- `File.rename` — rename, move into new directory, nonexistent source error, path traversal rejection (source and target)
- HTTP endpoint tests — `POST /file/upload` (single, batch with target dir, binary), `DELETE /file`, `POST /file/mkdir`, `POST /file/rename`

### CLI Publishing (`@kortix/opencode-ai`)

The Kortix fork builds and publishes its own CLI binary to npm as `@kortix/opencode-ai`. The binary includes build-time defines that point autoupdate checks at the Kortix npm package and GitHub releases instead of upstream.

### CI / Automation

- **`.github/workflows/sync-upstream.yml`** — Daily cron + manual trigger to sync from `anomalyco/opencode:dev` into the `kortix` branch.
- **`.github/workflows/publish-kortix.yml`** — Manual trigger to build and publish `@kortix/opencode-ai` (CLI) and `@kortix/opencode-sdk` (SDK) to npm.
- **`packages/sdk/js/script/publish-kortix.ts`** — Publishes the SDK as `@kortix/opencode-sdk` to npm.
- **`packages/opencode/script/publish-kortix.ts`** — Publishes the CLI as `@kortix/opencode-ai` to npm.

---

## Branch Structure

| Branch | Purpose |
|--------|---------|
| `kortix` | Default. All Kortix additions merged here. |
| `dev` | Upstream mirror (`anomalyco/opencode:dev`). Untouched. |

---

## Upstream

For documentation on OpenCode itself, see the upstream repo: [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode) and [opencode.ai/docs](https://opencode.ai/docs).
