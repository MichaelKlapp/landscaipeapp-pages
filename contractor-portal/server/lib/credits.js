const { nowIso } = require('./db');

function getCreditBalance(db, contractorId) {
  return db.creditLedger
    .filter((e) => e.contractorId === contractorId)
    .reduce((sum, e) => sum + (Number(e.delta) || 0), 0);
}

function getHeldCreditsCount(db, contractorId, asOf = new Date()) {
  const now = asOf.getTime();
  return db.leadInterests.filter((li) => {
    if (li.contractorId !== contractorId) return false;
    if (li.status !== 'held') return false;
    return new Date(li.expiresAt).getTime() > now;
  }).length;
}

function getAvailableCredits(db, contractorId, asOf = new Date()) {
  return Math.max(0, getCreditBalance(db, contractorId) - getHeldCreditsCount(db, contractorId, asOf));
}

function addLedgerEntry(db, entry) {
  db.creditLedger.push({
    id: entry.id,
    contractorId: entry.contractorId,
    type: entry.type,
    delta: entry.delta,
    leadId: entry.leadId || null,
    note: entry.note || null,
    createdAt: entry.createdAt || nowIso()
  });
}

module.exports = {
  getCreditBalance,
  getHeldCreditsCount,
  getAvailableCredits,
  addLedgerEntry
};


