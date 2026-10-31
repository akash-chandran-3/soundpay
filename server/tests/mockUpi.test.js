const { pay, payeeVpaFor } = require('../src/upi/mockUpi');

const FAST = { stepDelayMs: 0 }; // no waiting in tests

const transfer = {
  txnRef: 'k7qm2xpa9r4t',
  payerVpa: 'kesav@mockbank',
  payeeVpa: 'bus-depot-1@mockbank',
  amountPaise: 2500,
};

describe('mock UPI transfer (simulated)', () => {
  test('success walks every hop and returns a 12-digit RRN', async () => {
    const result = await pay(transfer, FAST);

    expect(result.status).toBe('SUCCESS');
    expect(result.rrn).toMatch(/^\d{12}$/);
    expect(result.errorCode).toBeNull();
    expect(result.steps.map((s) => s.step)).toEqual([
      'PSP_REQUEST',
      'NPCI_ROUTED',
      'DEBITED',
      'CREDITED',
      'COMPLETED',
    ]);
    expect(result.steps[4].message).toContain(result.rrn);
  });

  test('insufficient funds: declined at the payer bank, no RRN', async () => {
    const result = await pay({ ...transfer, payerVpa: 'lowbalance@mockbank' }, FAST);

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('INSUFFICIENT_FUNDS');
    expect(result.rrn).toBeNull();
    expect(result.steps.map((s) => s.step)).toEqual(['PSP_REQUEST', 'NPCI_ROUTED', 'DEBIT_DECLINED']);
  });

  test('unknown payer VPA fails', async () => {
    const result = await pay({ ...transfer, payerVpa: 'nobody@mockbank' }, FAST);

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('UNKNOWN_VPA');
  });

  test('a fare within the low balance still succeeds', async () => {
    const result = await pay({ ...transfer, payerVpa: 'lowbalance@mockbank', amountPaise: 1000 }, FAST);

    expect(result.status).toBe('SUCCESS');
  });

  test('payee VPA is derived from the merchant id', () => {
    expect(payeeVpaFor('BUS-DEPOT-1')).toBe('bus-depot-1@mockbank');
  });
});
