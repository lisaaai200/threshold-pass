# 🌙 ThresholdPass: private proof-of-threshold on Midnight

**Prove that a private number meets a public bar without revealing the number.**

Examples include "my reserves are ≥ $10,000", "my income is ≥ the rent requirement", "I hold ≥ 500 governance tokens" and "I'm over 18".
ThresholdPass is a [Compact](https://docs.midnight.network/compact) smart contract plus a browser demo for the [Midnight](https://midnight.network) network.
A trusted issuer attests a value once. After that, the holder can prove *value ≥ threshold* in zero knowledge as often as policies require. The ledger only ever learns that someone passed.

- **Live demo (GitHub Pages):** https://lisaaai200.github.io/threshold-pass/
- **Contract:** [`contract/src/threshold_pass.compact`](contract/src/threshold_pass.compact)
- **Compile and test evidence:** [`docs/compile-evidence.txt`](docs/compile-evidence.txt) (official compiler 0.35.0 log) · CI workflow: [`ci/github-actions-ci.yml`](ci/github-actions-ci.yml)
- **License:** Apache-2.0 · GitHub topic `midnightntwrk`

> 🤖 **Disclosure:** this project was designed, written and tested by **Genie, an AI agent**, for the Midnight Buildathon (Wave 3) on AKINDO. Its human owner reviews and submits the entry. The code is entirely open, so please judge it on what it does.

---

## 1. The problem

Proof-of-solvency, KYC tiers, credit checks and token-gated access all have the same shape: *a verifier needs a yes/no answer about a number they should never see.* Today the holder hands over bank statements or wallet addresses, so the verifier ends up storing far more data than it needs. Public chains make this worse, because a "proof of balance" there usually means revealing the address and its full history.

## 2. How it works

| Role | Does | Sees |
|---|---|---|
| **Issuer** (auditor, exchange, bank, payroll provider) | Deploys a policy (`threshold`). Checks a holder's value off-chain, gives them a credential `{value, salt}`, and inserts only `H(value, salt, holderPk)` into a Merkle tree on-chain. | Value of the holders it attests. It can't link later passes to holders. |
| **Holder** | Runs `proveThreshold()` locally. The circuit privately checks the credential is in the tree, that it belongs to the holder's key, and that `value ≥ threshold`. | Its own private state |
| **Verifier** (lender, DAO, marketplace) | Gets a 32-byte **pass ticket** from the holder and looks it up in the public `passTickets` map. | Only "a valid issued credential passed policy *X*" |
| **Everyone else** | Reads the public ledger | Threshold, counts, Merkle root, tickets. No values, no holder keys, no link to a specific credential. |

```
 Issuer device                Midnight public ledger                  Holder device (private state)
 ─────────────                ──────────────────────                  ─────────────────────────────
 deploy(threshold) ───────▶  issuerPk, threshold, policyVersion
 attest value off-chain ──────────────────────────────────────────▶  {secretKey, value, salt}
 issueCredential(commit) ─▶  credentials: HistoricMerkleTree  ◀─ path ─ witness credentialPath()
                             (commitment hidden inside the tree)
                                                                    proveThreshold()  [ZK circuit]
                                                                      ├ leaf = H(value,salt,pk(sk))
                                                                      ├ path.leaf == leaf
                                                                      ├ checkRoot(root(path))
                                                                      ├ disclose(value ≥ threshold)
                             passTickets[nullifier] = threshold ◀──── └ nullifier = H(sk, version, threshold)
 Verifier: passTickets.member(ticket)? ──▶ ✅ "≥ threshold"
```

## 3. Midnight integration and privacy design (dual-ledger model)

Midnight keeps a **public ledger state** on-chain and **private state** on each user's device. Circuits connect the two: they read private data through `witness` functions, and nothing derived from a witness reaches the ledger unless it is wrapped in `disclose()`. The compiler enforces this rule. ThresholdPass uses each part of that model as follows:

- **Private state** ([`witnesses.ts`](contract/src/witnesses.ts)): `secretKey`, `credential.value`, `credential.salt`. These are served by `witness secretKey()`, `credentialValue()`, `credentialSalt()` and `credentialPath(leaf)`. The last one builds the Merkle path from the local copy of the ledger (`findPathForLeaf`).
- **Public ledger** ([`threshold_pass.compact`](contract/src/threshold_pass.compact)): `issuerPk`, `threshold`, `policyVersion: Counter`, `credentials: HistoricMerkleTree<16, Bytes<32>>` (up to 65,536 credentials), `issuedCount`, `passTickets: Map<Bytes<32>, Uint<64>>` and `passCount`.
- **Explicit disclosure is minimal.** Only four things are disclosed:
  1. the Merkle root that the path hashes to (`checkRoot`);
  2. the **boolean** `value >= threshold`, never the value itself;
  3. the nullifier ticket;
  4. issuer-supplied policy values.
- **Commitment and nullifier pattern** (the Zerocash pattern from the Midnight docs):
  - The commitment `H("tpass:cred:", value, salt, pk)` sits in a Merkle tree. The circuit proves membership without saying which leaf it used.
  - The nullifier `H("tpass:nul:", sk, policyVersion, threshold)` is keyed by the holder's *secret* key. So not even the issuer can link a ticket back to a credential.
  - Domain separators keep the commitment, the nullifier and the public key apart.
- **Binding the path to the caller.** Following the docs' *Restricting a circuit to a group* guidance, the circuit asserts `path.leaf == leaf`, where `leaf` is rebuilt from the caller's own secret key. Copying someone else's credential or path therefore fails, and the test suite checks this.
- **Issuer authentication** uses derived identity: `issuerPk = H("tpass:pk:", sk)` is stored at deploy, and issuer-only circuits re-derive it from the witness `secretKey()`.
- **Policy versioning.** `setThreshold` bumps `policyVersion`, which gives every holder a fresh nullifier space, so they can prove again under the new rule. Old tickets keep the threshold they proved (`passTickets[t]`). A verifier always sees *which* bar was cleared.
- `HistoricMerkleTree` is used so that a proof built against an older root still verifies after the issuer adds more credentials. Nothing is ever removed, which is the safe case for historic roots (see the docs' caveat).

### Trust model and limitations (honest list)

- The issuer is trusted to attest values correctly; it acts as an oracle. ThresholdPass hides the value from everyone *else* and makes passes unlinkable, but the issuer itself knows the values it attested.
- Privacy among holders is only as large as the anonymity set (the number of issued credentials). A tree with 3 leaves hides little.
- There is no revocation or expiry yet (see the roadmap). Values are `Uint<64>` in whole units.
- The live demo runs the compiled circuits in a local, in-browser simulated ledger (see below). It does **not** generate ZK proofs or talk to a Midnight network. Proving needs the Midnight proof server, and deploying needs a funded testnet wallet.

## 4. Repository layout

```
contract/src/threshold_pass.compact   Compact contract (3 provable circuits + 3 pure helpers)
contract/src/witnesses.ts             Private-state type + witness implementations
contract/src/simulator.ts             In-process ledger simulator built on @midnight-ntwrk/compact-runtime
contract/src/test/*.test.ts           Vitest suite (12 tests) against the compiled contract
web/src/main.ts, web/public/*         Static frontend (issuer / holder / verifier panels)
web/build.mjs                         esbuild bundle incl. the Midnight on-chain runtime WASM
ci/github-actions-ci.yml              GitHub Actions: installs the official Compact toolchain, compiles, tests, builds Pages
docs/compile-evidence.txt             Local compile + test log
```

`contract/src/managed/` (the compiler output: TypeScript bindings, ZKIR, prover and verifier keys) is generated and git-ignored; `npm run compact` (or the CI workflow) rebuilds it from source.

## 5. Setup and how to test (for judges)

Requirements: Node 20+, Linux or macOS (x86_64 or arm64).

```bash
# 1. Install the official Compact toolchain (or use the installer from docs.midnight.network)
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.3/compact-installer.sh | sh
compact update 0.35.0
compact compile --version          # 0.35.0

# 2. Build and test
git clone https://github.com/lisaaai200/threshold-pass && cd threshold-pass
npm ci
npm run compact                    # full compile: TS bindings + ZKIR + proving/verifier keys (~15 s)
npm run typecheck
npm test                           # 12 tests, compiled circuits on a simulated ledger
npm run build:web && npx serve site   # or: python3 -m http.server -d site
```

The live demo is the output of `npm run build:web`, published on the `gh-pages` branch.

Expected compiler output: `Compiling 3 circuits:` (`issueCredential`, `setThreshold`, `proveThreshold`), with keys in `contract/src/managed/threshold_pass/keys/`.

### What the tests cover (`contract/src/test/threshold-pass.test.ts`)

1. The constructor initialises the public ledger; only the *derived* issuer key is public.
2. Only the issuer can issue credentials.
3. A holder at or above the threshold passes and gets a verifiable ticket.
4. A holder below the threshold is rejected (`Value is below the threshold`).
5. A forged value with no issued credential is rejected (`not issued`).
6. Stealing another holder's credential is rejected, because the path is bound to the caller's key.
7. Double-proving under the same policy is rejected (nullifier).
8. A policy change gives a fresh ticket. Old tickets keep their old threshold, and a raised bar rejects the holder.
9. Only the issuer can change the threshold.
10. Nothing public equals the holder's key, commitment or value.
11. Unknown tickets don't verify.
12. Pure helpers are deterministic and domain-separated.

### Try the frontend

Open the [live demo](https://lisaaai200.github.io/threshold-pass/) and try this sequence:

1. Click **Deploy contract**.
2. Click **Issue** for Alice and for Bob.
3. Click **Prove** for each: Alice (25,000) passes, and Bob (4,000) is rejected by the circuit's assertion.
4. Click **Try a forged credential**.
5. Click **Verify** on Alice's ticket.

The *Public ledger* panel shows exactly what an observer could see. Every action calls the real compiled circuits through `@midnight-ntwrk/compact-runtime`, and the runtime's WASM ledger runs in your browser.

## 6. Use cases and adoption path

- **Proof of reserves or solvency** for OTC desks, market makers and DAOs' treasuries. An auditor issues the credential, and counterparties verify tickets.
- **Under-collateralised DeFi and RWA onboarding**: "income ≥ X" or "net worth ≥ accredited threshold", without the lender storing documents.
- **Token- and reputation-gated access**: "≥ N tokens or points" without doxxing the wallet.
- **Age and eligibility checks** (the threshold is a birth-date bound).

Adoption path: start with one issuer that already verifies the data (an exchange or auditor), plus one verifier that wants fewer documents (a lender or launchpad). The contract is generic, so each issuer deploys its own policy instance.

## 7. Roadmap

- [x] Compact contract: Merkle-hidden credentials, threshold proof, nullifier tickets, policy versioning
- [x] Simulator, 12 tests, CI with the official compiler, and a static frontend running the compiled contract
- [ ] Deploy to Midnight testnet (faucet tDUST) with `midnight-js` and a local proof server, and generate real proofs
- [ ] Lace wallet (DApp connector) integration in the frontend
- [ ] Credential expiry and revocation (epoch roots); multiple issuers; range proofs (`lo ≤ v < hi`)
- [ ] A verifier SDK and REST endpoint for checking tickets through the Midnight indexer

## 8. Credits

- The Midnight docs: *Keeping data private*, *Security best practices*, and the ledger ADT reference.
- The test and simulator structure follows [`midnightntwrk/example-bboard`](https://github.com/midnightntwrk/example-bboard) (Apache-2.0).

Built by **Genie** (an AI agent) · Apache-2.0 · not financial or legal advice.
