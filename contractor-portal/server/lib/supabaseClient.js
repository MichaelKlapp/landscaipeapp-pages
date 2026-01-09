const { createClient } = require('@supabase/supabase-js');

function firstEnv(names) {
  for (const n of names) {
    const v = String(process.env[n] || '').trim();
    if (v) return v;
  }
  return '';
}

function looksLikeHttpUrl(v) {
  return /^https?:\/\//i.test(String(v || '').trim());
}

let _client = null;

function getSupabase() {
  if (_client) return _client;
  // Prefer SUPABASE_URL if present, but ignore it if it doesn't look like a URL (can be polluted in shells)
  const primary = firstEnv(['SUPABASE_URL']);
  const url = looksLikeHttpUrl(primary) ? primary : firstEnv(['SUPABASE_PROJECT_URL', 'SUPABASE_URL']);
  const key = firstEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']);
  if (!url) throw new Error('Missing required env var: SUPABASE_URL (or SUPABASE_PROJECT_URL)');
  if (!key) throw new Error('Missing required env var: SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)');

  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  return _client;
}

function getPortalConfig() {
  return {
    bucketLeadImages: String(process.env.CP_BUCKET_LEAD_IMAGES || 'cp-lead-images').trim(),
    bucketContractorPhotos: String(process.env.CP_BUCKET_CONTRACTOR_PHOTOS || 'cp-contractor-photos').trim(),
    signedUrlTtlSeconds: Number(process.env.CP_SIGNED_URL_TTL || 60 * 60 * 24 * 7) // 7 days
  };
}

module.exports = {
  getSupabase,
  getPortalConfig
};

