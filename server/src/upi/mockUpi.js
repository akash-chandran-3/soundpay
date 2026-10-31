// SIMULATED UPI transfer. Nothing here talks to NPCI or a real bank, and no
// money moves. It walks through the same hops a real UPI "pay" request takes,
// so the demo can show (and you can explain) how UPI works:
//
//   payer's UPI app (PSP) -> NPCI UPI switch -> payer's bank (debit)
//                                            -> payee's bank (credit)
//   -> NPCI confirms with an RRN (reference number) -> both sides notified
//
// Real differences worth knowing: the real UPI PIN is encrypted on the phone and
// checked only by the payer's bank; real failures use short NPCI response codes;
// and a real transfer can end up "pending" and be settled later by a status check.
const { newRrn } = require('../ids');

// Demo payer accounts. Balances are fixed demo values (they don't go down).
const DEMO_ACCOUNTS = {
  'kesav@mockbank': { name: 'Kesav (demo)', balancePaise: 50000 }, // Rs 500
  'lowbalance@mockbank': { name: 'Low balance (demo)', balancePaise: 1000 }, // Rs 10
};

// The bus depot's UPI address, e.g. BUS-DEPOT-1 -> bus-depot-1@mockbank
function payeeVpaFor(merchantId) {
  return `${merchantId.toLowerCase()}@mockbank`;
}

function rupees(paise) {
  return `Rs ${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs one simulated transfer. Returns
//   { status: 'SUCCESS', rrn, errorCode: null, steps }  or
//   { status: 'FAILED', rrn: null, errorCode, steps }
// Each step is { step, message, atMs } (atMs = time since the start), so the
// passenger's screen can show the hops as a timeline.
async function pay({ txnRef, payerVpa, payeeVpa, amountPaise }, { stepDelayMs = 300 } = {}) {
  const startedAt = Date.now();
  const steps = [];

  async function step(name, message) {
    await wait(stepDelayMs); // pretend each hop takes a moment
    steps.push({ step: name, message, atMs: Date.now() - startedAt });
  }

  await step('PSP_REQUEST', `Payer's UPI app sent the request to NPCI (ref ${txnRef})`);

  const account = DEMO_ACCOUNTS[payerVpa];
  if (!account) {
    await step('VPA_NOT_FOUND', `Payer's bank has no account for ${payerVpa}`);
    return { status: 'FAILED', rrn: null, errorCode: 'UNKNOWN_VPA', steps };
  }
  await step('NPCI_ROUTED', `NPCI routed the request to the payer's bank`);

  if (account.balancePaise < amountPaise) {
    await step('DEBIT_DECLINED', `Payer's bank declined: insufficient funds`);
    return { status: 'FAILED', rrn: null, errorCode: 'INSUFFICIENT_FUNDS', steps };
  }
  await step('DEBITED', `Payer's bank debited ${rupees(amountPaise)} from ${payerVpa}`);
  await step('CREDITED', `Payee's bank credited ${payeeVpa}`);

  const rrn = newRrn();
  await step('COMPLETED', `NPCI confirmed the transfer (RRN ${rrn})`);

  return { status: 'SUCCESS', rrn, errorCode: null, steps };
}

module.exports = { pay, payeeVpaFor, DEMO_ACCOUNTS };
