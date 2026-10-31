// GET /api/upi/demo-accounts -> the simulated payer accounts the passenger can pick.
const express = require('express');
const { DEMO_ACCOUNTS } = require('../upi/mockUpi');

const router = express.Router();

router.get('/demo-accounts', (req, res) => {
  const accounts = Object.entries(DEMO_ACCOUNTS).map(([vpa, account]) => ({
    vpa,
    name: account.name,
    balancePaise: account.balancePaise,
  }));
  res.json({ accounts });
});

module.exports = router;
