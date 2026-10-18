// ── Tutorials (video guides managed from Admin → Tutorials) ─────────────────────
//   GET    /api/tutorials             public  - published tutorials (newest/ordered first)
//   GET    /api/tutorials/:id         public  - one published tutorial
//   GET    /api/admin/tutorials       admin   - every tutorial (incl. hidden) + storage info
//   POST   /api/admin/tutorials       admin   - add one (multipart: video file OR videoUrl link)
//   PUT    /api/admin/tutorials/:id   admin   - edit text / replace video / show-hide
//   DELETE /api/admin/tutorials/:id   admin   - remove (also removes the stored video)
//   GET    /tutorials, /tutorials/:id (pages) - serve public/tutorials.html
//
// The admin can add an UNLIMITED number of tutorials. Each has a title, a sub-heading and a
// longer discussion/description, plus a video that is either uploaded (stored on Cloudinary when
// it is configured, otherwise on local disk) or pasted as a link (YouTube, Vimeo or a direct
// .mp4 link - handy for videos bigger than the upload limit).

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const MAX_UPLOAD_MB = 100;          // Cloudinary's free plan also caps a single video at ~100 MB
const LIMITS = { title: 150, subheading: 200, description: 5000, videoUrl: 500 };
const VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-m4v|3gpp)$/i;
const SAFE_VIDEO_EXT = /^\.(mp4|mov|webm|m4v|3gp)$/;

// Plain text only: strip tags/control characters but keep line breaks.
function cleanText(v, max) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

// Accept only https links (or an uploaded /uploads/... path produced by us). Returns '' / cleaned / null(invalid).
function normaliseVideoUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.length > LIMITS.videoUrl) return null;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  return u.toString();
}

// Work out how the player should show a link.
//   { kind:'youtube', embed:'https://www.youtube-nocookie.com/embed/ID' }
//   { kind:'vimeo',   embed:'https://player.vimeo.com/video/ID' }
//   { kind:'file',    src:'<url>' }   -> plain <video> tag (uploads, Cloudinary, direct .mp4)
function describeVideo(url) {
  if (!url) return { kind: 'none' };
  try {
    const u = new URL(url, 'https://local.invalid');
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
      else { const m = u.pathname.match(/^\/(embed|shorts|live)\/([\w-]{6,20})/); if (m) id = m[2]; }
    }
    if (id && /^[\w-]{6,20}$/.test(id)) return { kind: 'youtube', embed: 'https://www.youtube-nocookie.com/embed/' + id };
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = u.pathname.match(/(\d{5,12})/);
      if (m) return { kind: 'vimeo', embed: 'https://player.vimeo.com/video/' + m[1] };
    }
  } catch (e) { /* fall through to a plain file */ }
  return { kind: 'file', src: url };
}

function register(app, deps) {
  const { mongoose, adminAuth } = deps;
  // This file lives in lib/, so the project root is one level up (falls back to the same folder if it is still flat).
  const rootDir = fs.existsSync(path.join(__dirname, 'public')) ? __dirname : path.join(__dirname, '..');
  const uploadDir = path.join(rootDir, 'public', 'uploads');

  let cloudinary = null, CloudinaryStorage = null, cloudinaryConfigured = false;
  try {
    cloudinary = require('cloudinary').v2;
    ({ CloudinaryStorage } = require('multer-storage-cloudinary'));
    cloudinaryConfigured = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  } catch (e) { cloudinaryConfigured = false; }

  // ── Model ──
  const schema = new mongoose.Schema({
    title:        { type: String, required: true },
    subheading:   { type: String, default: '' },
    description:  { type: String, default: '' },
    videoUrl:     { type: String, default: '' },   // uploaded file URL OR pasted link
    videoSource:  { type: String, default: 'none' }, // 'upload' | 'link' | 'none'
    videoPublicId:{ type: String, default: '' },   // Cloudinary id / local filename, used for deletion
    published:    { type: Boolean, default: true },
    order:        { type: Number, default: 0 },    // lower number shows first
    createdAt:    { type: Date, default: Date.now },
    updatedAt:    { type: Date, default: Date.now }
  });
  const Tutorial = mongoose.models.Tutorial || mongoose.model('Tutorial', schema);

  // ── Upload (own multer, so nothing else in server.js is touched) ──
  const storage = cloudinaryConfigured
    ? new CloudinaryStorage({
        cloudinary,
        params: async () => ({
          folder: 'ksl/tutorials-videos',
          resource_type: 'video',
          public_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          use_filename: false
        })
      })
    : multer.diskStorage({
        destination: (req, file, cb) => { try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) {} cb(null, uploadDir); },
        filename: (req, file, cb) => {
          let ext = path.extname(file.originalname || '').toLowerCase();
          if (!SAFE_VIDEO_EXT.test(ext)) ext = '.mp4';
          cb(null, `tutorial_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
        }
      });
  const uploader = multer({
    storage,
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => VIDEO_MIME.test(file.mimetype) ? cb(null, true) : cb(new Error('Please choose a video file (mp4, mov or webm).'))
  }).single('video');

  // Runs multer but turns its errors into clean JSON the admin page can show.
  const handleUpload = (req, res, next) => uploader(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `That video is bigger than ${MAX_UPLOAD_MB} MB. Compress it, or upload it to YouTube/Vimeo and paste the link instead.`
      : (err.message || 'Upload failed');
    return res.status(400).json({ error: msg });
  });

  const uploadedInfo = (file) => {
    if (!file) return null;
    if (cloudinaryConfigured) return { url: file.path, publicId: file.filename || '' };
    return { url: '/uploads/' + file.filename, publicId: file.filename || '' };
  };

  // Best-effort removal of a stored video; never throws.
  async function removeStored(doc) {
    try {
      if (!doc || doc.videoSource !== 'upload' || !doc.videoPublicId) return;
      if (/^https?:\/\//i.test(doc.videoUrl) && cloudinary && cloudinaryConfigured) {
        await cloudinary.uploader.destroy(doc.videoPublicId, { resource_type: 'video' });
      } else if (doc.videoUrl.startsWith('/uploads/')) {
        const f = path.join(uploadDir, path.basename(doc.videoPublicId));
        if (f.startsWith(uploadDir) && fs.existsSync(f)) fs.unlinkSync(f);
      }
    } catch (e) { console.error('[tutorials] could not remove old video:', e.message); }
  }

  const shape = (d) => ({
    id: String(d._id),
    title: d.title,
    subheading: d.subheading || '',
    description: d.description || '',
    video: describeVideo(d.videoUrl),
    videoUrl: d.videoUrl || '',
    videoSource: d.videoSource || 'none',
    published: !!d.published,
    order: d.order || 0,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt
  });
  const isId = (id) => /^[a-f0-9]{24}$/i.test(String(id || ''));

  // Validates the text fields; returns { ok, value } or { ok:false, error }.
  function readFields(b, partial) {
    const out = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
    if (!partial || has('title')) {
      out.title = cleanText(b.title, LIMITS.title);
      if (!out.title) return { ok: false, error: 'Please enter a title, e.g. "How to log in a TikTok account".' };
    }
    if (!partial || has('subheading')) out.subheading = cleanText(b.subheading, LIMITS.subheading);
    if (!partial || has('description')) out.description = cleanText(b.description, LIMITS.description);
    if (!partial || has('published')) out.published = !(b.published === false || b.published === 'false' || b.published === '0' || b.published === 0);
    if (has('order')) {
      const n = Number(b.order);
      if (!Number.isFinite(n) || Math.abs(n) > 100000) return { ok: false, error: 'Order must be a number.' };
      out.order = Math.round(n);
    }
    return { ok: true, value: out };
  }

  // ── Public ──
  app.get('/api/tutorials', async (req, res) => {
    try {
      const docs = await Tutorial.find({ published: true }).sort({ order: 1, createdAt: -1 }).lean();
      res.set('Cache-Control', 'no-store');
      res.json({ tutorials: docs.map(shape) });
    } catch (e) { console.error('[tutorials] list failed:', e.message); res.status(500).json({ error: 'Could not load tutorials.' }); }
  });
  app.get('/api/tutorials/:id', async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(404).json({ error: 'Tutorial not found.' });
      const d = await Tutorial.findOne({ _id: req.params.id, published: true }).lean();
      if (!d) return res.status(404).json({ error: 'Tutorial not found.' });
      res.set('Cache-Control', 'no-store');
      res.json({ tutorial: shape(d) });
    } catch (e) { res.status(500).json({ error: 'Could not load this tutorial.' }); }
  });

  // ── Admin ──
  app.get('/api/admin/tutorials', adminAuth, async (req, res) => {
    try {
      const docs = await Tutorial.find({}).sort({ order: 1, createdAt: -1 }).lean();
      res.json({
        tutorials: docs.map(shape),
        storage: { cloudinary: cloudinaryConfigured, maxUploadMB: MAX_UPLOAD_MB }
      });
    } catch (e) { res.status(500).json({ error: 'Could not load tutorials: ' + e.message }); }
  });

  app.post('/api/admin/tutorials', adminAuth, handleUpload, async (req, res) => {
    try {
      const f = readFields(req.body || {}, false);
      if (!f.ok) { await removeStored({ videoSource: 'upload', videoUrl: (uploadedInfo(req.file) || {}).url || '', videoPublicId: (uploadedInfo(req.file) || {}).publicId || '' }); return res.status(400).json({ error: f.error }); }
      const doc = { ...f.value, videoUrl: '', videoSource: 'none', videoPublicId: '' };
      const up = uploadedInfo(req.file);
      if (up) { doc.videoUrl = up.url; doc.videoSource = 'upload'; doc.videoPublicId = up.publicId; }
      else if (req.body && req.body.videoUrl) {
        const link = normaliseVideoUrl(req.body.videoUrl);
        if (link === null) return res.status(400).json({ error: 'The video link must be a full https:// link (YouTube, Vimeo or a direct .mp4 link).' });
        doc.videoUrl = link; doc.videoSource = link ? 'link' : 'none';
      }
      if (!doc.videoUrl) return res.status(400).json({ error: 'Please upload a video or paste a video link.' });
      if (req.body && req.body.order === undefined) {
        const top = await Tutorial.findOne({}).sort({ order: -1 }).select('order').lean();
        doc.order = top ? (top.order || 0) + 1 : 1;     // new tutorials go to the end by default
      }
      const created = await Tutorial.create(doc);
      res.json({ ok: true, tutorial: shape(created) });
    } catch (e) { console.error('[tutorials] create failed:', e.message); res.status(500).json({ error: 'Could not save the tutorial: ' + e.message }); }
  });

  app.put('/api/admin/tutorials/:id', adminAuth, handleUpload, async (req, res) => {
    const up = uploadedInfo(req.file);
    const discardNew = () => up ? removeStored({ videoSource: 'upload', videoUrl: up.url, videoPublicId: up.publicId }) : null;
    try {
      if (!isId(req.params.id)) { await discardNew(); return res.status(404).json({ error: 'Tutorial not found.' }); }
      const existing = await Tutorial.findById(req.params.id);
      if (!existing) { await discardNew(); return res.status(404).json({ error: 'Tutorial not found.' }); }
      const b = req.body || {};
      const f = readFields(b, true);
      if (!f.ok) { await discardNew(); return res.status(400).json({ error: f.error }); }
      const update = { ...f.value, updatedAt: new Date() };
      let oldToRemove = null;
      if (up) {
        oldToRemove = { videoSource: existing.videoSource, videoUrl: existing.videoUrl, videoPublicId: existing.videoPublicId };
        update.videoUrl = up.url; update.videoSource = 'upload'; update.videoPublicId = up.publicId;
      } else if (b.videoUrl !== undefined && String(b.videoUrl).trim() !== '' && String(b.videoUrl).trim() !== existing.videoUrl) {
        const link = normaliseVideoUrl(b.videoUrl);
        if (!link) return res.status(400).json({ error: 'The video link must be a full https:// link (YouTube, Vimeo or a direct .mp4 link).' });
        oldToRemove = { videoSource: existing.videoSource, videoUrl: existing.videoUrl, videoPublicId: existing.videoPublicId };
        update.videoUrl = link; update.videoSource = 'link'; update.videoPublicId = '';
      }
      const saved = await Tutorial.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
      if (oldToRemove) await removeStored(oldToRemove);
      res.json({ ok: true, tutorial: shape(saved) });
    } catch (e) { await discardNew(); console.error('[tutorials] update failed:', e.message); res.status(500).json({ error: 'Could not update the tutorial: ' + e.message }); }
  });

  app.delete('/api/admin/tutorials/:id', adminAuth, async (req, res) => {
    try {
      if (!isId(req.params.id)) return res.status(404).json({ error: 'Tutorial not found.' });
      const d = await Tutorial.findByIdAndDelete(req.params.id);
      if (!d) return res.status(404).json({ error: 'Tutorial not found.' });
      await removeStored(d);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'Could not delete: ' + e.message }); }
  });

  // ── Pages ──
  const sendPage = (req, res) => {
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.sendFile(path.join(rootDir, 'public', 'tutorials.html'));
  };
  app.get('/tutorials', sendPage);
  app.get('/tutorials/:id', sendPage);

  console.log(` Tutorials ready — ${cloudinaryConfigured ? 'videos are stored on Cloudinary' : 'Cloudinary not set: uploaded tutorial videos go to local disk and are LOST on Render restarts (use video links, or set Cloudinary)'}`);
}

module.exports = { register, describeVideo, normaliseVideoUrl };
