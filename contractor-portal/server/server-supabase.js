require('dotenv').config({ override: true });

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const { validatePreAcceptanceMessage } = require('./lib/sanitize');
const { matchesLead, scoreLead } = require('./lib/matching');
const { getSupabase, getPortalConfig } = require('./lib/supabaseClient');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3030;
const INTEREST_TTL_DAYS = 4;
const BASE_PATH = process.env.BASE_PATH || '/contractor-portal';

const MAX_PHOTOS_TOTAL = 10;
const MAX_FEATURED = 3;

const app = express();
app.use(express.json({ limit: '2mb' }));

// Fail fast on missing env / invalid Supabase config
try {
  getSupabase();
} catch (e) {
  console.error(String(e && e.message ? e.message : e));
  console.error('Create contractor-portal/server/.env based on contractor-portal/server/env.example');
  process.exit(1);
}

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

// Serve existing site assets (for shared icons/images)
app.use(`${BASE_PATH}/assets`, express.static(path.join(__dirname, '..', '..', 'assets')));
app.use('/assets', express.static(path.join(__dirname, '..', '..', 'assets')));

// Serve portal-specific assets (icons, etc.)
app.use(`${BASE_PATH}/cp-assets`, express.static(path.join(__dirname, '..', 'cp-assets')));
app.use('/cp-assets', express.static(path.join(__dirname, '..', 'cp-assets')));

function nowIso() {
  return new Date().toISOString();
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function uuid(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function safeImageExt(originalName) {
  const ext = String(path.extname(originalName || '') || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return ext;
  return '.jpg';
}

async function cleanExpiredInterests() {
  const supabase = getSupabase();
  const now = nowIso();
  await supabase
    .from('cp_lead_interests')
    .update({ status: 'expired', expired_at: now, release_reason: 'ttl_expired' })
    .eq('status', 'held')
    .lte('expires_at', now);
}

async function signStoragePath(bucket, storagePath) {
  if (!storagePath) return null;

  // Allow legacy/static paths in DB if you choose to store them
  if (String(storagePath).startsWith('/')) return storagePath;
  if (String(storagePath).startsWith('http://') || String(storagePath).startsWith('https://')) return storagePath;

  const supabase = getSupabase();
  const { signedUrlTtlSeconds } = getPortalConfig();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, signedUrlTtlSeconds);
  if (error) return null;
  return data.signedUrl || null;
}

async function creditsFor(contractorId) {
  const supabase = getSupabase();
  const now = nowIso();

  const { data: ledger, error: ledgerErr } = await supabase
    .from('cp_credit_ledger')
    .select('delta')
    .eq('contractor_id', contractorId);
  if (ledgerErr) throw ledgerErr;
  const balance = (ledger || []).reduce((sum, r) => sum + (Number(r.delta) || 0), 0);

  const { count: heldCount, error: heldErr } = await supabase
    .from('cp_lead_interests')
    .select('id', { count: 'exact', head: true })
    .eq('contractor_id', contractorId)
    .eq('status', 'held')
    .gt('expires_at', now);
  if (heldErr) throw heldErr;

  const available = Math.max(0, balance - (heldCount || 0));
  return { balance, available };
}

async function getContractorById(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('cp_contractors').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getContractorByEmail(email) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('cp_contractors').select('*').ilike('email', String(email).trim()).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getContractorPhotos(contractorId) {
  const supabase = getSupabase();
  const { bucketContractorPhotos } = getPortalConfig();

  const { data, error } = await supabase
    .from('cp_contractor_photos')
    .select('*')
    .eq('contractor_id', contractorId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const photos = [];
  for (const r of rows) {
    const url = await signStoragePath(bucketContractorPhotos, r.storage_path);
    photos.push({
      id: r.id,
      url,
      thumbUrl: url,
      isFeatured: Boolean(r.is_featured),
      sortOrder: Number(r.sort_order) || 0,
      createdAt: r.created_at
    });
  }
  return photos;
}

function safeContractorView(contractor, photos) {
  return {
    id: contractor.id,
    role: contractor.role,
    status: contractor.status,
    email: contractor.email,
    companyName: contractor.company_name,
    ownerName: contractor.owner_name,
    yearsInBusiness: contractor.years_in_business ?? null,
    ratingAvg: contractor.rating_avg ?? null,
    ratingCount: contractor.rating_count ?? null,
    photos: photos || [],
    tagline: contractor.tagline,
    logoUrl: contractor.logo_url,
    phone: contractor.phone,
    plan: contractor.plan,
    autoReload: contractor.auto_reload || {},
    serviceZips: contractor.service_zips || [],
    majorCategories: contractor.major_categories || [],
    subCategories: contractor.sub_categories || []
  };
}

function safeContractorHomeownerView(contractor, photos) {
  const all = Array.isArray(photos) ? photos : [];
  const featured = all.filter((p) => p.isFeatured).slice(0, MAX_FEATURED);
  return {
    id: contractor.id,
    companyName: contractor.company_name,
    tagline: contractor.tagline,
    yearsInBusiness: contractor.years_in_business ?? null,
    ratingAvg: contractor.rating_avg ?? null,
    ratingCount: contractor.rating_count ?? null,
    majorCategories: contractor.major_categories || [],
    subCategories: contractor.sub_categories || [],
    serviceZips: contractor.service_zips || [],
    featuredPhotos: featured,
    allPhotos: all.slice(0, MAX_PHOTOS_TOTAL)
  };
}

function leadRowToLead(row, homeowner) {
  return {
    id: row.id,
    homeownerId: row.homeowner_id,
    zip: row.zip,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
    vibe: row.vibe,
    changeLevel: row.change_level,
    majorCategories: row.major_categories || [],
    requiredTags: row.required_tags || [],
    beforeImagePath: row.before_image_path,
    afterImagePath: row.after_image_path,
    createdAt: row.created_at,
    status: row.status,
    assignedContractorId: row.assigned_contractor_id,
    acceptedAt: row.accepted_at || null,
    homeowner: homeowner || null
  };
}

function safeLeadMaskedView(lead) {
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
      phoneVerified: Boolean(lead.homeowner && lead.homeowner.phoneVerifiedAt),
      zip: lead.homeowner ? lead.homeowner.zip : lead.zip
    },
    interest: lead.interest || null
  };
}

function safeLeadFullView(lead) {
  return {
    ...safeLeadMaskedView(lead),
    homeowner: lead.homeowner
      ? {
          id: lead.homeowner.id,
          displayName: lead.homeowner.displayName,
          email: lead.homeowner.email,
          phone: lead.homeowner.phone,
          zip: lead.homeowner.zip,
          phoneVerifiedAt: lead.homeowner.phoneVerifiedAt
        }
      : null
  };
}

async function authFromRequest(req) {
  const supabase = getSupabase();
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  const { data: session, error } = await supabase.from('cp_sessions').select('*').eq('token', token).maybeSingle();
  if (error) throw error;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) return null;

  const user = await getContractorById(session.user_id);
  if (!user) return null;
  return { token, session, user };
}

async function requireAuth(req, res, next) {
  try {
    await cleanExpiredInterests();
    const auth = await authFromRequest(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    req.user = auth.user;
    req.token = auth.token;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// Multer memory uploads (we store images in Supabase Storage, not on disk)
const uploadPhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });
const uploadLeadImages = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// -------- Auth --------
app.post('/api/auth/login', async (req, res) => {
  try {
    const supabase = getSupabase();
    await cleanExpiredInterests();

    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await getContractorByEmail(email);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid credentials' });

    const ok = bcrypt.compareSync(password, String(user.password_hash || ''));
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = uuid('sess');
    const createdAt = nowIso();
    const expiresAt = addDays(new Date(), 7).toISOString();

    const { error: sessErr } = await supabase.from('cp_sessions').insert({
      token,
      user_id: user.id,
      created_at: createdAt,
      expires_at: expiresAt
    });
    if (sessErr) throw sessErr;

    const photos = await getContractorPhotos(user.id);
    res.json({ token, user: safeContractorView(user, photos) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const supabase = getSupabase();
    await cleanExpiredInterests();

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

    const existing = await getContractorByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const id = uuid('ctr');
    const createdAt = nowIso();
    const hashed = bcrypt.hashSync(password, 10);

    const userRow = {
      id,
      role: 'contractor',
      status: 'active',
      email,
      password_hash: hashed,
      company_name: companyName.slice(0, 80),
      owner_name: ownerName.slice(0, 80),
      years_in_business: Math.trunc(yearsInBusiness),
      phone: phone.slice(0, 40),
      plan: 'payg',
      auto_reload: { enabled: false, threshold: 2, reloadAmount: 10 },
      service_zips: [],
      major_categories: [],
      sub_categories: [],
      created_at: createdAt,
      updated_at: createdAt
    };

    const { error: insErr } = await supabase.from('cp_contractors').insert(userRow);
    if (insErr) throw insErr;

    const token = uuid('sess');
    const expiresAt = addDays(new Date(), 7).toISOString();
    const { error: sessErr } = await supabase.from('cp_sessions').insert({
      token,
      user_id: id,
      created_at: createdAt,
      expires_at: expiresAt
    });
    if (sessErr) throw sessErr;

    res.json({ token, user: safeContractorView(userRow, []) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    await supabase.from('cp_sessions').delete().eq('token', req.token);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const c = await creditsFor(req.user.id);
    const photos = await getContractorPhotos(req.user.id);
    res.json({ user: safeContractorView(req.user, photos), credits: c });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------- Leads --------
app.get('/api/leads', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { bucketLeadImages } = getPortalConfig();
    const contractor = req.user;

    const isAdmin = contractor.role === 'admin';
    const leadQuery = supabase
      .from('cp_leads')
      .select('*')
      .order('created_at', { ascending: false });

    const { data: leadRows, error: leadErr } = isAdmin
      ? await leadQuery
      : await leadQuery.or(`status.eq.open,and(status.eq.assigned,assigned_contractor_id.eq.${contractor.id})`);
    if (leadErr) throw leadErr;

    const leadsRaw = Array.isArray(leadRows) ? leadRows : [];
    const homeownerIds = Array.from(new Set(leadsRaw.map((l) => l.homeowner_id).filter(Boolean)));

    const homeownersById = new Map();
    if (homeownerIds.length) {
      const { data: homeowners, error: hErr } = await supabase.from('cp_homeowners').select('*').in('id', homeownerIds);
      if (hErr) throw hErr;
      for (const h of homeowners || []) {
        homeownersById.set(h.id, {
          id: h.id,
          displayName: h.display_name,
          email: h.email,
          phone: h.phone,
          zip: h.zip,
          phoneVerifiedAt: h.phone_verified_at
        });
      }
    }

    const leadObjs = [];
    for (const row of leadsRaw) {
      const homeowner = homeownersById.get(row.homeowner_id) || null;
      const lead = leadRowToLead(row, homeowner);
      lead.beforeImageUrl = await signStoragePath(bucketLeadImages, lead.beforeImagePath);
      lead.afterImageUrl = await signStoragePath(bucketLeadImages, lead.afterImagePath);
      leadObjs.push(lead);
    }

    const candidates = isAdmin ? leadObjs : leadObjs.filter((l) => matchesLead(safeContractorView(contractor, []), l));

    // interests for this contractor
    const ids = candidates.map((l) => l.id);
    const interestsByLead = new Map();
    if (!isAdmin && ids.length) {
      const { data: myInterests, error: iErr } = await supabase
        .from('cp_lead_interests')
        .select('*')
        .eq('contractor_id', contractor.id)
        .in('lead_id', ids);
      if (iErr) throw iErr;
      for (const li of myInterests || []) {
        interestsByLead.set(li.lead_id, {
          id: li.id,
          status: li.status,
          heldAt: li.held_at,
          expiresAt: li.expires_at,
          capturedAt: li.captured_at,
          releasedAt: li.released_at,
          expiredAt: li.expired_at,
          withdrawnAt: li.withdrawn_at,
          releaseReason: li.release_reason
        });
      }
    }

    for (const l of candidates) {
      l.interest = interestsByLead.get(l.id) || null;
    }

    const contractorView = safeContractorView(contractor, []);
    const sorted = candidates
      .slice()
      .sort((a, b) => scoreLead(contractorView, b) - scoreLead(contractorView, a));

    res.json({ leads: sorted.map((l) => safeLeadMaskedView(l)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/leads/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { bucketLeadImages } = getPortalConfig();
    const contractor = req.user;

    const { data: row, error } = await supabase.from('cp_leads').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Not found' });

    const { data: hrow, error: hErr } = await supabase.from('cp_homeowners').select('*').eq('id', row.homeowner_id).maybeSingle();
    if (hErr) throw hErr;
    const homeowner = hrow
      ? {
          id: hrow.id,
          displayName: hrow.display_name,
          email: hrow.email,
          phone: hrow.phone,
          zip: hrow.zip,
          phoneVerifiedAt: hrow.phone_verified_at
        }
      : null;

    const lead = leadRowToLead(row, homeowner);
    lead.beforeImageUrl = await signStoragePath(bucketLeadImages, lead.beforeImagePath);
    lead.afterImageUrl = await signStoragePath(bucketLeadImages, lead.afterImagePath);

    const isAdmin = contractor.role === 'admin';
    const isAssignedToMe = lead.assignedContractorId === contractor.id && lead.status === 'assigned';
    if (isAdmin || isAssignedToMe) return res.json({ lead: safeLeadFullView(lead) });
    return res.json({ lead: safeLeadMaskedView(lead) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/:id/interest', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractor = req.user;
    if (contractor.role === 'admin') return res.status(400).json({ error: 'Admin cannot reserve credits.' });

    const { data: lead, error } = await supabase.from('cp_leads').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (lead.status !== 'open') return res.status(409).json({ error: 'Lead is not open' });

    const c = await creditsFor(contractor.id);
    if (c.available < 1) return res.status(409).json({ error: 'No available credits' });

    const { data: existing, error: exErr } = await supabase
      .from('cp_lead_interests')
      .select('*')
      .eq('lead_id', lead.id)
      .eq('contractor_id', contractor.id)
      .maybeSingle();
    if (exErr) throw exErr;

    const now = nowIso();
    const expiresAt = addDays(new Date(), INTEREST_TTL_DAYS).toISOString();

    if (!existing) {
      const { error: insErr } = await supabase.from('cp_lead_interests').insert({
        id: uuid('li'),
        lead_id: lead.id,
        contractor_id: contractor.id,
        status: 'held',
        held_at: now,
        expires_at: expiresAt,
        created_at: now
      });
      if (insErr) throw insErr;
    } else {
      if (existing.status === 'held') return res.status(409).json({ error: 'Already interested' });
      if (existing.status === 'captured') return res.status(409).json({ error: 'Already accepted' });
      const { error: upErr } = await supabase
        .from('cp_lead_interests')
        .update({
          status: 'held',
          held_at: now,
          expires_at: expiresAt,
          captured_at: null,
          released_at: null,
          expired_at: null,
          withdrawn_at: null,
          release_reason: null
        })
        .eq('id', existing.id);
      if (upErr) throw upErr;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/:id/withdraw-interest', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractor = req.user;
    if (contractor.role === 'admin') return res.status(400).json({ error: 'Admin cannot withdraw.' });

    const { data: li, error } = await supabase
      .from('cp_lead_interests')
      .select('*')
      .eq('lead_id', req.params.id)
      .eq('contractor_id', contractor.id)
      .maybeSingle();
    if (error) throw error;
    if (!li) return res.status(404).json({ error: 'Not found' });
    if (li.status !== 'held') return res.status(409).json({ error: 'Interest is not held' });

    const now = nowIso();
    const { error: upErr } = await supabase
      .from('cp_lead_interests')
      .update({ status: 'withdrawn', withdrawn_at: now, release_reason: 'contractor_withdrew' })
      .eq('id', li.id);
    if (upErr) throw upErr;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/:id/questions', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractor = req.user;
    if (contractor.role === 'admin') return res.status(400).json({ error: 'Admin cannot ask questions.' });

    const templateId = String(req.body.templateId || '').trim();
    const extra = String(req.body.extra || '').trim();
    if (!templateId) return res.status(400).json({ error: 'templateId is required' });

    const validation = validatePreAcceptanceMessage(extra);
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const now = nowIso();
    const { error } = await supabase.from('cp_lead_questions').insert({
      id: uuid('q'),
      lead_id: req.params.id,
      contractor_id: contractor.id,
      template_id: templateId,
      extra: extra || null,
      created_at: now
    });
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------- Billing (demo) --------
app.get('/api/billing', requireAuth, async (req, res) => {
  try {
    const c = await creditsFor(req.user.id);
    const autoReload = req.user.auto_reload || { enabled: false, threshold: 0, reloadAmount: 0 };
    res.json({ credits: c, autoReload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/billing/buy-credits', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const amount = Number(req.body.amount || 0);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100) return res.status(400).json({ error: 'Invalid amount' });

    const now = nowIso();
    const { error } = await supabase.from('cp_credit_ledger').insert({
      id: uuid('led'),
      contractor_id: req.user.id,
      type: 'purchase',
      delta: Math.trunc(amount),
      lead_id: null,
      note: 'Purchased credits (demo)',
      created_at: now
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------- Profile --------
app.get('/api/profile', requireAuth, async (req, res) => {
  try {
    const photos = await getContractorPhotos(req.user.id);
    res.json({ profile: safeContractorView(req.user, photos) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/profile', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractor = req.user;

    const tagline = req.body.tagline != null ? String(req.body.tagline).trim().slice(0, 140) : null;
    const serviceZips = String(req.body.serviceZips || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);

    const majorCategories = Array.isArray(req.body.majorCategories) ? req.body.majorCategories : [];
    const subCategories = Array.isArray(req.body.subCategories) ? req.body.subCategories : [];

    const payload = {
      company_name: String(req.body.companyName || contractor.company_name || '').trim().slice(0, 80) || null,
      owner_name: String(req.body.ownerName || contractor.owner_name || '').trim().slice(0, 80) || null,
      phone: String(req.body.phone || contractor.phone || '').trim().slice(0, 40) || null,
      years_in_business:
        req.body.yearsInBusiness !== undefined && String(req.body.yearsInBusiness).trim() !== ''
          ? Math.trunc(Number(req.body.yearsInBusiness))
          : contractor.years_in_business ?? null,
      tagline,
      service_zips: serviceZips,
      major_categories: majorCategories.map(String).slice(0, 10),
      sub_categories: subCategories.map(String).slice(0, 50),
      updated_at: nowIso()
    };

    const { error } = await supabase.from('cp_contractors').update(payload).eq('id', contractor.id);
    if (error) throw error;

    const updated = await getContractorById(contractor.id);
    const photos = await getContractorPhotos(contractor.id);
    res.json({ ok: true, profile: safeContractorView(updated, photos) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/profile/photos', requireAuth, uploadPhoto.single('photo'), async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractorId = req.user.id;
    const { bucketContractorPhotos } = getPortalConfig();

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'photo is required' });

    const { data: existingPhotos, error: pErr } = await supabase
      .from('cp_contractor_photos')
      .select('*')
      .eq('contractor_id', contractorId)
      .order('sort_order', { ascending: true });
    if (pErr) throw pErr;

    const photos = existingPhotos || [];
    if (photos.length >= MAX_PHOTOS_TOTAL) return res.status(409).json({ error: `Max ${MAX_PHOTOS_TOTAL} photos.` });

    const wantsFeatured = String(req.body.isFeatured || '').toLowerCase() === 'true';
    if (wantsFeatured) {
      const featuredCount = photos.filter((p) => p.is_featured).length;
      if (featuredCount >= MAX_FEATURED) return res.status(409).json({ error: `Max ${MAX_FEATURED} featured photos.` });
    }

    const photoId = uuid('ph');
    const ext = safeImageExt(file.originalname);
    const storagePath = `${contractorId}/${photoId}${ext}`;

    const { error: upErr } = await supabase.storage.from(bucketContractorPhotos).upload(storagePath, file.buffer, {
      contentType: file.mimetype || 'image/jpeg',
      upsert: true
    });
    if (upErr) throw upErr;

    const maxSort = photos.reduce((m, p) => Math.max(m, Number(p.sort_order) || 0), 0);
    const now = nowIso();
    const { error: insErr } = await supabase.from('cp_contractor_photos').insert({
      id: photoId,
      contractor_id: contractorId,
      storage_path: storagePath,
      is_featured: wantsFeatured,
      sort_order: maxSort + 1,
      created_at: now
    });
    if (insErr) throw insErr;

    res.json({ ok: true, photos: await getContractorPhotos(contractorId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/profile/photos/:id', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractorId = req.user.id;
    const { bucketContractorPhotos } = getPortalConfig();

    const { data: row, error } = await supabase
      .from('cp_contractor_photos')
      .select('*')
      .eq('id', req.params.id)
      .eq('contractor_id', contractorId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Not found' });

    await supabase.storage.from(bucketContractorPhotos).remove([row.storage_path]);
    await supabase.from('cp_contractor_photos').delete().eq('id', row.id).eq('contractor_id', contractorId);

    res.json({ ok: true, photos: await getContractorPhotos(contractorId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/profile/photos/:id/feature', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractorId = req.user.id;
    const isFeatured = Boolean(req.body.isFeatured);

    const { data: photos, error: pErr } = await supabase.from('cp_contractor_photos').select('*').eq('contractor_id', contractorId);
    if (pErr) throw pErr;

    if (isFeatured) {
      const featuredCount = (photos || []).filter((p) => p.is_featured).length;
      if (featuredCount >= MAX_FEATURED) return res.status(409).json({ error: `Max ${MAX_FEATURED} featured photos.` });
    }

    const { error } = await supabase
      .from('cp_contractor_photos')
      .update({ is_featured: isFeatured })
      .eq('id', req.params.id)
      .eq('contractor_id', contractorId);
    if (error) throw error;

    res.json({ ok: true, photos: await getContractorPhotos(contractorId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/profile/photos/:id/move', requireAuth, async (req, res) => {
  try {
    const supabase = getSupabase();
    const contractorId = req.user.id;
    const direction = String(req.body.direction || '').trim();
    if (!['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Invalid direction' });

    const { data: photos, error: pErr } = await supabase
      .from('cp_contractor_photos')
      .select('*')
      .eq('contractor_id', contractorId)
      .order('sort_order', { ascending: true });
    if (pErr) throw pErr;

    const idx = (photos || []).findIndex((p) => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= photos.length) return res.json({ ok: true, photos: await getContractorPhotos(contractorId) });

    const a = photos[idx];
    const b = photos[swapWith];

    await supabase.from('cp_contractor_photos').update({ sort_order: b.sort_order }).eq('id', a.id).eq('contractor_id', contractorId);
    await supabase.from('cp_contractor_photos').update({ sort_order: a.sort_order }).eq('id', b.id).eq('contractor_id', contractorId);

    res.json({ ok: true, photos: await getContractorPhotos(contractorId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------- Public (app-facing) --------
app.get('/api/public/contractors/:id', async (req, res) => {
  try {
    const contractor = await getContractorById(req.params.id);
    if (!contractor || contractor.status !== 'active') return res.status(404).json({ error: 'Not found' });
    const photos = await getContractorPhotos(contractor.id);
    return res.json({ contractor: safeContractorHomeownerView(contractor, photos) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------- Admin --------
app.get('/api/admin/contractors', requireAuth, requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('cp_contractors').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const list = [];
    for (const c of data || []) {
      const photos = await getContractorPhotos(c.id);
      list.push(safeContractorView(c, photos));
    }
    res.json({ contractors: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/contractors/:id/add-credits', requireAuth, requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const amount = Number(req.body.amount || 0);
    const note = String(req.body.note || '').trim().slice(0, 140) || 'Admin adjustment (demo)';
    if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: 'Amount is required' });

    const now = nowIso();
    await supabase.from('cp_credit_ledger').insert({
      id: uuid('led'),
      contractor_id: req.params.id,
      type: 'admin_adjustment',
      delta: Math.trunc(amount),
      lead_id: null,
      note,
      created_at: now
    });

    await supabase.from('cp_audit_log').insert({
      id: uuid('audit'),
      type: 'admin_add_credits',
      actor_id: req.user.id,
      target_contractor_id: req.params.id,
      lead_id: null,
      note: `amount=${Math.trunc(amount)}; ${note}`,
      created_at: now
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/leads', requireAuth, requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const { bucketLeadImages } = getPortalConfig();

    const { data: leads, error } = await supabase.from('cp_leads').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const rows = leads || [];
    const homeownerIds = Array.from(new Set(rows.map((l) => l.homeowner_id).filter(Boolean)));
    const homeownersById = new Map();
    if (homeownerIds.length) {
      const { data: homeowners, error: hErr } = await supabase.from('cp_homeowners').select('*').in('id', homeownerIds);
      if (hErr) throw hErr;
      for (const h of homeowners || []) {
        homeownersById.set(h.id, {
          id: h.id,
          displayName: h.display_name,
          email: h.email,
          phone: h.phone,
          zip: h.zip,
          phoneVerifiedAt: h.phone_verified_at
        });
      }
    }

    const out = [];
    for (const r of rows) {
      const homeowner = homeownersById.get(r.homeowner_id) || null;
      const lead = leadRowToLead(r, homeowner);
      lead.beforeImageUrl = await signStoragePath(bucketLeadImages, lead.beforeImagePath);
      lead.afterImageUrl = await signStoragePath(bucketLeadImages, lead.afterImagePath);
      out.push({
        ...safeLeadMaskedView(lead),
        homeowner: lead.homeowner,
        assignedContractorId: lead.assignedContractorId || null,
        acceptedAt: lead.acceptedAt || null
      });
    }
    res.json({ leads: out });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/leads/:id/accept', requireAuth, requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const leadId = req.params.id;
    const contractorId = String(req.body.contractorId || '').trim();
    if (!contractorId) return res.status(400).json({ error: 'contractorId required' });

    const { data: lead, error: lErr } = await supabase.from('cp_leads').select('*').eq('id', leadId).maybeSingle();
    if (lErr) throw lErr;
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (lead.status !== 'open') return res.status(409).json({ error: 'Lead is not open' });

    const { data: chosen, error: cErr } = await supabase
      .from('cp_lead_interests')
      .select('*')
      .eq('lead_id', leadId)
      .eq('contractor_id', contractorId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!chosen || chosen.status !== 'held') return res.status(409).json({ error: 'Chosen contractor has no held interest' });

    const now = nowIso();

    // Capture chosen interest
    await supabase
      .from('cp_lead_interests')
      .update({ status: 'captured', captured_at: now, release_reason: null })
      .eq('id', chosen.id);

    // Release all other held interests
    await supabase
      .from('cp_lead_interests')
      .update({ status: 'released', released_at: now, release_reason: 'homeowner_selected_other' })
      .eq('lead_id', leadId)
      .eq('status', 'held')
      .neq('contractor_id', contractorId);

    // Update lead assignment
    await supabase
      .from('cp_leads')
      .update({ status: 'assigned', assigned_contractor_id: contractorId, accepted_at: now })
      .eq('id', leadId);

    // Capture credit (ledger)
    await supabase.from('cp_credit_ledger').insert({
      id: uuid('led'),
      contractor_id: contractorId,
      type: 'capture',
      delta: -1,
      lead_id: leadId,
      note: 'Credit captured on homeowner acceptance',
      created_at: now
    });

    await supabase.from('cp_audit_log').insert({
      id: uuid('audit'),
      type: 'admin_accept_lead',
      actor_id: req.user.id,
      lead_id: leadId,
      target_contractor_id: contractorId,
      note: 'Simulated homeowner acceptance',
      created_at: now
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post(
  '/api/admin/leads',
  requireAuth,
  requireAdmin,
  (req, _res, next) => {
    req.leadId = uuid('lead');
    next();
  },
  uploadLeadImages.fields([
    { name: 'before', maxCount: 1 },
    { name: 'after', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const supabase = getSupabase();
      const { bucketLeadImages } = getPortalConfig();

      const leadId = req.leadId;
      const files = req.files || {};
      const before = Array.isArray(files.before) ? files.before[0] : null;
      const after = Array.isArray(files.after) ? files.after[0] : null;
      if (!before || !after) return res.status(400).json({ error: 'Both before and after images are required.' });

      const zip = String(req.body.zip || '').trim();
      if (!zip) return res.status(400).json({ error: 'ZIP is required.' });

      const homeownerName = String(req.body.homeownerName || '').trim() || 'Homeowner';
      const homeownerEmail = String(req.body.homeownerEmail || '').trim().toLowerCase();
      const homeownerPhone = String(req.body.homeownerPhone || '').trim();
      if (!homeownerEmail || !homeownerPhone) {
        return res.status(400).json({ error: 'Homeowner email and phone are required.' });
      }

      // create or reuse homeowner
      const { data: existingHomeowner, error: hErr } = await supabase
        .from('cp_homeowners')
        .select('*')
        .ilike('email', homeownerEmail)
        .maybeSingle();
      if (hErr) throw hErr;

      let homeownerId = existingHomeowner ? existingHomeowner.id : uuid('hm');
      if (!existingHomeowner) {
        const now = nowIso();
        const { error: insErr } = await supabase.from('cp_homeowners').insert({
          id: homeownerId,
          display_name: homeownerName.slice(0, 80),
          email: homeownerEmail,
          phone: homeownerPhone.slice(0, 40),
          zip,
          phone_verified_at: now,
          created_at: now
        });
        if (insErr) throw insErr;
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

      const beforeExt = safeImageExt(before.originalname);
      const afterExt = safeImageExt(after.originalname);
      const beforePath = `${leadId}/before${beforeExt}`;
      const afterPath = `${leadId}/after${afterExt}`;

      const beforeUpload = await supabase.storage.from(bucketLeadImages).upload(beforePath, before.buffer, {
        contentType: before.mimetype || 'image/jpeg',
        upsert: true
      });
      if (beforeUpload.error) throw beforeUpload.error;

      const afterUpload = await supabase.storage.from(bucketLeadImages).upload(afterPath, after.buffer, {
        contentType: after.mimetype || 'image/jpeg',
        upsert: true
      });
      if (afterUpload.error) throw afterUpload.error;

      const now = nowIso();
      const leadRow = {
        id: leadId,
        homeowner_id: homeownerId,
        zip,
        budget_min: Number.isFinite(budgetMin) ? budgetMin : null,
        budget_max: Number.isFinite(budgetMax) ? budgetMax : null,
        vibe,
        change_level: changeLevel,
        major_categories: majorCategories,
        required_tags: requiredTags,
        before_image_path: beforePath,
        after_image_path: afterPath,
        status: 'open',
        assigned_contractor_id: null,
        created_at: now,
        accepted_at: null
      };

      const { error: leadErr } = await supabase.from('cp_leads').insert(leadRow);
      if (leadErr) throw leadErr;

      const lead = leadRowToLead(leadRow, null);
      lead.beforeImageUrl = await signStoragePath(bucketLeadImages, beforePath);
      lead.afterImageUrl = await signStoragePath(bucketLeadImages, afterPath);

      res.json({ ok: true, lead: safeLeadMaskedView(lead) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

app.post('/api/admin/leads/:id/spam', requireAuth, requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const leadId = req.params.id;

    const { data: lead, error } = await supabase.from('cp_leads').select('*').eq('id', leadId).maybeSingle();
    if (error) throw error;
    if (!lead) return res.status(404).json({ error: 'Not found' });
    if (lead.status !== 'open') return res.status(409).json({ error: 'Only open leads can be marked as spam in v1' });

    const now = nowIso();
    await supabase
      .from('cp_lead_interests')
      .update({ status: 'released', released_at: now, release_reason: 'lead_marked_spam' })
      .eq('lead_id', leadId)
      .eq('status', 'held');

    await supabase.from('cp_leads').update({ status: 'spam' }).eq('id', leadId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/leads/:id/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabase();
    const leadId = req.params.id;

    const { data: lead, error } = await supabase.from('cp_leads').select('*').eq('id', leadId).maybeSingle();
    if (error) throw error;
    if (!lead) return res.status(404).json({ error: 'Not found' });

    await supabase.from('cp_lead_interests').delete().eq('lead_id', leadId);
    await supabase.from('cp_leads').update({ status: 'open', assigned_contractor_id: null, accepted_at: null }).eq('id', leadId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------- health --------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, store: 'supabase' });
});

app.listen(PORT, () => {
  console.log(`Contractor Portal (Supabase) running at http://localhost:${PORT}`);
});

