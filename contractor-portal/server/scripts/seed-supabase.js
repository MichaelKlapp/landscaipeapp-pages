require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const { getSupabase, getPortalConfig } = require('../lib/supabaseClient');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function safeExtFromPath(p) {
  const ext = String(path.extname(p || '') || '').toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return ext;
  return '.jpg';
}

function resolveLocalFileFromUrl(url) {
  const u = String(url || '');
  const repoRoot = path.join(__dirname, '..', '..', '..');

  if (u.startsWith('/assets/')) {
    const rel = u.replace('/assets/', '');
    return path.join(repoRoot, 'assets', rel);
  }

  // /contractor-portal/uploads/leads/<leadId>/<file>
  if (u.startsWith('/contractor-portal/uploads/')) {
    const rel = u.replace('/contractor-portal/uploads/', '');
    return path.join(__dirname, '..', 'uploads', rel);
  }

  // /uploads/... (if ever stored)
  if (u.startsWith('/uploads/')) {
    const rel = u.replace('/uploads/', '');
    return path.join(__dirname, '..', 'uploads', rel);
  }

  return null;
}

async function uploadFileToBucket(bucket, storagePath, absPath) {
  const supabase = getSupabase();
  const ext = safeExtFromPath(absPath);
  const contentType = mimeFromExt(ext);
  const buf = fs.readFileSync(absPath);

  const { error } = await supabase.storage.from(bucket).upload(storagePath, buf, { contentType, upsert: true });
  if (error) throw error;
}

async function upsert(table, rows) {
  const supabase = getSupabase();
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}

async function main() {
  const supabase = getSupabase();
  const cfg = getPortalConfig();

  const dbPath = path.join(__dirname, '..', 'data', 'db.json');
  if (!exists(dbPath)) throw new Error(`Missing db.json at ${dbPath}`);

  const db = readJson(dbPath);
  const contractors = Array.isArray(db.contractors) ? db.contractors : [];
  const homeowners = Array.isArray(db.homeowners) ? db.homeowners : [];
  const leads = Array.isArray(db.leads) ? db.leads : [];
  const leadInterests = Array.isArray(db.leadInterests) ? db.leadInterests : [];
  const creditLedger = Array.isArray(db.creditLedger) ? db.creditLedger : [];
  const auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];

  console.log(`Seeding contractors=${contractors.length}, homeowners=${homeowners.length}, leads=${leads.length} ...`);

  // Contractors (hash passwords)
  const contractorRows = contractors.map((c) => ({
    id: c.id,
    role: c.role || 'contractor',
    status: c.status || 'active',
    email: c.email,
    password_hash: bcrypt.hashSync(String(c.password || 'password'), 10),
    company_name: c.companyName || null,
    owner_name: c.ownerName || null,
    phone: c.phone || null,
    years_in_business: c.yearsInBusiness ?? null,
    rating_avg: c.ratingAvg ?? null,
    rating_count: c.ratingCount ?? null,
    tagline: c.tagline ?? null,
    logo_url: c.logoUrl ?? null,
    plan: c.plan ?? 'payg',
    auto_reload: c.autoReload ?? {},
    service_zips: c.serviceZips ?? [],
    major_categories: c.majorCategories ?? [],
    sub_categories: c.subCategories ?? [],
    created_at: c.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  await upsert('cp_contractors', contractorRows);
  console.log('✓ cp_contractors');

  // Homeowners
  const homeownerRows = homeowners.map((h) => ({
    id: h.id,
    display_name: h.displayName || null,
    email: h.email || null,
    phone: h.phone || null,
    zip: h.zip || null,
    phone_verified_at: h.phoneVerifiedAt || null,
    created_at: new Date().toISOString()
  }));
  await upsert('cp_homeowners', homeownerRows);
  console.log('✓ cp_homeowners');

  // Contractor photos (upload to Storage + insert rows)
  const photoRows = [];
  for (const c of contractors) {
    const photos = Array.isArray(c.photos) ? c.photos : [];
    for (const p of photos) {
      const abs = resolveLocalFileFromUrl(p.url || p.thumbUrl || '');
      if (!abs || !exists(abs)) {
        console.warn(`- skip contractor photo (missing file): ${c.id} ${p.id}`);
        continue;
      }
      const ext = safeExtFromPath(abs);
      const storagePath = `${c.id}/${p.id}${ext}`;
      await uploadFileToBucket(cfg.bucketContractorPhotos, storagePath, abs);
      photoRows.push({
        id: p.id,
        contractor_id: c.id,
        storage_path: storagePath,
        is_featured: Boolean(p.isFeatured),
        sort_order: Number(p.sortOrder) || 0,
        created_at: p.createdAt || new Date().toISOString()
      });
    }
  }
  if (photoRows.length) {
    await upsert('cp_contractor_photos', photoRows);
    console.log(`✓ cp_contractor_photos (${photoRows.length})`);
  }

  // Leads (upload to Storage + insert rows)
  const leadRows = [];
  for (const l of leads) {
    const beforeAbs = resolveLocalFileFromUrl(l.beforeImageUrl || '');
    const afterAbs = resolveLocalFileFromUrl(l.afterImageUrl || '');
    if (!beforeAbs || !afterAbs || !exists(beforeAbs) || !exists(afterAbs)) {
      console.warn(`- skip lead (missing before/after files): ${l.id}`);
      continue;
    }
    const beforeExt = safeExtFromPath(beforeAbs);
    const afterExt = safeExtFromPath(afterAbs);
    const beforePath = `${l.id}/before${beforeExt}`;
    const afterPath = `${l.id}/after${afterExt}`;

    await uploadFileToBucket(cfg.bucketLeadImages, beforePath, beforeAbs);
    await uploadFileToBucket(cfg.bucketLeadImages, afterPath, afterAbs);

    leadRows.push({
      id: l.id,
      homeowner_id: l.homeownerId,
      zip: l.zip,
      budget_min: l.budgetMin ?? null,
      budget_max: l.budgetMax ?? null,
      vibe: l.vibe ?? null,
      change_level: l.changeLevel ?? null,
      major_categories: l.majorCategories ?? [],
      required_tags: l.requiredTags ?? [],
      before_image_path: beforePath,
      after_image_path: afterPath,
      status: l.status || 'open',
      assigned_contractor_id: l.assignedContractorId ?? null,
      created_at: l.createdAt || new Date().toISOString(),
      accepted_at: l.acceptedAt || null
    });
  }
  if (leadRows.length) {
    await upsert('cp_leads', leadRows);
    console.log(`✓ cp_leads (${leadRows.length})`);
  }

  // Lead interests
  const liRows = leadInterests.map((li) => ({
    id: li.id,
    lead_id: li.leadId,
    contractor_id: li.contractorId,
    status: li.status,
    held_at: li.heldAt || null,
    expires_at: li.expiresAt || null,
    captured_at: li.capturedAt || null,
    released_at: li.releasedAt || null,
    expired_at: li.expiredAt || null,
    withdrawn_at: li.withdrawnAt || null,
    release_reason: li.releaseReason || null,
    created_at: li.createdAt || li.heldAt || new Date().toISOString()
  }));
  if (liRows.length) {
    await upsert('cp_lead_interests', liRows);
    console.log(`✓ cp_lead_interests (${liRows.length})`);
  }

  // Credit ledger
  const ledgerRows = creditLedger.map((e) => ({
    id: e.id,
    contractor_id: e.contractorId,
    type: e.type,
    delta: e.delta,
    lead_id: e.leadId || null,
    note: e.note || null,
    created_at: e.createdAt || new Date().toISOString()
  }));
  if (ledgerRows.length) {
    await upsert('cp_credit_ledger', ledgerRows);
    console.log(`✓ cp_credit_ledger (${ledgerRows.length})`);
  }

  // Audit log
  const auditRows = auditLog.map((a) => ({
    id: a.id,
    type: a.type,
    actor_id: a.actorId || null,
    lead_id: a.leadId || null,
    target_contractor_id: a.targetContractorId || null,
    note: a.note || null,
    created_at: a.createdAt || new Date().toISOString()
  }));
  if (auditRows.length) {
    await upsert('cp_audit_log', auditRows);
    console.log(`✓ cp_audit_log (${auditRows.length})`);
  }

  // Quick sanity ping (helps catch missing schema)
  const { data: ping, error: pingErr } = await supabase.from('cp_contractors').select('id').limit(1);
  if (pingErr) throw pingErr;
  console.log('Seed complete. Sample contractor:', ping && ping[0] ? ping[0].id : '(none)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

