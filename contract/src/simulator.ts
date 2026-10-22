// Copyright 2026 Genie (an AI agent). SPDX-License-Identifier: Apache-2.0
//
// A tiny in-process Midnight simulator: runs the compiled Compact circuits
// (the same JS the proof server would prove) against an in-memory ledger.
// Used by the tests and by the browser demo. No network, no wallet, no funds.

import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type StateValue,
  type ChargedState,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits, type Ledger } from './managed/threshold_pass/contract/index.js';
import { witnesses, createPrivateState, type Credential, type ThresholdPassPrivateState } from './witnesses.js';

const COIN_PK = '0'.repeat(64);

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export { pureCircuits };

export class ThresholdPassSimulator {
  readonly contract = new Contract<ThresholdPassPrivateState>(witnesses);
  readonly address = sampleContractAddress();
  private state!: StateValue | ChargedState;

  private constructor() {}

  /** Deploys a fresh contract; the issuer's secret key becomes the admin key. */
  static async deploy(issuerSecretKey: Uint8Array, threshold: bigint): Promise<ThresholdPassSimulator> {
    const sim = new ThresholdPassSimulator();
    const { currentContractState } = await sim.contract.initialState(
      createConstructorContext(createPrivateState(issuerSecretKey), COIN_PK),
      threshold,
    );
    sim.state = currentContractState.data;
    return sim;
  }

  getLedger(): Ledger {
    return ledger(this.state);
  }

  private ctx(circuitId: string, privateState: ThresholdPassPrivateState) {
    return createCircuitContext({
      circuitId,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: COIN_PK,
      contractState: this.state,
      privateState,
    });
  }

  private commit(result: { context: { callContext: { currentQueryContext: { state: unknown } } } }) {
    this.state = result.context.callContext.currentQueryContext.state as StateValue | ChargedState;
  }

  /** Issuer side: computes the hiding commitment for a holder and inserts it. */
  async issueCredential(issuerSecretKey: Uint8Array, holderPk: Uint8Array, credential: Credential): Promise<Uint8Array> {
    const commitment = pureCircuits.credentialCommitment(credential.value, credential.salt, holderPk);
    const r = await this.contract.impureCircuits.issueCredential(
      this.ctx('issueCredential', createPrivateState(issuerSecretKey)),
      commitment,
    );
    this.commit(r);
    return commitment;
  }

  async setThreshold(issuerSecretKey: Uint8Array, minimum: bigint): Promise<void> {
    const r = await this.contract.impureCircuits.setThreshold(
      this.ctx('setThreshold', createPrivateState(issuerSecretKey)),
      minimum,
    );
    this.commit(r);
  }

  /** Holder side: proves value >= threshold; returns the public pass ticket. */
  async proveThreshold(holderSecretKey: Uint8Array, credential: Credential): Promise<Uint8Array> {
    const r = await this.contract.impureCircuits.proveThreshold(
      this.ctx('proveThreshold', createPrivateState(holderSecretKey, credential)),
    );
    this.commit(r);
    return r.result;
  }

  /** Verifier side: pure ledger read, no secrets needed. */
  verifyTicket(ticket: Uint8Array): { valid: boolean; threshold?: bigint } {
    const l = this.getLedger();
    return l.passTickets.member(ticket) ? { valid: true, threshold: l.passTickets.lookup(ticket) } : { valid: false };
  }
}
