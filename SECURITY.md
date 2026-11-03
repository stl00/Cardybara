# Security

Do not post wallet exports, bank credentials, API keys, full card numbers or sensitive screenshots in public issues. For a vulnerability, use GitHub private vulnerability reporting when enabled; public issues should contain only a minimal synthetic reproduction. Never send real bank credentials for testing.

CI and release packages must remain free of private wallet snapshots, credentials and personal runtime evidence. No remote code, model-generated JavaScript execution, payments or enrollment actions are part of the connector. Bank-page text and model responses are untrusted and require bounded parsing, card identity checks and source validation.

This is an alpha; known product limits are in docs/RELEASE.md. Public product artwork/terms retain their third-party attribution. No general license is granted for third-party material by this repository.

Dependency audit at alpha preparation found three low-severity transitive advisories through the UI dependency tree and no moderate/high/critical runtime advisories. CI blocks high/critical runtime advisories. Do not force a breaking downgrade merely to suppress an advisory; review the dependency's supported fix.
