// Copyright 2026 Genie (an AI agent). SPDX-License-Identifier: Apache-2.0
// Browser demo: runs the *compiled* ThresholdPass Compact contract with the
// official @midnight-ntwrk/compact-runtime, against an in-browser ledger.
import { ThresholdPassSimulator, pureCircuits, randomBytes, toHex } from '../../contract/src/simulator.js';
import type { Credential } from '../../contract/src/witnesses.js';

type Holder = { name: string; sk: Uint8Array; cred?: Credential; issued: boolean; ticket?: string };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const fmt = (v: bigint) => v.toLocaleString('en-US');

let sim: ThresholdPassSimulator | undefined;
let issuerSk = randomBytes(32);
let holders: Holder[] = [];
const log: string[] = [];

function note(msg: string, kind: 'ok' | 'err' | 'info' = 'info') {
  log.unshift(`<li class="${kind}">${new Date().toLocaleTimeString()} — ${msg}</li>`);
  $('log').innerHTML = log.slice(0, 40).join('');
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const hit = m.match(/failed assert: (.*)/i);
  return hit ? hit[1] : m;
}

function render() {
  const enabled = !!sim;
  document.querySelectorAll<HTMLButtonElement>('.needs-contract').forEach((b) => (b.disabled = !enabled));
  if (!sim) return;
  const l = sim.getLedger();
  const tickets = [...l.passTickets].map(([t, thr]) => `<li><code>${short(toHex(t))}</code> → ≥ ${fmt(thr)}</li>`);
  $('ledger').innerHTML = `
    <dl>
      <dt>issuerPk</dt><dd><code>${short(toHex(l.issuerPk))}</code></dd>
      <dt>threshold</dt><dd>${fmt(l.threshold)}</dd>
      <dt>policyVersion</dt><dd>${l.policyVersion}</dd>
      <dt>credentials (Merkle root)</dt><dd><code>${short(l.credentials.root().field.toString(16).padStart(64, '0'))}</code></dd>
      <dt>issuedCount</dt><dd>${l.issuedCount}</dd>
      <dt>passCount</dt><dd>${l.passCount}</dd>
      <dt>passTickets</dt><dd>${tickets.length ? `<ul>${tickets.join('')}</ul>` : '<em>none yet</em>'}</dd>
    </dl>`;
  $('holders').innerHTML = holders
    .map(
      (h, i) => `
    <tr>
      <td>${h.name}</td>
      <td>${h.cred ? fmt(h.cred.value) : '—'}</td>
      <td><code>${short(toHex(pureCircuits.derivePk(h.sk)))}</code></td>
      <td>${h.issued ? '✅ issued' : `<button data-issue="${i}">Issue</button>`}</td>
      <td><button data-prove="${i}">Prove ≥ threshold</button></td>
      <td>${h.ticket ? `<code class="ticket" title="click to copy to verifier" data-ticket="${h.ticket}">${short(h.ticket)}</code>` : ''}</td>
    </tr>`,
    )
    .join('');
}

async function deploy() {
  const thr = BigInt(($('threshold') as HTMLInputElement).value || '0');
  issuerSk = randomBytes(32);
  sim = await ThresholdPassSimulator.deploy(issuerSk, thr);
  holders = [
    { name: 'Alice', sk: randomBytes(32), cred: { value: 25_000n, salt: randomBytes(32) }, issued: false },
    { name: 'Bob', sk: randomBytes(32), cred: { value: 4_000n, salt: randomBytes(32) }, issued: false },
  ];
  note(`Contract deployed (local ledger). Public threshold = ${fmt(thr)}.`, 'ok');
  render();
}

async function issue(i: number) {
  const h = holders[i];
  if (!sim || !h.cred) return;
  try {
    const c = await sim.issueCredential(issuerSk, pureCircuits.derivePk(h.sk), h.cred);
    h.issued = true;
    note(`issueCredential: inserted hidden commitment for ${h.name} (${short(toHex(c))}) into the Merkle tree. Value stays off-chain.`, 'ok');
  } catch (e) {
    note(`issueCredential rejected: ${errMsg(e)}`, 'err');
  }
  render();
}

async function prove(i: number) {
  const h = holders[i];
  if (!sim || !h.cred) return;
  try {
    const t = await sim.proveThreshold(h.sk, h.cred);
    h.ticket = toHex(t);
    ($('ticket') as HTMLInputElement).value = h.ticket;
    note(`proveThreshold: ${h.name} passed. Ledger learned only “one more pass” + ticket ${short(h.ticket)}.`, 'ok');
  } catch (e) {
    note(`proveThreshold rejected for ${h.name}: ${errMsg(e)}`, 'err');
  }
  render();
}

function addHolder() {
  const name = ($('hname') as HTMLInputElement).value.trim() || `Holder ${holders.length + 1}`;
  const value = BigInt(($('hvalue') as HTMLInputElement).value || '0');
  holders.push({ name, sk: randomBytes(32), cred: { value, salt: randomBytes(32) }, issued: false });
  note(`${name} created a private wallet key; the issuer will attest value ${fmt(value)} off-chain.`);
  render();
}

async function forge() {
  if (!sim) return;
  const m = { name: 'Mallory', sk: randomBytes(32), cred: { value: 1_000_000n, salt: randomBytes(32) }, issued: false };
  try {
    await sim.proveThreshold(m.sk, m.cred);
    note('Unexpected: forged credential accepted', 'err');
  } catch (e) {
    note(`Mallory claimed 1,000,000 without an issued credential → rejected: ${errMsg(e)}`, 'err');
  }
}

async function setThr() {
  if (!sim) return;
  const v = BigInt(($('newthr') as HTMLInputElement).value || '0');
  try {
    await sim.setThreshold(issuerSk, v);
    holders.forEach((h) => (h.ticket = undefined));
    note(`setThreshold: policy v${sim.getLedger().policyVersion} now requires ≥ ${fmt(v)}. Holders can prove again.`, 'ok');
  } catch (e) {
    note(`setThreshold rejected: ${errMsg(e)}`, 'err');
  }
  render();
}

function verify() {
  if (!sim) return;
  const hex = ($('ticket') as HTMLInputElement).value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    $('verdict').textContent = 'Enter a 64-hex-character ticket.';
    return;
  }
  const bytes = new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
  const r = sim.verifyTicket(bytes);
  $('verdict').innerHTML = r.valid
    ? `✅ Valid: the holder proved a value ≥ <b>${fmt(r.threshold!)}</b>. The value itself was never revealed.`
    : '❌ Unknown ticket: no such proof on the ledger.';
}

document.addEventListener('click', (ev) => {
  const t = ev.target as HTMLElement;
  if (t.dataset.issue) void issue(Number(t.dataset.issue));
  if (t.dataset.prove) void prove(Number(t.dataset.prove));
  if (t.dataset.ticket) ($('ticket') as HTMLInputElement).value = t.dataset.ticket;
});
$('deploy').onclick = () => void deploy();
$('add').onclick = addHolder;
$('forge').onclick = () => void forge();
$('setthr').onclick = () => void setThr();
$('verify').onclick = verify;
$('status').textContent = 'Compact runtime loaded. Deploy a policy to start.';
render();
