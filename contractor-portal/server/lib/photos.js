const fs = require('fs');
const path = require('path');

const MAX_PHOTOS_TOTAL = 10;
const MAX_FEATURED = 3;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function contractorUploadDir(baseDir, contractorId) {
  return path.join(baseDir, contractorId);
}

function normalizePhotos(contractor) {
  if (!Array.isArray(contractor.photos)) contractor.photos = [];
  for (const p of contractor.photos) {
    if (p && typeof p === 'object') {
      p.isFeatured = Boolean(p.isFeatured);
      p.sortOrder = Number.isFinite(p.sortOrder) ? p.sortOrder : 0;
    }
  }
  contractor.photos.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}

function featuredCount(contractor) {
  normalizePhotos(contractor);
  return contractor.photos.filter((p) => p.isFeatured).length;
}

function canAddPhoto(contractor) {
  normalizePhotos(contractor);
  return contractor.photos.length < MAX_PHOTOS_TOTAL;
}

function addPhoto(contractor, photo) {
  normalizePhotos(contractor);
  if (!canAddPhoto(contractor)) {
    return { ok: false, reason: `Max ${MAX_PHOTOS_TOTAL} photos allowed.` };
  }

  const maxOrder = contractor.photos.reduce((m, p) => Math.max(m, Number(p.sortOrder) || 0), 0);
  const nextOrder = contractor.photos.length ? maxOrder + 1 : 1;

  contractor.photos.push({
    id: photo.id,
    url: photo.url,
    thumbUrl: photo.thumbUrl || photo.url,
    isFeatured: Boolean(photo.isFeatured),
    sortOrder: Number.isFinite(photo.sortOrder) ? photo.sortOrder : nextOrder,
    createdAt: photo.createdAt
  });

  // enforce featured cap by un-featuring newest if necessary
  while (featuredCount(contractor) > MAX_FEATURED) {
    const featured = contractor.photos.filter((p) => p.isFeatured).sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));
    if (!featured.length) break;
    featured[0].isFeatured = false;
  }

  normalizePhotos(contractor);
  return { ok: true };
}

function deletePhoto(contractor, photoId) {
  normalizePhotos(contractor);
  const idx = contractor.photos.findIndex((p) => p.id === photoId);
  if (idx === -1) return { ok: false, reason: 'Photo not found.' };
  const removed = contractor.photos.splice(idx, 1)[0];
  normalizePhotos(contractor);
  return { ok: true, removed };
}

function setFeatured(contractor, photoId, isFeatured) {
  normalizePhotos(contractor);
  const photo = contractor.photos.find((p) => p.id === photoId);
  if (!photo) return { ok: false, reason: 'Photo not found.' };

  if (isFeatured && !photo.isFeatured && featuredCount(contractor) >= MAX_FEATURED) {
    return { ok: false, reason: `You can only feature ${MAX_FEATURED} photos.` };
  }

  photo.isFeatured = Boolean(isFeatured);
  normalizePhotos(contractor);
  return { ok: true, photo };
}

function movePhoto(contractor, photoId, direction) {
  normalizePhotos(contractor);
  const list = contractor.photos;
  const idx = list.findIndex((p) => p.id === photoId);
  if (idx === -1) return { ok: false, reason: 'Photo not found.' };

  const swapWith = direction === 'up' ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) return { ok: true };

  const a = list[idx];
  const b = list[swapWith];
  const tmp = a.sortOrder;
  a.sortOrder = b.sortOrder;
  b.sortOrder = tmp;

  normalizePhotos(contractor);
  return { ok: true };
}

module.exports = {
  MAX_PHOTOS_TOTAL,
  MAX_FEATURED,
  ensureDir,
  contractorUploadDir,
  normalizePhotos,
  addPhoto,
  deletePhoto,
  setFeatured,
  movePhoto
};


