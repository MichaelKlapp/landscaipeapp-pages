function normalizeTag(tag) {
  return String(tag || '').trim().toLowerCase();
}

function overlaps(a = [], b = []) {
  const set = new Set(a.map(normalizeTag));
  return b.some((x) => set.has(normalizeTag(x)));
}

function matchesLead(contractor, lead) {
  if (!contractor || !lead) return false;
  // Contractors should see:
  // - open leads they match
  // - assigned leads that were accepted for them
  if (lead.status === 'assigned') return lead.assignedContractorId === contractor.id;
  if (lead.status !== 'open') return false;

  // v1 geo: must explicitly serve lead zip
  const servesZip = (contractor.serviceZips || []).includes(lead.zip);
  if (!servesZip) return false;

  // major category gate (if lead specifies)
  if (Array.isArray(lead.majorCategories) && lead.majorCategories.length > 0) {
    if (!overlaps(contractor.majorCategories || [], lead.majorCategories)) return false;
  }

  // subcategory overlap boosts relevance; not required for v1 match,
  // but if lead specifies requiredTags, require at least one overlap.
  if (Array.isArray(lead.requiredTags) && lead.requiredTags.length > 0) {
    if (!overlaps(contractor.subCategories || [], lead.requiredTags)) return false;
  }

  return true;
}

function scoreLead(contractor, lead) {
  let score = 0;

  if ((contractor.serviceZips || []).includes(lead.zip)) score += 50;

  const majorOverlap = overlaps(contractor.majorCategories || [], lead.majorCategories || []);
  if (majorOverlap) score += 25;

  const tags = lead.requiredTags || [];
  const subs = contractor.subCategories || [];
  const subSet = new Set(subs.map(normalizeTag));
  score += tags.filter((t) => subSet.has(normalizeTag(t))).length * 8;

  return score;
}

module.exports = {
  matchesLead,
  scoreLead
};


