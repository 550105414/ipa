# Browser-local encrypted customer vault

This module stores the demo/local customer archive in IndexedDB. Sensitive values never appear in the summary record: phone, both ID-card image blobs, and bank PAN are encrypted independently with AES-256-GCM and random 96-bit IVs. AES-GCM AAD binds schema version, the SHA-256 user-scope binding, vault ID, customer ID, and field name.

The master key is random. PBKDF2-SHA256 (210,000 iterations and a random salt) derives its wrapping key from both the user password and the high-entropy `unlockSecret` returned by `/api/local-vault/unlock`. The secret is kept only in an opaque in-memory, absolute five-minute session and is never persisted, so copying IndexedDB is not enough to brute-force the short application password offline.

Phone search stores HMAC-SHA256 tokens for every continuous 3–11 digit fragment. Its non-extractable HMAC key is derived from the master key with HKDF and persisted as a `CryptoKey`, allowing locked list/search screens without storing plaintext phone fragments. This protects a static IndexedDB export; it cannot protect against malicious same-origin JavaScript, so CSP/XSS controls remain required.

Small customer summaries and indexes live separately from encrypted image/payment payloads. Phone lookup uses a multi-entry HMAC-token index; name/list lookup uses a user-scope + creation-time range cursor. Search therefore never loads all ID image ciphertext into memory. A second DEK-derived, non-extractable HMAC key authenticates every plaintext summary field and token so an offline IndexedDB edit cannot silently forge a customer or search result.

Customer ciphertext, authenticated summary, and phone tokens are committed in one transaction. IndexedDB quota, blocked upgrade, and version-change failures are explicit errors. The supported KDF work factor and salt sizes are exact for each schema version, preventing a modified record from forcing unbounded PBKDF2 work. An unlocked customer owns its object URLs through `revoke()`; `revokeLocalVaultSession()` also revokes every URL registered to that session.

`searchLocalCustomersPage()` returns at most 20 summaries with `nextCursor` and `total`. Its keyset cursor is authenticated by the summary HMAC key and bound to the vault, query, status, and period; it contains no phone query or decrypted payload. `searchLocalCustomers()` remains the compatible first-page wrapper.

No API or stored type accepts CVV, PIN, card password, or similar authentication data.
