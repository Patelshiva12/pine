'use strict';
// Stores dish photos as WebP under UPLOAD_DIR and returns their public URL path.
// Swap this module for S3/Cloud Storage if the server's disk is not persistent.
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const config = require('../config');
const ids = require('../ids');
const { bad } = require('../errors');

const SIZES = { img: 640, hero: 1400 };

async function saveBuffer(buf, { menuId = 'dish', kind = 'img' } = {}) {
  let out;
  try {
    out = await sharp(buf, { failOn: 'error' }).rotate()
      .resize({ width: SIZES[kind] || 640, height: SIZES[kind] || 640, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer();
  } catch (_) {
    throw bad('That file is not a readable image (use JPG, PNG or WebP)');
  }
  await fs.mkdir(config.uploadDir, { recursive: true });
  const name = `${menuId.slice(0, 40)}-${kind}-${ids.rand(6)}.webp`;
  await fs.writeFile(path.join(config.uploadDir, name), out);
  return `${config.publicUrl}${config.uploadUrl}/${name}`;
}

/** Accepts "data:image/...;base64,..." (what the admin page sends) */
async function saveDataUrl(dataUrl, opts) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl || '');
  if (!m) throw bad('Photo must be a base64 image data URL');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > config.maxPhotoBytes) throw bad('Photo is too large');
  return saveBuffer(buf, opts);
}

/** Deletes a previously uploaded file (ignores bundled photos and external URLs). */
async function remove(url) {
  if (!url || !url.startsWith(config.publicUrl + config.uploadUrl + '/')) return;
  const name = path.basename(url);
  await fs.unlink(path.join(config.uploadDir, name)).catch(() => {});
}

module.exports = { saveBuffer, saveDataUrl, remove };
