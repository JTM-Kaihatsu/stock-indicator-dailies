# Contributing

## Toolchain

npm workspaces + TypeScript. TypeScript runs **directly** on Node (v22+) via native
type-stripping — there is **no build step** and no bundler for the packages. Tests use
the built-in `node --test` runner.

```bash
npm test          # all packages
npm run typecheck # tsc --noEmit per package
```

## TypeScript: strip-only constraints

Because Node *strips* types rather than compiling them, TypeScript features that require
code generation are **not allowed** in `src/` or `test/`. Avoid:

- **Parameter properties** — `constructor(private x: T)`. Declare the field explicitly
  and assign in the body instead.
- **`enum`** — use `as const` objects / string-literal unions (see `INDICATOR_KEYS`).
- **`namespace`** with runtime members.
- **Experimental decorators.**

Type-only syntax is fine, and `verbatimModuleSyntax` is on, so import types with
`import type { ... }`. Import local modules with their real `.ts` extension.

## Conventions

- `packages/shared` is the single source of truth for domain constants and logic;
  don't re-encode indicator params or signal rules elsewhere — import them.
- Keep deterministic logic in fast unit tests; keep model/browser/network-dependent
  behavior behind interfaces (stub in unit tests, exercise for real in `evals/`).
