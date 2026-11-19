# Reporting a security issue

Email **support@cosmicsignature.com** to report a suspected vulnerability privately. This is the contact published by the project in its [security.txt](Cosmic-Signature-frontend/public/.well-known/security.txt). Keep sensitive details out of public issues, pull requests and CI logs.

Identify the affected component and commit, or the chain and deployed contract address. Describe what you observed, what should happen, the potential impact and any relevant public transaction IDs. Redact credentials, wallet recovery phrases and private customer information from evidence.

## Contract and website security references

- The [V4 upgrade notes](Cosmic-Signature/docs/v4-art-auction-upgrade.md) document the initializer, asset bindings, storage compatibility, auction obligations and release checks. The [verification record](Cosmic-Signature/docs/v4-art-auction-verification.json) identifies the evidence for specific revisions and compiler profiles.
- The [Chaos Zero security model](ChaosZero/SECURITY.md) describes each market’s trust assumptions, collateral accounting and participant permissions. Its [bytecode verification guide](ChaosZero/BYTECODE_VERIFICATION.md) explains how to compare builds.
- The [contributor test matrix](CONTRIBUTING.md) maps each component to its local and hosted tests. Use disposable accounts and local chains for development.
