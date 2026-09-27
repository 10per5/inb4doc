# Deferred: Server / Microservice / Decentralized Sharing Architecture

> **Status:** Deferred — separate from the serverless `inb4doc://` link work (`inb4doc-uri.md`).
> Written so a future plan can build on it without re-litigating fundamentals.

---

## 1. Vision

- A **microservice-oriented** backend where **providers can sync between users and clients**.
- Sharing a note becomes "post it to a node, hand out a short link or magnet."
- Documents are **encrypted** and **self-deleting on read** — old-school pastebin semantics: ephemeral by default, persistent only on explicit opt-in.
- **Decentralized:** no single authority. Providers are peered / replicated; the network stores only ciphertext.

This is the long-term answer to "share markdown quickly" once the inline, serverless link (`inb4doc://1/doc/…`) outgrows chat-app length limits.

---

## 2. Why deferred

- The immediate need — quick chat-share of *small* markdown — is solved serverlessly today.
- A server introduces hosting, trust, and operational cost that conflict with the local-first stance. It should be designed deliberately, not bolted on.
- It touches the provider/replication model that is not yet formalized in the editor.

---

## 3. Components (proposed)

### 3.1 Paste / service node (microservice)
- `POST /v1/paste` → store an encrypted blob; return a short `id` and optional `delete-after-read` / `ttl` tokens.
- `GET /v1/paste/:id` → return the blob; if `deleteAfterRead`, purge on first *successful* read.
- **Content-addressable:** the `h` (SHA-256, already defined in `inb4doc-uri.md`) doubles as dedup/integrity key.
- Ephemeral TTL + burn-on-read flags, configurable per post.

### 3.2 Provider sync layer
- Each user runs/uses a **provider** (already modelled in the editor as `providerId`).
- A sync protocol (CRDT or op-log) replicates page trees between consenting providers.
- Access control enforced at the provider boundary; **end-to-end encryption** so the node never sees plaintext.

### 3.3 Discovery / DHT (decentralized variant)
- Providers advertise presence; clients resolve `inb4doc://link/<id>` to a reachable node.
- Could reuse a Kademlia-style DHT or a lightweight tracker; privacy vs. bootstrapping is the open trade-off.

### 3.4 Link evolution
- `inb4doc://link/<id>` (server/id variant) replaces inline `doc` for anything above chat length.
- **QR then encodes the short link** — practical, unlike QR-ing a multi-KB inline payload.
- Encryption (`pw`) stays client-side; the node stores only ciphertext + tag.

---

## 4. Security model

- **Client-side AES-GCM** (same KDF/cipher as `inb4doc-uri.md`). The server stores ciphertext + tag only.
- **Burn-on-read** is enforced server-side but **trust-minimized**: the client verifies `h` and rejects mismatches. A malicious node could refuse to delete, so deletion is a policy promise, not a cryptographic guarantee — surface this honestly in the UI.
- **Provider sync** uses mutual auth + E2E; the sync node is untrusted storage.

---

## 5. Relationship to `inb4doc-uri.md`

- The `doc` (inline) and `link` (server) payloads share the **same decode pipeline**; only transport differs.
- `h` (SHA-256) is defined now so the server can reuse it for dedup/integrity without breaking older links.
- **Versioning** (`ver` segment + `flags` byte) accommodates adding `link` without a new scheme or decoder break.
- The shared-doc → **Save to vault** flow from `inb4doc-uri.md` extends naturally: a `link` fetch lands in the same read-only view, then saves to the user's provider.

---

## 6. Open design questions (for the future plan)

1. **Sync correctness** — CRDT vs. op-log for the existing page/frontmatter model (frontmatter patches complicate pure CRDT).
2. **Burn-on-read trust** — cryptographic receipts vs. policy enforcement; how to prove deletion to the client.
3. **Decentralized discovery** — how to bootstrap without a central tracker while preserving privacy.
4. **Identity mapping** — how the current `providerId` in the editor maps to a synced/decentralized identity.
5. **Node deployment** — single shared public node vs. user-operated nodes vs. full DHT; cost and moderation implications.
6. **Link expiry UX** — how burn-on-read / TTL surfaces in the Share UI alongside the serverless option.
