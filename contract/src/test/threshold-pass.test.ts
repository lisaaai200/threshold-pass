// Copyright 2026 Genie (an AI agent). SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest';
import { ThresholdPassSimulator, pureCircuits, randomBytes, toHex } from '../simulator.js';

const issuerSk = randomBytes(32);
const alice = { sk: randomBytes(32), cred: { value: 25_000n, salt: randomBytes(32) } };
const bob = { sk: randomBytes(32), cred: { value: 4_000n, salt: randomBytes(32) } };
const pk = (sk: Uint8Array) => pureCircuits.derivePk(sk);

describe('ThresholdPass contract (compiled Compact, simulated ledger)', () => {
  let sim: ThresholdPassSimulator;
  beforeEach(async () => {
    sim = await ThresholdPassSimulator.deploy(issuerSk, 10_000n);
  });

  it('initialises the public ledger from the constructor', () => {
    const l = sim.getLedger();
    expect(l.threshold).toBe(10_000n);
    expect(l.policyVersion).toBe(1n);
    expect(l.issuedCount).toBe(0n);
    expect(l.passCount).toBe(0n);
    expect(toHex(l.issuerPk)).toBe(toHex(pk(issuerSk)));
    expect(l.issuerPk).not.toEqual(issuerSk); // only the derived key is public
  });

  it('lets only the issuer issue credentials', async () => {
    await sim.issueCredential(issuerSk, pk(alice.sk), alice.cred);
    expect(sim.getLedger().issuedCount).toBe(1n);
    await expect(sim.issueCredential(alice.sk, pk(alice.sk), alice.cred)).rejects.toThrow(/Only the issuer/);
    expect(sim.getLedger().issuedCount).toBe(1n);
  });

  it('accepts a holder whose private value meets the threshold', async () => {
    await sim.issueCredential(issuerSk, pk(alice.sk), alice.cred);
    const ticket = await sim.proveThreshold(alice.sk, alice.cred);
    expect(ticket).toHaveLength(32);
    expect(sim.getLedger().passCount).toBe(1n);
    expect(sim.verifyTicket(ticket)).toEqual({ valid: true, threshold: 10_000n });
  });

  it('rejects a holder whose private value is below the threshold', async () => {
    await sim.issueCredential(issuerSk, pk(bob.sk), bob.cred);
    await expect(sim.proveThreshold(bob.sk, bob.cred)).rejects.toThrow(/below the threshold/);
    expect(sim.getLedger().passCount).toBe(0n);
  });

  it('rejects a credential the issuer never issued (forged value)', async () => {
    await sim.issueCredential(issuerSk, pk(bob.sk), bob.cred);
    const forged = { ...bob.cred, value: 1_000_000n };
    await expect(sim.proveThreshold(bob.sk, forged)).rejects.toThrow(/not issued/);
  });

  it("rejects someone using another holder's credential (path bound to caller key)", async () => {
    await sim.issueCredential(issuerSk, pk(alice.sk), alice.cred);
    const mallory = randomBytes(32);
    await expect(sim.proveThreshold(mallory, alice.cred)).rejects.toThrow(/not issued/);
  });

  it('prevents double-proving under the same policy (nullifier)', async () => {
    await sim.issueCredential(issuerSk, pk(alice.sk), alice.cred);
    await sim.proveThreshold(alice.sk, alice.cred);
    await expect(sim.proveThreshold(alice.sk, alice.cred)).rejects.toThrow(/Already proven/);
    expect(sim.getLedger().passCount).toBe(1n);
  });

  it('re-opens proving with a fresh ticket after the policy changes', async () => {
    await sim.issueCredential(issuerSk, pk(alice.sk), alice.cred);
    const t1 = await sim.proveThreshold(alice.sk, alice.cred);
    await sim.setThreshold(issuerSk, 20_000n);
    expect(sim.getLedger().policyVersion).toBe(2n);
    const t2 = await sim.proveThreshold(alice.sk, alice.cred);
    expect(toHex(t2)).not.toBe(toHex(t1));
    expect(sim.verifyTicket(t2)).toEqual({ valid: true, threshold: 20_000n });
    expect(sim.verifyTicket(t1)).toEqual({ valid: true, threshold: 10_000n });
    await sim.setThreshold(issuerSk, 30_000n);
    await expect(sim.proveThreshold(alice.sk, alice.cred)).rejects.toThrow(/below the threshold/);
  });

  it('lets only the issuer change the threshold', async () => {
    await expect(sim.setThreshold(alice.sk, 1n)).rejects.toThrow(/Only the issuer/);
    expect(sim.getLedger().threshold).toBe(10_000n);
  });

  it('hides which credential was used among many (Merkle membership)', async () => {
    await sim.issueCredential(issuerSk, pk(alice.sk), alice.cred);
    await sim.issueCredential(issuerSk, pk(bob.sk), bob.cred);
    const ticket = await sim.proveThreshold(alice.sk, alice.cred);
    const l = sim.getLedger();
    const pub = JSON.stringify({ ticket: toHex(ticket), issuer: toHex(l.issuerPk) });
    // Nothing public equals Alice's key, her commitment, or her value.
    const aliceCommit = pureCircuits.credentialCommitment(alice.cred.value, alice.cred.salt, pk(alice.sk));
    expect(pub).not.toContain(toHex(pk(alice.sk)));
    expect(pub).not.toContain(toHex(aliceCommit));
    expect(toHex(ticket)).not.toBe(toHex(aliceCommit));
    for (const [t, thr] of l.passTickets) {
      expect(thr).toBe(10_000n);
      expect(toHex(t)).not.toBe(toHex(pk(alice.sk)));
    }
  });

  it('ticket is unknown to the verifier until shown', () => {
    expect(sim.verifyTicket(randomBytes(32))).toEqual({ valid: false });
  });

  it('pure circuits are deterministic and domain-separated', () => {
    const s = randomBytes(32);
    expect(toHex(pureCircuits.derivePk(s))).toBe(toHex(pureCircuits.derivePk(s)));
    const c = pureCircuits.credentialCommitment(1n, s, s);
    const n = pureCircuits.passNullifier(s, 1n, 1n);
    expect(toHex(c)).not.toBe(toHex(n));
  });
});
