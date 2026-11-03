# Reference implementation and licensing

Design reference: affil-ai/nextcard-sync, MIT, Copyright (c) 2026 nextcard.
Fixed commit: d39ebb08c4c408a99046087f24e9ccf511e61898 (manifest 0.9.3).
https://github.com/affil-ai/nextcard-sync/tree/d39ebb08c4c408a99046087f24e9ccf511e61898

Modules read directly for this implementation: src/providers/provider-registry.ts;
src/lib/sync-run.ts; src/lib/content-script-run-control.ts;
src/background/core/runtime-state.ts; src/background/core/tab-utils.ts;
scripts/verify-artifact.mjs; LICENSE.

Borrowed design: provider registry, attempt ownership and cancellation guards,
persisted runtime state, navigation lifecycle, and validation of built artifacts.
Cardybara's JS implementation is written for its own protocol and bank scopes;
no Nextcard backend, credentials, membership code, brand assets, MAIN-world
observers, or API interception is included. Reference is not a security audit.
The complete upstream MIT license is preserved in licenses/nextcard-MIT.txt.
