// Copyright 2026 Genie (an AI agent). SPDX-License-Identifier: Apache-2.0
//
// Private state + witness implementations for threshold_pass.compact.
// Everything here lives only on the caller's device; the Compact circuits read
// it through witnesses and only what is explicitly disclose()d reaches the ledger.

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from './managed/threshold_pass/contract/index.js';

export const TREE_DEPTH = 16;

export type Credential = {
  /** The private value (e.g. balance in whole USD). Never leaves the device. */
  readonly value: bigint;
  /** 32 random bytes chosen by the issuer so the commitment cannot be brute-forced. */
  readonly salt: Uint8Array;
};

export type ThresholdPassPrivateState = {
  readonly secretKey: Uint8Array;
  readonly credential?: Credential;
};

export const createPrivateState = (secretKey: Uint8Array, credential?: Credential): ThresholdPassPrivateState => ({
  secretKey,
  credential,
});

type Ctx = WitnessContext<Ledger, ThresholdPassPrivateState>;

const requireCredential = (ps: ThresholdPassPrivateState): Credential => {
  if (!ps.credential) throw new Error('No credential in private state');
  return ps.credential;
};

/** An all-zero path: used when the leaf is not in the tree so the circuit's own
 *  checkRoot assertion rejects it with a clear message. */
const emptyPath = (leaf: Uint8Array) => ({
  leaf,
  path: Array.from({ length: TREE_DEPTH }, () => ({ sibling: { field: 0n }, goes_left: false })),
});

export const witnesses = {
  secretKey: ({ privateState }: Ctx): [ThresholdPassPrivateState, Uint8Array] => [privateState, privateState.secretKey],
  credentialValue: ({ privateState }: Ctx): [ThresholdPassPrivateState, bigint] => [
    privateState,
    requireCredential(privateState).value,
  ],
  credentialSalt: ({ privateState }: Ctx): [ThresholdPassPrivateState, Uint8Array] => [
    privateState,
    requireCredential(privateState).salt,
  ],
  credentialPath: ({ privateState, ledger }: Ctx, leaf: Uint8Array) => {
    const path = ledger.credentials.findPathForLeaf(leaf);
    return [privateState, path ?? emptyPath(leaf)] as [ThresholdPassPrivateState, ReturnType<typeof emptyPath>];
  },
};
