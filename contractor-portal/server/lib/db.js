const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'db.json');

function readDb() {
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  return JSON.parse(raw);
}

function writeDb(db) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2) + '\n', 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function ensureDefaults(db) {
  db.contractors ||= [];
  db.homeowners ||= [];
  db.leads ||= [];
  db.leadInterests ||= [];
  db.creditLedger ||= [];
  db.sessions ||= [];
  db.auditLog ||= [];
  return db;
}

module.exports = {
  DATA_PATH,
  readDb,
  writeDb,
  nowIso,
  addDays,
  ensureDefaults
};


