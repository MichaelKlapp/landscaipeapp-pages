const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const multer = require('multer');

const { readDb, writeDb, ensureDefaults, nowIso, addDays } = require('./lib/db');
const { getCreditBalance, getAvailableCredits, addLedgerEntry } = require('./lib/credits');
const { validatePreAcceptanceMessage } = require('./lib/sanitize');
const { matchesLead, scoreLead } = require('./lib/matching');
const {
  MAX_PHOTOS_TOTAL,
  MAX_FEATURED,
  ensureDir,
  contractorUploadDir,
  normalizePhotos,
  addPhoto,
  deletePhoto,
  setFeatured,
  movePhoto
} = require('./lib/photos');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3030;
const INTEREST_TTL_DAYS = 4;
const BASE_PATH = process.env.BASE_PATH || '/contractor-portal';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const LEADS_DIR = path.join(UPLOADS_DIR, 'leads');

function cleanExpiredInterests(db) {
  const now = Date.now();
  for (const li of db.leadInterests) {
    if (li.status !== 'held') continue;
    if (new Date(li.expiresAt).getTime() <= now) {
      li.status = 'expired';
      li.expiredAt = nowIso();
      li.releaseReason = 'ttl_expired';
    }
  }
}

function getContractorById(db, id) {
  return db.contractors.find((c) => c.id === id) || null;
}

function safeContractorView(contractor) {
  if (!contractor) return null;
  normalizePhotos(contractor);
  return {
    id: contractor.id,
    role: contractor.role,
    status: contractor.status,
    email: contractor.email,
    companyName: contractor.companyName,
    ownerName: contractor.ownerName,
    yearsInBusiness: contractor.yearsInBusiness ?? null,
    ratingAvg: contractor.ratingAvg ?? null,
    ratingCount: contractor.ratingCount ?? null,
    photos: Array.isArray(contractor.photos) ? contractor.photos : [],
    tagline: contractor.tagline,
    logoUrl: contractor.logoUrl,
    phone: contractor.phone,
    plan: contractor.plan,
    autoReload: contractor.autoReload,
    serviceZips: contractor.serviceZips,
    majorCategories: contractor.majorCategories,
    subCategories: contractor.subCategories
  };
}

function safeContractorHomeownerView(contractor) {
  if (!contractor) return null;
  normalizePhotos(contractor);
  const photos = contractor.photos || [];
  const featured = photos.filter((p) => p.isFeatured).slice(0, MAX_FEATURED);
  return {
    id: contractor.id,
    companyName: contractor.companyName,
    tagline: contractor.tagline,
    yearsInBusiness: contractor.yearsInBusiness ?? null,
    ratingAvg: contractor.ratingAvg ?? null,
    ratingCount: contractor.ratingCount ?? null,
    majorCategories: contractor.majorCategories || [],
    subCategories: contractor.subCategories || [],
    serviceZips: contractor.serviceZips || [],
    featuredPhotos: featured,
    allPhotos: photos.slice(0, MAX_PHOTOS_TOTAL)
  };
}

function safeLeadMaskedView(db, lead) {
  const homeowner = db.homeowners.find((h) => h.id === lead.homeownerId) || null;
  return {
    id: lead.id,
    zip: lead.zip,
    budgetMin: lead.budgetMin,
    budgetMax: lead.budgetMax,
    vibe: lead.vibe,
    changeLevel: lead.changeLevel,
    majorCategories: lead.majorCategories,
    requiredTags: lead.requiredTags,
    beforeImageUrl: lead.beforeImageUrl,
    afterImageUrl: lead.afterImageUrl,
    createdAt: lead.createdAt,
    status: lead.status,
    homeowner: {
      phoneVerified: Boolean(homeowner && homeowner.phoneVerifiedAt),
      zip: homeowner ? homeowner.zip : lead.zip
    }
  };
}

function safeLeadFullView(db, lead) {
  const homeowner = db.homeowners.find((h) => h.id === lead.homeownerId) || null;
  return {
    ...safeLeadMaskedView(db, lead),
    homeowner: homeowner
      ? {
          id: homeowner.id,
          displayName: homeowner.displayName,
          email: homeowner.email,
          phone: homeowner.phone,
          zip: homeowner.zip,
          phoneVerifiedAt: homeowner.phoneVerifiedAt
        }
      : null
  };
}

function authFromRequest(db, req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  const session = db.sessions.find((s) => s.token === token) || null;
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = getContractorById(db, session.userId);
  if (!user) return null;
  return { token, session, user };
}

function requireAuth(req, res, next) {
  const db = ensureDefaults(readDb());
  cleanExpiredInterests(db);
  const auth = authFromRequest(db, req);
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  req.db = db;
  req.user = auth.user;
  req.token = auth.token;
  req._saveDb = () => writeDb(db);
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

function uuid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Allow API to be served from /contractor-portal/api/* as well as /api/*
app.use((req, _res, next) => {
  if (req.url.startsWith(`${BASE_PATH}/api/`)) {
    req.url = req.url.slice(BASE_PATH.length);
  }
  next();
});

// Serve portal under /contractor-portal (and keep / for local convenience)
app.use(BASE_PATH, express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.use('/', express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Serve existing site assets for demo lead images (mounted at both paths)
app.use(`${BASE_PATH}/assets`, express.static(path.join(__dirname, '..', '..', 'assets')));
app.use('/assets', express.static(path.join(__dirname, '..', '..', 'assets')));

// Serve portal-specific assets (icons, etc.)
app.use(`${BASE_PATH}/cp-assets`, express.static(path.join(__dirname, '..', 'cp-assets')));
app.use('/cp-assets', express.static(path.join(__dirname, '..', 'cp-assets')));

// Serve contractor uploaded portfolio photos
ensureDir(UPLOADS_DIR);
ensureDir(LEADS_DIR);
app.use(`${BASE_PATH}/uploads`, express.static(UPLOADS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const auth = authFromRequest(ensureDefaults(readDb()), req);
      const userId = auth && auth.user ? auth.user.id : 'unknown';
      const dir = contractorUploadDir(UPLOADS_DIR, userId);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.jpg';
      cb(null, `${crypto.randomUUID().slice(0, 10)}${safeExt}`);
    }
  }),
  limits: { fileSize: 6 * 1024 * 1024 }
});

function safeImageExt(originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return ext;
  return '.jpg';
}

function deleteIfExists(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
}

// Lead images upload (admin only)
const leadUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const leadId = req.leadId || 'unknown';
      const dir = path.join(LEADS_DIR, leadId);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = safeImageExt(file.originalname);
      const field = file.fieldname === 'before' ? 'before' : 'after';
      cb(null, `${field}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

// -------- Auth --------
app.post('/api/auth/login', (req, res) => {
  const db = ensureDefaults(readDb());
  cleanExpiredInterests(db);

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.contractors.find((c) => String(c.email).toLowerCase() === email) || null;

  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });
  if (user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

  const token = uuid('sess');
  const createdAt = nowIso();
  const expiresAt = addDays(new Date(), 7).toISOString();

  db.sessions.push({ token, userId: user.id, createdAt, expiresAt });
  writeDb(db);

  res.json({ token, user: safeContractorView(user) });
});

app.post('/api/auth/register', (req, res) => {
  const db = ensureDefaults(readDb());
  cleanExpiredInterests(db);

  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const companyName = String(req.body.companyName || '').trim();
  const ownerName = String(req.body.ownerName || '').trim();
  const phone = String(req.body.phone || '').trim();
  const yearsInBusiness = Number(req.body.yearsInBusiness || 0);

  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (!companyName) return res.status(400).json({ error: 'Business name is required' });
  if (!ownerName) return res.status(400).json({ error: 'Owner name is required' });
  if (!phone) return res.status(400).json({ error: 'Phone is required' });
  if (!Number.isFinite(yearsInBusiness) || yearsInBusiness < 0 || yearsInBusiness > 100) {
    return res.status(400).json({ error: 'Years in business must be between 0 and 100' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const existing = db.contractors.find((c) => String(c.email).toLowerCase() === email);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

  const id = uuid('ctr');
  const user = {
    id,
    role: 'contractor',
    status: 'active',
    email,
    password, // demo only; replace with hashing before production
    companyName: companyName.slice(0, 80),
    ownerName: ownerName.slice(0, 80),
    yearsInBusiness: Math.trunc(yearsInBusiness),
    ratingAvg: null,
    ratingCount: null,
    photos: [],
    tagline: null,
    logoUrl: null,
    phone: phone.slice(0, 40),
    plan: 'payg',
    autoReload: { enabled: false, threshold: 2, reloadAmount: 10 },
    serviceZips: [],
    majorCategories: [],
    subCategories: []
  };

  db.contractors.push(user);

  const token = uuid('sess');
  const createdAt = nowIso();
  const expiresAt = addDays(new Date(), 7).toISOString();
  db.sessions.push({ token, userId: user.id, createdAt, expiresAt });

  writeDb(db);
  res.json({ token, user: safeContractorView(user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.token;
  req.db.sessions = req.db.sessions.filter((s) => s.token !== token);
  req._saveDb();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const contractorId = req.user.id;
  const balance = getCreditBalance(req.db, contractorId);
  const available = getAvailableCredits(req.db, contractorId);

  res.json({
    user: safeContractorView(req.user),
    credits: { balance, available }
  });
});

// -------- Leads --------
app.get('/api/leads', requireAuth, (req, res) => {
  const contractor = req.user;

  // admin can view all leads
  const candidates = contractor.role === 'admin' ? req.db.leads : req.db.leads.filter((l) => matchesLead(contractor, l));

  const myInterests = req.db.leadInterests.filter((li) => li.contractorId === contractor.id);
  const myInterestByLead = new Map(myInterests.map((li) => [li.leadId, li]));

  const list = candidates
    .map((lead) => {
      const masked = safeLeadMaskedView(req.db, lead);
      const li = myInterestByLead.get(lead.id) || null;
      return {
        ...masked,
        score: contractor.role === 'admin' ? null : scoreLead(contractor, lead),
        interest: li
          ? {
              status: li.status,
              heldAt: li.heldAt || null,
              expiresAt: li.expiresAt || null,
              capturedAt: li.capturedAt || null,
              releasedAt: li.releasedAt || null,
              releaseReason: li.releaseReason || null
            }
          : null
      };
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0) || String(b.createdAt).localeCompare(String(a.createdAt)));

  res.json({ leads: list });
});

app.get('/api/leads/:id', requireAuth, (req, res) => {
  const lead = req.db.leads.find((l) => l.id === req.params.id) || null;
  if (!lead) return res.status(404).json({ error: 'Not found' });

  const isAdmin = req.user.role === 'admin';
  const isAssignedToMe = lead.assignedContractorId === req.user.id && lead.status === 'assigned';

  if (isAdmin || isAssignedToMe) return res.json({ lead: safeLeadFullView(req.db, lead) });
  return res.json({ lead: safeLeadMaskedView(req.db, lead) });
});

app.post('/api/leads/:id/interest', requireAuth, (req, res) => {
  const contractor = req.user;
  const lead = req.db.leads.find((l) => l.id === req.params.id) || null;
  if (!lead) return res.status(404).json({ error: 'Not found' });
  if (contractor.role !== 'admin' && !matchesLead(contractor, lead)) return res.status(403).json({ error: 'Not eligible for this lead' });
  if (lead.status !== 'open') return res.status(409).json({ error: 'Lead is not open' });

  const existing = req.db.leadInterests.find((li) => li.leadId === lead.id && li.contractorId === contractor.id) || null;
  if (existing && (existing.status === 'held' || existing.status === 'captured')) {
    return res.json({ ok: true, interest: existing });
  }

  const available = getAvailableCredits(req.db, contractor.id);
  if (available < 1) return res.status(409).json({ error: 'Not enough available lead credits to hold this lead' });

  const heldAt = nowIso();
  const expiresAt = addDays(new Date(), INTEREST_TTL_DAYS).toISOString();
  const li = {
    id: uuid('li'),
    leadId: lead.id,
    contractorId: contractor.id,
    status: 'held',
    heldAt,
    expiresAt,
    capturedAt: null,
    releasedAt: null,
    expiredAt: null,
    withdrawnAt: null,
    releaseReason: null
  };

  req.db.leadInterests.push(li);
  req._saveDb();
  res.json({ ok: true, interest: li });
});

app.post('/api/leads/:id/withdraw-interest', requireAuth, (req, res) => {
  const contractor = req.user;
  const li = req.db.leadInterests.find((x) => x.leadId === req.params.id && x.contractorId === contractor.id) || null;
  if (!li) return res.status(404).json({ error: 'No interest found for this lead' });
  if (li.status !== 'held') return res.status(409).json({ error: `Cannot withdraw interest in status '${li.status}'` });

  li.status = 'withdrawn';
  li.withdrawnAt = nowIso();
  li.releaseReason = 'contractor_withdrew';
  req._saveDb();
  res.json({ ok: true, interest: li });
});

// -------- Ask Question (pre-acceptance) --------
app.post('/api/leads/:id/questions', requireAuth, (req, res) => {
  const contractor = req.user;
  const lead = req.db.leads.find((l) => l.id === req.params.id) || null;
  if (!lead) return res.status(404).json({ error: 'Not found' });

  const li = req.db.leadInterests.find((x) => x.leadId === lead.id && x.contractorId === contractor.id) || null;
  if (!li || li.status !== 'held') return res.status(409).json({ error: 'You must be interested in the lead to ask a question' });

  const templateId = String(req.body.templateId || '').trim();
  const extra = String(req.body.extra || '').trim();

  const templates = {
    timeline: 'What’s your ideal project timeline?',
    access: 'Any access constraints (gates, pets, HOA rules)?',
    materials: 'Do you have preferred materials or styles?',
    budget: 'Is your budget range flexible?',
    scope: 'Which parts of the yard are highest priority?'
  };

  const base = templates[templateId];
  if (!base) return res.status(400).json({ error: 'Invalid templateId' });

  let message = base;
  if (extra) message += ` — ${extra}`;

  const validation = validatePreAcceptanceMessage(message);
  if (!validation.ok) return res.status(400).json({ error: validation.reason });

  lead.questions ||= [];
  lead.questions.push({
    id: uuid('q'),
    leadId: lead.id,
    contractorId: contractor.id,
    contractorName: contractor.companyName,
    templateId,
    text: validation.text,
    createdAt: nowIso()
  });

  req._saveDb();
  res.json({ ok: true });
});

// -------- Profile --------
app.get('/api/profile', requireAuth, (req, res) => {
  res.json({ profile: safeContractorView(req.user) });
});

app.post('/api/profile', requireAuth, (req, res) => {
  const contractor = req.user;
  const body = req.body || {};

  // minimal validation; tighten later
  contractor.companyName = String(body.companyName || contractor.companyName || '').slice(0, 80);
  contractor.ownerName = String(body.ownerName || contractor.ownerName || '').slice(0, 80);
  contractor.tagline = String(body.tagline || contractor.tagline || '').slice(0, 120) || null;

  contractor.serviceZips = Array.isArray(body.serviceZips) ? body.serviceZips.map((z) => String(z).trim()).filter(Boolean).slice(0, 50) : contractor.serviceZips;
  contractor.majorCategories = Array.isArray(body.majorCategories) ? body.majorCategories.map(String) : contractor.majorCategories;
  contractor.subCategories = Array.isArray(body.subCategories) ? body.subCategories.map(String) : contractor.subCategories;

  req._saveDb();
  res.json({ ok: true, profile: safeContractorView(contractor) });
});

// Portfolio photos
app.post('/api/profile/photos', requireAuth, upload.single('photo'), (req, res) => {
  const contractor = req.user;
  normalizePhotos(contractor);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if ((contractor.photos || []).length >= MAX_PHOTOS_TOTAL) {
    // delete the uploaded file since we won't keep it
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(409).json({ error: `Max ${MAX_PHOTOS_TOTAL} photos allowed.` });
  }

  const isFeatured = Boolean(req.body && (req.body.isFeatured === 'true' || req.body.isFeatured === true));
  if (isFeatured && (contractor.photos || []).filter((p) => p.isFeatured).length >= MAX_FEATURED) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(409).json({ error: `You can only feature ${MAX_FEATURED} photos.` });
  }

  const relativeUrl = `${BASE_PATH}/uploads/${encodeURIComponent(contractor.id)}/${encodeURIComponent(req.file.filename)}`;
  const photo = {
    id: uuid('ph'),
    url: relativeUrl,
    thumbUrl: relativeUrl,
    isFeatured,
    createdAt: nowIso()
  };

  const added = addPhoto(contractor, photo);
  if (!added.ok) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(409).json({ error: added.reason });
  }

  req._saveDb();
  return res.json({ ok: true, photos: contractor.photos, limits: { maxTotal: MAX_PHOTOS_TOTAL, maxFeatured: MAX_FEATURED } });
});

app.delete('/api/profile/photos/:photoId', requireAuth, (req, res) => {
  const contractor = req.user;
  const result = deletePhoto(contractor, req.params.photoId);
  if (!result.ok) return res.status(404).json({ error: result.reason });

  // best-effort: remove file on disk if it lives in our uploads directory
  const removed = result.removed;
  if (removed && removed.url && String(removed.url).includes('/uploads/')) {
    const parts = String(removed.url).split('/uploads/')[1];
    const fullPath = path.join(UPLOADS_DIR, decodeURIComponent(parts || ''));
    if (fullPath.startsWith(UPLOADS_DIR)) {
      try { fs.unlinkSync(fullPath); } catch {}
    }
  }

  req._saveDb();
  return res.json({ ok: true, photos: contractor.photos });
});

app.post('/api/profile/photos/:photoId/feature', requireAuth, (req, res) => {
  const contractor = req.user;
  const isFeatured = Boolean(req.body && req.body.isFeatured);
  const result = setFeatured(contractor, req.params.photoId, isFeatured);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  req._saveDb();
  return res.json({ ok: true, photos: contractor.photos, limits: { maxTotal: MAX_PHOTOS_TOTAL, maxFeatured: MAX_FEATURED } });
});

app.post('/api/profile/photos/:photoId/move', requireAuth, (req, res) => {
  const contractor = req.user;
  const dir = String(req.body && req.body.direction || '').trim();
  if (dir !== 'up' && dir !== 'down') return res.status(400).json({ error: 'direction must be up or down' });
  const result = movePhoto(contractor, req.params.photoId, dir);
  if (!result.ok) return res.status(404).json({ error: result.reason });
  req._saveDb();
  return res.json({ ok: true, photos: contractor.photos });
});

// App-facing: homeowner view for contractor card/profile
app.get('/api/public/contractors/:id', (req, res) => {
  const db = ensureDefaults(readDb());
  const contractor = db.contractors.find((c) => c.id === req.params.id) || null;
  if (!contractor) return res.status(404).json({ error: 'Not found' });
  return res.json({ contractor: safeContractorHomeownerView(contractor) });
});

// -------- Billing (stub; Stripe later) --------
app.get('/api/billing', requireAuth, (req, res) => {
  const contractorId = req.user.id;
  const balance = getCreditBalance(req.db, contractorId);
  const available = getAvailableCredits(req.db, contractorId);

  res.json({
    plan: req.user.plan,
    autoReload: req.user.autoReload,
    credits: { balance, available }
  });
});

app.post('/api/billing/buy-credits', requireAuth, (req, res) => {
  const amount = Number(req.body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) return res.status(400).json({ error: 'Invalid amount' });

  addLedgerEntry(req.db, {
    id: uuid('led'),
    contractorId: req.user.id,
    type: 'purchase',
    delta: Math.floor(amount),
    note: 'Manual credit purchase (demo)'
  });

  req._saveDb();
  res.json({ ok: true });
});

app.post('/api/billing/set-plan', requireAuth, (req, res) => {
  const plan = String(req.body.plan || '').trim();
  const allowed = new Set(['payg', 'pro100', 'pro250']);
  if (!allowed.has(plan)) return res.status(400).json({ error: 'Invalid plan' });
  req.user.plan = plan;
  req._saveDb();
  res.json({ ok: true });
});

// -------- Admin --------
app.get('/api/admin/contractors', requireAuth, requireAdmin, (req, res) => {
  res.json({ contractors: req.db.contractors.map(safeContractorView) });
});

app.post('/api/admin/contractors/:id/add-credits', requireAuth, requireAdmin, (req, res) => {
  const contractor = getContractorById(req.db, req.params.id);
  if (!contractor) return res.status(404).json({ error: 'Not found' });

  const amount = Number(req.body.amount || 0);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000) return res.status(400).json({ error: 'Invalid amount' });

  addLedgerEntry(req.db, {
    id: uuid('led'),
    contractorId: contractor.id,
    type: 'admin_adjustment',
    delta: Math.trunc(amount),
    note: String(req.body.note || 'Admin adjustment').slice(0, 200)
  });

  req.db.auditLog.push({
    id: uuid('audit'),
    type: 'admin_add_credits',
    actorId: req.user.id,
    targetContractorId: contractor.id,
    amount: Math.trunc(amount),
    createdAt: nowIso()
  });

  req._saveDb();
  res.json({ ok: true });
});

// Simulate homeowner accepting a contractor (this will be triggered by the app later)
app.post('/api/admin/leads/:id/accept', requireAuth, requireAdmin, (req, res) => {
  const lead = req.db.leads.find((l) => l.id === req.params.id) || null;
  if (!lead) return res.status(404).json({ error: 'Not found' });
  if (lead.status !== 'open') return res.status(409).json({ error: 'Lead is not open' });

  const contractorId = String(req.body.contractorId || '').trim();
  const contractor = getContractorById(req.db, contractorId);
  if (!contractor) return res.status(404).json({ error: 'Contractor not found' });
  if (contractor.role !== 'contractor') return res.status(400).json({ error: 'Invalid contractor' });

  // must have an active hold to be accepted (matches the intended flow)
  const chosen = req.db.leadInterests.find((li) => li.leadId === lead.id && li.contractorId === contractor.id) || null;
  if (!chosen || chosen.status !== 'held') return res.status(409).json({ error: 'Contractor must be interested (held) to be accepted' });

  // Capture 1 credit (winner)
  addLedgerEntry(req.db, {
    id: uuid('led'),
    contractorId: contractor.id,
    type: 'lead_capture',
    delta: -1,
    leadId: lead.id,
    note: 'Lead accepted by homeowner (demo)'
  });

  chosen.status = 'captured';
  chosen.capturedAt = nowIso();
  chosen.releaseReason = null;

  // Release all other holds
  for (const li of req.db.leadInterests) {
    if (li.leadId !== lead.id) continue;
    if (li.id === chosen.id) continue;
    if (li.status !== 'held') continue;
    li.status = 'released';
    li.releasedAt = nowIso();
    li.releaseReason = 'homeowner_selected_other';
  }

  lead.status = 'assigned';
  lead.assignedContractorId = contractor.id;
  lead.acceptedAt = nowIso();

  req.db.auditLog.push({
    id: uuid('audit'),
    type: 'admin_force_accept',
    actorId: req.user.id,
    leadId: lead.id,
    contractorId: contractor.id,
    createdAt: nowIso()
  });

  req._saveDb();
  res.json({ ok: true });
});

app.get('/api/admin/leads', requireAuth, requireAdmin, (req, res) => {
  const leads = req.db.leads
    .map((l) => {
      const homeowner = req.db.homeowners.find((h) => h.id === l.homeownerId) || null;
      return {
        ...safeLeadMaskedView(req.db, l),
        homeowner: homeowner
          ? {
              id: homeowner.id,
              displayName: homeowner.displayName,
              email: homeowner.email,
              phone: homeowner.phone,
              zip: homeowner.zip,
              phoneVerifiedAt: homeowner.phoneVerifiedAt
            }
          : null,
        assignedContractorId: l.assignedContractorId || null,
        acceptedAt: l.acceptedAt || null
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  res.json({ leads });
});

app.post(
  '/api/admin/leads',
  requireAuth,
  requireAdmin,
  (req, _res, next) => {
    req.leadId = uuid('lead');
    next();
  },
  leadUpload.fields([
    { name: 'before', maxCount: 1 },
    { name: 'after', maxCount: 1 }
  ]),
  (req, res) => {
    const leadId = req.leadId;
    const files = req.files || {};
    const before = Array.isArray(files.before) ? files.before[0] : null;
    const after = Array.isArray(files.after) ? files.after[0] : null;

    if (!before || !after) {
      if (before) deleteIfExists(before.path);
      if (after) deleteIfExists(after.path);
      return res.status(400).json({ error: 'Both before and after images are required.' });
    }

    const zip = String(req.body.zip || '').trim();
    if (!zip) {
      deleteIfExists(before.path);
      deleteIfExists(after.path);
      return res.status(400).json({ error: 'ZIP is required.' });
    }

    const homeownerName = String(req.body.homeownerName || '').trim() || 'Homeowner';
    const homeownerEmail = String(req.body.homeownerEmail || '').trim().toLowerCase();
    const homeownerPhone = String(req.body.homeownerPhone || '').trim();
    if (!homeownerEmail || !homeownerPhone) {
      deleteIfExists(before.path);
      deleteIfExists(after.path);
      return res.status(400).json({ error: 'Homeowner email and phone are required.' });
    }

    // create or reuse homeowner
    let homeowner = req.db.homeowners.find((h) => String(h.email).toLowerCase() === homeownerEmail) || null;
    if (!homeowner) {
      homeowner = {
        id: uuid('hm'),
        displayName: homeownerName.slice(0, 80),
        email: homeownerEmail,
        phone: homeownerPhone.slice(0, 40),
        zip,
        phoneVerifiedAt: nowIso()
      };
      req.db.homeowners.push(homeowner);
    }

    const budgetMin = req.body.budgetMin !== undefined && String(req.body.budgetMin).trim() !== '' ? Number(req.body.budgetMin) : null;
    const budgetMax = req.body.budgetMax !== undefined && String(req.body.budgetMax).trim() !== '' ? Number(req.body.budgetMax) : null;
    const vibe = String(req.body.vibe || '').trim() || null;
    const changeLevel = String(req.body.changeLevel || '').trim() || null;

    const majorCategories = String(req.body.majorCategories || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    const requiredTags = String(req.body.requiredTags || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25);

    const beforeUrl = `${BASE_PATH}/uploads/leads/${encodeURIComponent(leadId)}/${encodeURIComponent(before.filename)}`;
    const afterUrl = `${BASE_PATH}/uploads/leads/${encodeURIComponent(leadId)}/${encodeURIComponent(after.filename)}`;

    const lead = {
      id: leadId,
      homeownerId: homeowner.id,
      zip,
      budgetMin: Number.isFinite(budgetMin) ? budgetMin : null,
      budgetMax: Number.isFinite(budgetMax) ? budgetMax : null,
      vibe,
      changeLevel,
      majorCategories,
      requiredTags,
      beforeImageUrl: beforeUrl,
      afterImageUrl: afterUrl,
      createdAt: nowIso(),
      status: 'open',
      assignedContractorId: null,
      acceptedAt: null
    };

    req.db.leads.push(lead);
    req._saveDb();
    return res.json({ ok: true, lead });
  }
);

app.post('/api/admin/leads/:id/spam', requireAuth, requireAdmin, (req, res) => {
  const lead = req.db.leads.find((l) => l.id === req.params.id) || null;
  if (!lead) return res.status(404).json({ error: 'Not found' });
  if (lead.status !== 'open') return res.status(409).json({ error: 'Only open leads can be marked as spam in v1' });

  for (const li of req.db.leadInterests) {
    if (li.leadId !== lead.id) continue;
    if (li.status !== 'held') continue;
    li.status = 'released';
    li.releasedAt = nowIso();
    li.releaseReason = 'lead_marked_spam';
  }

  lead.status = 'spam';
  req._saveDb();
  return res.json({ ok: true });
});

app.post('/api/admin/leads/:id/reset', requireAuth, requireAdmin, (req, res) => {
  const lead = req.db.leads.find((l) => l.id === req.params.id) || null;
  if (!lead) return res.status(404).json({ error: 'Not found' });

  // Clear interests for clean re-testing
  req.db.leadInterests = req.db.leadInterests.filter((li) => li.leadId !== lead.id);

  lead.status = 'open';
  lead.assignedContractorId = null;
  lead.acceptedAt = null;
  req._saveDb();
  return res.json({ ok: true });
});

// -------- health --------
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

if (process.argv.includes('--seed')) {
  // No-op for now since db.json is already seeded; kept for future
  console.log('Seed: db.json already contains demo data.');
  process.exit(0);
}

app.listen(PORT, () => {
  console.log(`Contractor Portal running at http://localhost:${PORT}`);
});


