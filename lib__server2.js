require('dotenv').config();
// ── Site branding / look-and-feel lives in ONE file: site.config.js ─────────
// Clone the project, edit site.config.js (or the BRAND_* vars in .env), and the
// whole site renames, recolours and re-titles itself. No need to dig in here.
const { BRAND, PAGE_SEO, brandCss, publicBrand } = require('./site.config');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;
if (!googleClient) console.warn(' GOOGLE_CLIENT_ID not set in .env — Google Sign-In will be disabled until configured.');
const app = express();
const rateLimit = require('express-rate-limit');
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','x-admin-passcode','x-subadmin-token'] }));
app.options('*', cors()); // handle pre-flight OPTIONS requests
app.set('trust proxy', 1);
app.use((req, res, next) => {
 // Keep search engines out of the API, admin and account areas, but allow the
 // public marketing/shop pages to be indexed (Google was seeing a site-wide
 // `noindex` header, which blocked klslogs.com entirely).
 const p = req.path || '';
 const privatePath = /^\/(api|uploads|admin)/i.test(p);
 if (privatePath) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
 res.setHeader('Access-Control-Allow-Origin', '*');
 res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
 res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-admin-passcode,x-subadmin-token');
 next();
});

// ── sitemap.xml (Search Console needs a real XML file at the root) ──────────
app.get('/sitemap.xml', (req, res) => {
  const base = 'https://' + (req.headers.host || BRAND.domain).replace(/^www\./, '');
  const paths = ['/', '/marketplace', '/tools', '/logs', '/boost', '/buy-number', '/support', '/login', '/register'];
  const now = new Date().toISOString().slice(0, 10);
  const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map(u => `  <url><loc>${base}${u}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq></url>`).join('\n') +
    '\n</urlset>\n';
  res.type('application/xml').send(body);
});

// ── Brand colours + fonts as a stylesheet, and brand text as JSON ──────────
// Pages already link /brand.css, so editing site.config.js restyles the site.
app.get('/brand.css', (req, res) => {
  res.type('text/css').set('Cache-Control', 'public, max-age=300').send(brandCss());
});
app.get('/api/brand', (req, res) => res.json(publicBrand()));
// ── Security hardening ──────────────────────────────────────────────────────
// helmet ships the well-known protective headers (HSTS, no-sniff, frame-deny,
// referrer policy, cross-origin isolation). The Content-Security-Policy is left
// off because the pages use inline scripts, but everything else is on.
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));
app.disable('x-powered-by');
// Block obvious payload abuse before any route sees it: NoSQL operator
// injection ({"$gt":""} style) inside JSON bodies and query strings.
function stripOperators(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const k of Object.keys(obj)) {
    if (k.startsWith('$') || k.includes('.')) { delete obj[k]; continue; }
    stripOperators(obj[k], depth + 1);
  }
}

// Brute-force protection on the account doors (login, reset, Google).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  trustProxy: true
});
['/api/auth/login', '/api/auth/google', '/api/auth/forgot-password', '/api/auth/reset-password-with-code']
  .forEach(route => app.use(route, authLimiter));

const apiLimiter = rateLimit({
 windowMs: 60 * 1000,
 max: 300, // very generous — 3G Android retries count against this, don't penalise slow connections
 standardHeaders: true,
 legacyHeaders: false,
 skip: (req) => req.method === 'OPTIONS', // never rate-limit CORS pre-flight
 message: { error: 'Too many requests — please slow down.' },
 trustProxy: true
});
app.use('/api/', apiLimiter);
const registerLimiter = rateLimit({
 windowMs: 60 * 60 * 1000, // 1 hour
 max: 5, // 5 signups per IP per hour is generous for shared connections, brutal for bots
 standardHeaders: true,
 legacyHeaders: false,
 message: { error: 'Too many accounts created from this connection recently. Please try again later or contact support.' },
 trustProxy: true
});
app.use('/api/auth/register', registerLimiter);
const apiV1Limiter = rateLimit({
 windowMs: 60 * 1000,
 max: 60,
 standardHeaders: true,
 legacyHeaders: false,
 message: { error: 'API rate limit exceeded — please slow down your requests.' },
 trustProxy: true
});
app.use('/api/v1/', apiV1Limiter);
app.use(express.json({ limit: '20mb' }));
// ── KLS request console log ──────────────────────────────────────────────────
// Every API call is logged with method, path, status, duration and the caller,
// so any "it works for me but not for him" report can be traced in the server
// logs instead of guessed at.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const started = Date.now();
  res.on('finish', () => {
    const who = req.user?.email || req.user?._id || 'guest';
    const line = `[KLS] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - started}ms user=${who}`;
    if (res.statusCode >= 500) console.error(line);
    else if (res.statusCode >= 400) console.warn(line);
    else console.log(line);
  });
  next();
});
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use((req, res, next) => { stripOperators(req.body); stripOperators(req.query); next(); });
// index:false so '/' reaches the SEO-meta-injecting route below instead of being auto-served raw.
// HTML pages are never cached: visitors were still being served an old copy of
// the home page (and other pages) out of the browser/CDN cache after a deploy.
// Versioned assets (?v=...) keep their normal cache.
app.use(express.static('public', {
  index: false,
  setHeaders(res, filePath) {
    if (/\.html?$/i.test(filePath)) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinaryConfigured = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (cloudinaryConfigured) {
 cloudinary.config({
 cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
 api_key: process.env.CLOUDINARY_API_KEY,
 api_secret: process.env.CLOUDINARY_API_SECRET
 });
 console.log(' Cloudinary connected — uploaded pictures/files will persist permanently');
} else {
 console.warn(' Cloudinary not configured (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET missing in .env) — uploads will fall back to local disk and WILL BE LOST on Render restarts/redeploys.');
}
const uploadDir = path.join(__dirname, 'public', 'uploads');
const receiptDir = path.join(__dirname, 'public', 'receipts');
const fileDir = path.join(__dirname, 'public', 'files');
[uploadDir, receiptDir, fileDir].forEach(d => {
  // If a stray FILE sits where the folder should be, replace it; otherwise uploads fail with ENOTDIR.
  try { if (fs.existsSync(d) && !fs.statSync(d).isDirectory()) fs.unlinkSync(d); } catch (e) { console.error('Could not clear non-directory at', d, e.message); }
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
function makeStorage(folder, resourceType) {
 if (cloudinaryConfigured) {
 return new CloudinaryStorage({
 cloudinary,
 params: async (req, file) => ({
 folder: `ksl/${folder}`,
 resource_type: resourceType || 'auto', // 'auto' lets Cloudinary handle images vs arbitrary files (zip/apk/etc.)
 public_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
 use_filename: false
 })
 });
 }
 const dir = folder === 'receipts' ? receiptDir : folder === 'files' ? fileDir : uploadDir;
 return multer.diskStorage({
 destination: (req, file, cb) => cb(null, dir),
 filename: (req, file, cb) => cb(null, `${folder}_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
 });
}
function fileUrl(file) {
 if (!file) return null;
 if (cloudinaryConfigured) return file.path; // Cloudinary gives the full https:// URL in file.path
 return `/${file.destination.includes('receipts') ? 'receipts' : file.destination.includes('files') ? 'files' : 'uploads'}/${file.filename}`;
}
const upload = multer({ storage: makeStorage('uploads', 'image'), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => /jpeg|jpg|png|gif|webp/.test(file.mimetype) ? cb(null, true) : cb(new Error('Images only')) });
const receiptUpload = multer({
 storage: multer.diskStorage({
 destination: (req, file, cb) => cb(null, receiptDir),
 filename: (req, file, cb) => cb(null, `receipt_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
 }),
 limits: { fileSize: 10 * 1024 * 1024 },
 fileFilter: (req, file, cb) => /jpeg|jpg|png|gif|webp|pdf/.test(file.mimetype) ? cb(null, true) : cb(new Error('Image or PDF only'))
});
const MAX_SUB_ACCOUNTS = 50;
const subReviewFileFields = Array.from({ length: MAX_SUB_ACCOUNTS }, (_, i) => ({ name: `subReviewFile_${i}`, maxCount: 1 }));
const subTutorialFileFields = Array.from({ length: MAX_SUB_ACCOUNTS }, (_, i) => ({ name: `subTutorialFile_${i}`, maxCount: 1 }));
const uploadLogFields = multer({
 storage: cloudinaryConfigured
 ? new CloudinaryStorage({
 cloudinary,
 params: async (req, file) => {
 const isReview = file.fieldname === 'adminReviewFile' || file.fieldname.startsWith('subReviewFile_');
 const isTutorial = file.fieldname === 'tutorialImages' || file.fieldname === 'tutorialVideo' || file.fieldname.startsWith('subTutorialFile_');
 return {
 folder: file.fieldname === 'deliverableFile' ? 'ksl/files' : isReview ? 'ksl/reviews' : isTutorial ? 'ksl/tutorials' : 'ksl/uploads',
 resource_type: (isReview || isTutorial) ? 'auto' : (file.fieldname === 'deliverableFile' ? 'auto' : 'image'),
 public_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
 use_filename: false
 };
 }
 })
 : multer.diskStorage({
 destination: (req, file, cb) => cb(null, file.fieldname === 'deliverableFile' ? fileDir : uploadDir),
 filename: (req, file, cb) => {
 const isReview = file.fieldname === 'adminReviewFile' || file.fieldname.startsWith('subReviewFile_');
 const isTutorial = file.fieldname === 'tutorialImages' || file.fieldname === 'tutorialVideo' || file.fieldname.startsWith('subTutorialFile_');
 const prefix = file.fieldname === 'deliverableFile' ? 'file' : isReview ? 'review' : isTutorial ? 'tutorial' : 'img';
 cb(null, `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
 }
 }),
 limits: { fileSize: 100 * 1024 * 1024 },
 fileFilter: (req, file, cb) => {
 const isReview = file.fieldname === 'adminReviewFile' || file.fieldname.startsWith('subReviewFile_');
 const isSubTutorial = file.fieldname.startsWith('subTutorialFile_');
 if (file.fieldname === 'picture' && !/jpeg|jpg|png|gif|webp/.test(file.mimetype)) return cb(new Error('Picture must be an image'));
 if (isReview && !/jpeg|jpg|png|gif|webp|mp4|mov|webm|quicktime/.test(file.mimetype)) return cb(new Error('Review attachment must be an image or video'));
 if (isSubTutorial && !/jpeg|jpg|png|gif|webp|mp4|mov|webm|quicktime/.test(file.mimetype)) return cb(new Error('Sub-account tutorial must be an image or video'));
 if (file.fieldname === 'tutorialImages' && !/jpeg|jpg|png|gif|webp/.test(file.mimetype)) return cb(new Error('Tutorial images must be image files'));
 if (file.fieldname === 'tutorialVideo' && !/mp4|mov|webm|quicktime/.test(file.mimetype)) return cb(new Error('Tutorial video must be a video file'));
 cb(null, true);
 }
}).fields([
 { name: 'picture', maxCount: 1 }, { name: 'deliverableFile', maxCount: 1 }, { name: 'adminReviewFile', maxCount: 1 },
 { name: 'tutorialImages', maxCount: 20 }, { name: 'tutorialVideo', maxCount: 1 },
 ...subReviewFileFields, ...subTutorialFileFields
]);
const reviewUpload = multer({
 storage: cloudinaryConfigured
 ? new CloudinaryStorage({
 cloudinary,
 params: async (req, file) => ({
 folder: 'ksl/reviews',
 resource_type: 'auto', // auto-detects image vs video
 public_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
 use_filename: false
 })
 })
 : multer.diskStorage({
 destination: (req, file, cb) => cb(null, uploadDir),
 filename: (req, file, cb) => cb(null, `review_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
 }),
 limits: { fileSize: 50 * 1024 * 1024 },
 fileFilter: (req, file, cb) => /jpeg|jpg|png|gif|webp|mp4|mov|webm|quicktime/.test(file.mimetype) ? cb(null, true) : cb(new Error('Image or video only'))
});
const chatUpload = multer({
 storage: cloudinaryConfigured
 ? new CloudinaryStorage({
 cloudinary,
 params: async (req, file) => ({
 folder: 'ksl/chat',
 resource_type: 'auto', // auto-detects image vs video vs raw file
 public_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
 use_filename: false
 })
 })
 : multer.diskStorage({
 destination: (req, file, cb) => cb(null, uploadDir),
 filename: (req, file, cb) => cb(null, `chat_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
 }),
 limits: { fileSize: 50 * 1024 * 1024 }
});
const depositTutorialUpload = multer({
 storage: cloudinaryConfigured
 ? new CloudinaryStorage({
 cloudinary,
 params: async (req, file) => ({
 folder: 'ksl/deposit-tutorials',
 resource_type: file.fieldname === 'video' ? 'video' : 'image',
 public_id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
 use_filename: false
 })
 })
 : multer.diskStorage({
 destination: (req, file, cb) => cb(null, uploadDir),
 filename: (req, file, cb) => cb(null, `deptut_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`)
 }),
 limits: { fileSize: 100 * 1024 * 1024 },
 fileFilter: (req, file, cb) => {
 if (file.fieldname === 'video' && !/mp4|mov|webm|quicktime/.test(file.mimetype)) return cb(new Error('Tutorial video must be a video file'));
 if (file.fieldname === 'images' && !/jpeg|jpg|png|gif|webp/.test(file.mimetype)) return cb(new Error('Tutorial images must be image files'));
 cb(null, true);
 }
}).fields([{ name: 'video', maxCount: 1 }, { name: 'images', maxCount: 10 }]);
mongoose.connect(process.env.MONGODB_URI, {
 serverSelectionTimeoutMS: 10000,
 socketTimeoutMS: 45000,
 retryWrites: true,
 w: 'majority'
})
 .then(async () => {
   console.log('MongoDB connected');
   try {
     const _sl = await SiteLinks.findById('main');
     // Self-healing migration: corrects known-outdated contact numbers in the live database
     // automatically on server boot. Only matches specific OLD values — once the number is
     // '2349065518402' (or an admin sets any other custom number later), this never touches it
     // again, so it's safe to leave running indefinitely.
     const outdatedNumbers = ['2349154834677', '2348124960204'];
     let finalNumber = '2349065518402';
     if (!_sl) {
       await SiteLinks.create({ _id: 'main', whatsappNumber: '2349065518402', adminPhone: '2349065518402' });
     } else if (!_sl.whatsappNumber || outdatedNumbers.includes(_sl.whatsappNumber)) {
       await SiteLinks.findByIdAndUpdate('main', { $set: { whatsappNumber: '2349065518402', adminPhone: '2349065518402' } });
       console.log('[startup] contact number corrected to 2349065518402');
     } else {
       finalNumber = _sl.adminPhone || _sl.whatsappNumber; // an admin already set a different custom number — respect it
     }
     // Keep the WhatsApp-notification env var in sync with the database value, so a stale
     // ADMIN_WHATSAPP set in the hosting platform's environment variables can never override
     // what's actually configured in the admin panel.
     process.env.ADMIN_WHATSAPP = finalNumber;
   } catch(e) { console.error('[startup] site-links init:', e.message); }
 })
 .catch(err => console.error('MongoDB connection error:', err));
mongoose.connection.on('disconnected', () => {
 console.warn(' MongoDB disconnected — attempting reconnect…');
 setTimeout(() => {
 mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, retryWrites: true, w: 'majority' })
 .catch(e => console.error('Reconnect failed:', e.message));
 }, 3000);
});
mongoose.connection.on('reconnected', () => console.log(' MongoDB reconnected'));
const userSchema = new mongoose.Schema({
 name: { type: String, required: true, trim: true },
 email: { type: String, required: true, unique: true, lowercase: true },
 password: { type: String }, // not required — Google-only accounts have no password
 googleId: { type: String, unique: true, sparse: true },
 authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
 profilePicture: { type: String, default: '' },
 flwCustomerId: { type: String, default: '' }, // Flutterwave v4 customer ID, created once and reused for future Flutterwave calls
 referralCode: { type: String, unique: true, sparse: true }, // this user's own shareable code
 referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who referred this user, if anyone (set once, at signup)
 balance: { type: Number, default: 0 },
 restricted: { type: Boolean, default: false },
 restrictedReason: { type: String, default: '' },
 restrictedAt: { type: Date },
 lastLoginAt: { type: Date },
 lastLoginIp: { type: String },
 lastLoginUserAgent: { type: String },
 signupFingerprint: { type: String, default: '', index: true }, // ip+device hash — powers the 5-accounts-per-person rule
 signupIp: { type: String, default: '' }, // captured once at registration — used to detect referral/signup abuse (many accounts from one IP)
 lastActiveAt: { type: Date }, // updated (throttled) on authenticated requests — powers the "Active Now" list
 gameId: { type: String, unique: true, sparse: true }, // permanent, e.g. KLS-7F3A9K
 apiKey: { type: String, unique: true, sparse: true },
 apiSecret: { type: String },
 apiEnabled: { type: Boolean, default: false },
 apiKeyCreatedAt: { type: Date },
 apiLastUsedAt: { type: Date },
 contactPhone: { type: String, default: '' }, // user's contact number in full E.164 format (e.g. +2348012345678 / +447700900000)
 country: { type: String, default: '' },          // ISO-3166-1 alpha-2 of the user's country — drives payment methods & currency
 language: { type: String, default: 'en' },       // UI language chosen by the user
 displayCurrency: { type: String, default: '' },  // currency prices are shown in (the ledger stays NGN)
 virtualAccount: {
 enabled: { type: Boolean, default: false }, // true once created — self-serve or by admin
 accountNumber: { type: String, default: '' },
 bankName: { type: String, default: '' },
 accountName: { type: String, default: '' },
 flwRef: { type: String, default: '' }, // Flutterwave's own reference
 createdAt: { type: Date }
 },
 notificationsSeenAt: { type: Date, default: null },
 loginHistory: [{
 at: { type: Date, default: Date.now },
 ip: String,
 userAgent: String
 }],
 purchaseDetails: [{
 logId: mongoose.Schema.Types.ObjectId,
 logTitle: String,
 logType: { type: String, enum: ['log', 'tool'], default: 'log' },
 logDetails: String,
 toolLink: String,
 deliveryType: { type: String, enum: ['link', 'file'], default: 'link' },
 deliverableFile: String,
 deliverableFileName: String,
 pricePaid: Number,
 source: { type: String, default: 'market1' }, // 'market1' manual logs · 'market2' RakibSocials API
 purchasedAt: { type: Date, default: Date.now }
 }],
 createdAt: { type: Date, default: Date.now }
});
const categorySchema = new mongoose.Schema({
 name: { type: String, required: true, unique: true, trim: true },
 showReviews: { type: Boolean, default: true }, // if false, reviews are hidden for every log in this category
 createdAt: { type: Date, default: Date.now }
});
const subAccountSchema = new mongoose.Schema({
 label: { type: String, required: true }, // e.g. "Account 1", or the phone number itself
 details: { type: String, default: '' },
 toolLink: { type: String, default: '' },
 deliveryType: { type: String, enum: ['link', 'file'], default: 'link' },
 deliverableFile: { type: String, default: '' },
 deliverableFileName: { type: String, default: '' },
 picture: { type: String, default: '' },
 price: { type: Number, required: true },
 sold: { type: Boolean, default: false },
 soldTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 soldAt: { type: Date },
 reviews: [{
 userId: mongoose.Schema.Types.ObjectId,
 userName: String,
 rating: { type: Number, min: 1, max: 5 },
 reviewType: { type: String, enum: ['text', 'image', 'video', 'link'], default: 'text' }, // what type of review content
 content: { type: String, maxlength: 2000 }, // text comment, image URL, video URL, or link
 createdAt: { type: Date, default: Date.now }
 }],
 adminReview: {
 reviewType: { type: String, enum: ['none', 'text', 'image', 'video', 'link'], default: 'none' },
 content: { type: String, default: '' }, // text comment, image URL, video URL, or link — depending on reviewType
 rating: { type: Number, min: 1, max: 5 }
 },
 tutorial: {
 tutorialType: { type: String, enum: ['none', 'images', 'video', 'link'], default: 'none' },
 images: [{ type: String }],
 videoUrl: { type: String, default: '' },
 linkUrl: { type: String, default: '' }
 },
 createdAt: { type: Date, default: Date.now }
});
const logSchema = new mongoose.Schema({
 type: { type: String, enum: ['log', 'tool'], default: 'log' },
 listingType: { type: String, enum: ['simple', 'folder'], default: 'simple' },
 title: { type: String, required: true },
 description: { type: String, required: true },
 details: String,
 toolLink: String,
 deliveryType: { type: String, enum: ['link', 'file'], default: 'link' },
 deliverableFile: String,
 deliverableFileName: String,
 toolQty: { type: Number, default: 0 },
 maxPurchases: { type: Number, default: 1 },
 picture: String,
 price: { type: Number },
 soldCount: { type: Number, default: 0 },
 reviews: [{
 userId: mongoose.Schema.Types.ObjectId,
 userName: String,
 rating: { type: Number, min: 1, max: 5 },
 reviewType: { type: String, enum: ['text', 'image', 'video', 'link'], default: 'text' },
 content: { type: String, maxlength: 2000 },
 createdAt: { type: Date, default: Date.now }
 }],
 adminReview: {
 reviewType: { type: String, enum: ['none', 'text', 'image', 'video', 'link'], default: 'none' },
 content: { type: String, default: '' }, // text comment, image URL, video URL, or link — depending on reviewType
 rating: { type: Number, min: 1, max: 5 }
 },
 subAccounts: [subAccountSchema],
 category: { type: String, default: 'General' },
 available: { type: Boolean, default: true },
 tutorial: {
 tutorialType: { type: String, enum: ['none', 'images', 'video', 'link'], default: 'none' },
 images: [{ type: String }], // ordered list of image URLs, shown one-at-a-time with a Next button
 videoUrl: { type: String, default: '' },
 linkUrl: { type: String, default: '' }
 },
 createdAt: { type: Date, default: Date.now }
});
const transactionSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 type: { type: String, enum: ['deposit', 'purchase', 'admin_credit', 'admin_debit', 'debit', 'referral_commission', 'refund'], required: true },
 amount: { type: Number, required: true },
 description: String,
 status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
 // Idempotency key. One Flutterwave charge can only ever produce ONE wallet
 // transaction: the unique+sparse index makes a second insert throw instead of
 // silently crediting the same deposit twice.
 txRef: { type: String, index: true, unique: true, sparse: true },
 reversed: { type: Boolean, default: false },
 reversedAt: { type: Date, default: null },
 reversalReason: { type: String, default: '' },
 createdAt: { type: Date, default: Date.now }
});
const receiptSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 userName: String,
 userEmail: String,
 claimedAmount: Number,
 claimedBank: String,
 claimedAccountName: String,
 claimedAccountNumber: String,
 extractedAmount: Number,
 extractedDate: String,
 extractedTime: String,
 extractedReference: String,
 extractedSenderName: String,
 extractedRecipientName: String,
 extractedRecipientAccount: String,
 extractedBank: String,
 receiptFingerprint: { type: String, unique: true, sparse: true },
 aiVerdict: { type: String, enum: ['approved', 'rejected', 'manual_review'], default: 'manual_review' },
 aiConfidence: Number,
 aiReason: String,
 fakeTransferFlags: [String],
 receiptPath: String,
 status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
 adminNote: String,
 seenByUser: { type: Boolean, default: true }, // false once status changes away from pending, until user views it
 createdAt: { type: Date, default: Date.now }
});
const supportSchema = new mongoose.Schema({
 userId: mongoose.Schema.Types.ObjectId,
 name: String, email: String, subject: String, message: String,
 status: { type: String, enum: ['open', 'resolved'], default: 'open' },
 adminReply: String,
 seenByUser: { type: Boolean, default: true }, // false once admin replies, until user views it
 createdAt: { type: Date, default: Date.now }
});
const visitorStatsSchema = new mongoose.Schema({
 key: { type: String, default: 'global', unique: true },
 visitors: { type: Number, default: 0 }
});
const visitorLogSchema = new mongoose.Schema({
 visitorId: { type: String, required: true, unique: true },
 firstSeen: { type: Date, default: Date.now },
 lastSeen: { type: Date, default: Date.now },
 visitCount: { type: Number, default: 1 }
});
const depositTutorialSchema = new mongoose.Schema({
 method: { type: String, enum: ['paymentlink'], required: true, unique: true },
 videoUrl: { type: String, default: '' },
 imageUrls: [{ type: String }],
 caption: { type: String, default: '' },
 updatedAt: { type: Date, default: Date.now }
});
const DepositTutorial = mongoose.model('DepositTutorial', depositTutorialSchema);
const paymentMethodSettingSchema = new mongoose.Schema({
 method: { type: String, enum: ['paymentlink'], required: true, unique: true },
 enabled: { type: Boolean, default: true },
 disabledMessage: { type: String, default: '' }, // optional note shown to users, e.g. "Under maintenance"
 updatedAt: { type: Date, default: Date.now }
});
const PaymentMethodSetting = mongoose.model('PaymentMethodSetting', paymentMethodSettingSchema);
const siteLinksSchema = new mongoose.Schema({
 _id: { type: String, default: 'main' },
 whatsappNumber: { type: String, default: '2349065518402' }, // digits only, no + or spaces — used as wa.me/{number}
 adminPhone: { type: String, default: '2349065518402' }, // admin contact number shown on support/contact pages
 whatsappGroupLink: { type: String, default: 'https://chat.whatsapp.com/HBqJeik773M1pqEmIjfpXr' },
 whatsappChannelLink: { type: String, default: 'https://whatsapp.com/channel/0029Vb7ivq9HLHQcS4XgQu2Q' },
 // Telegram + support contact details are admin-editable (Admin → Site Links) and are
 // applied site-wide by applySiteLinks() in public/script.js. They MUST live on the
 // schema: Mongoose silently drops unknown paths, which is why saving a new Telegram
 // username used to appear to work but every page kept the old @klslogs link.
 telegramUsername: { type: String, default: 'klslogs' },
 telegramLink: { type: String, default: 'https://t.me/klslogs' },
  telegramChannelLink: { type: String, default: '' },
  telegramCommunityLink: { type: String, default: '' },
 whatsappChatLink: { type: String, default: '' },
 supportHours: { type: String, default: '' },
 updatedAt: { type: Date, default: Date.now }
});
const SiteLinks = mongoose.model('SiteLinks', siteLinksSchema);
const NUMBER_RENTAL_WINDOW_MS = 20 * 60 * 1000; // 20 minutes to receive a code before auto-refund
const numberPricingSchema = new mongoose.Schema({
 provider: { type: String, required: true, trim: true },
 country: { type: String, required: true, trim: true },
 price: { type: Number, required: true },
 apiPrice: { type: Number, default: 0 }, // 0/unset = not offered via the public developer API
 enabled: { type: Boolean, default: true },
 mode: { type: String, default: 'live' }, // kept for backward-compat with old records; always 'live' now
 updatedAt: { type: Date, default: Date.now }
});
numberPricingSchema.index({ provider: 1, country: 1 }, { unique: true });
const NumberPricing = mongoose.model('NumberPricing', numberPricingSchema);
const userNumberPriceSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 provider: { type: String, required: true },
 country: { type: String, required: true },
 price: { type: Number, required: true },
 updatedAt: { type: Date, default: Date.now }
});
userNumberPriceSchema.index({ userId: 1, provider: 1, country: 1 }, { unique: true });
const UserNumberPrice = mongoose.model('UserNumberPrice', userNumberPriceSchema);
async function resolveNumberPrice(userId, provider, country) {
 if (userId) {
 const override = await UserNumberPrice.findOne({ userId, provider, country });
 if (override) return override.price;
 }
 const standard = await NumberPricing.findOne({ provider, country, enabled: true });
 return standard ? standard.price : null;
}
const numberListingSchema = new mongoose.Schema({
 provider: { type: String, required: true, trim: true },
 country: { type: String, required: true, trim: true },
 phoneNumber: { type: String, required: true, trim: true },
 cost: { type: Number, default: 0 },
 sellPrice: { type: Number, required: true },
 status: { type: String, enum: ['available', 'sold', 'delivered', 'expired', 'cancelled', 'needs_review'], default: 'available', index: true },
 soldTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 createdAt: { type: Date, default: Date.now },
 soldAt: { type: Date },
 expiresAt: { type: Date },
 code: { type: String, default: '' },
 codeAddedAt: { type: Date },
 novaSessionId: { type: String, default: '' },
 novaOrderNumber: { type: String, default: '' },
 novaServiceId: { type: Number, default: null },
 novaServerId: { type: Number, default: null },
 novaIdempotencyKey: { type: String, default: '' },
 // 'server1' = NovaSolution · 'server2' = GrizzlySMS
 server: { type: String, default: 'server1' },
 grizzlyActivationId: { type: String, default: '' },
 costUsd: { type: Number, default: 0 },
 // Last error the upstream provider returned while we were polling/serving this order.
 providerError: { type: String, default: '' },
 providerErrorAt: { type: Date },
 // Mobile operator requested for Server 2 orders ('any' = provider's choice).
 operator: { type: String, default: '' },
 // Lifecycle timestamps powering the live order-status timeline.
 cancelledAt: { type: Date },
 expiredAt: { type: Date },
 // Whether the provider confirmed the cancellation on their side.
 providerCancelled: { type: Boolean, default: false },
 providerCancelDetail: { type: String, default: '' },
 // How many times we retried the provider-side cancel after refunding the customer.
 providerCancelAttempts: { type: Number, default: 0 },

});
const NumberListing = mongoose.model('NumberListing', numberListingSchema);

// ── GrizzlySMS Integration (Server 2) ────────────────────────────────────────
// GrizzlySMS is sms-activate compatible: one endpoint, an `action` query param and
// an `api_key`. Docs: https://grizzlysms.com/docs  (handler_api.php)
const GRIZZLY_API_KEY = process.env.GRIZZLY_API_KEY || '5ef2d6daed2387b1d8a7fb374162d56b';
const GRIZZLY_BASE_URL = process.env.GRIZZLY_BASE_URL || 'https://api.grizzlysms.com/stubs/handler_api.php';
const grizzlyAxios = axios.create({ timeout: 20000 });

// Plain-text error strings Grizzly answers with instead of JSON.
const GRIZZLY_ERRORS = {
  BAD_KEY: 'Number provider rejected our API key — contact support.',
  BAD_ACTION: 'Number provider rejected the request.',
  NO_BALANCE: 'Number provider wallet is empty — please contact support.',
  NO_NUMBERS: 'No numbers available for that selection right now — try another country or provider.',
  WRONG_SERVICE: 'That service is not available for sale — pick another one.',
  SERVICE_UNAVAILABLE_REGION: 'That service is blocked in this region right now.',
  NO_ACTIVATION: 'That order no longer exists on the provider side.',
  EARLY_CANCEL_DENIED: 'You can only cancel 2 minutes after buying the number.'
};

// Every Grizzly call goes through here so logging + error shape stay consistent.
async function grizzlyRequest(action, params = {}) {
  const query = { api_key: GRIZZLY_API_KEY, action, ...params };
  console.log(`[grizzly] ${action}`, JSON.stringify(params));
  let res;
  try {
    res = await grizzlyAxios.get(GRIZZLY_BASE_URL, { params: query });
  } catch (e) {
    const err = new Error('Could not reach the number provider — please try again shortly.');
    err.grizzlyCode = 'NETWORK';
    throw err;
  }
  const body = res.data;
  console.log(`[grizzly] ${action} ->`, typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 300));
  if (typeof body === 'string') {
    const trimmed = body.trim();
    // "ACCESS_BALANCE:12.34" / "STATUS_OK:1234" style answers are successes, not errors.
    if (/^[A-Z_]+$/.test(trimmed) && GRIZZLY_ERRORS[trimmed]) {
      const err = new Error(GRIZZLY_ERRORS[trimmed]);
      err.grizzlyCode = trimmed;
      throw err;
    }
    if (/^[A-Z_]+$/.test(trimmed) && !trimmed.startsWith('STATUS_') && !trimmed.startsWith('ACCESS_')) {
      const err = new Error(`Number provider said: ${trimmed}`);
      err.grizzlyCode = trimmed;
      throw err;
    }
  }
  return body;
}

// ── Server + pricing configuration (admin-controlled) ────────────────────────
// One single document holds: which servers are live, the USD→₦ rate used to convert
// Grizzly's dollar cost, and the flat-naira profit ladder used for markup.
const numberServerConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  server1Enabled: { type: Boolean, default: true },   // the provider live number catalog
  // Server 1 profit ladder (₦ added on top of the live NovaSolution cost).
  server1MarkupTiers: {
    type: [{ upTo: Number, profit: Number }],
    default: [
      { upTo: 499, profit: 300 },     // ₦0–499 cost       → +₦300
      { upTo: 999, profit: 400 },     // ₦500–999 cost     → +₦400
      { upTo: 4999, profit: 700 },    // ₦1,000–4,999 cost → +₦700
      { upTo: 10000, profit: 1200 }   // ₦5,000–10,000     → +₦1,200
    ]
  },
  // Developer-API buyers keep this % of the normal profit (e.g. 75 = API price is a little cheaper).
  apiProfitPercent: { type: Number, default: 75 },
  server2Enabled: { type: Boolean, default: true },   // GrizzlySMS — all services/countries
  usdToNgn: { type: Number, default: 1650 },          // rate used to convert Grizzly USD cost to ₦
  // Flat-naira profit ladder. Each tier: cost in ₦ from `upTo` downwards gets `profit` ₦ added.
  markupTiers: {
    type: [{ upTo: Number, profit: Number }],
    default: [
      { upTo: 500, profit: 300 },     // ₦0–500 cost      → +₦300
      { upTo: 999, profit: 450 },     // ₦501–999 cost    → +₦450
      { upTo: 5000, profit: 700 },    // ₦1,000–5,000     → +₦700
      { upTo: 10000, profit: 1000 }   // ₦5,001–10,000    → +₦1,000
    ]
  },
  // Anything costing more than the last tier gets this percentage markup instead.
  highCostMarkupPercent: { type: Number, default: 20 },
  roundTo: { type: Number, default: 50 },             // round final ₦ price up to the nearest N
  // How Server 2 lists "providers" to customers:
  //   'pools'     = Grizzly price pools (cheapest first) — default
  //   'operators' = real mobile operators for the country (customer picks "Any" or a specific one)
  //   'both'      = price pool AND operator choice
  server2ProviderMode: { type: String, enum: ['pools', 'operators', 'both'], default: 'pools' },
  // Operator pre-selected for the customer. 'any' = let Grizzly choose any operator.
  server2DefaultOperator: { type: String, default: 'any' },
  // When ON, the 3 cheapest (low SMS rate) pools — Pool 1 to 3 — are hidden from customers.
  server2HideLowPools: { type: Boolean, default: false },
  // ── Auto USD→₦ rate tracking ───────────────────────────────────────────────
  // The dollar moves constantly; if the stored rate goes stale every Server 2 sale
  // silently loses money. When this is on, the server re-reads the live USD/NGN rate
  // on a timer and writes it straight into `usdToNgn` (plus a safety margin).
  autoRateEnabled: { type: Boolean, default: true },
  autoRateMarginPercent: { type: Number, default: 3 },   // cushion added on top of the live rate
  autoRateIntervalHours: { type: Number, default: 6 },
  autoRateMinRate: { type: Number, default: 800 },       // sanity floor — ignore absurd feeds
  autoRateMaxRate: { type: Number, default: 10000 },     // sanity ceiling
  lastAutoRate: { type: Number, default: 0 },            // raw live rate last seen
  lastAutoRateAt: { type: Date, default: null },
  lastAutoRateSource: { type: String, default: '' },
  lastAutoRateError: { type: String, default: '' },
  // ── Gizzle (Grizzly) balance alerting ──────────────────────────────────────
  balanceAlertsEnabled: { type: Boolean, default: true },
  lowBalanceThresholdUsd: { type: Number, default: 5 },
  balanceAlertEmail: { type: String, default: '' },      // where the warning email is sent
  balanceCheckIntervalMinutes: { type: Number, default: 15 },
  lastBalanceUsd: { type: Number, default: 0 },
  lastBalanceAt: { type: Date, default: null },
  lastBalanceError: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});
const NumberServerConfig = mongoose.model('NumberServerConfig', numberServerConfigSchema);

async function getNumberServerConfig() {
  let cfg = await NumberServerConfig.findOne({ key: 'main' });
  if (!cfg) cfg = await NumberServerConfig.create({ key: 'main' });
  return cfg;
}

// ── Admin email notifications ────────────────────────────────────────────────
// No SMTP dependency: we post to Resend, the one and only mail provider used by
// this site. With no key set the alert still lands in the admin warning banner
// and the error log, so nothing is ever silently lost.
async function sendAdminEmail(to, subject, text) {
  const target = String(to || process.env.ADMIN_ALERT_EMAIL || '').trim();
  if (!target) return { sent: false, reason: 'No admin alert email configured' };
  const from = process.env.ALERT_EMAIL_FROM || ('alerts@' + BRAND.domain);
  if (!process.env.RESEND_API_KEY) return { sent: false, reason: 'No RESEND_API_KEY configured' };
  try {
    await axios.post('https://api.resend.com/emails',
      { from, to: [target], subject, text },
      { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 15000 });
    return { sent: true, via: 'resend' };
  } catch (e) {
    console.error('[alert-email] failed:', e.message);
    return { sent: false, reason: e.message };
  }
}

// ── Live USD→₦ rate, auto-refreshed ─────────────────────────────────────────
// Two free public feeds, tried in order, so one going down does not freeze pricing.
const USD_RATE_FEEDS = [
  { name: 'open.er-api.com', url: 'https://open.er-api.com/v6/latest/USD', pick: d => d?.rates?.NGN },
  { name: 'exchangerate.host', url: 'https://api.exchangerate.host/latest?base=USD&symbols=NGN', pick: d => d?.rates?.NGN },
  { name: 'frankfurter.app', url: 'https://api.frankfurter.app/latest?from=USD&to=NGN', pick: d => d?.rates?.NGN }
];

async function fetchLiveUsdNgnRate() {
  let lastErr = 'No feed answered';
  for (const feed of USD_RATE_FEEDS) {
    try {
      const r = await axios.get(feed.url, { timeout: 12000 });
      const rate = Number(feed.pick(r.data));
      if (Number.isFinite(rate) && rate > 0) return { rate, source: feed.name };
    } catch (e) { lastErr = `${feed.name}: ${e.message}`; }
  }
  throw new Error(lastErr);
}

// Writes the live rate (plus margin) into the config so every Server 2 price uses it.
async function refreshUsdRate(force) {
  const cfg = await getNumberServerConfig();
  if (!force && !cfg.autoRateEnabled) return { skipped: true, reason: 'Auto rate update is switched off' };
  try {
    const { rate, source } = await fetchLiveUsdNgnRate();
    const margin = Number(cfg.autoRateMarginPercent) || 0;
    const withMargin = Math.round(rate * (1 + margin / 100));
    const floor = Number(cfg.autoRateMinRate) || 0;
    const ceil = Number(cfg.autoRateMaxRate) || Infinity;
    if (withMargin < floor || withMargin > ceil) {
      throw new Error(`Live rate ₦${withMargin} is outside your safety range (₦${floor}–₦${ceil}) — rate left unchanged`);
    }
    const previous = cfg.usdToNgn;
    cfg.usdToNgn = withMargin;
    cfg.lastAutoRate = rate;
    cfg.lastAutoRateAt = new Date();
    cfg.lastAutoRateSource = source;
    cfg.lastAutoRateError = '';
    cfg.updatedAt = new Date();
    await cfg.save();
    console.log(`[usd-rate] ${source}: $1 = ₦${rate} → using ₦${withMargin} (+${margin}%), was ₦${previous}`);
    return { updated: true, liveRate: rate, appliedRate: withMargin, previousRate: previous, source, marginPercent: margin };
  } catch (e) {
    cfg.lastAutoRateError = String(e.message || e).slice(0, 300);
    await cfg.save().catch(() => {});
    // A stale rate is a money-losing risk, so this is worth a banner + email too.
    raiseNumbersAlert({
      type: 'rate',
      severity: 'warning',
      title: 'Dollar rate auto-update failed',
      message: `Could not refresh the live USD→₦ rate: ${e.message}. Server 2 is still pricing with ₦${cfg.usdToNgn} per $1 — check it manually so you do not sell below cost.`
    });
    return { updated: false, error: e.message };
  }
}

// ── Admin warning banner state (Gizzle balance / rate problems) ─────────────
// Kept in memory for the banner and mirrored into SystemError + email once per
// cooldown window so a broken provider cannot spam the owner's inbox.
const numbersAlerts = new Map();          // type -> alert object
// Alert the admin at most once per day while a number provider stays low.
const ALERT_EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const _alertEmailSentAt = new Map();
// The cooldown is also stored in MongoDB so a server restart cannot turn the
// "once a day" promise into "once per restart".
const adminAlertLogSchema = new mongoose.Schema({
 type: { type: String, required: true, unique: true },
 lastSentAt: { type: Date, default: null },
 lastTitle: { type: String, default: '' }
});
const AdminAlertLog = mongoose.models.AdminAlertLog || mongoose.model('AdminAlertLog', adminAlertLogSchema);


function raiseNumbersAlert(alert) {
  const existing = numbersAlerts.get(alert.type);
  const record = {
    type: alert.type,
    severity: alert.severity || 'warning',
    title: alert.title,
    message: alert.message,
    raisedAt: existing?.raisedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  numbersAlerts.set(alert.type, record);
  SystemError.create({
    source: 'numbers-alert',
    message: `${alert.title}: ${alert.message}`.slice(0, 500),
    detail: alert.type
  }).catch(() => {});
  notifyAdminOfAlert(record).catch(() => {});
  return record;
}

function clearNumbersAlert(type) {
  numbersAlerts.delete(type);
  _alertEmailSentAt.delete(type);
  AdminAlertLog.deleteOne({ type }).catch(() => {});
}

/** True when this alert type was already sent inside the last 24 hours. */
async function alertRecentlySent(type) {
  if (Date.now() - (_alertEmailSentAt.get(type) || 0) < ALERT_EMAIL_COOLDOWN_MS) return true;
  try {
    const row = await AdminAlertLog.findOne({ type }).lean();
    const last = row && row.lastSentAt ? new Date(row.lastSentAt).getTime() : 0;
    if (Date.now() - last < ALERT_EMAIL_COOLDOWN_MS) { _alertEmailSentAt.set(type, last); return true; }
  } catch { /* database hiccup — fall back to the in-memory window */ }
  return false;
}

async function notifyAdminOfAlert(alert) {
  const cfg = await getNumberServerConfig().catch(() => null);
  if (!cfg || !cfg.balanceAlertsEnabled) return;
  if (await alertRecentlySent(alert.type)) return;
  _alertEmailSentAt.set(alert.type, Date.now());
  await AdminAlertLog.updateOne(
    { type: alert.type },
    { $set: { lastSentAt: new Date(), lastTitle: alert.title } },
    { upsert: true }
  ).catch(() => {});
  const result = await sendAdminEmail(
    cfg.balanceAlertEmail,
    `[KLS Alert] ${alert.title}`,
    `${alert.message}\n\nRaised: ${new Date(alert.raisedAt).toLocaleString()}\nOpen the admin panel → BuyNumber 2 tab to fix this.`
  );
  if (!result.sent) console.warn('[alert-email] not sent:', result.reason);
}


// ── Gizzle (Grizzly) balance monitor ────────────────────────────────────────
async function checkGrizzlyBalanceAndAlert() {
  const cfg = await getNumberServerConfig();
  try {
    const raw = await grizzlyRequest('getBalance');
    const text = String(raw || '');
    if (!text.startsWith('ACCESS_BALANCE')) throw new Error(text || 'Unexpected reply from Gizzle SMS');
    const balance = Number(text.split(':')[1] || 0);
    cfg.lastBalanceUsd = balance;
    cfg.lastBalanceAt = new Date();
    cfg.lastBalanceError = '';
    await cfg.save();
    clearNumbersAlert('balance-error');
    const threshold = Number(cfg.lowBalanceThresholdUsd) || 0;
    if (threshold > 0 && balance < threshold) {
      raiseNumbersAlert({
        type: 'balance-low',
        severity: 'danger',
        title: 'Gizzle SMS balance is low',
        message: `Gizzle SMS balance is $${balance.toFixed(2)} (≈₦${Math.round(balance * (cfg.usdToNgn || 0)).toLocaleString('en-NG')}), below your $${threshold} warning level. Top up now or Server 2 purchases will start failing.`
      });
    } else {
      clearNumbersAlert('balance-low');
    }
    return { balance, threshold, balanceNgn: Math.round(balance * (cfg.usdToNgn || 0)) };
  } catch (e) {
    cfg.lastBalanceError = String(e.message || e).slice(0, 300);
    cfg.lastBalanceAt = new Date();
    await cfg.save().catch(() => {});
    raiseNumbersAlert({
      type: 'balance-error',
      severity: 'danger',
      title: 'Gizzle SMS balance check failed',
      message: `The Gizzle SMS (Grizzly) API did not answer the balance check: ${e.message}. Server 2 may be unable to sell numbers right now.`
    });
    throw e;
  }
}

// Boot both background jobs once the process is up (delayed so Mongo is connected).
setTimeout(() => {
  refreshUsdRate(false).catch(() => {});
  checkGrizzlyBalanceAndAlert().catch(() => {});
  setInterval(async () => {
    const cfg = await getNumberServerConfig().catch(() => null);
    if (!cfg) return;
    const rateDue = !cfg.lastAutoRateAt ||
      Date.now() - new Date(cfg.lastAutoRateAt).getTime() >= (Number(cfg.autoRateIntervalHours) || 6) * 3600e3;
    if (cfg.autoRateEnabled && rateDue) refreshUsdRate(false).catch(() => {});
    const balDue = !cfg.lastBalanceAt ||
      Date.now() - new Date(cfg.lastBalanceAt).getTime() >= (Number(cfg.balanceCheckIntervalMinutes) || 15) * 60e3;
    if (balDue) checkGrizzlyBalanceAndAlert().catch(() => {});
  }, 5 * 60 * 1000);
}, 20000);

// Turns Grizzly's USD cost into the ₦ price a customer pays, using the profit ladder.
// Example with defaults (rate 1650): $0.88 -> ₦1452 cost -> +₦700 -> ₦2150.
function applyNumberMarkup(costNgn, cfg) {
  const tiers = (cfg.markupTiers || []).slice().sort((a, b) => a.upTo - b.upTo);
  let profit = null;
  for (const t of tiers) {
    if (costNgn <= t.upTo) { profit = t.profit; break; }
  }
  if (profit === null) profit = Math.round(costNgn * (Number(cfg.highCostMarkupPercent) || 0) / 100);
  const raw = costNgn + profit;
  const step = Number(cfg.roundTo) || 1;
  return Math.ceil(raw / step) * step;
}

function grizzlyPriceNgn(costUsd, cfg) {
  const costNgn = Number(costUsd || 0) * (Number(cfg.usdToNgn) || 0);
  return { costNgn: Math.round(costNgn), price: applyNumberMarkup(Math.round(costNgn), cfg) };
}

// ── Emoji helpers so the buy page reads like an app, not a database dump ──────
const isoCountries = require('i18n-iso-countries');
isoCountries.registerLocale(require('i18n-iso-countries/langs/en.json'));
// Grizzly's English country names that ISO lookup can't resolve on its own.
const COUNTRY_ALIASES = {
  'england': 'GB', 'uk': 'GB', 'great britain': 'GB', 'usa': 'US', 'united states': 'US',
  'laos': 'LA', 'macau': 'MO', 'macao': 'MO', 'hong kong': 'HK', 'south korea': 'KR',
  'north korea': 'KP', 'russia': 'RU', 'moldova': 'MD', 'bolivia': 'BO', 'venezuela': 'VE',
  'tanzania': 'TZ', 'syria': 'SY', 'vietnam': 'VN', 'iran': 'IR', 'ivory coast': 'CI',
  'dr congo': 'CD', 'congo': 'CG', 'palestine': 'PS', 'brunei': 'BN', 'cape verde': 'CV',
  'east timor': 'TL', 'swaziland': 'SZ', 'czech republic': 'CZ', 'taiwan': 'TW',
  'bosnia and herzegovina': 'BA', 'saint kitts and nevis': 'KN', 'saint lucia': 'LC',
  'united arab emirates': 'AE', 'dominican republic': 'DO', 'papua new guinea': 'PG'
};
function countryFlag(name) {
  const clean = String(name || '').trim();
  if (!clean) return '🌍';
  const code = COUNTRY_ALIASES[clean.toLowerCase()] || isoCountries.getAlpha2Code(clean, 'en');
  if (!code || code.length !== 2) return '🌍';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Hand-picked icons for the services people actually search for; everything else
// falls back to a sensible category guess so no row ever looks broken.
const SERVICE_EMOJI = {
  wa: '💬', bye: '💼', tg: '✈️', vi: '🟣', wb: '💬', go: '🔎', gp: '🔎', ig: '📸', fb: '👍',
  lf: '🎵', tw: '🐦', ds: '🎮', ot: '📱', ub: '🚗', mm: '🧡', am: '📦', ts: '🎬', ki: '🎤',
  ma: '🍏', mt: '🪟', dr: '🚕', we: '💚', ya: '🚕', qq: '🐧', nf: '🎬', sn: '👻', li: '🔗',
  ss: '🛍️', tn: '❤️', bd: '💘', re: '🤖', ew: '🛒', dh: '🏨', ab: '🏠', pp: '💳', st: '🎧',
  ig4: '📸', bz: '💰', bnb: '💰', cb: '🪙', ok: '🪙', vk: '🔵', ok2: '🟠', pm: '💵', fu: '🍔',
  jl: '🛒', sh: '🛒', al: '🛒', wx: '💚', im: '💬', sg: '📨', tk: '🎵', yl: '📺', zoo: '🐾'
};
const SERVICE_KEYWORD_EMOJI = [
  [/whats\s*app/i, '💬'], [/telegram/i, '✈️'], [/viber/i, '🟣'], [/signal/i, '📨'],
  [/google|gmail/i, '🔎'], [/instagram/i, '📸'], [/facebook|meta/i, '👍'], [/tiktok/i, '🎵'],
  [/twitter|^x$/i, '🐦'], [/discord/i, '🎮'], [/snapchat/i, '👻'], [/linkedin/i, '🔗'],
  [/apple|icloud/i, '🍏'], [/microsoft|outlook|hotmail/i, '🪟'], [/amazon/i, '📦'],
  [/paypal|payoneer|wise|revolut|stripe|pay\b/i, '💳'], [/bank|credit|loan|finance|capital/i, '🏦'],
  [/binance|coin|crypto|bitcoin|wallet|okx|bybit|kraken/i, '🪙'], [/uber|bolt|taxi|lyft|grab/i, '🚗'],
  [/netflix|hulu|disney|cinema|movie|tv\b/i, '🎬'], [/spotify|music|audio|deezer/i, '🎧'],
  [/tinder|badoo|dating|match|bumble|love/i, '❤️'], [/game|poker|casino|bet|slot|play/i, '🎮'],
  [/food|pizza|eat|delivery|restaurant|burger/i, '🍔'], [/shop|store|mall|market|buy|cart|commerce/i, '🛒'],
  [/hotel|travel|airline|air\b|booking|trip|flight/i, '✈️'], [/mail|email|inbox/i, '📧'],
  [/health|clinic|pharma|med|doctor|hospital/i, '🏥'], [/edu|school|learn|course|university|student/i, '🎓'],
  [/sport|fit|gym|run|football|soccer/i, '⚽'], [/car|auto|drive|motor/i, '🚙'],
  [/cloud|host|server|vpn|proxy/i, '☁️'], [/news|media|press|magazine/i, '📰'],
  [/gov|tax|id\b|passport|visa/i, '🏛️'], [/telecom|mobile|sim|operator|carrier/i, '📶']
];
// Real app logos (not emoji) served from the simple-icons CDN. Falls back to a
// generic SIM icon when a service has no known brand mark.
const SERVICE_ICON_SLUGS = {
  wa: 'whatsapp', bye: 'whatsapp', wb: 'whatsapp', tg: 'telegram', vi: 'viber', sg: 'signal',
  go: 'google', gp: 'google', gm: 'gmail', ig: 'instagram', ig4: 'instagram', fb: 'facebook',
  tw: 'x', tk: 'tiktok', ds: 'discord', sn: 'snapchat', li: 'linkedin', ma: 'apple',
  mt: 'microsoftoutlook', am: 'amazon', pp: 'paypal', nf: 'netflix', st: 'spotify',
  tn: 'tinder', ub: 'uber', we: 'wechat', wx: 'wechat', vk: 'vk', ok: 'odnoklassniki',
  qq: 'tencentqq', ya: 'yandex', bz: 'binance', bnb: 'binance', cb: 'coinbase',
  ts: 'twitch', yl: 'youtube', al: 'alibabadotcom', jl: 'shopee', sh: 'shopee',
  ki: 'kakaotalk', im: 'imgur', ab: 'airbnb', dh: 'booking', dr: 'lyft', mm: 'microsoft',
  re: 'reddit', ew: 'ebay', ss: 'shopify', lf: 'tiktok', ot: 'simpleanalytics'
};
const SERVICE_ICON_KEYWORDS = [
  [/whats\s*app/i, 'whatsapp'], [/telegram/i, 'telegram'], [/viber/i, 'viber'], [/signal/i, 'signal'],
  [/gmail/i, 'gmail'], [/google/i, 'google'], [/instagram/i, 'instagram'], [/facebook|meta/i, 'facebook'],
  [/tiktok/i, 'tiktok'], [/twitter|^x$/i, 'x'], [/discord/i, 'discord'], [/snapchat/i, 'snapchat'],
  [/linkedin/i, 'linkedin'], [/apple|icloud/i, 'apple'], [/outlook|hotmail/i, 'microsoftoutlook'],
  [/microsoft|azure/i, 'microsoft'], [/amazon/i, 'amazon'], [/paypal/i, 'paypal'], [/payoneer/i, 'payoneer'],
  [/wise/i, 'wise'], [/revolut/i, 'revolut'], [/stripe/i, 'stripe'], [/skrill/i, 'skrill'],
  [/binance/i, 'binance'], [/coinbase/i, 'coinbase'], [/okx/i, 'okx'], [/bybit/i, 'bybit'],
  [/kraken/i, 'kraken'], [/blockchain|bitcoin|crypto/i, 'bitcoin'], [/netflix/i, 'netflix'],
  [/spotify/i, 'spotify'], [/deezer/i, 'deezer'], [/youtube/i, 'youtube'], [/twitch/i, 'twitch'],
  [/disney/i, 'disneyplus'], [/hulu/i, 'hulu'], [/tinder/i, 'tinder'], [/badoo/i, 'badoo'],
  [/bumble/i, 'bumble'], [/uber\s*eats/i, 'ubereats'], [/uber/i, 'uber'], [/bolt/i, 'bolt'],
  [/lyft/i, 'lyft'], [/grab/i, 'grab'], [/doordash/i, 'doordash'], [/deliveroo/i, 'deliveroo'],
  [/glovo/i, 'glovo'], [/wechat|weixin/i, 'wechat'], [/^vk|vkontakte/i, 'vk'], [/yandex/i, 'yandex'],
  [/mail\.?ru/i, 'maildotru'], [/proton/i, 'protonmail'], [/yahoo/i, 'yahoo'], [/zoom/i, 'zoom'],
  [/skype/i, 'skype'], [/line\b/i, 'line'], [/kakao/i, 'kakaotalk'], [/reddit/i, 'reddit'],
  [/pinterest/i, 'pinterest'], [/tumblr/i, 'tumblr'], [/quora/i, 'quora'], [/github/i, 'github'],
  [/gitlab/i, 'gitlab'], [/dropbox/i, 'dropbox'], [/steam/i, 'steam'], [/epic\s*games/i, 'epicgames'],
  [/playstation/i, 'playstation'], [/xbox/i, 'xbox'], [/roblox/i, 'roblox'], [/ebay/i, 'ebay'],
  [/aliexpress/i, 'aliexpress'], [/alibaba/i, 'alibabadotcom'], [/shopee/i, 'shopee'],
  [/lazada/i, 'lazada'], [/flipkart/i, 'flipkart'], [/olx/i, 'olx'], [/shopify/i, 'shopify'],
  [/airbnb/i, 'airbnb'], [/booking/i, 'bookingdotcom'], [/upwork/i, 'upwork'], [/fiverr/i, 'fiverr'],
  [/truecaller/i, 'truecaller'], [/imo\b/i, 'imou'], [/naver/i, 'naver'], [/nike/i, 'nike'],
  [/adidas/i, 'adidas'], [/walmart/i, 'walmart'], [/starbucks/i, 'starbucks'], [/mcdonald/i, 'mcdonalds'],
  [/kfc/i, 'kfc'], [/bet|casino|poker|slot/i, 'pokerstars'], [/vpn|proxy/i, 'nordvpn'],
  [/telecom|mobile|sim|carrier/i, 'simpleicons']
];
function serviceIconUrl(code, name) {
  const slug = SERVICE_ICON_SLUGS[String(code || '').toLowerCase()] ||
    (SERVICE_ICON_KEYWORDS.find(([re]) => re.test(String(name || '')))?.[1]);
  return slug ? `https://cdn.simpleicons.org/${slug}` : '';
}
function serviceEmoji(code, name) {
  if (SERVICE_EMOJI[String(code || '').toLowerCase()]) return SERVICE_EMOJI[String(code).toLowerCase()];
  for (const [re, emoji] of SERVICE_KEYWORD_EMOJI) if (re.test(String(name || ''))) return emoji;
  return '📱';
}
// Shown pinned at the top of the picker so the popular ones are never buried in 2,400 rows.
const POPULAR_SERVICE_CODES = ['wa', 'bye', 'tg', 'go', 'ig', 'fb', 'tw', 'ds', 'tk', 'ma', 'mt', 'am', 'ub', 'nf', 'sn', 'li', 'pp', 'we', 'vi'];



const KNOWN_SERVICE_NAMES = {
 whatsapp: 'WhatsApp', telegram: 'Telegram', google: 'Google', gmail: 'Gmail', facebook: 'Facebook',
 instagram: 'Instagram', tiktok: 'TikTok', twitter: 'Twitter/X', x: 'Twitter/X', discord: 'Discord',
 snapchat: 'Snapchat', linkedin: 'LinkedIn', microsoft: 'Microsoft', apple: 'Apple', amazon: 'Amazon',
 paypal: 'PayPal', uber: 'Uber', netflix: 'Netflix', spotify: 'Spotify', tinder: 'Tinder',
 yahoo: 'Yahoo', ebay: 'eBay', airbnb: 'Airbnb', viber: 'Viber', line: 'LINE', wechat: 'WeChat'
};
function prettifyServiceName(raw) {
 const key = String(raw || '').trim().toLowerCase();
 if (KNOWN_SERVICE_NAMES[key]) return KNOWN_SERVICE_NAMES[key];
 return String(raw || '').replace(/\b\w/g, c => c.toUpperCase());
}
const badgeSchema = new mongoose.Schema({
 name: { type: String, required: true, trim: true },
 icon: { type: String, default: '' }, // emoji shown next to the user's name
 description: { type: String, default: '' },
 criteriaType: { type: String, enum: ['manual', 'total_spent', 'referral_count', 'games_played', 'purchase_count'], default: 'manual' },
 criteriaValue: { type: Number, default: 0 }, // threshold for the criteria type (ignored for 'manual')
 enabled: { type: Boolean, default: true },
 createdAt: { type: Date, default: Date.now }
});
const Badge = mongoose.model('Badge', badgeSchema);
const userBadgeSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 badgeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Badge', required: true },
 awardedAt: { type: Date, default: Date.now }
});
userBadgeSchema.index({ userId: 1, badgeId: 1 }, { unique: true });
const UserBadge = mongoose.model('UserBadge', userBadgeSchema);
async function checkAndAwardBadges(userId) {
 try {
 const rules = await Badge.find({ enabled: true, criteriaType: { $ne: 'manual' } });
 if (!rules.length) return;
 for (const rule of rules) {
 let qualifies = false;
 if (rule.criteriaType === 'total_spent') {
 const agg = await Transaction.aggregate([{ $match: { userId: new mongoose.Types.ObjectId(userId), type: 'purchase', status: 'success' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
 qualifies = (agg[0]?.total || 0) >= rule.criteriaValue;
 } else if (rule.criteriaType === 'purchase_count') {
 const count = await Transaction.countDocuments({ userId, type: 'purchase', status: 'success' });
 qualifies = count >= rule.criteriaValue;
 } else if (rule.criteriaType === 'referral_count') {
 const count = await User.countDocuments({ referredBy: userId });
 qualifies = count >= rule.criteriaValue;
 } else if (rule.criteriaType === 'games_played') {
 const count = await GameScore.countDocuments({ userId });
 qualifies = count >= rule.criteriaValue;
 }
 if (qualifies) {
 await UserBadge.findOneAndUpdate({ userId, badgeId: rule._id }, { userId, badgeId: rule._id }, { upsert: true });
 }
 }
 } catch (e) { console.error('Badge check failed:', e.message); }
}
const restockRequestSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 userName: { type: String, default: '' },
 logId: { type: mongoose.Schema.Types.ObjectId, ref: 'Log', required: true, index: true },
 logTitle: { type: String, default: '' },
 createdAt: { type: Date, default: Date.now }
});
restockRequestSchema.index({ userId: 1, logId: 1 }, { unique: true });
const RestockRequest = mongoose.model('RestockRequest', restockRequestSchema);
async function getSiteLinks() {
 let doc = await SiteLinks.findById('main');
 if (!doc) doc = await SiteLinks.create({ _id: 'main', whatsappNumber: '2349065518402', adminPhone: '2349065518402' });
 return doc;
}
const SOLD_SUBACCOUNT_VISIBLE_MS = 24 * 60 * 60 * 1000; // 24 hours
function stripStaleSoldSubAccounts(subAccounts) {
 const cutoff = Date.now() - SOLD_SUBACCOUNT_VISIBLE_MS;
 return (subAccounts || []).filter(sa => !sa.sold || !sa.soldAt || new Date(sa.soldAt).getTime() >= cutoff);
}
const adSchema = new mongoose.Schema({
 title: { type: String, default: '' },
 imageUrl: String,
 link: { type: String, required: true },
 active: { type: Boolean, default: true },
 createdAt: { type: Date, default: Date.now }
});
const giveawaySchema = new mongoose.Schema({
 title: { type: String, required: true },
 description: { type: String, default: '' },
 category: { type: String, default: '' }, // e.g. "Gmail", "Netflix" — cosmetic label only
 credentials: { type: String, required: true }, // the actual login/password revealed to the winner
 imageUrl: { type: String, default: '' },
 startsAt: { type: Date, default: Date.now }, // claiming is blocked server-side until this time
 status: { type: String, enum: ['active', 'claimed'], default: 'active' },
 winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 winnerName: { type: String, default: '' },
 winnerProfilePicture: { type: String, default: '' },
 claimedAt: { type: Date },
 createdAt: { type: Date, default: Date.now }
});
const systemErrorSchema = new mongoose.Schema({
 source: { type: String, required: true }, // e.g. 'ultramsg'
 message: { type: String, required: true },
 detail: { type: String, default: '' },
 context: { type: mongoose.Schema.Types.Mixed },
 resolved: { type: Boolean, default: false },
 createdAt: { type: Date, default: Date.now }
});
const adminAccountSchema = new mongoose.Schema({
 name: { type: String, required: true, trim: true },
 email: { type: String, required: true, unique: true, lowercase: true },
 password: { type: String, required: true },
 role: { type: String, enum: ['support'], default: 'support' }, // scoped role: receipts + support only
 active: { type: Boolean, default: true },
 // ── Per-admin delivery-alert notification preferences ──────────────────────
 // Each admin decides whether they get emailed about email-delivery problems
 // and which severities are worth waking them up for.
 alertEmailEnabled: { type: Boolean, default: true },
 alertSeverities: { type: [String], default: ['warning', 'critical'] },
 createdAt: { type: Date, default: Date.now },
 lastLoginAt: { type: Date }
});
const chatGroupSchema = new mongoose.Schema({
 name: { type: String, required: true, trim: true },
 description: { type: String, default: '' },
 active: { type: Boolean, default: true },
 createdAt: { type: Date, default: Date.now }
});
const chatMessageSchema = new mongoose.Schema({
 groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 userName: String,
 text: { type: String, maxlength: 1000, default: '' },
 attachmentUrl: { type: String, default: '' },
 attachmentType: { type: String, enum: ['', 'image', 'video', 'file'], default: '' },
 attachmentName: { type: String, default: '' },
 deleted: { type: Boolean, default: false },
 createdAt: { type: Date, default: Date.now }
});
const conversationSchema = new mongoose.Schema({
 participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }],
 lastMessageText: { type: String, default: '' },
 lastMessageAt: { type: Date, default: Date.now },
 createdAt: { type: Date, default: Date.now }
});
const directMessageSchema = new mongoose.Schema({
 conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
 senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 senderName: String,
 text: { type: String, maxlength: 1000, default: '' },
 attachmentUrl: { type: String, default: '' },
 attachmentType: { type: String, default: '' }, // 'image' | 'video' | 'audio' | 'file'
 attachmentName: { type: String, default: '' },
 readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
 deleted: { type: Boolean, default: false },
 createdAt: { type: Date, default: Date.now }
});
const gameScoreSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 gameId: { type: String, required: true }, // permanent user-facing Game ID at time of play
 game: { type: String, required: true, enum: ['space-shooter', 'turbo-run', 'base-defense'] },
 mode: { type: String, enum: ['bot', 'battle'], default: 'bot' },
 battleCode: { type: String, default: '' }, // shared code both players enter for a score-battle
 score: { type: Number, required: true },
 createdAt: { type: Date, default: Date.now }
});
const Category = mongoose.model('Category', categorySchema);
const User = mongoose.model('User', userSchema);
const Log = mongoose.model('Log', logSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const referralEarningSchema = new mongoose.Schema({
 referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
 purchaseAmount: { type: Number, required: true },
 commission: { type: Number, required: true },
 itemLabel: { type: String, default: '' },
 createdAt: { type: Date, default: Date.now }
});
const ReferralEarning = mongoose.model('ReferralEarning', referralEarningSchema);
const Receipt = mongoose.model('Receipt', receiptSchema);
const Support = mongoose.model('Support', supportSchema);
const VisitorStats = mongoose.model('VisitorStats', visitorStatsSchema);
const VisitorLog = mongoose.model('VisitorLog', visitorLogSchema);
const Ad = mongoose.model('Ad', adSchema);
const Giveaway = mongoose.model('Giveaway', giveawaySchema);
const weeklyRewardSchema = new mongoose.Schema({
 weekKey: { type: String, required: true, unique: true },
 winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 winnerName: { type: String, default: '' },
 purchaseCount: { type: Number, default: 0 },
 amount: { type: Number, default: 50 },
 paidAt: { type: Date, default: Date.now }
});
const WeeklyReward = mongoose.model('WeeklyReward', weeklyRewardSchema);
const SystemError = mongoose.model('SystemError', systemErrorSchema);
app.post('/api/client-error-log', async (req, res) => {
 try {
 const { message, url, status, contentType, connectionType, downlinkMbps, userAgent } = req.body || {};
 if (!message || typeof message !== 'string' || message.length > 500) return res.status(400).end();
 await SystemError.create({
 source: 'client',
 message: String(message).slice(0, 500),
 detail: `URL: ${String(url || '').slice(0, 300)} | HTTP status: ${status ?? 'none (network-level failure)'} | Content-Type: ${contentType || 'n/a'} | Connection: ${connectionType || 'unknown'} (${downlinkMbps ?? '?'} Mbps est.) | UA: ${String(userAgent || '').slice(0, 300)}`,
 context: { url, status, contentType, connectionType, downlinkMbps }
 });
 res.status(204).end();
 } catch (e) { res.status(204).end(); } // never let logging itself surface an error to the user
});
const ChatGroup = mongoose.model('ChatGroup', chatGroupSchema);
const AdminAccount = mongoose.model('AdminAccount', adminAccountSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const DirectMessage = mongoose.model('DirectMessage', directMessageSchema);
const GameScore = mongoose.model('GameScore', gameScoreSchema);

// ── ANNOUNCEMENTS (admin "Notifications bar") ────────────────────────────────
// An announcement is a broadcast the owner posts from the admin panel. Every user
// sees it once as a popup with three actions: "Don't show again" (never shown to
// that user again), "Cancel" (close for now, shown again next session) and
// "Read more" (opens the admin-provided link, or the in-app notifications page
// when no link was set).
//
// Per-user state lives in its own collection keyed by (announcementId, userId),
// so "don't show again" and the read/unread styling survive logout, cache
// clearing and new devices — it is never kept in localStorage alone.
const announcementSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true },
  link: { type: String, default: '' },          // optional "Read more" destination
  linkLabel: { type: String, default: '' },
  image: { type: String, default: '' },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Log', default: null },
  level: { type: String, enum: ['info', 'success', 'warning', 'urgent'], default: 'info' },
  active: { type: Boolean, default: true },
  pinned: { type: Boolean, default: false },
  createdBy: { type: String, default: 'admin' },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });
const Announcement = mongoose.model('Announcement', announcementSchema);

const announcementStateSchema = new mongoose.Schema({
  announcementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  readAt: { type: Date, default: null },
  dismissedAt: { type: Date, default: null },   // set by "Don't show again"
  viewedAt: { type: Date, default: null },      // first time this user actually saw the popup
  views: { type: Number, default: 0 },          // how many times it was shown to this user
  clickedAt: { type: Date, default: null },     // pressed "Read more"
  clicks: { type: Number, default: 0 },
}, { timestamps: true });
announcementStateSchema.index({ announcementId: 1, userId: 1 }, { unique: true });
const AnnouncementState = mongoose.model('AnnouncementState', announcementStateSchema);

/** Announcements that are live right now (active and not expired). */
const liveAnnouncementFilter = () => ({
  active: true,
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});

let klsCampaigns = null; // set when lib/campaigns.js is mounted at the bottom of this file
// Set once lib/engagement.js is mounted at the bottom of this file. It owns the
// device/session records, so tokens issued before it existed keep working.
let klsEngagement = null;
/**
 * Mark a user as active right now (throttled to one write every 2 minutes).
 * Called from every authenticated path — token auth, optional auth, API keys
 * and the heartbeat — so the admin "Online now" list shows old accounts too,
 * not only the ones that happened to hit a token-protected endpoint.
 */
function touchActivity(user) {
 if (!user?._id) return;
 const last = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
 if (Date.now() - last <= 2 * 60 * 1000) return;
 user.lastActiveAt = new Date();
 User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date(), lastSeen: new Date() } })
 .catch(e => console.error('[KLS] touchActivity failed:', e.message));
}
const auth = async (req, res, next) => {
  let decoded;
  const token = req.headers.authorization?.split(' ')[1];
  if (!token || token === 'null' || token === 'undefined') return res.status(401).json({ error: 'Please log in again.', sessionEnded: true });
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
  catch (e) { return res.status(401).json({ error: 'Your session expired — please log in again.', sessionEnded: true }); }
  try {
  // Sliding session: anyone active keeps getting a fresh token, so it never silently expires mid-use.
  if (decoded.exp && decoded.exp * 1000 - Date.now() < 6 * 24 * 60 * 60 * 1000) {
    const fresh = { id: decoded.id }; if (decoded.sid) fresh.sid = decoded.sid;
    res.setHeader('X-Refresh-Token', jwt.sign(fresh, process.env.JWT_SECRET, { expiresIn: '30d' }));
    res.setHeader('Access-Control-Expose-Headers', 'X-Refresh-Token');
  }
  req.user = await User.findById(decoded.id).select('-password');
  if (!req.user) return res.status(401).json({ error: 'User not found' });
  if (req.user.restricted) return res.status(403).json({ error: 'Your account has been restricted. Contact support for help.', restricted: true });
  // This device may have been signed out from another device's Settings page.
  if (klsEngagement && decoded.sid && !(await klsEngagement.touchSession(decoded.sid, req.user._id))) {
    return res.status(401).json({ error: 'This device was signed out. Please log in again.', sessionEnded: true });
  }
 if (!req.user.gameId) {
 req.user.gameId = await generateUniqueGameId();
 await req.user.save();
 }
 if (!req.user.referralCode) {
 req.user.referralCode = await generateUniqueReferralCode();
 await req.user.save();
 }
 touchActivity(req.user);
 } catch (e) {
 console.error('[auth] lookup failed (not a token problem):', e.message);
 return res.status(503).json({ error: 'Temporary server hiccup — please try again in a moment.' });
 }
 next();
};
const optionalAuth = async (req, res, next) => {
 try {
 const token = req.headers.authorization?.split(' ')[1];
 if (!token) return next();
 const decoded = jwt.verify(token, process.env.JWT_SECRET);
 const user = await User.findById(decoded.id).select('-password');
 if (user && !user.restricted) { req.user = user; touchActivity(user); }
 } catch { /* an invalid/expired token just means "not logged in" here, not an error */ }
 next();
};
const apiKeyAuth = async (req, res, next) => {
 try {
 const key = req.headers['x-api-key'];
 const secret = req.headers['x-api-secret'];
 if (!key || !secret) return res.status(401).json({ error: 'Missing X-API-Key or X-API-Secret header' });
 const user = await User.findOne({ apiKey: key, apiEnabled: true }).select('-password');
 if (!user || user.apiSecret !== secret) return res.status(401).json({ error: 'Invalid API key or secret' });
 if (user.restricted) return res.status(403).json({ error: 'This account has been restricted', restricted: true });
 user.apiLastUsedAt = new Date();
 await user.save();
 req.apiUser = user;
 next();
 } catch (e) { res.status(500).json({ error: 'API auth error' }); }
};
const adminAuth = (req, res, next) => {
 const p = req.headers['x-admin-passcode'];
 if (!p || p !== process.env.ADMIN_PASSCODE) return res.status(403).json({ error: 'Access denied' });
 req.adminRole = 'super';
 next();
};
const subAdminAuth = async (req, res, next) => {
 try {
 const token = req.headers.authorization?.split(' ')[1];
 if (!token) return res.status(401).json({ error: 'No token' });
 const decoded = jwt.verify(token, process.env.JWT_SECRET + '_subadmin');
 const account = await AdminAccount.findById(decoded.id).select('-password');
 if (!account || !account.active) return res.status(403).json({ error: 'Access denied' });
 req.subAdmin = account;
 req.adminRole = account.role;
 next();
 } catch { res.status(401).json({ error: 'Invalid or expired session' }); }
};
const anyAdminAuth = async (req, res, next) => {
 const p = req.headers['x-admin-passcode'];
 if (p && p === process.env.ADMIN_PASSCODE) { req.adminRole = 'super'; return next(); }
 return subAdminAuth(req, res, next);
};
// Marketplace 2 (RakibSocials API) + marketplace on/off switches — see lib/market2.js
require('./lib/market2').register(app, { mongoose, User, Transaction, auth, anyAdminAuth, sendAdminEmail });
require('./lib/boost2')({ app, mongoose, User, Transaction, auth, anyAdminAuth, novaGate });
function sanitizeUser(u) {
 return {
 id: u._id, name: u.name, email: u.email, balance: u.balance || 0,
 restricted: !!u.restricted, gameId: u.gameId || '', createdAt: u.createdAt,
 profilePicture: u.profilePicture || '', authProvider: u.authProvider || 'local',
 referralCode: u.referralCode || '', contactPhone: u.contactPhone || '',
 country: u.country || '', language: u.language || 'en', displayCurrency: u.displayCurrency || '',
 virtualAccount: u.virtualAccount || { enabled: false, accountNumber: '', bankName: '', accountName: '', flwRef: '' }
 };
}
function generateFileFingerprint(filePath) {
 try {
 const buffer = fs.readFileSync(filePath);
 return crypto.createHash('sha256').update(buffer).digest('hex');
 } catch (e) {
 console.error('Fingerprint error:', e.message);
 return null;
 }
}
const { createWorker } = require('tesseract.js');
async function analyzeReceiptWithAI(imagePath, claimedAmount, claimedBank, claimedAccountName) {
 const flags = [];
 const extracted = {};
 let confidence = 60; // start neutral
 try {
 console.log(' Running OCR on receipt...');
 const worker = await createWorker('eng');
 const { data: { text } } = await worker.recognize(imagePath);
 await worker.terminate();
 const raw = text || '';
 const upper = raw.toUpperCase();
 console.log('OCR text:', raw.substring(0, 300));
 const fakeAppKeywords = [
 'FAKE', 'DEMO', 'TEST TRANSFER', 'SIMULATOR', 'SAMPLE',
 'IFAKEBANKALER', 'FAKE BANK ALERT', 'NOT A REAL', 'PROOF OF PAYMENT',
 'SCREENSHOT', 'FAKEBANK', 'ALERTDEMO'
 ];
 for (const kw of fakeAppKeywords) {
 if (upper.includes(kw)) {
 flags.push(`Fake app keyword detected: "${kw}"`);
 confidence -= 40;
 }
 }
 let foundAmount = null;
 const nairaSymbolMatch = raw.match(/₦\s*([\d,]+(?:\.\d{1,2})?)/);
 if (nairaSymbolMatch) {
 foundAmount = parseFloat(nairaSymbolMatch[1].replace(/,/g, ''));
 }
 if (!foundAmount) {
 const lines = raw.split('\n');
 for (const line of lines) {
 const lu = line.toUpperCase();
 if (lu.includes('AMOUNT') || lu.includes('TOTAL') || lu.includes('NGN')) {
 const numMatch = line.match(/([\d,]+(?:\.\d{1,2})?)/);
 if (numMatch) {
 const val = parseFloat(numMatch[1].replace(/,/g, ''));
 if (!isNaN(val) && val > 0 && String(Math.floor(val)).length <= 8) {
 foundAmount = val;
 break;
 }
 }
 }
 }
 }
 if (!foundAmount) {
 const allNums = [];
 const numIter = raw.matchAll(/([\d,]+(?:\.\d{1,2})?)/g);
 for (const m of numIter) {
 const val = parseFloat(m[1].replace(/,/g, ''));
 const digits = String(Math.floor(val)).length;
 if (!isNaN(val) && val > 0 && digits <= 8 && digits >= 2) allNums.push(val);
 }
 if (allNums.length > 0) {
 foundAmount = allNums.reduce((prev, curr) =>
 Math.abs(curr - claimedAmount) < Math.abs(prev - claimedAmount) ? curr : prev
 );
 }
 }
 extracted.amount = foundAmount;
 if (extracted.amount) {
 const diff = Math.abs(extracted.amount - claimedAmount);
 const pct = diff / claimedAmount;
 if (pct < 0.01) {
 confidence += 20;
 } else if (pct < 0.05) {
 confidence += 5;
 } else {
 flags.push(`Amount mismatch: receipt shows \u20a6${extracted.amount}, user claimed \u20a6${claimedAmount}`);
 confidence -= 30;
 }
 } else {
 flags.push('Could not extract amount from receipt');
 confidence -= 10;
 }
 const refMatch = raw.match(/(?:Transaction\s*No\.?|Session\s*ID|Reference(?:\s*No\.?)?|Ref(?:\s*No\.?)?|Trans(?:action)?\s*(?:ID|Ref)|NXG|FTN|TRF|RRN)[:\s#]*([A-Z0-9]{8,})/i);
 const longDigitRef = raw.match(/\b(\d{15,})\b/); // OPay 22-digit transaction numbers
 if (refMatch) {
 extracted.reference = refMatch[1];
 confidence += 15;
 } else if (longDigitRef) {
 extracted.reference = longDigitRef[1];
 confidence += 15;
 } else {
 flags.push('No transaction reference number found');
 confidence -= 15;
 }
 const dateMatch = raw.match(/(\d{4}-\d{2}-\d{2}|\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{1,2}\s+\w+\s+\d{4})/);
 if (dateMatch) {
 extracted.date = dateMatch[1];
 const receiptDate = new Date(dateMatch[1]);
 const now = new Date();
 const diffDays = (now - receiptDate) / (1000 * 60 * 60 * 24);
 if (receiptDate > now) {
 flags.push('Receipt date is in the future');
 confidence -= 35;
 } else if (diffDays > 3) {
 flags.push(`Receipt is ${Math.floor(diffDays)} days old — may be reused`);
 confidence -= 20;
 } else {
 confidence += 10; // fresh receipt
 }
 } else {
 flags.push('No date found on receipt');
 confidence -= 10;
 }
 const timeMatch = raw.match(/\b(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\b/i);
 if (timeMatch) extracted.time = timeMatch[1];
 const fromMatch = raw.match(/(?:From|Sender|Debit Account)[:\s]+([A-Z\s]{5,40})/i);
 if (fromMatch) extracted.senderName = fromMatch[1].trim();
 if (claimedAccountName && extracted.senderName) {
 const claimedUpper = claimedAccountName.toUpperCase().trim();
 const extractedUpper = extracted.senderName.toUpperCase().trim();
 const claimedWords = claimedUpper.split(/\s+/);
 const matchCount = claimedWords.filter(w => w.length > 2 && extractedUpper.includes(w)).length;
 if (matchCount >= 1) {
 confidence += 10;
 } else {
 flags.push(`Sender name mismatch: receipt shows "${extracted.senderName}", user entered "${claimedAccountName}"`);
 confidence -= 15;
 }
 }
 const toMatch = raw.match(/(?:To|Recipient|Beneficiary|Credit Account)[:\s]+([A-Z\s]{5,40})/i);
 if (toMatch) extracted.recipientName = toMatch[1].trim();
 const acctMatch = raw.match(/\b(\d{10})\b/);
 const maskedMatch = raw.match(/\b(\d{4})[\s\-]*\*{2,6}[\s\-]*(\d{2,4})\b/);
 if (acctMatch) extracted.recipientAccount = acctMatch[1];
 else if (maskedMatch) extracted.recipientAccount = `${maskedMatch[1]}****${maskedMatch[2]}`;
 const ourAccountName = (process.env.ACCOUNT_NAME || '').toUpperCase();
 const ourAccountNumber = process.env.ACCOUNT_NUMBER || '';
 const ourBankName = (process.env.BANK_NAME || '').toUpperCase();
 if (ourAccountNumber && extracted.recipientAccount) {
 if (extracted.recipientAccount === ourAccountNumber) {
 confidence += 25; // account number matches perfectly
 } else if (/^\d{4}\*{4}\d{2,4}$/.test(extracted.recipientAccount)) {
 const [, prefix, suffix] = extracted.recipientAccount.match(/^(\d{4})\*{4}(\d{2,4})$/);
 if (ourAccountNumber.startsWith(prefix) && ourAccountNumber.endsWith(suffix)) {
 confidence += 20; // matches on visible digits of a masked account
 } else {
 flags.push(`Masked recipient account ${extracted.recipientAccount} does not match our account ${ourAccountNumber}`);
 confidence -= 35;
 }
 } else {
 flags.push(`Recipient account ${extracted.recipientAccount} does not match our account ${ourAccountNumber}`);
 confidence -= 35;
 }
 }
 if (ourAccountName && extracted.recipientName) {
 const ourWords = ourAccountName.split(/\s+/);
 const recipUpper = extracted.recipientName.toUpperCase();
 const matchCount = ourWords.filter(w => w.length > 2 && recipUpper.includes(w)).length;
 if (matchCount >= 1) {
 confidence += 10;
 } else {
 flags.push(`Recipient name "${extracted.recipientName}" does not match our account name`);
 confidence -= 20;
 }
 }
 const bankUpper = claimedBank.toUpperCase();
 if (upper.includes(bankUpper.split(' ')[0])) {
 confidence += 10; // bank name appears in receipt
 extracted.bank = claimedBank;
 } else {
 const bankAbbrevs = { 'GTB': 'GUARANTY', 'UBA': 'UNITED BANK', 'FCMB': 'FCMB', 'ZENITH': 'ZENITH', 'ACCESS': 'ACCESS', 'KUDA': 'KUDA', 'OPAY': 'OPAY', 'MONIEPOINT': 'MONIEPOINT', 'PALMPAY': 'PALMPAY' };
 let bankFound = false;
 for (const [abbr, full] of Object.entries(bankAbbrevs)) {
 if ((bankUpper.includes(abbr) || bankUpper.includes(full)) && (upper.includes(abbr) || upper.includes(full))) {
 bankFound = true;
 extracted.bank = claimedBank;
 confidence += 5;
 break;
 }
 }
 if (!bankFound) {
 flags.push(`Bank name "${claimedBank}" not found in receipt text`);
 confidence -= 10;
 }
 }
 const stats = fs.statSync(imagePath);
 const sizeKB = stats.size / 1024;
 if (sizeKB < 20) {
 flags.push('Receipt image is suspiciously small (possible fake/edited screenshot)');
 confidence -= 20;
 } else if (sizeKB > 100) {
 confidence += 5; // larger files are usually real screenshots
 }
 confidence = Math.max(0, Math.min(100, confidence));
 let verdict;
 if (flags.some(f => f.toLowerCase().includes('fake') || f.toLowerCase().includes('future') || f.toLowerCase().includes('mismatch') && confidence < 50)) {
 verdict = confidence < 40 ? 'rejected' : 'manual_review';
 } else if (confidence >= 75 && flags.length === 0) {
 verdict = 'approved';
 } else if (confidence >= 60 && flags.length <= 1) {
 verdict = 'approved';
 } else if (confidence >= 45) {
 verdict = 'manual_review';
 } else {
 verdict = 'rejected';
 }
 const reason = flags.length === 0
 ? `Receipt verified successfully (confidence: ${confidence}%)`
 : `Issues found: ${flags[0]}${flags.length > 1 ? ` (+${flags.length - 1} more)` : ''}`;
 console.log(` OCR verdict: ${verdict} (${confidence}%) — ${reason}`);
 return { verdict, confidence, reason, flags, extracted };
 } catch (e) {
 console.error('OCR verification error:', e.message);
 return { verdict: 'manual_review', confidence: 0, reason: 'OCR unavailable — queued for manual review', flags: [], extracted: {} };
 }
}
async function generateUniqueGameId() {
 for (let i = 0; i < 10; i++) {
 const code = BRAND.txPrefix + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
 if (!(await User.findOne({ gameId: code }))) return code;
 }
 return BRAND.txPrefix + '-' + Date.now().toString(36).toUpperCase();
}
async function generateUniqueReferralCode() {
 for (let i = 0; i < 10; i++) {
 const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. "9F3A21B4"
 if (!(await User.findOne({ referralCode: code }))) return code;
 }
 return crypto.randomBytes(6).toString('hex').toUpperCase();
}
const REFERRAL_COMMISSION_RATE = 0.04;
async function creditReferralCommission(buyer, purchaseAmount, itemLabel) {
 try {
 if (!buyer.referredBy || !purchaseAmount) return;
 const referrer = await User.findById(buyer.referredBy);
 if (!referrer || referrer.restricted) return; // never pay out commission to a restricted account
 const commission = Math.round(purchaseAmount * REFERRAL_COMMISSION_RATE * 100) / 100;
 if (commission <= 0) return;
 referrer.balance = (referrer.balance || 0) + commission;
 await referrer.save();
 await ReferralEarning.create({
 referrerId: referrer._id, referredUserId: buyer._id,
 purchaseAmount, commission, itemLabel
 });
 await Transaction.create({
 userId: referrer._id, type: 'referral_commission', amount: commission,
 description: `4% referral commission — ${buyer.name} purchased ${itemLabel}`,
 status: 'success'
 });
 checkAndAwardBadges(referrer._id).catch(() => {});
 } catch (e) {
 console.error('Referral commission crediting failed (purchase itself is unaffected):', e.message);
 }
}
const BLOCKED_EMAIL_DOMAINS = new Set([
 'example.com', 'example.org', 'example.net', 'test.com', 'test.org', 'sample.com', 'domain.com',
 'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', '10minutemail.com', '10minutemail.net',
 'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'getnada.com',
 'sharklasers.com', 'dispostable.com', 'fakeinbox.com', 'maildrop.cc', 'mintemail.com', 'moakt.com'
]);
function isBlockedEmailDomain(email) {
 const domain = String(email).split('@')[1]?.toLowerCase().trim();
 return domain ? BLOCKED_EMAIL_DOMAINS.has(domain) : false;
}

// ── One person, five accounts maximum ───────────────────────────────────────
// Signup IP + device (user-agent) fingerprint are both counted. Once five
// accounts exist behind the same connection/device the sixth is refused, which
// stops referral farming and throwaway-account abuse without ever blocking a
// genuine household of a few users.
const MAX_ACCOUNTS_PER_PERSON = Math.max(1, Number(process.env.MAX_ACCOUNTS_PER_PERSON || 5));
function deviceFingerprint(req) {
  const ua = String(req.headers['user-agent'] || '');
  const lang = String(req.headers['accept-language'] || '');
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
  return crypto.createHash('sha256').update(ip + '|' + ua + '|' + lang).digest('hex').slice(0, 32);
}
async function accountLimitReached(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
  const fp = deviceFingerprint(req);
  const or = [];
  if (ip) or.push({ signupIp: ip });
  or.push({ signupFingerprint: fp });
  const count = await User.countDocuments({ $or: or });
  if (count >= MAX_ACCOUNTS_PER_PERSON) {
    return `You have reached the limit of ${MAX_ACCOUNTS_PER_PERSON} accounts allowed per person on this website. Please log in to one of your existing accounts, or contact support if you believe this is a mistake.`;
  }
  return null;
}

app.post('/api/auth/register', async (req, res) => {
 try {
 const { name, email, password, refCode, phone, phoneCountry, country, language } = req.body;
 if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
 if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
 if (isBlockedEmailDomain(email)) return res.status(400).json({ error: 'Please sign up with a real, active email address.' });
 if (await User.findOne({ email: email.toLowerCase() })) return res.status(400).json({ error: 'Email already registered' });
 const capError = await accountLimitReached(req);
 if (capError) return res.status(429).json({ error: capError, accountLimit: true });
 const gameId = await generateUniqueGameId();
 const referralCode = await generateUniqueReferralCode();
 const referrer = refCode ? await User.findOne({ referralCode: String(refCode).toUpperCase() }) : null;
 const signupIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
 // Worldwide phone handling: the client sends the chosen country plus the local
 // number; countries.normalizePhone turns that into a validated E.164 number.
 const countriesLib = require('./lib/countries');
 const isoCountry = countriesLib.byCode(phoneCountry || country || 'NG');
 if (isoCountry && isoCountry.blocked) return res.status(403).json({ error: 'We are unable to open accounts in your country.' });
 let contactPhone = '';
 if (phone) {
 contactPhone = countriesLib.normalizePhone((phoneCountry || country || 'NG'), phone)
 || (countriesLib.byPhone(phone) ? String(phone).replace(/[^\d+]/g, '') : '');
 }
 const user = new User({
 name, email: email.toLowerCase(), password: await bcrypt.hash(password, 12), gameId,
 referralCode, referredBy: referrer ? referrer._id : null, signupIp, signupFingerprint: deviceFingerprint(req), contactPhone,
 country: isoCountry ? isoCountry.code : '',
 language: (language || 'en').slice(0, 8).toLowerCase(),
 displayCurrency: isoCountry ? isoCountry.currency : 'NGN'
 });
 await user.save();
 // Welcome email — never awaited so a slow mail provider can't stall signup.
 if (klsCampaigns) klsCampaigns.sendWelcomeEmail(user).catch(() => {});
 const token = klsEngagement ? await klsEngagement.issueToken(user, req) : jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
 res.json({ token, user: sanitizeUser(user) });
 } catch (e) { res.status(500).json({ error: 'Registration failed: ' + e.message }); }
});
app.post('/api/auth/login', async (req, res) => {
 try {
 const { email, password } = req.body;
 if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
 const user = await User.findOne({ email: email.toLowerCase() });
 if (!user) return res.status(400).json({ error: 'Invalid email or password' });
 if (!user.password) return res.status(400).json({ error: 'This account signed up with Google. Please use "Continue with Google" to log in.' });
 if (!(await bcrypt.compare(password, user.password))) return res.status(400).json({ error: 'Invalid email or password' });
 if (user.restricted) return res.status(403).json({ error: `Your account has been restricted${user.restrictedReason ? ': ' + user.restrictedReason : ''}. Contact support for help.`, restricted: true });
 const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
 const userAgent = req.headers['user-agent'] || '';
 user.lastLoginAt = new Date();
 user.lastLoginIp = ip;
 user.lastLoginUserAgent = userAgent;
 user.loginHistory.push({ at: new Date(), ip, userAgent });
 if (user.loginHistory.length > 50) user.loginHistory = user.loginHistory.slice(-50);
 await user.save();
 const token = klsEngagement ? await klsEngagement.issueToken(user, req) : jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
 res.json({ token, user: sanitizeUser(user) });
 } catch { res.status(500).json({ error: 'Login failed' }); }
});
async function upsertGoogleUser(payload, agreedTerms, refCode, req) {
 let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email: payload.email.toLowerCase() }] });
 let isNewUser = false;
 if (user) {
 if (!user.googleId) { user.googleId = payload.sub; user.authProvider = user.authProvider === 'local' && user.password ? 'local' : 'google'; }
 if (!user.profilePicture && payload.picture) user.profilePicture = payload.picture;
 } else {
 if (!agreedTerms) { const err = new Error('You must agree to the Terms & Conditions to create an account'); err.requiresTerms = true; throw err; }
 if (isBlockedEmailDomain(payload.email)) { const err = new Error('Please sign up with a real, active email address.'); err.blockedDomain = true; throw err; }
 isNewUser = true;
 if (req) {
 const capError = await accountLimitReached(req);
 if (capError) { const err = new Error(capError); err.accountLimit = true; throw err; }
 }
 const referrer = refCode ? await User.findOne({ referralCode: String(refCode).toUpperCase() }) : null;
 const signupIp = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() : '';
 user = new User({
 name: payload.name || payload.email.split('@')[0],
 email: payload.email.toLowerCase(),
 googleId: payload.sub,
 authProvider: 'google',
 profilePicture: payload.picture || '',
 gameId: await generateUniqueGameId(),
 referralCode: await generateUniqueReferralCode(),
 referredBy: referrer ? referrer._id : null,
 signupIp,
 signupFingerprint: req ? deviceFingerprint(req) : ''
 });
 }
 if (user.restricted) { const err = new Error(`Your account has been restricted${user.restrictedReason ? ': ' + user.restrictedReason : ''}. Contact support for help.`); err.restricted = true; throw err; }
 if (isNewUser && klsCampaigns) klsCampaigns.sendWelcomeEmail(user).catch(() => {});
 return { user, isNewUser };
}
async function finalizeGoogleLogin(user, req) {
 const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
 const userAgent = req.headers['user-agent'] || '';
 user.lastLoginAt = new Date();
 user.lastLoginIp = ip;
 user.lastLoginUserAgent = userAgent;
 user.loginHistory.push({ at: new Date(), ip, userAgent });
 if (user.loginHistory.length > 50) user.loginHistory = user.loginHistory.slice(-50);
 await user.save();
 return klsEngagement ? await klsEngagement.issueToken(user, req) : jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '30d' });
}
app.post('/api/auth/google', async (req, res) => {
 try {
 if (!googleClient) return res.status(503).json({ error: 'Google Sign-In is not configured on this server yet.' });
 const { credential, agreedTerms, refCode } = req.body;
 if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
 const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
 const payload = ticket.getPayload();
 if (!payload?.email) return res.status(400).json({ error: 'Could not verify Google account' });
 const { user, isNewUser } = await upsertGoogleUser(payload, agreedTerms, refCode, req);
 const token = await finalizeGoogleLogin(user, req);
 res.json({ token, user: sanitizeUser(user), isNewUser });
 } catch (e) {
 console.error('Google auth error:', e.message);
 if (e.requiresTerms) return res.status(400).json({ error: e.message, requiresTerms: true });
 if (e.restricted) return res.status(403).json({ error: e.message, restricted: true });
 if (e.blockedDomain) return res.status(400).json({ error: e.message, blockedDomain: true });
 if (e.accountLimit) return res.status(429).json({ error: e.message, accountLimit: true });
 res.status(400).json({ error: 'Google sign-in failed: ' + e.message });
 }
});
const googleRedirectClient = (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
 ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${process.env.SITE_URL || ''}/auth/google/callback`)
 : null;
const pendingGoogleLogins = new Map(); // code -> { token, user, isNewUser, expiresAt }
function cleanupPendingGoogleLogins() {
 const now = Date.now();
 for (const [code, entry] of pendingGoogleLogins) if (entry.expiresAt < now) pendingGoogleLogins.delete(code);
}
app.get('/auth/google', (req, res) => {
 if (!googleRedirectClient) return res.status(503).send('Google Sign-In is not configured on this server yet.');
 const agreedTerms = req.query.agreedTerms === '1' ? '1' : '0';
 const refCode = (req.query.ref || '').toString().slice(0, 20);
 const url = googleRedirectClient.generateAuthUrl({
 access_type: 'online',
 scope: ['openid', 'email', 'profile'],
 state: `${agreedTerms}|${refCode}`,
 prompt: 'select_account'
 });
 res.redirect(url);
});
app.get('/auth/google/callback', async (req, res) => {
 const siteUrl = process.env.SITE_URL || '';
 try {
 if (!googleRedirectClient) throw new Error('Google Sign-In is not configured on this server yet.');
 const { code, state, error: googleError } = req.query;
 if (googleError) throw new Error(googleError === 'access_denied' ? 'Sign-in was cancelled' : googleError);
 if (!code) throw new Error('Missing authorization code from Google');
 const { tokens } = await googleRedirectClient.getToken(code);
 const ticket = await googleRedirectClient.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
 const payload = ticket.getPayload();
 if (!payload?.email) throw new Error('Could not verify Google account');
 const [agreedTermsRaw, refCode] = String(state || '').split('|');
 const agreedTerms = agreedTermsRaw === '1';
 const { user, isNewUser } = await upsertGoogleUser(payload, agreedTerms, refCode, req);
 const token = await finalizeGoogleLogin(user, req);
 cleanupPendingGoogleLogins();
 const loginCode = crypto.randomBytes(24).toString('hex');
 pendingGoogleLogins.set(loginCode, { token, user: sanitizeUser(user), isNewUser, expiresAt: Date.now() + 2 * 60 * 1000 });
 res.redirect(`${siteUrl}/login?googleLoginCode=${loginCode}`);
 } catch (e) {
 console.error('Google redirect auth error:', e.message);
 const reason = e.requiresTerms ? 'terms' : e.restricted ? 'restricted' : e.blockedDomain ? 'blocked' : 'failed';
 res.redirect(`${siteUrl}/login?googleLoginError=${reason}&googleLoginMsg=${encodeURIComponent(e.message)}`);
 }
});
app.post('/api/auth/google/exchange', (req, res) => {
 const { code } = req.body;
 const entry = code && pendingGoogleLogins.get(code);
 if (code) pendingGoogleLogins.delete(code);
 if (!entry || entry.expiresAt < Date.now()) return res.status(400).json({ error: 'This sign-in link has expired. Please try again.' });
 res.json({ token: entry.token, user: entry.user, isNewUser: entry.isNewUser });
});
app.post('/api/admin/staff/login', async (req, res) => {
 try {
 const { email, password } = req.body;
 if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
 const account = await AdminAccount.findOne({ email: email.toLowerCase() });
 if (!account || !(await bcrypt.compare(password, account.password))) return res.status(400).json({ error: 'Invalid email or password' });
 if (!account.active) return res.status(403).json({ error: 'This admin account has been deactivated. Contact the site owner.' });
 account.lastLoginAt = new Date();
 await account.save();
 const token = jwt.sign({ id: account._id }, process.env.JWT_SECRET + '_subadmin', { expiresIn: '7d' });
 res.json({ token, account: { id: account._id, name: account.name, email: account.email, role: account.role } });
 } catch (e) { res.status(500).json({ error: 'Login failed: ' + e.message }); }
});
app.post('/api/admin/staff/reset-password', subAdminAuth, async (req, res) => {
 try {
 const { currentPassword, newPassword } = req.body;
 if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new password are required' });
 if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
 const account = await AdminAccount.findById(req.subAdmin._id);
 if (!(await bcrypt.compare(currentPassword, account.password))) return res.status(400).json({ error: 'Current password is incorrect' });
 account.password = await bcrypt.hash(newPassword, 12);
 await account.save();
 res.json({ message: 'Password updated successfully' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/staff', adminAuth, async (req, res) => {
 res.json(await AdminAccount.find().select('-password').sort({ createdAt: -1 }));
});
app.post('/api/admin/staff', adminAuth, async (req, res) => {
 try {
 const { name, email, password } = req.body;
 if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
 if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
 if (await AdminAccount.findOne({ email: email.toLowerCase() })) return res.status(400).json({ error: 'An admin with this email already exists' });
 const account = await AdminAccount.create({ name, email: email.toLowerCase(), password: await bcrypt.hash(password, 12), role: 'support' });
 res.json({ id: account._id, name: account.name, email: account.email, role: account.role, message: ` Sub-admin "${name}" created — they can log in at /YOUR_ADMIN_PATH with these credentials.` });
 } catch (e) { res.status(500).json({ error: 'Failed to create sub-admin: ' + e.message }); }
});
app.put('/api/admin/staff/:id/toggle', adminAuth, async (req, res) => {
 try {
 const { active } = req.body;
 const account = await AdminAccount.findByIdAndUpdate(req.params.id, { active: !!active }, { new: true }).select('-password');
 if (!account) return res.status(404).json({ error: 'Not found' });
 res.json({ account, message: active ? ` ${account.name} reactivated` : ` ${account.name} deactivated` });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/staff/:id', adminAuth, async (req, res) => {
 await AdminAccount.findByIdAndDelete(req.params.id);
 res.json({ message: 'Sub-admin account deleted' });
});
app.post('/api/admin/staff/:id/reset-password', adminAuth, async (req, res) => {
 try {
 const { newPassword } = req.body;
 if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
 const account = await AdminAccount.findById(req.params.id);
 if (!account) return res.status(404).json({ error: 'Not found' });
 account.password = await bcrypt.hash(newPassword, 12);
 await account.save();
 res.json({ message: ` Password reset for ${account.name}` });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/auth/reset-password', auth, async (req, res) => {
 try {
 const { oldPassword, newPassword } = req.body;
 const user = await User.findById(req.user._id);
 if (!user.password) return res.status(400).json({ error: 'This account uses Google Sign-In and has no password. There is nothing to reset — you can set one via "Add a password" in Settings.' });
 if (!(await bcrypt.compare(oldPassword, user.password))) return res.status(400).json({ error: 'Old password incorrect' });
 if (newPassword.length < 6) return res.status(400).json({ error: 'Minimum 6 characters' });
 user.password = await bcrypt.hash(newPassword, 12);
 await user.save();
 res.json({ message: 'Password updated successfully' });
 } catch { res.status(500).json({ error: 'Reset failed' }); }
});
app.post('/api/auth/set-password', auth, async (req, res) => {
 try {
 const { newPassword } = req.body;
 const user = await User.findById(req.user._id);
 if (user.password) return res.status(400).json({ error: 'This account already has a password. Use "Change Password" instead.' });
 if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Minimum 6 characters' });
 user.password = await bcrypt.hash(newPassword, 12);
 await user.save();
 res.json({ message: ' Password set! You can now log in with email + password too.' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/user/profile', auth, async (req, res) => {
 try {
 const { name, email } = req.body;
 const user = await User.findById(req.user._id);
 if (name && name.trim()) user.name = name.trim();
 if (email && email.trim().toLowerCase() !== user.email) {
 const newEmail = email.trim().toLowerCase();
 const existing = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
 if (existing) return res.status(400).json({ error: 'That email is already in use by another account' });
 user.email = newEmail;
 }
 await user.save();
 res.json({ message: ' Profile updated', user: sanitizeUser(user) });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/user/phone', auth, async (req, res) => {
 try {
 const { phone } = req.body;
 if (!phone) return res.status(400).json({ error: 'Phone number is required' });
 const cleaned = phone.trim().replace(/\s+/g,'');
 let normalized = cleaned;
 if (/^0[789]\d{9}$/.test(cleaned)) normalized = '+234' + cleaned.slice(1);
 if (!/^\+234[789]\d{9}$/.test(normalized)) {
 return res.status(400).json({ error: 'Enter a valid Nigerian number in +234 format (e.g. +2348012345678)' });
 }
 const user = await User.findById(req.user._id);
 user.contactPhone = normalized;
 await user.save();
 res.json({ message: ' Phone number saved', user: sanitizeUser(user) });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/user/phone', auth, async (req, res) => {
 try {
 const { phone } = req.body;
 if (!phone) return res.status(400).json({ error: 'Phone number is required' });
 const cleaned = phone.trim().replace(/\s+/g,'');
 let normalized = cleaned;
 if (/^0[789]\d{9}$/.test(cleaned)) normalized = '+234' + cleaned.slice(1);
 if (!/^\+234[789]\d{9}$/.test(normalized)) {
 return res.status(400).json({ error: 'Enter a valid Nigerian number in +234 format (e.g. +2348012345678)' });
 }
 const user = await User.findById(req.user._id);
 user.contactPhone = normalized;
 await user.save();
 res.json({ message: ' Phone number updated', user: sanitizeUser(user) });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/user/profile-picture', auth, upload.single('picture'), async (req, res) => {
 try {
 if (!req.file) return res.status(400).json({ error: 'No picture uploaded' });
 const user = await User.findById(req.user._id);
 user.profilePicture = fileUrl(req.file);
 await user.save();
 res.json({ message: ' Profile picture updated', profilePicture: user.profilePicture });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/user/api-key', auth, async (req, res) => {
 const user = await User.findById(req.user._id).select('apiKey apiEnabled apiKeyCreatedAt apiLastUsedAt');
 res.json({ apiKey: user.apiKey || null, apiEnabled: user.apiEnabled, createdAt: user.apiKeyCreatedAt, lastUsedAt: user.apiLastUsedAt, hasSecret: !!user.apiKey });
});
app.post('/api/user/api-key/generate', auth, async (req, res) => {
 try {
 const user = await User.findById(req.user._id);
 user.apiKey = 'ksl_live_' + crypto.randomBytes(16).toString('hex');
 user.apiSecret = crypto.randomBytes(32).toString('hex');
 user.apiEnabled = true;
 user.apiKeyCreatedAt = new Date();
 await user.save();
 res.json({ apiKey: user.apiKey, apiSecret: user.apiSecret, message: ' API key generated. Save your secret now — it will not be shown again.' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/user/api-key/revoke', auth, async (req, res) => {
 try {
 const user = await User.findById(req.user._id);
 user.apiKey = undefined; user.apiSecret = undefined; user.apiEnabled = false;
 await user.save();
 res.json({ message: ' API key revoked' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/user/me', auth, async (req, res) => res.json(await User.findById(req.user._id).select('-password -apiSecret')));
app.get('/api/referrals/summary', auth, async (req, res) => {
 try {
 const siteUrl = process.env.SITE_URL || '';
 const referredCount = await User.countDocuments({ referredBy: req.user._id });
 const earnings = await ReferralEarning.find({ referrerId: req.user._id }).sort({ createdAt: -1 }).limit(50);
 const totalEarned = earnings.reduce((sum, e) => sum + e.commission, 0);
 res.json({
 referralCode: req.user.referralCode,
 referralLink: `${siteUrl}/?ref=${req.user.referralCode}`,
 referredCount,
 totalEarned,
 commissionRate: REFERRAL_COMMISSION_RATE,
 recentEarnings: earnings.map(e => ({ commission: e.commission, purchaseAmount: e.purchaseAmount, itemLabel: e.itemLabel, createdAt: e.createdAt }))
 });
 } catch (e) { res.status(500).json({ error: 'Failed to load referral summary' }); }
});
app.get('/api/user/transactions', auth, async (req, res) => res.json(await Transaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100)));
app.get('/api/user/deposit-summary', auth, async (req, res) => {
 try {
 const agg = await Transaction.aggregate([
 { $match: { userId: req.user._id, type: 'deposit', status: 'success' } },
 { $group: { _id: null, total: { $sum: '$amount' } } }
 ]);
 res.json({ totalDeposited: agg[0]?.total || 0, currentBalance: req.user.balance || 0 });
 } catch (e) { res.status(500).json({ error: 'Failed to load deposit summary' }); }
});
app.get('/api/user/purchases', auth, async (req, res) => {
 const u = await User.findById(req.user._id).select('purchaseDetails');
 res.json(u.purchaseDetails || []);
});
// ── ANNOUNCEMENT ROUTES ──────────────────────────────────────────────────────
// User-facing: the list plus this user's own read/dismissed state.
app.get('/api/announcements', auth, async (req, res) => {
 try {
  const items = await Announcement.find(liveAnnouncementFilter())
    .sort({ pinned: -1, createdAt: -1 }).limit(50).lean();
  const states = await AnnouncementState.find({
    userId: req.user._id,
    announcementId: { $in: items.map(i => i._id) },
  }).lean();
  const byId = new Map(states.map(st => [String(st.announcementId), st]));
  const out = items.map(a => {
    const st = byId.get(String(a._id));
    return {
      id: String(a._id),
      title: a.title,
      message: a.message,
      link: a.link || '',
      linkLabel: a.linkLabel || '',
      image: a.image || '',
      itemId: a.itemId ? String(a.itemId) : '',
      level: a.level || 'info',
      pinned: !!a.pinned,
      createdAt: a.createdAt,
      read: !!(st && st.readAt),
      readAt: (st && st.readAt) || null,
      dismissed: !!(st && st.dismissedAt),
    };
  });
  res.json({
    items: out,
    unread: out.filter(a => !a.read).length,
    // Popups: everything this user has not permanently dismissed and has not read yet.
    popups: out.filter(a => !a.dismissed && !a.read).map(a => a.id),
  });
 } catch (e) { res.status(500).json({ error: 'Failed to load announcements' }); }
});

/** Mark read (Read more / opened) or permanently dismissed ("Don't show again"). */
app.post('/api/announcements/:id/state', auth, async (req, res) => {
 try {
  const { read, dismissed, viewed, clicked } = req.body || {};
  const ann = await Announcement.findById(req.params.id).select('_id');
  if (!ann) return res.status(404).json({ error: 'Announcement not found' });
  const set = {};
  const inc = {};
  const now0 = new Date();
  if (viewed === true) { inc.views = 1; }
  if (clicked === true) { inc.clicks = 1; set.readAt = now0; }
  if (read === true) set.readAt = new Date();
  if (dismissed === true) { set.dismissedAt = new Date(); if (!set.readAt) set.readAt = new Date(); }
  if (dismissed === false) set.dismissedAt = null;
  const update = { $set: set, $setOnInsert: { announcementId: ann._id, userId: req.user._id } };
  if (Object.keys(inc).length) update.$inc = inc;
  // First-touch timestamps must not overwrite an earlier one, so they go in $setOnInsert-safe form.
  const existing = await AnnouncementState.findOne({ announcementId: ann._id, userId: req.user._id }).select('viewedAt clickedAt').lean();
  if (viewed === true && !(existing && existing.viewedAt)) update.$set.viewedAt = now0;
  if (clicked === true && !(existing && existing.clickedAt)) update.$set.clickedAt = now0;
  const st = await AnnouncementState.findOneAndUpdate(
    { announcementId: ann._id, userId: req.user._id },
    update,
    { new: true, upsert: true }
  );
  res.json({ id: String(ann._id), read: !!st.readAt, dismissed: !!st.dismissedAt });
 } catch (e) { res.status(500).json({ error: 'Failed to save notification state' }); }
});

/** Mark every live announcement as read for this user (used by the notifications page). */
app.post('/api/announcements/read-all', auth, async (req, res) => {
 try {
  const items = await Announcement.find(liveAnnouncementFilter()).select('_id').lean();
  const now = new Date();
  await Promise.all(items.map(a => AnnouncementState.updateOne(
    { announcementId: a._id, userId: req.user._id },
    { $set: { readAt: now }, $setOnInsert: { announcementId: a._id, userId: req.user._id } },
    { upsert: true }
  )));
  res.json({ message: 'All announcements marked as read', count: items.length });
 } catch (e) { res.status(500).json({ error: 'Failed to mark announcements read' }); }
});

// Admin: the "Notifications bar" tab.
app.get('/api/admin/announcements', adminAuth, async (req, res) => {
 try {
  const items = await Announcement.find().sort({ createdAt: -1 }).limit(200).lean();
  const stats = await AnnouncementState.aggregate([
    { $group: { _id: '$announcementId',
      reads: { $sum: { $cond: [{ $ifNull: ['$readAt', false] }, 1, 0] } },
      dismissals: { $sum: { $cond: [{ $ifNull: ['$dismissedAt', false] }, 1, 0] } },
      viewers: { $sum: { $cond: [{ $ifNull: ['$viewedAt', false] }, 1, 0] } },
      impressions: { $sum: { $ifNull: ['$views', 0] } },
      clickers: { $sum: { $cond: [{ $ifNull: ['$clickedAt', false] }, 1, 0] } },
      clicks: { $sum: { $ifNull: ['$clicks', 0] } } } }
  ]);
  const byId = new Map(stats.map(s => [String(s._id), s]));
  res.json(items.map(a => {
    const st = byId.get(String(a._id)) || {};
    const viewers = st.viewers || 0;
    return {
      ...a,
      id: String(a._id),
      reads: st.reads || 0,
      dismissals: st.dismissals || 0,
      viewers,
      impressions: st.impressions || 0,
      clickers: st.clickers || 0,
      clicks: st.clicks || 0,
      ctr: viewers ? Math.round(((st.clickers || 0) / viewers) * 1000) / 10 : 0,
    };
  }));
 } catch (e) { res.status(500).json({ error: 'Failed to load announcements' }); }
});

/** Analytics: how many users saw each notification and how many pressed "Read more". */
app.get('/api/admin/announcements/analytics', adminAuth, async (req, res) => {
 try {
  const [items, stats, totalUsers] = await Promise.all([
    Announcement.find().sort({ createdAt: -1 }).limit(200).lean(),
    AnnouncementState.aggregate([
      { $group: { _id: '$announcementId',
        viewers: { $sum: { $cond: [{ $ifNull: ['$viewedAt', false] }, 1, 0] } },
        impressions: { $sum: { $ifNull: ['$views', 0] } },
        clickers: { $sum: { $cond: [{ $ifNull: ['$clickedAt', false] }, 1, 0] } },
        clicks: { $sum: { $ifNull: ['$clicks', 0] } },
        reads: { $sum: { $cond: [{ $ifNull: ['$readAt', false] }, 1, 0] } },
        dismissals: { $sum: { $cond: [{ $ifNull: ['$dismissedAt', false] }, 1, 0] } } } }
    ]),
    User.countDocuments(),
  ]);
  const byId = new Map(stats.map(s => [String(s._id), s]));
  const rows = items.map(a => {
    const st = byId.get(String(a._id)) || {};
    const viewers = st.viewers || 0;
    const clickers = st.clickers || 0;
    return {
      id: String(a._id),
      title: a.title,
      level: a.level || 'info',
      active: a.active !== false,
      link: a.link || '',
      createdAt: a.createdAt,
      viewers,
      impressions: st.impressions || 0,
      clickers,
      clicks: st.clicks || 0,
      reads: st.reads || 0,
      dismissals: st.dismissals || 0,
      reachPercent: totalUsers ? Math.round((viewers / totalUsers) * 1000) / 10 : 0,
      ctr: viewers ? Math.round((clickers / viewers) * 1000) / 10 : 0,
    };
  });
  const totals = rows.reduce((t, r) => ({
    viewers: t.viewers + r.viewers,
    impressions: t.impressions + r.impressions,
    clickers: t.clickers + r.clickers,
    clicks: t.clicks + r.clicks,
    reads: t.reads + r.reads,
    dismissals: t.dismissals + r.dismissals,
  }), { viewers: 0, impressions: 0, clickers: 0, clicks: 0, reads: 0, dismissals: 0 });
  res.json({ totalUsers, totals, rows });
 } catch (e) { res.status(500).json({ error: 'Failed to load notification analytics' }); }
});

app.post('/api/admin/announcements', adminAuth, upload.single('image'), async (req, res) => {
 try {
  const { title, message, link, linkLabel, level, pinned, active, expiresAt } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'Message is required' });
  const clean = String(link || '').trim();
  if (clean && !/^(https?:\/\/|\/)/i.test(clean)) {
    return res.status(400).json({ error: 'Link must start with http://, https:// or /' });
  }
  const ann = await Announcement.create({
    title: String(title).trim().slice(0, 140),
    message: String(message).trim().slice(0, 2000),
    link: clean,
    linkLabel: String(linkLabel || '').trim().slice(0, 40),
    image: req.file ? fileUrl(req.file) : '',
    level: ['info', 'success', 'warning', 'urgent'].includes(level) ? level : 'info',
    pinned: pinned === true || pinned === 'true',
    active: active === false || active === 'false' ? false : true,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    createdBy: (req.subAdmin && (req.subAdmin.email || req.subAdmin.name)) || 'owner',
  });
  res.json(ann);
 } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/announcements/:id', adminAuth, upload.single('image'), async (req, res) => {
 try {
  const up = {};
  ['title', 'message', 'link', 'linkLabel', 'level'].forEach(k => {
    if (typeof req.body[k] !== 'undefined') up[k] = String(req.body[k] || '').trim();
  });
  if (up.link && !/^(https?:\/\/|\/)/i.test(up.link)) {
    return res.status(400).json({ error: 'Link must start with http://, https:// or /' });
  }
  if (typeof req.body.active !== 'undefined') up.active = req.body.active === true || req.body.active === 'true';
  if (typeof req.body.pinned !== 'undefined') up.pinned = req.body.pinned === true || req.body.pinned === 'true';
  if (typeof req.body.expiresAt !== 'undefined') up.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
  if (req.file) up.image = fileUrl(req.file);
  const ann = await Announcement.findByIdAndUpdate(req.params.id, up, { new: true });
  if (!ann) return res.status(404).json({ error: 'Not found' });
  res.json(ann);
 } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/announcements/:id', adminAuth, async (req, res) => {
 try {
  await AnnouncementState.deleteMany({ announcementId: req.params.id });
  await Announcement.findByIdAndDelete(req.params.id);
  res.json({ message: 'Announcement deleted' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/user/notifications', auth, async (req, res) => {
 try {
 const user = await User.findById(req.user._id).select('notificationsSeenAt');
 let seenAt = user.notificationsSeenAt;
 if (!seenAt) {
 seenAt = new Date();
 await User.findByIdAndUpdate(req.user._id, { notificationsSeenAt: seenAt });
 }
 const [receipts, tickets, transactions, supportReplies, announcements, announcementStates] = await Promise.all([
 Receipt.find({ userId: req.user._id, status: { $ne: 'pending' }, seenByUser: false }).sort({ createdAt: -1 }).limit(30),
 Support.find({ userId: req.user._id, status: 'resolved', seenByUser: false }).sort({ createdAt: -1 }).limit(30),
 Transaction.find({ userId: req.user._id, status: 'success', type: { $in: ['deposit', 'purchase', 'admin_credit'] } }).sort({ createdAt: -1 }).limit(30),
 SupportMessage.find({ userId: req.user._id, sender: 'admin', readByUser: false }).sort({ createdAt: -1 }).limit(30),
 Announcement.find(liveAnnouncementFilter()).sort({ pinned: -1, createdAt: -1 }).limit(50).lean(),
 AnnouncementState.find({ userId: req.user._id }).lean()
 ]);
 const announcementRead = new Map(announcementStates.map(s => [String(s.announcementId), !!s.readAt]));
 const items = [
 ...receipts.map(r => ({
 id: r._id, type: 'deposit',
 title: r.status === 'approved' ? ' Deposit approved' : ' Deposit rejected',
 message: r.status === 'approved' ? `Your ₦${r.claimedAmount.toLocaleString('en-NG')} deposit was approved.` : `Your ₦${r.claimedAmount.toLocaleString('en-NG')} deposit was rejected.${r.adminNote ? ' ' + r.adminNote : ''}`,
 createdAt: r.createdAt
 })),
 ...tickets.map(t => ({
 id: t._id, type: 'support',
 title: ' Support replied',
 message: t.adminReply ? t.adminReply.slice(0, 120) : 'Your support ticket has a reply.',
 createdAt: t.createdAt
 })),
  ...supportReplies.map(m => ({
  id: m._id, type: 'live-support',
  title: ' New live support reply',
  message: m.text.slice(0, 120),
  link: '/support',
  createdAt: m.createdAt
  })),
  ...announcements.map(a => ({
   id: a._id, type: 'announcement', title: a.title, message: a.message,
   link: a.link || '/notifications', image: a.image || '', level: a.level || 'info',
   unread: !announcementRead.get(String(a._id)), createdAt: a.createdAt
  })),
 ...transactions.map(tx => ({
 id: tx._id,
 type: tx.type,
 title: tx.type === 'deposit' ? ' Deposit received' : tx.type === 'purchase' ? ' Purchase successful' : ' Balance credited',
 message: tx.type === 'deposit' ? `₦${tx.amount.toLocaleString('en-NG')} was added to your wallet.` : tx.type === 'purchase' ? `${tx.description || 'Purchase completed'} — ₦${tx.amount.toLocaleString('en-NG')}` : `${tx.description || 'Your balance was credited'} — ₦${tx.amount.toLocaleString('en-NG')}`,
 createdAt: tx.createdAt
 }))
 ].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 40);
 const unreadCount = items.filter(i => i.unread === true || (i.type !== 'announcement' && new Date(i.createdAt) > seenAt)).length;
 res.json({ count: unreadCount, items });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/user/notifications/mark-seen', auth, async (req, res) => {
 try {
 await Promise.all([
 Receipt.updateMany({ userId: req.user._id, seenByUser: false }, { seenByUser: true }),
 Support.updateMany({ userId: req.user._id, seenByUser: false }, { seenByUser: true }),
 SupportMessage.updateMany({ userId: req.user._id, sender: 'admin', readByUser: false }, { readByUser: true }),
 (async () => {
   const live = await Announcement.find(liveAnnouncementFilter()).select('_id').lean();
   const now = new Date();
   await Promise.all(live.map(a => AnnouncementState.updateOne(
     { announcementId: a._id, userId: req.user._id },
     { $set: { readAt: now }, $setOnInsert: { announcementId: a._id, userId: req.user._id } },
     { upsert: true }
   )));
 })(),
 User.findByIdAndUpdate(req.user._id, { notificationsSeenAt: new Date() })
 ]);
 res.json({ message: 'Notifications marked as read' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/logs', optionalAuth, async (req, res) => {
 res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
 res.set('Pragma', 'no-cache');
 res.set('Expires', '0');
 const filter = { available: true };
 if (req.query.type && req.query.type !== 'all') filter.type = req.query.type;
 if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
 const logs = await Log.find(filter).select('-details -toolLink -deliverableFile -subAccounts.details -subAccounts.toolLink -subAccounts.deliverableFile').sort({ createdAt: -1 });
 const categories = await Category.find();
 const showReviewsFor = new Set(categories.filter(c => c.showReviews).map(c => c.name));
 const visible = logs.map(l => {
 const obj = l.toObject();
 if (!showReviewsFor.has(l.category)) {
 obj.reviews = [];
 obj.adminReview = { reviewType: 'none', content: '' };
 if (obj.subAccounts) obj.subAccounts = obj.subAccounts.map(sa => ({ ...sa, reviews: [], adminReview: { reviewType: 'none', content: '' } }));
 }
 if (obj.listingType === 'folder') {
 obj.subAccounts = stripStaleSoldSubAccounts(obj.subAccounts);
 obj.availableCount = obj.subAccounts.filter(sa => !sa.sold).length;
 obj.soldOut = obj.availableCount === 0;
 const availablePrices = obj.subAccounts.filter(sa => !sa.sold).map(sa => sa.price);
 obj.priceFrom = availablePrices.length ? Math.min(...availablePrices) : null;
 } else if (obj.type === 'tool') {
 obj.soldOut = obj.toolQty > 0 && obj.soldCount >= obj.toolQty;
 } else {
 obj.soldOut = obj.maxPurchases > 0 && obj.soldCount >= obj.maxPurchases;
 }
 return obj;
 });
 res.json(visible);
});
app.get('/api/logs/:id', optionalAuth, async (req, res) => {
 res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
 res.set('Pragma', 'no-cache');
 res.set('Expires', '0');
 const log = await Log.findById(req.params.id).select('-details -toolLink -deliverableFile -subAccounts.details -subAccounts.toolLink -subAccounts.deliverableFile');
 if (!log) return res.status(404).json({ error: 'Not found' });
 const cat = await Category.findOne({ name: log.category });
 const showReviews = !cat || cat.showReviews; // default to showing if category record doesn't exist yet
 const obj = log.toObject();
 if (!showReviews) {
 obj.reviews = [];
 obj.adminReview = { reviewType: 'none', content: '' };
 if (obj.subAccounts) obj.subAccounts = obj.subAccounts.map(sa => ({ ...sa, reviews: [], adminReview: { reviewType: 'none', content: '' } }));
 }
 if (obj.listingType === 'folder') {
 obj.subAccounts = stripStaleSoldSubAccounts(obj.subAccounts);
 obj.availableCount = obj.subAccounts.filter(sa => !sa.sold).length;
 obj.soldOut = obj.availableCount === 0;
 const availablePrices = obj.subAccounts.filter(sa => !sa.sold).map(sa => sa.price);
 obj.priceFrom = availablePrices.length ? Math.min(...availablePrices) : null;
 } else if (obj.type === 'tool') {
 obj.soldOut = obj.toolQty > 0 && obj.soldCount >= obj.toolQty;
 } else {
 obj.soldOut = obj.maxPurchases > 0 && obj.soldCount >= obj.maxPurchases;
 }
 res.json(obj);
});
app.post('/api/logs/:id/notify-restock', auth, async (req, res) => {
 try {
 const log = await Log.findById(req.params.id).select('title');
 if (!log) return res.status(404).json({ error: 'Item not found' });
 await RestockRequest.findOneAndUpdate(
 { userId: req.user._id, logId: log._id },
 { userId: req.user._id, logId: log._id, userName: req.user.name || '', logTitle: log.title, createdAt: new Date() },
 { upsert: true }
 );
 res.json({ ok: true });
 } catch (e) { res.status(500).json({ error: 'Failed to save — please try again' }); }
});
app.post('/api/logs/buy/:id', auth, async (req, res) => {
 try {
 const { subAccountId } = req.body;
 const log = await Log.findById(req.params.id);
 if (!log || !log.available) return res.status(404).json({ error: 'Item not available' });
 const user = await User.findById(req.user._id);

 if (log.listingType === 'folder') {
   if (!subAccountId) return res.status(400).json({ error: 'Choose a sub-account to buy' });
   // ATOMIC CLAIM — only touches the ONE matching sub-account (sold:false).
   // Two concurrent buyers can never both get the same account.
   const claimed = await Log.findOneAndUpdate(
     { _id: log._id, 'subAccounts._id': subAccountId, 'subAccounts.sold': false },
     { $set: { 'subAccounts.$.sold': true, 'subAccounts.$.soldTo': user._id, 'subAccounts.$.soldAt': new Date() } },
     { new: true }
   );
   if (!claimed) return res.status(400).json({ error: 'This account has already been sold — please choose another.' });
   const sub = claimed.subAccounts.id(subAccountId);
   if (!sub) {
     // Roll back — safety net
     await Log.updateOne({ _id: log._id, 'subAccounts._id': subAccountId }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
     return res.status(500).json({ error: 'Sub-account data error — please try again' });
   }
   // BALANCE CHECK after claim — roll back if insufficient
   if ((user.balance || 0) < sub.price) {
     await Log.updateOne({ _id: log._id, 'subAccounts._id': subAccountId }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
     return res.status(400).json({ error: 'Insufficient balance. Please deposit funds.' });
   }
   // ATOMIC DEDUCT — never read-modify-write; concurrent ops are safe
   const updatedUser = await User.findByIdAndUpdate(
     user._id, { $inc: { balance: -sub.price } }, { new: true }
   );
   if (!updatedUser) {
     await Log.updateOne({ _id: log._id, 'subAccounts._id': subAccountId }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
     return res.status(500).json({ error: 'Failed to deduct balance — please try again' });
   }
   // Push purchase record atomically — never overwrites other purchaseDetails
   const purchasedAt = new Date();
   await User.updateOne({ _id: user._id }, { $push: { purchaseDetails: {
     logId: log._id, logTitle: `${log.title} — ${sub.label}`, logType: log.type,
     logDetails: sub.details || '', toolLink: sub.toolLink || '',
     deliveryType: sub.deliveryType || 'link',
     deliverableFile: sub.deliverableFile || '', deliverableFileName: sub.deliverableFileName || '',
     pricePaid: sub.price, subAccountId: sub._id, purchasedAt
   }}});
   await Transaction.create({ userId: user._id, type: 'purchase', amount: sub.price, description: `Purchased: ${log.title} — ${sub.label}`, status: 'success' });
   await creditReferralCommission(updatedUser, sub.price, `${log.title} — ${sub.label}`);
   checkAndAwardBadges(user._id).catch(() => {});
   // Re-label ONLY the unsold sub-accounts so numbering stays clean
   const freshLog = await Log.findById(log._id);
   if (freshLog) {
     let labelIdx = 1;
     freshLog.subAccounts.forEach(sa => { if (!sa.sold) sa.label = `Account ${labelIdx++}`; });
     await freshLog.save();
   }
   return res.json({
     message: 'Purchase successful!', newBalance: updatedUser.balance,
     logDetails: sub.details || '', toolLink: sub.toolLink || '',
     deliveryType: sub.deliveryType || 'link',
     deliverableFile: sub.deliverableFile || '', deliverableFileName: sub.deliverableFileName || '',
     logType: log.type, logTitle: `${log.title} — ${sub.label}`,
   });
 }

 // Non-folder items (single log or tool)
 if (log.type === 'log') {
   if (user.purchaseDetails.find(p => String(p.logId) === String(log._id)))
     return res.status(400).json({ error: 'You already purchased this account.' });
   if (log.maxPurchases > 0 && log.soldCount >= log.maxPurchases)
     return res.status(400).json({ error: 'This account has already been sold.' });
 }
 if (log.type === 'tool' && log.toolQty > 0 && log.soldCount >= log.toolQty)
   return res.status(400).json({ error: 'This tool is out of stock.' });
 if ((user.balance || 0) < log.price)
   return res.status(400).json({ error: 'Insufficient balance. Please deposit funds.' });
 // Atomic deduct
 const updatedUser = await User.findByIdAndUpdate(
   user._id, { $inc: { balance: -log.price } }, { new: true }
 );
 await User.updateOne({ _id: user._id }, { $push: { purchaseDetails: {
   logId: log._id, logTitle: log.title, logType: log.type, logDetails: log.details || '',
   toolLink: log.toolLink || '', deliveryType: log.deliveryType || 'link',
   deliverableFile: log.deliverableFile || '', deliverableFileName: log.deliverableFileName || '',
   pricePaid: log.price, purchasedAt: new Date()
 }}});
 await Transaction.create({ userId: user._id, type: 'purchase', amount: log.price, description: `Purchased: ${log.title}`, status: 'success' });
 await creditReferralCommission(updatedUser, log.price, log.title);
 checkAndAwardBadges(user._id).catch(() => {});
 await Log.findByIdAndUpdate(log._id, { $inc: { soldCount: 1 } });

 // ── Send purchase confirmation email ──────────────────────
 try {
   if (klsCampaigns && typeof klsCampaigns.sendPurchaseEmail === 'function') {
     klsCampaigns.sendPurchaseEmail({
       user: updatedUser,
       item: { title: log.title, type: log.type, price: log.price },
       newBalance: updatedUser.balance
     }).catch(() => {}); // fire-and-forget, never block response
   }
 } catch (_) {}

 res.json({
   message: 'Purchase successful!', newBalance: updatedUser.balance,
   logDetails: log.details || '', toolLink: log.toolLink || '',
   deliveryType: log.deliveryType || 'link',
   deliverableFile: log.deliverableFile || '', deliverableFileName: log.deliverableFileName || '',
   logType: log.type, logTitle: log.title,
 });
 } catch (e) { res.status(500).json({ error: 'Purchase failed: ' + e.message }); }
});
app.post('/api/logs/buy-multi/:id', auth, async (req, res) => {
  const claimedIds = []; // track what we've claimed so we can roll back on any failure
  try {
    const { subAccountIds } = req.body;
    if (!Array.isArray(subAccountIds) || !subAccountIds.length)
      return res.status(400).json({ error: 'Select at least one account to buy' });
    if (subAccountIds.length > 50)
      return res.status(400).json({ error: 'Please buy in smaller batches (max 50 at once)' });
    const log = await Log.findById(req.params.id);
    if (!log || !log.available) return res.status(404).json({ error: 'Item not available' });
    if (log.listingType !== 'folder') return res.status(400).json({ error: 'This item does not support multi-select purchase' });
    const user = await User.findById(req.user._id);
    const claimedSubs = []; // { _id, price, label, details, ... } for each successfully claimed sub
    for (const subId of subAccountIds) {
      const claimed = await Log.findOneAndUpdate(
        { _id: log._id, 'subAccounts._id': subId, 'subAccounts.sold': false },
        { $set: { 'subAccounts.$.sold': true, 'subAccounts.$.soldTo': user._id, 'subAccounts.$.soldAt': new Date() } },
        { new: true }
      );
      if (!claimed) {
        for (const rid of claimedIds) {
          await Log.updateOne({ _id: log._id, 'subAccounts._id': rid }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
        }
        return res.status(400).json({ error: 'One of the selected accounts was just sold to someone else. Please refresh and try again.' });
      }
      claimedIds.push(subId);
      claimedSubs.push(claimed.subAccounts.id(subId));
    }
    const total = claimedSubs.reduce((sum, s) => sum + (s.price || 0), 0);
    if ((user.balance || 0) < total) {
      for (const rid of claimedIds) {
        await Log.updateOne({ _id: log._id, 'subAccounts._id': rid }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
      }
      return res.status(400).json({ error: 'Insufficient balance for this batch. Please deposit funds.' });
    }
    user.balance = (user.balance || 0) - total;
    const purchasedItems = [];
    for (const sub of claimedSubs) {
      user.purchaseDetails.push({
        logId: log._id, logTitle: `${log.title} — ${sub.label}`, logType: log.type, logDetails: sub.details || '',
        toolLink: sub.toolLink || '', deliveryType: sub.deliveryType || 'link',
        deliverableFile: sub.deliverableFile || '', deliverableFileName: sub.deliverableFileName || '',
        pricePaid: sub.price, subAccountId: sub._id
      });
    }
    await user.save();
    const newRecords = user.purchaseDetails.slice(-claimedSubs.length);
    newRecords.forEach((rec, i) => {
      purchasedItems.push({
        logDetails: rec.logDetails, toolLink: rec.toolLink, deliveryType: rec.deliveryType,
        deliverableFile: rec.deliverableFile, deliverableFileName: rec.deliverableFileName,
        logTitle: rec.logTitle, purchaseId: rec._id, purchasedAt: rec.purchasedAt, pricePaid: rec.pricePaid
      });
    });
    await Transaction.create({
      userId: user._id, type: 'purchase', amount: total,
      description: `Purchased ${claimedSubs.length} accounts from ${log.title}`, status: 'success'
    });
    for (const sub of claimedSubs) {
      await creditReferralCommission(user, sub.price, `${log.title} — ${sub.label}`);
    }
    checkAndAwardBadges(user._id).catch(() => {});
    const freshLog = await Log.findById(log._id);
    const boughtIds = new Set(claimedIds.map(String));
    const remaining = freshLog.subAccounts.filter(sa => !boughtIds.has(String(sa._id)));
    remaining.forEach((sa, idx) => { sa.label = `Account ${idx + 1}`; });
    freshLog.subAccounts = remaining;
    await freshLog.save();
    res.json({ message: `${claimedSubs.length} accounts purchased!`, newBalance: user.balance, total, items: purchasedItems });
  } catch (e) {
    for (const rid of claimedIds) {
      try { await Log.updateOne({ _id: req.params.id, 'subAccounts._id': rid }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } }); } catch {}
    }
    res.status(500).json({ error: 'Purchase failed: ' + e.message });
  }
});
app.post('/api/logs/:id/review', auth, reviewUpload.single('reviewFile'), async (req, res) => {
 try {
 const { rating, subAccountId, reviewType } = req.body;
 let content = req.body.content;
 if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1–5 required' });
 if (!['text', 'image', 'video', 'link'].includes(reviewType)) return res.status(400).json({ error: 'Invalid review type' });
 if (reviewType === 'image' || reviewType === 'video') {
 if (!req.file) return res.status(400).json({ error: `Please upload a ${reviewType} file` });
 content = fileUrl(req.file);
 } else {
 if (!content || !content.trim()) return res.status(400).json({ error: 'Review content required' });
 content = content.trim();
 }
 const user = await User.findById(req.user._id);
 const purchase = user.purchaseDetails.find(p => String(p.logId) === req.params.id && (!subAccountId || String(p.subAccountId) === String(subAccountId)));
 if (!purchase) return res.status(403).json({ error: 'Purchase this item first' });
 const log = await Log.findById(req.params.id);
 if (!log) return res.status(404).json({ error: 'Not found' });
 if (log.listingType === 'folder') {
 if (!subAccountId) return res.status(400).json({ error: 'subAccountId required for folder listings' });
 const sub = log.subAccounts.id(subAccountId);
 if (!sub) return res.status(404).json({ error: 'Sub-account not found' });
 if (sub.reviews.find(r => String(r.userId) === String(user._id)))
 return res.status(400).json({ error: 'Already reviewed' });
 sub.reviews.push({ userId: user._id, userName: user.name, rating: parseInt(rating), reviewType, content });
 await log.save();
 return res.json({ message: 'Review submitted!' });
 }
 if (log.reviews.find(r => String(r.userId) === String(user._id)))
 return res.status(400).json({ error: 'Already reviewed' });
 log.reviews.push({ userId: user._id, userName: user.name, rating: parseInt(rating), reviewType, content });
 await log.save();
 res.json({ message: 'Review submitted!' });
 } catch (e) { res.status(500).json({ error: 'Review failed: ' + e.message }); }
});
// ── ACTIVITY WINDOW ───────────────────────────────────────────────────────────
// "Live activity" and "active users" always look back a rolling 24 hours.
// The window is computed from absolute UTC timestamps (Date.now() minus the
// window), so it is timezone-independent: a user in Lagos, London or Los
// Angeles sees the same rolling 24h slice of data, and no calendar-day or
// server-timezone boundary can shrink it back to a shorter window.
const ACTIVITY_WINDOW_HOURS = 24;
const ACTIVITY_WINDOW_MS = ACTIVITY_WINDOW_HOURS * 60 * 60 * 1000;
const activitySince = () => new Date(Date.now() - ACTIVITY_WINDOW_MS);
app.get('/api/public/stats', async (req, res) => {
 try {
 const [activeLogs, activeTools, categoryCount, deliveredCount, totalUsers] = await Promise.all([
 Log.countDocuments({ type: 'log', available: true }),
 Log.countDocuments({ type: 'tool', available: true }),
 Category.countDocuments(),
 Transaction.countDocuments({ type: 'purchase', status: 'success' }),
 User.countDocuments()
 ]);
 res.json({ activeLogs, activeTools, categoryCount, deliveredCount, totalUsers });
 } catch (e) { res.status(500).json({ error: 'Failed to load stats' }); }
});
// Live activity for the last 24 hours — powers the public "LIVE" strip on the home page.
// Names are masked, no user ids leave the server; purely social proof.
app.get('/api/public/live-stats', async (req, res) => {
 try {
 const since = activitySince();
 const maskName = (n) => {
 const name = String(n || 'User').trim();
 if (name.length <= 2) return name[0] + '***';
 return name.slice(0, 2) + '***' + name.slice(-1);
 };
 const [purchases, deposits, recent] = await Promise.all([
 Transaction.aggregate([
 { $match: { type: 'purchase', status: 'success', createdAt: { $gte: since } } },
 { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$amount' } } }
 ]),
 Transaction.aggregate([
 { $match: { type: 'deposit', status: 'success', createdAt: { $gte: since } } },
 { $group: { _id: null, count: { $sum: 1 }, volume: { $sum: '$amount' } } }
 ]),
 Transaction.find({ type: { $in: ['purchase', 'deposit'] }, status: 'success', createdAt: { $gte: since } })
 .sort({ createdAt: -1 }).limit(8).populate('userId', 'name').lean()
 ]);
 res.json({
 windowHours: ACTIVITY_WINDOW_HOURS,
 purchases: { count: purchases[0]?.count || 0, volume: Math.round(purchases[0]?.volume || 0) },
 deposits: { count: deposits[0]?.count || 0, volume: Math.round(deposits[0]?.volume || 0) },
 feed: (recent || []).map(t => ({
 type: t.type,
 amount: Math.round(t.amount || 0),
 name: maskName(t.userId && t.userId.name),
 at: t.createdAt
 }))
 });
 } catch (e) {
 res.status(500).json({ error: 'Failed to load live stats' });
 }
});
app.get('/api/categories', async (req, res) => {
 try {
 const cats = await Category.find().sort({ name: 1 });
 res.json(Array.isArray(cats) ? cats : []);
 } catch (e) {
 console.error('GET /api/categories error:', e.message);
 res.status(500).json([]);
 }
});
app.get('/api/admin/categories', adminAuth, async (req, res) => {
 res.json(await Category.find().sort({ name: 1 }));
});
app.put('/api/admin/categories/:id', adminAuth, async (req, res) => {
 try {
 const { showReviews } = req.body;
 const update = {};
 if (typeof showReviews !== 'undefined') update.showReviews = showReviews === true || showReviews === 'true';
 const cat = await Category.findByIdAndUpdate(req.params.id, update, { new: true });
 if (!cat) return res.status(404).json({ error: 'Not found' });
 res.json(cat);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
const FIXED_CATEGORIES = [
 'Gmail',
 'TikTok',
 'Facebook',
 'Twitter',
 'Instagram',
 'Snapchat',
 'Texting App',
 'VPN & Proxy',
 'Netflix',
 'Others'
];
async function seedDefaultCategories() {
 for (const name of FIXED_CATEGORIES) {
 await Category.findOneAndUpdate({ name }, { $setOnInsert: { name, showReviews: true } }, { upsert: true });
 }
 await Log.updateMany({ category: 'Texting Apps (TextPlus, NextPlus, Google Voice, TextNow, etc.)' }, { $set: { category: 'Texting App' } });
 await Category.deleteMany({ name: { $nin: FIXED_CATEGORIES } });
}
seedDefaultCategories().catch(() => {});
app.get('/api/banks', async (req, res) => {
 const banks = [
 { name: 'Access Bank', code: '044' },
 { name: 'Citibank Nigeria', code: '023' },
 { name: 'Ecobank Nigeria', code: '050' },
 { name: 'Fidelity Bank', code: '070' },
 { name: 'First Bank of Nigeria', code: '011' },
 { name: 'First City Monument Bank (FCMB)', code: '214' },
 { name: 'Globus Bank', code: '00103' },
 { name: 'Guaranty Trust Bank (GTBank)', code: '058' },
 { name: 'Heritage Bank', code: '030' },
 { name: 'Keystone Bank', code: '082' },
 { name: 'Kuda Bank', code: '50211' },
 { name: 'Moniepoint MFB', code: '50515' },
 { name: 'OPay (PayCom)', code: '999992' },
 { name: 'Palmpay', code: '999991' },
 { name: 'Parallex Bank', code: '526' },
 { name: 'Polaris Bank', code: '076' },
 { name: 'Providus Bank', code: '101' },
 { name: 'Stanbic IBTC Bank', code: '221' },
 { name: 'Standard Chartered Bank', code: '068' },
 { name: 'Sterling Bank', code: '232' },
 { name: 'Suntrust Bank', code: '100' },
 { name: 'Taj Bank', code: '302' },
 { name: 'Union Bank of Nigeria', code: '032' },
 { name: 'United Bank for Africa (UBA)', code: '033' },
 { name: 'Unity Bank', code: '215' },
 { name: 'VFD Microfinance Bank', code: '566' },
 { name: 'Wema Bank', code: '035' },
 { name: 'Zenith Bank', code: '057' },
 { name: 'Carbon (Paylater)', code: '565' },
 { name: 'Rubies MFB', code: '125' },
 { name: 'Sparkle MFB', code: '51310' },
 { name: 'ALAT by Wema', code: '035A' },
 { name: 'Mint MFB', code: '50304' },
 { name: 'Jaiz Bank', code: '301' }
 ];
 res.json(banks);
});
app.get('/api/verify-account', auth, async (req, res) => {
 const { account_number, bank_code } = req.query;
 if (!account_number || !bank_code) return res.status(400).json({ error: 'Account number and bank code required' });
 try {
 const r = await axios.get(`https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`, {
 headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
 timeout: 8000
 });
 res.json({ accountName: r.data.data.account_name, accountNumber: r.data.data.account_number });
 } catch (e) {
 res.status(400).json({ error: 'Name lookup unavailable. Enter your name manually.' });
 }
});
const FLW_IS_LIVE = process.env.FLW_ENV === 'live';
const FLW_API_BASE = FLW_IS_LIVE
 ? 'https://api.flutterwave.cloud/f4bexperience' // production
 : 'https://developersandbox-api.flutterwave.com'; // sandbox/test
const klsCountries = require('./lib/countries');
const klsGeo = require('./lib/geo');
const klsFx = require('./lib/fx');
const klsFlwMethods = require('./lib/flw-methods');
let klsPlatform = null; // set once lib/platform.js is mounted at the bottom of this file
const FLW_TOKEN_URL = 'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token';
let _flwTokenCache = { token: null, expiresAt: 0 };
async function getFlwAccessToken() {
 if (_flwTokenCache.token && Date.now() < _flwTokenCache.expiresAt - 30000) return _flwTokenCache.token; // 30s safety margin
 const params = new URLSearchParams({
 client_id: process.env.FLW_CLIENT_ID,
 client_secret: process.env.FLW_CLIENT_SECRET,
 grant_type: 'client_credentials'
 });
 const tokenRes = await axios.post(FLW_TOKEN_URL, params, {
 headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000
 });
 _flwTokenCache = { token: tokenRes.data.access_token, expiresAt: Date.now() + (tokenRes.data.expires_in * 1000) };
 return _flwTokenCache.token;
}
async function flwHeaders() {
 const token = await getFlwAccessToken();
 return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function handleFlutterwaveWebhook(req, res) {
 const receivedHash = req.headers['verif-hash'];
 const expectedHash = process.env.FLW_SECRET_HASH || process.env.FLW_WEBHOOK_HASH || '';
 console.log(' KLS webhook received:');
 console.log(' verif-hash header :', receivedHash || '(MISSING)');
 console.log(' expected hash :', expectedHash ? expectedHash.slice(0, 6) + '***' : '(NOT SET IN ENV)');
 console.log(' match? :', receivedHash && expectedHash && receivedHash === expectedHash ? 'YES ' : 'NO ');
 console.log(' raw headers :', JSON.stringify(req.headers).slice(0, 300));
 if (expectedHash && receivedHash !== expectedHash) {
 console.error(' KLS webhook REJECTED: signature mismatch.');
 console.error(' Got :', receivedHash);
 console.error(' Expected:', expectedHash);
 console.error(' Fix: set FLW_SECRET_HASH in your Render/env vars to match your Flutterwave Webhook Secret Hash');
 if (klsPlatform) await klsPlatform.logWebhook({ channel: 'charge', status: 'signature_rejected', message: 'verif-hash mismatch', payload: req.body });
 return res.status(401).json({ error: 'Invalid webhook signature' });
 }
 if (!expectedHash) {
 console.warn(' KLS webhook: FLW_SECRET_HASH not set — processing anyway (set it in env vars for security)');
 }
 const event = req.body;
 const tx = event.data || {};
 const eventType = event.event || event.type;
 const txStatus = tx.status;
 const txRefAny = tx.tx_ref || tx.reference || '';
 console.log('KLS webhook event:', eventType);
 console.log(' tx.id :', tx.id);
 console.log(' tx.tx_ref/ref :', txRefAny);
 console.log(' tx.flw_ref :', tx.flw_ref);
 console.log(' tx.amount :', tx.amount);
 console.log(' tx.status :', txStatus);
 console.log(' tx.currency :', tx.currency);
 console.log(' tx.customer :', JSON.stringify(tx.customer || {}));
 console.log(' tx.va_number :', tx.virtual_account_number || '(none)');
 console.log(' tx.narration :', tx.narration || tx.meta?.narration || '(none)');
 console.log(' tx.meta :', JSON.stringify(tx.meta || {}).slice(0, 300));
 // Record every delivery so the admin desk can prove what arrived and when.
 const whLog = klsPlatform ? await klsPlatform.logWebhook({
 channel: 'charge', event: eventType || 'unknown', reference: txRefAny,
 txId: tx.id, amount: tx.amount, currency: tx.currency,
 status: 'received', message: `status=${txStatus}`, payload: event,
 }) : null;
 const markWebhook = async (status, message) => {
 try {
 if (whLog && klsPlatform) {
 await klsPlatform.WebhookEvent.updateOne({ _id: whLog._id }, { $set: { status, message: String(message || '').slice(0, 900) } });
 if (['failed', 'conversion_error'].includes(status)) {
 await klsPlatform.alertOps('webhook_' + status, `Flutterwave charge webhook ${status}`, message, { reference: txRefAny, txId: tx.id });
 }
 }
 } catch { /* logging never breaks a credit */ }
 };
 const validCompletionEvents = ['charge.completed', 'charge.successful', 'transfer.completed', 'payment.successful'];
 const normEventType = String(eventType || '').trim().toLowerCase();
 if (!validCompletionEvents.includes(normEventType)) {
  res.json({ received: true });
  // ── AUTO-REVERSAL ──────────────────────────────────────────────────────────
  const isReversalEvent = [
    'transfer.reversal','charge.reversed','transfer.failed','virtual_account.reversed',
    'charge.failed','refund.processed','charge.refunded','refund.successful','transfer.reversed'
  ].includes(String(eventType || '').toLowerCase());
  if (isReversalEvent && txRefAny) {
    console.log(' [AUTO-REVERSAL] Processing:', eventType, 'ref:', txRefAny);
    try {
      const revIds = [tx.id, tx.flw_ref, tx.tx_ref, tx.reference].filter(Boolean).map(String);
      const origDeposit = await Transaction.findOne({ txRef: { $in: revIds }, type: 'deposit', status: 'success' });
      if (!origDeposit) { await markWebhook('ignored','reversal: no credited deposit for ref: '+txRefAny); return; }
      if (origDeposit.reversed) { await markWebhook('ignored','reversal: already reversed for ref: '+txRefAny); return; }
      const marked = await Transaction.findOneAndUpdate(
        { _id: origDeposit._id, reversed: { $ne: true } },
        { reversed: true, reversedAt: new Date(), reversalReason: 'Auto-reversal: '+eventType },
        { new: true }
      );
      if (!marked) { console.log(' [AUTO-REVERSAL] Concurrent block for ref:', txRefAny); return; }
      const reversalAmount = origDeposit.amount;
      const user = await User.findByIdAndUpdate(origDeposit.userId, { $inc: { balance: -reversalAmount } }, { new: true });
      if (user) {
        await Transaction.create({ userId: user._id, type: 'debit', amount: reversalAmount,
          description: 'Deposit reversal (auto): '+txRefAny+' — '+eventType,
          txRef: txRefAny+'_rev', status: 'success' });
        console.log(' [AUTO-REVERSAL] -₦'+reversalAmount+' from '+user.email+' → balance ₦'+user.balance+(user.balance<0?' (NEGATIVE)':''));
        if (user.balance < 0 && klsPlatform) {
          await klsPlatform.alertOps('negative_balance','User balance went negative after auto-reversal',
            'User: '+user.email+' — Balance: ₦'+user.balance+' after ₦'+reversalAmount+' reversal of '+txRefAny,
            { userId: String(user._id), txRef: txRefAny });
        }
      }
      await markWebhook('credited','Auto-reversal: ₦'+reversalAmount+' deducted from user '+origDeposit.userId);
    } catch (revErr) {
      console.error(' [AUTO-REVERSAL] Error:', revErr.message);
      await markWebhook('failed','auto-reversal error: '+revErr.message);
    }
    return;
  }
  await markWebhook('ignored', 'event type is not charge.completed: ' + eventType);
  console.log(' Skipping: event type is not charge.completed (got:', eventType, ')');
  return;
 }
 const normTxStatus = String(txStatus || '').trim().toLowerCase();
 if (!tx || (!['successful', 'succeeded', 'success', 'completed'].includes(normTxStatus))) {
 res.json({ received: true });
 console.warn(' Skipping: tx.status is not successful/succeeded (got:', txStatus, ')');
 await markWebhook('ignored', 'tx status not successful: ' + txStatus);
 return;
 }
 const normCurrency = String(tx.currency || '').trim().toUpperCase();
 if (normCurrency !== 'NGN' && normCurrency !== 'USD') {
 res.json({ received: true });
 console.warn(' Skipping: unsupported settlement currency (got:', tx.currency, ')');
 await markWebhook('ignored', 'unsupported currency: ' + tx.currency);
 return;
 }
 console.log(' All checks passed — processing credit...');
 // Credit BEFORE answering Flutterwave. The old code answered 200 first and
 // credited in setImmediate(): any crash, restart or transient DB/API error in
 // that background task silently threw the deposit away and Flutterwave never
 // retried it, which is why some deposits simply never confirmed.
 const processCharge = async () => {
 try {
 if (txRefAny) {
 console.log(` Checking ref '${txRefAny}' against PaymentLinkDeposit...`);
 const plDeposit = await PaymentLinkDeposit.findOne({ txRef: txRefAny });
 if (plDeposit) {
 console.log(` Matched PaymentLinkDeposit — routing to handlePaymentLinkWebhookCredit`);
 if (plDeposit.status === 'success') {
 if (klsPlatform) await klsPlatform.logIdempotencyConflict(txRefAny, 'Payment link deposit was already credited — duplicate delivery ignored', { txId: tx.id });
 await markWebhook('duplicate', 'payment link deposit already credited');
 return;
 }
 await handlePaymentLinkWebhookCredit(plDeposit, tx);
 await markWebhook('processed', 'Payment link deposit credited');
 return;
 }
 console.log(` Not a PL deposit. Checking BankTransferDeposit...`);
 const btDeposit = await BankTransferDeposit.findOne({ reference: txRefAny, status: 'pending' });
 if (btDeposit) {
 console.log(` Matched BankTransferDeposit ref=${txRefAny} — crediting via webhook`);
 const freshBT = await BankTransferDeposit.findOneAndUpdate(
 { _id: btDeposit._id, status: 'pending' },
 { status: 'success', flwChargeId: String(tx.flw_ref || tx.id || '') },
 { new: true }
 );
 if (freshBT) {
 const btUser = await User.findByIdAndUpdate(
 freshBT.userId,
 { $inc: { balance: freshBT.creditAmount } },
 { new: true }
 );
 await Transaction.create({
 userId: freshBT.userId, type: 'deposit', amount: freshBT.creditAmount, txRef: chargeKey(tx),
 description: `VA bank transfer deposit — ₦${freshBT.creditAmount.toLocaleString('en-NG')} credited (fee ₦${freshBT.fee}) via ${freshBT.bankName || 'bank transfer'}`,
 status: 'success'
 });
 if (btUser) pushBalanceToUser(freshBT.userId, btUser.balance);
 console.log(` BT webhook credited ₦${freshBT.creditAmount} for user ${freshBT.userId}`);
 await markWebhook('processed', 'Bank transfer deposit credited');
 } else {
 console.log(` BT deposit already credited (race condition prevented)`);
 if (klsPlatform) await klsPlatform.logIdempotencyConflict(txRefAny, 'Bank transfer deposit already credited — duplicate delivery ignored', { txId: tx.id });
 await markWebhook('duplicate', 'bank transfer deposit already credited');
 }
 return;
 }
 console.log(` No PL or BT deposit matched ref. Continuing to permanent VA match...`);
 }
 const settings = await getVASettings();
 if (!settings.globalEnabled) {
 console.warn('KLS webhook: virtual accounts globally disabled — tx', tx.id, 'not credited');
 return;
 }
 let user = null;
 const customerEmail = (tx.customer?.email || '').trim().toLowerCase();
 if (customerEmail) {
 user = await User.findOne({ email: customerEmail });
 if (user) console.log('KLS webhook: matched user by email:', customerEmail);
 }
 if (!user) {
 const meta = tx.meta || {};
 const vaAccNum =
 tx.virtual_account_number ||
 meta.virtual_account_number ||
 meta.account_number ||
 meta.destinationAccountNumber ||
 meta.beneficiaryAccountNumber ||
 (tx.account?.number) ||
 null;
 if (vaAccNum) {
 user = await User.findOne({ 'virtualAccount.accountNumber': vaAccNum });
 if (user) console.log('KLS webhook: matched user by VA account number:', vaAccNum);
 }
 }
 if (!user) {
 const narration = String(tx.narration || tx.meta?.narration || '');
 if (narration.startsWith(BRAND.txPrefix + ' ') || narration.startsWith(BRAND.txPrefix + '-')) {
 const nameSlug = narration.replace(new RegExp('^' + BRAND.txPrefix + '[-\\s]', 'i'), '').split(/[\s-]/)[0].toLowerCase();
 if (nameSlug.length >= 3) {
 user = await User.findOne({
 'virtualAccount.enabled': true,
 name: { $regex: new RegExp(nameSlug, 'i') }
 });
 if (user) console.log('KLS webhook: matched user by narration slug:', nameSlug, '', user.name);
 }
 }
 }
 if (!user) {
 await markWebhook('failed', 'No KLS user could be matched to this payment');
 console.warn('KLS webhook: NO user found for tx', tx.id,
 '| email:', customerEmail, '| ref:', txRefAny,
 '| This payment arrived in Flutterwave but was NOT credited.',
 '| Full customer:', JSON.stringify(tx.customer));
 return;
 }
 if (!user.virtualAccount?.enabled) {
 console.warn(`KLS webhook: VA disabled for ${user.email} — ₦${tx.amount} NOT credited`);
 return;
 }
 await handleVaWebhookCredit(user, tx);
 await markWebhook('processed', 'Virtual account deposit credited');
 } catch (e) {
 console.error('KLS webhook error:', e.message, e.stack?.slice(0, 400));
 await markWebhook('failed', e.message);
 throw e;
 }
 };
 try {
 await processCharge();
 res.json({ received: true });
 } catch {
 // Non-2xx = Flutterwave retries this exact delivery. The credit path is
 // idempotent, so a retry can never double-credit.
 res.status(500).json({ error: 'processing_failed, please retry' });
 }
}
app.post('/api/webhooks/flutterwave', express.json(), handleFlutterwaveWebhook);
app.post('/api/deposit/paymentlink/callback', express.json(), handleFlutterwaveWebhook);
// One stable key per Flutterwave charge. tx.id is the only value Flutterwave
// guarantees to be identical on every delivery / API read of the same charge;
// flw_ref alone changed shape between retries and channels, which is how the
// same money could be recorded twice under two different keys.
function chargeKey(tx) {
 return String(tx.id || tx.flw_ref || tx.tx_ref || tx.reference || '');
}
// A charge that already belongs to a payment link or a one-off bank-transfer
// deposit must never be credited again by the permanent-VA path (webhook or
// reconciler) — that was a real double-credit route.
async function chargeBelongsToOtherChannel(tx) {
 const ids = [tx.id, tx.flw_ref, tx.tx_ref, tx.reference].filter(Boolean).map(String);
 if (!ids.length) return false;
 try {
  const [pl, bt] = await Promise.all([
   PaymentLinkDeposit.findOne({ $or: [{ txRef: { $in: ids } }, { flwTransactionId: { $in: ids } }] }).select('_id'),
   BankTransferDeposit.findOne({ $or: [{ reference: { $in: ids } }, { flwChargeId: { $in: ids } }] }).select('_id')
  ]);
  return !!(pl || bt);
 } catch { return false; }
}
async function handleVaWebhookCredit(user, tx) {
 const flwRef = chargeKey(tx);
 if (!flwRef) { console.warn(' VA credit skipped: charge has no usable reference'); return { status: 'skipped' }; }
 console.log(`\n handleVaWebhookCredit START user=${user.email} key=${flwRef} amount=${tx.amount}`);
 if (await chargeBelongsToOtherChannel(tx)) {
  console.log(` ${flwRef} belongs to a payment-link/bank-transfer deposit — not crediting again`);
  return { status: 'duplicate' };
 }
 const receivedAmount = Number(tx.amount || 0);
 if (receivedAmount <= 0) { console.warn(' SKIPPED: received amount is zero or negative'); return { status: 'skipped' }; }
 const fee = calcDepositFee(receivedAmount);
 const creditAmount = receivedAmount - fee;
 if (creditAmount <= 0) { console.warn(` SKIPPED: credit ₦${creditAmount} after ₦${fee} fee`); return { status: 'skipped' }; }

 // ── ATOMIC CLAIM ───────────────────────────────────────────────────────────
 // The old code did findOne() then create(). Two deliveries arriving at the
 // same moment (webhook + poll, or several users hitting the box at once) both
 // saw "no record" and both credited. Now the claim is a single upsert: only
 // the request that actually INSERTS the row is allowed to move money.
 let claimedNew = false;
 let claimId = null;
 try {
  const claim = await VirtualAccountDeposit.findOneAndUpdate(
   { flwRef },
   { $setOnInsert: {
     userId: user._id, flwRef, flwTxId: String(tx.id || ''),
     amount: receivedAmount, creditAmount,
     accountNumber: user.virtualAccount?.accountNumber || '',
     status: 'pending', rawPayload: tx, createdAt: new Date()
    } },
   { upsert: true, new: true, rawResult: true }
  );
  claimedNew = !claim?.lastErrorObject?.updatedExisting;
  claimId = claim?.value?._id;
 } catch (e) {
  if (e && e.code === 11000) { console.log(` DUPLICATE ${flwRef} — another worker already claimed it`); return { status: 'duplicate' }; }
  throw e; // real DB problem → webhook returns 500 → Flutterwave retries
 }
 if (!claimedNew) { console.log(` DUPLICATE ${flwRef} for ${user.email} — already recorded, skipping`); return { status: 'duplicate' }; }

 // ── INDEPENDENT VERIFICATION ───────────────────────────────────────────────
 let verified = true;
 try {
  const vRes = await flwAxios.get(`/transactions/${tx.id}/verify`, { timeout: 8000 });
  const vtx = vRes.data?.data;
  if (vtx) {
   verified = String(vtx.status || '').trim().toLowerCase() === 'successful' && String(vtx.currency || '').trim().toUpperCase() === 'NGN' && Number(vtx.amount) >= receivedAmount * 0.99;
   console.log(` verify: status=${vtx.status} currency=${vtx.currency} amount=${vtx.amount} → ${verified}`);
  } else {
   console.warn(' Verify returned no data — trusting the signed webhook');
  }
 } catch (ve) {
  console.warn(` Verify API unavailable (${ve.message}) — trusting the signed webhook`);
 }
 if (!verified) {
  // Release the claim so a later legitimate delivery can still be credited.
  if (claimId) await VirtualAccountDeposit.deleteOne({ _id: claimId, status: 'pending' }).catch(() => {});
  console.warn(` ${flwRef} NOT credited — failed Flutterwave verification`);
  return { status: 'rejected' };
 }

 // ── MONEY MOVES ONCE ───────────────────────────────────────────────────────
 // The wallet transaction carries txRef = the charge key and a unique index,
 // so even if this collection was ever recreated without the VA index, the
 // second attempt throws instead of crediting twice.
 try {
  await Transaction.create({
   userId: user._id, type: 'deposit', amount: creditAmount, txRef: flwRef,
   description: `VA deposit — ₦${creditAmount.toLocaleString('en-NG')} credited (₦${receivedAmount.toLocaleString('en-NG')} received, ₦${fee} fee) via ${user.virtualAccount?.bankName || 'bank transfer'}`,
   status: 'success'
  });
 } catch (e) {
  if (e && e.code === 11000) {
   console.log(` ${flwRef} already has a wallet transaction — not crediting again`);
   await VirtualAccountDeposit.updateOne({ _id: claimId }, { $set: { status: 'success' } }).catch(() => {});
   return { status: 'duplicate' };
  }
  throw e;
 }
 const updated = await User.findByIdAndUpdate(user._id, { $inc: { balance: creditAmount } }, { new: true }).select('balance');
 await VirtualAccountDeposit.updateOne({ _id: claimId }, { $set: { status: 'success' } });
 if (updated) {
  pushBalanceToUser(user._id, updated.balance, creditAmount);
  const vaDepMsg = `event: va_deposit\ndata: ${JSON.stringify({
   creditAmount, receivedAmount, fee, balance: updated.balance,
   bank: user.virtualAccount?.bankName || 'bank transfer', flwRef, ts: Date.now()
  })}\n\n`;
  const clients = sseClients.get(String(user._id));
  if (clients && clients.size) { for (const r of clients) { try { r.write(vaDepMsg); } catch { clients.delete(r); } } }
 }
 console.log(` KLS VA credited: ₦${creditAmount} to ${user.email} (received ₦${receivedAmount}, fee ₦${fee}) | key:${flwRef}`);
 return { status: 'credited', creditAmount };
}
async function handlePaymentLinkWebhookCredit(deposit, tx) {
 if (deposit.status === 'success') { console.log(`Payment link webhook: tx_ref ${deposit.txRef} already credited — skipped`); return; }
 const expectedCurrency = String(deposit.currency || 'NGN').toUpperCase();
 const gotCurrency = String(tx.currency || 'NGN').toUpperCase();
 if (gotCurrency !== expectedCurrency) {
 console.warn(`Payment link webhook: currency mismatch for ${deposit.txRef} — expected ${expectedCurrency}, got ${tx.currency}`);
 return;
 }
 const receivedAmt = Number(tx.charged_amount || tx.amount || 0);
 if (receivedAmt < (deposit.amount * 0.98)) {
 console.warn(`Payment link webhook: amount mismatch for ${deposit.txRef} — expected ≥${expectedCurrency} ${deposit.amount}, got ${tx.amount}`);
 return;
 }
 await creditPaymentLinkDeposit(deposit, tx);
 console.log(` Payment link deposit credited via webhook: ₦${deposit.creditAmount} for tx_ref ${deposit.txRef}`);
}
const FLW_PROXY_URL = process.env.FLW_PROXY_URL || '';
let flwProxyAgent = null;
if (FLW_PROXY_URL) {
 try {
 const { HttpsProxyAgent } = require('https-proxy-agent');
 flwProxyAgent = new HttpsProxyAgent(FLW_PROXY_URL);
 console.log('Flutterwave requests will be routed through FLW_PROXY_URL');
 } catch (e) {
 console.error('FLW_PROXY_URL is set but https-proxy-agent failed to load — run `npm install`. Falling back to direct requests.', e.message);
 }
}
const FLW_V3_BASE = 'https://api.flutterwave.com/v3';
const flwAxios = axios.create({
 baseURL: FLW_V3_BASE,
 timeout: 15000,
 httpsAgent: flwProxyAgent || undefined,
 proxy: false // disable axios' own proxy env-var handling; we manage the agent ourselves
});
flwAxios.interceptors.request.use(config => {
 config.headers = { ...config.headers, Authorization: `Bearer ${process.env.FLW_V3_SECRET_KEY}` };
 return config;
});
const virtualAccountDepositSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 flwRef: { type: String, required: true, unique: true }, // Flutterwave tx reference
 flwTxId: { type: String, default: '' },
 amount: { type: Number, required: true },
 creditAmount: { type: Number, required: true },
 accountNumber: { type: String },
 status: { type: String, enum: ['pending','success','failed'], default: 'pending' },
 rawPayload: { type: Object },
 createdAt: { type: Date, default: Date.now }
});
const VirtualAccountDeposit = mongoose.model('VirtualAccountDeposit', virtualAccountDepositSchema);
// One single settings document — there used to be two different schemas
// registered under the same model name, which meant findOne() could return a
// *different* document than the one the admin toggle wrote to. That is exactly
// how "Virtual Accounts Temporarily Unavailable" ended up showing for some
// people while others were fine. Now there is exactly one document, always.
const virtualAccountSettingsSchema = new mongoose.Schema({
 globalEnabled: { type: Boolean, default: true },
 updatedAt: { type: Date, default: Date.now }
});
const VirtualAccountSettings = mongoose.model('VirtualAccountSettings', virtualAccountSettingsSchema);
async function getVASettings() {
 try {
 let s = await VirtualAccountSettings.findOne().sort({ _id: 1 });
 if (!s) { s = await VirtualAccountSettings.create({ globalEnabled: true }); }
 // Clean up any stray duplicate settings docs from older releases so the
 // answer can never depend on which one happens to be read first.
 VirtualAccountSettings.deleteMany({ _id: { $ne: s._id } }).catch(() => {});
 return s;
 } catch (e) {
 // Never let a database hiccup look like "maintenance mode" to a customer.
 console.error('[KLS] getVASettings failed, defaulting to ENABLED:', e.message);
 return { globalEnabled: true };
 }
}
app.put('/api/admin/virtual-accounts/settings', adminAuth, async (req, res) => {
 try {
 const { globalEnabled } = req.body;
 let s = await VirtualAccountSettings.findOne().sort({ _id: 1 });
 if (!s) s = new VirtualAccountSettings();
 s.globalEnabled = !!globalEnabled;
 s.updatedAt = new Date();
 await s.save();
 await VirtualAccountSettings.deleteMany({ _id: { $ne: s._id } }).catch(() => {});
 console.log('[KLS] Admin set virtual accounts globalEnabled =', s.globalEnabled);
 res.json({ globalEnabled: s.globalEnabled });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/virtual-accounts/settings', adminAuth, async (req, res) => {
 try {
 const s = await getVASettings();
 res.json({ globalEnabled: s.globalEnabled });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/virtual-accounts', adminAuth, async (req, res) => {
 try {
 const users = await User.find({ 'virtualAccount.accountNumber': { $ne: '' } })
 .select('name email virtualAccount balance createdAt')
 .sort({ 'virtualAccount.createdAt': -1 })
 .limit(500);
 res.json(users.map(u => ({
 id: u._id, name: u.name, email: u.email, balance: u.balance,
 virtualAccount: u.virtualAccount, createdAt: u.createdAt
 })));
 } catch (e) { res.status(500).json({ error: e.message }); }
});
/**
 * Which country do we treat this customer as being in for the virtual-account
 * rail? Profile country wins, then a Nigerian phone number on the profile
 * (this rescues long-standing users who signed up before the country field
 * existed and who browse through a VPN or a foreign mobile network), then the
 * normal header/IP lookup. Nigeria is the fallback, never a foreign country.
 */
async function resolveVACountry(req, user) {
 const profile = String(user?.country || '').trim().toUpperCase();
 if (profile) return { code: profile, source: 'profile' };
 const phone = String(user?.contactPhone || '').replace(/[^0-9+]/g, '');
 if (/^(\+?234|0)[789]\d{9}$/.test(phone)) return { code: 'NG', source: 'phone' };
 try {
 return await klsGeo.resolveCountry(req, user);
 } catch (e) {
 console.error('[KLS] geo lookup failed, defaulting to NG:', e.message);
 return { code: 'NG', source: 'default' };
 }
}
async function createVirtualAccountForUser(user) {
 // ── NIGERIA-ONLY HARD GUARD ────────────────────────────────────────────────
 // Flutterwave has only approved dedicated virtual accounts for Nigeria on this
 // merchant account (Bank Transfer Ghana is still pending review), so no other
 // market may ever have one created — not by a user, not by an admin.
 const vaCountry = String(user.country || 'NG').toUpperCase();
 if (!klsFlwMethods.supportsVirtualAccount(vaCountry)) {
 const err = new Error('Virtual accounts are available to customers in Nigeria only. Use the payment link — it is priced in US dollars for your country.');
 err.status = 403;
 throw err;
 }
 if (user.virtualAccount?.accountNumber) {
 user.virtualAccount.enabled = true;
 await user.save();
 return { message: 'Virtual account re-enabled', virtualAccount: user.virtualAccount };
 }
 const bvn = process.env.FLW_PLATFORM_BVN;
 if (!bvn) throw new Error('FLW_PLATFORM_BVN is not set in environment variables');
 if (!process.env.FLW_V3_SECRET_KEY) throw new Error('FLW_V3_SECRET_KEY is not set');
 const slug = user.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
 const txRef = `${BRAND.txPrefix}-VA-${slug}-${Date.now()}`;
 const nameParts = user.name.trim().split(/\s+/);
 const firstName = nameParts[0] || 'KLS';
 const lastName = nameParts.slice(1).join(' ') || 'User';
 const payload = {
 email: user.email, // KEY: this is how we match payments back to the user
 is_permanent: true, // permanent — never expires
 bvn: bvn,
 tx_ref: txRef,
 amount: 0, // no pre-set amount — any amount accepted
 currency: 'NGN',
 narration: `${BRAND.txPrefix} ${user.name.trim().slice(0, 18)}`, // shows on sender's bank receipt
 firstname: firstName,
 lastname: lastName,
 phonenumber: user.contactPhone || '08000000000',
 };
 const flwRes = await flwAxios.post('/virtual-account-numbers', payload, { timeout: 20000 });
 const va = flwRes.data?.data;
 if (!va || !va.account_number) {
 console.error('FLW virtual account creation failed:', flwRes.data);
 throw new Error(flwRes.data?.message || 'Flutterwave did not return an account number');
 }
 user.virtualAccount = {
 enabled: true,
 accountNumber: va.account_number,
 bankName: va.bank_name || 'Wema Bank',
 accountName: `${BRAND.txPrefix} ${user.name.trim()}`.slice(0, 30), // "KLS John Doe" — shown on deposit page and bank receipts
 flwRef: va.flw_ref || txRef,
 createdAt: new Date()
 };
 await user.save();
 return { message: ' Virtual account created', virtualAccount: user.virtualAccount };
}
app.get('/api/user/virtual-account', auth, async (req, res) => {
 try {
 const user = await User.findById(req.user._id).select('virtualAccount name balance country contactPhone');
 const settings = await getVASettings();
 const va = user.virtualAccount || {};
 // Nigeria-only rail. The country comes from the profile first and from the
 // caller's IP when the profile has none, so accounts created before the
 // country field existed are handled correctly too. Any non-Nigerian user —
 // including one who already has an account number from an earlier release —
 // gets nothing back and the deposit page hides the card entirely.
 const geoRes = await resolveVACountry(req, user);
 console.log(`[KLS] VA check for ${user.email || user._id}: country=${geoRes.code} (${geoRes.source}) globalEnabled=${settings.globalEnabled} hasAccount=${!!va.accountNumber}`);
 if (geoRes.code !== 'NG') {
 return res.json({
 enabled: false,
 available: false,
 reason: 'country',
 country: geoRes.code,
 message: 'Virtual accounts are available to customers in Nigeria only. Use the payment link — it is priced in US dollars for your country.',
 balance: user.balance || 0,
 globalEnabled: settings.globalEnabled
 });
 }
 res.json({
 available: true,
 enabled: !!(va.enabled && va.accountNumber),
 accountNumber: va.accountNumber || '',
 bankName: va.bankName || 'Wema Bank',
 accountName: va.accountName || user.name || '',
 userName: user.name || '',
 balance: user.balance || 0,
 createdAt: va.createdAt || null,
 globalEnabled: settings.globalEnabled
 });
 } catch (e) {
 // A failure here must never be mistaken for "maintenance". Report the error
 // but keep available/globalEnabled true so the page shows the Generate card.
 console.error('[KLS] /api/user/virtual-account failed:', e.message);
 res.status(200).json({ available: true, enabled: false, globalEnabled: true, error: e.message, balance: req.user?.balance || 0 });
 }
});
app.post('/api/user/virtual-account/create', auth, async (req, res) => {
 try {
 const settings = await getVASettings();
 if (!settings.globalEnabled) return res.status(503).json({ error: 'Virtual accounts are temporarily disabled — please try again later or use another deposit method.' });
 const user = await User.findById(req.user._id);
 if (!user) return res.status(404).json({ error: 'User not found' });
 if (!user.contactPhone) {
 return res.status(428).json({ error: 'Please add your phone number and country before creating a virtual account.', needsPhone: true });
 }
 const resolved = await resolveVACountry(req, user);
 console.log(`[KLS] VA create requested by ${user.email}: country=${resolved.code} (${resolved.source})`);
 if (resolved.code !== 'NG') {
 return res.status(403).json({
 error: 'Virtual accounts are available to customers in Nigeria only. Use the payment link — it is priced in US dollars for your country.',
 methods: ['paymentlink'],
 });
 }
 const result = await createVirtualAccountForUser(user);
 res.json(result);
 } catch (e) {
 const msg = e.response?.data?.message || e.message;
 console.error('Self-serve VA create error:', msg);
 res.status(e.status || 500).json({ error: msg });
 }
});
app.post('/api/admin/virtual-accounts/create/:userId', adminAuth, async (req, res) => {
 try {
 const user = await User.findById(req.params.userId);
 if (!user) return res.status(404).json({ error: 'User not found' });
 const result = await createVirtualAccountForUser(user);
 res.json(result);
 } catch (e) {
 const msg = e.response?.data?.message || e.message;
 console.error('VA create error:', msg);
 res.status(e.status || 500).json({ error: msg });
 }
});
app.put('/api/admin/virtual-accounts/toggle/:userId', adminAuth, async (req, res) => {
 try {
 const user = await User.findById(req.params.userId);
 if (!user) return res.status(404).json({ error: 'User not found' });
 if (!user.virtualAccount?.accountNumber) return res.status(400).json({ error: 'User has no virtual account yet. Create one first.' });
 user.virtualAccount.enabled = !user.virtualAccount.enabled;
 await user.save();
 res.json({ message: `Virtual account ${user.virtualAccount.enabled ? 'enabled' : 'disabled'}`, enabled: user.virtualAccount.enabled });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/virtual-accounts/:userId', adminAuth, async (req, res) => {
 try {
 const user = await User.findById(req.params.userId);
 if (!user) return res.status(404).json({ error: 'User not found' });
 user.virtualAccount = { enabled: false, accountNumber: '', bankName: '', accountName: '', flwRef: '' };
 await user.save();
 res.json({ message: 'Virtual account removed from this user' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/virtual-accounts/deposits', adminAuth, async (req, res) => {
 try {
 const deposits = await VirtualAccountDeposit.find()
 .sort({ createdAt: -1 }).limit(200)
 .populate('userId', 'name email');
 res.json(deposits);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
const paymentLinkDepositSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 txRef: { type: String, required: true, unique: true },
 amount: { type: Number, required: true }, // what Flutterwave actually charges the user
 // The charge currency. Nigeria is billed in NGN; every other country is
 // billed in USD, so verification must compare against THIS, not a hardcoded
 // 'NGN' — otherwise a legitimate dollar payment never gets credited.
 currency: { type: String, default: 'NGN' },
 creditAmount: { type: Number, required: true }, // what gets added to the wallet (amount - fee)
 fee: { type: Number, default: 0 },
 status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
 flwTransactionId: { type: String, default: '' },
 rawPayload: { type: mongoose.Schema.Types.Mixed },
 creditedAt: { type: Date },
 // Reversal tracking — prevents double-deduction if a failed deposit webhook fires twice
 reversed: { type: Boolean, default: false },
 reversedAt: { type: Date, default: null },
 reversalReason: { type: String, default: '' },
 createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }
});
const PaymentLinkDeposit = mongoose.model('PaymentLinkDeposit', paymentLinkDepositSchema);
function calcDepositFee(creditAmount) {
 if (creditAmount >= 100 && creditAmount <= 499) return 10;
 if (creditAmount >= 500 && creditAmount <= 999) return 20;
 if (creditAmount >= 1000 && creditAmount <= 9999) return 50;
 if (creditAmount >= 10000 && creditAmount <= 99999) return 100;
 if (creditAmount >= 100000) return 100; // capped flat for very large deposits
 return 0;
}
function calcChargeAmount(creditAmount) {
 return creditAmount + calcDepositFee(creditAmount);
}
app.post('/api/deposit/paymentlink/create', auth, async (req, res) => {
 try {
 if (!process.env.FLW_V3_SECRET_KEY) {
 return res.status(503).json({ error: 'Payments are not configured yet — contact support.' });
 }
 const methodSetting = await PaymentMethodSetting.findOne({ method: 'paymentlink' });
 if (methodSetting && methodSetting.enabled === false) {
 return res.status(503).json({ error: methodSetting.disabledMessage || 'Payment Link deposits are temporarily unavailable — please try again later.' });
 }
 const { amount, method } = req.body;
 const user = await User.findById(req.user._id);
 if (!user) return res.status(404).json({ error: 'User not found' });
 // Nigerians pay in naira; everyone else pays in US dollars. The wallet ledger
 // stays in NGN either way, so a dollar charge is converted at the live rate.
 // The country is resolved from the profile first and the request second, so a
 // missing profile country can never accidentally price a foreign user in ₦.
 const plGeo = await klsGeo.resolveCountry(req, user);
 const payCurrency = klsCountries.payCurrencyFor(plGeo.code);
 const parsedAmount = parseFloat(amount);
 let creditNgn, chargeAmount, chargeCurrency, fee;
 if (payCurrency === 'USD') {
 if (!parsedAmount || parsedAmount < 1) return res.status(400).json({ error: 'Minimum deposit is $1' });
 let ngn;
 try { ngn = Math.floor(await klsFx.ngnCreditForPayment(parsedAmount, 'USD')); }
 catch (convErr) {
 if (klsPlatform) await klsPlatform.logConversionError('USD→NGN quote failed while creating a payment link', convErr.message, { userId: String(user._id) });
 return res.status(503).json({ error: 'Exchange rates are temporarily unavailable — please try again in a moment.' });
 }
 // Foreign deposits carry the same service charge as naira deposits, and it is
 // ADDED to what the customer pays instead of shaved off the wallet credit, so
 // "deposit $10" always lands the full dollar value in the wallet.
 fee = calcDepositFee(ngn);
 const ngnPerUsd = ngn / parsedAmount; // effective rate for this quote
 const feeUsd = Math.ceil((fee / ngnPerUsd) * 100) / 100;
 creditNgn = ngn;
 chargeAmount = Math.round((parsedAmount + feeUsd) * 100) / 100;
 chargeCurrency = 'USD';
 } else {
 if (!parsedAmount || parsedAmount < 100) return res.status(400).json({ error: 'Minimum deposit is ₦100' });
 fee = calcDepositFee(parsedAmount);
 creditNgn = parsedAmount;
 chargeAmount = parsedAmount + fee;
 chargeCurrency = 'NGN';
 }
 // Only the rails Flutterwave has actually approved for this market are
 // offered — a customer never sees a method that will fail at checkout.
 const paymentOptions = klsFlwMethods.paymentOptionsFor(plGeo.code, chargeCurrency);
 const txRef = `${BRAND.txPrefix}-PL-${user._id}-${Date.now()}`;
 const siteUrl = process.env.SITE_URL || '';
 const payload = {
 tx_ref: txRef,
 amount: chargeAmount,
 currency: chargeCurrency,
 redirect_url: `${siteUrl}/api/deposit/paymentlink/callback`,
 payment_options: paymentOptions,
 customer: {
 email: user.email, // auto-filled from the logged-in account — never typed by the user
 name: user.name || `KLS Customer`
 },
 customizations: { title: 'KLS Wallet Deposit', description: `Deposit for ${user.name}` }
 };
 const flwRes = await flwAxios.post(`/payments`, payload, {
 headers: { 'Content-Type': 'application/json' },
 timeout: 15000
 });
 const link = flwRes.data?.data?.link;
 if (!link) throw new Error('Flutterwave did not return a payment link');
 await PaymentLinkDeposit.create({ userId: user._id, txRef, amount: chargeAmount, currency: chargeCurrency, creditAmount: creditNgn, fee, status: 'pending' });
 res.json({ link, txRef, currency: chargeCurrency, charged: chargeAmount, creditNgn, country: plGeo.code, paymentOptions });
 } catch (e) {
 console.error('Payment link create error:', JSON.stringify(e.response?.data || e.message, null, 2));
 try {
 await SystemError.create({
 source: 'flutterwave',
 message: 'Failed to create payment link for deposit',
 detail: JSON.stringify(e.response?.data || e.message),
 context: { userId: req.user?._id, attemptedAmount: req.body?.amount }
 });
 } catch {}
 res.status(502).json({
 error: 'Our payment provider is temporarily unavailable. Your funds are safe — nothing was charged. Please try again shortly, or contact support if this keeps happening.'
 });
 }
});
app.get('/api/deposit/paymentlink/callback', async (req, res) => {
 const siteUrl = process.env.SITE_URL || '';
 const failRedirect = `${siteUrl}/deposit?deposit=failed`;
 const pendingRedirect = (txRef) => `${siteUrl}/deposit?deposit=pending&txRef=${encodeURIComponent(txRef)}`;
 try {
 const { status, tx_ref, transaction_id } = req.query;
 if (!tx_ref) return res.redirect(failRedirect);
 const deposit = await PaymentLinkDeposit.findOne({ txRef: tx_ref });
 if (!deposit) return res.redirect(failRedirect);
 if (deposit.status === 'success') return res.redirect(`${siteUrl}/deposit?deposit=success`);
 if (status === 'cancelled' || status === 'failed') {
 console.warn(`Browser callback reported ${status} for ${tx_ref} — leaving deposit open for the webhook / verification`);
 return res.redirect(`${siteUrl}/deposit?deposit=cancelled`);
 }
 if (!process.env.FLW_V3_SECRET_KEY) return res.redirect(failRedirect);
 if (transaction_id) {
 try {
 const verify = await flwAxios.get(`/transactions/${transaction_id}/verify`, { timeout: 15000 });
 const tx = verify.data?.data;
 const ok = tx && String(tx.status || '').trim().toLowerCase() === 'successful'
 && String(tx.currency || '').trim().toUpperCase() === String(deposit.currency || 'NGN').toUpperCase()
 && Number(tx.amount) >= Number(deposit.amount) * 0.98 && tx.tx_ref === deposit.txRef;
 if (ok) { await creditPaymentLinkDeposit(deposit, tx); return res.redirect(`${siteUrl}/deposit?deposit=success`); }
 } catch (e) { console.error('Callback verify-by-id error:', e.response?.data || e.message); }
 }
 try {
 const verify = await flwAxios.get(`/transactions/verify_by_reference`, {
 params: { tx_ref: deposit.txRef }, timeout: 15000
 });
 const tx = verify.data?.data;
 if (tx && String(tx.status || '').trim().toLowerCase() === 'successful' && String(tx.currency || '').trim().toUpperCase() === String(deposit.currency || 'NGN').toUpperCase() && Number(tx.amount) >= Number(deposit.amount) * 0.98) {
 await creditPaymentLinkDeposit(deposit, tx);
 return res.redirect(`${siteUrl}/deposit?deposit=success`);
 }
 return res.redirect(pendingRedirect(tx_ref));
 } catch (e) {
 console.error('Callback verify-by-ref error:', e.response?.data || e.message);
 return res.redirect(pendingRedirect(tx_ref));
 }
 } catch (e) {
 console.error('Payment link callback error:', e.response?.data || e.message);
 res.redirect(failRedirect);
 }
});
async function creditPaymentLinkDeposit(deposit, tx) {
  const fresh = await PaymentLinkDeposit.findOneAndUpdate(
    { _id: deposit._id, status: 'pending' },
    { status: 'success', flwTransactionId: String(tx.id || ''), creditedAt: new Date(), rawPayload: tx },
    { new: true }
  );
  if (!fresh) return; // Already credited or failed — never double-credit
  // Use atomic $inc so a concurrent deposit/purchase never causes a race condition
  const updated = await User.findByIdAndUpdate(
    fresh.userId,
    { $inc: { balance: fresh.creditAmount ?? fresh.amount } },
    { new: true }
  ).select('balance name email');
  if (!updated) return;
  const creditAmount = fresh.creditAmount ?? fresh.amount;
  await Transaction.create({
    userId: updated._id, type: 'deposit', amount: creditAmount,
    txRef: deposit.txRef,
    description: `Deposit via Flutterwave payment link (${tx.payment_type || 'unknown method'})`,
    status: 'success'
  });
  pushBalanceToUser(updated._id, updated.balance, creditAmount);
  console.log(`✅ Payment link deposit credited: ₦${creditAmount} (charged ₦${fresh.amount}) for ${updated.name}`);
}

// ── Admin: Reverse a failed deposit ──────────────────────────────────────────
// Called manually by admin if a credited deposit later bounces/reverses.
// Uses the reversed:false guard to ensure exactly-once deduction.
app.post('/api/admin/deposit/reverse', adminAuth, async (req, res) => {
  try {
    const { txRef, reason } = req.body;
    if (!txRef) return res.status(400).json({ error: 'txRef required' });

    // Find by PaymentLinkDeposit first
    let deposit = await PaymentLinkDeposit.findOne({ txRef });
    if (!deposit) {
      // Try bank transfer deposits
      const BankTransferDeposit = mongoose.models.BankTransferDeposit;
      if (BankTransferDeposit) deposit = await BankTransferDeposit.findOne({ reference: txRef });
    }
    if (!deposit) return res.status(404).json({ error: 'Deposit not found by txRef/reference' });
    if (deposit.status !== 'success') return res.status(400).json({ error: 'Deposit was never successfully credited — nothing to reverse' });
    if (deposit.reversed) return res.status(400).json({ error: `Already reversed on ${deposit.reversedAt?.toLocaleString('en-NG')} — will not deduct again` });

    const creditAmount = deposit.creditAmount ?? deposit.amount ?? 0;

    // Atomic mark-as-reversed FIRST — if this fails (already reversed), we stop before touching balance
    const marked = await deposit.constructor.findOneAndUpdate(
      { _id: deposit._id, reversed: false },
      { reversed: true, reversedAt: new Date(), reversalReason: reason || 'Admin reversal' },
      { new: true }
    );
    if (!marked) return res.status(409).json({ error: 'Concurrent reversal detected — deposit was already reversed' });

    // Now deduct — balance can go negative (same as admin deduct)
    const user = await User.findByIdAndUpdate(
      deposit.userId,
      { $inc: { balance: -creditAmount } },
      { new: true }
    ).select('balance name email');
    if (!user) return res.status(404).json({ error: 'User not found — manual balance fix needed' });

    await Transaction.create({
      userId: user._id, type: 'admin_debit', amount: creditAmount,
      description: `Deposit reversal: ${txRef} — ${reason || 'failed transaction reversed'}`,
      status: 'success'
    });
    pushBalanceToUser(user._id, user.balance);
    console.log(`[KLS] Deposit reversed: ₦${creditAmount} from ${user.email} (txRef:${txRef}) — new balance ₦${user.balance}`);
    res.json({
      success: true,
      message: `✅ Reversed ₦${creditAmount.toLocaleString('en-NG')} from ${user.name}'s wallet`,
      newBalance: user.balance,
      userName: user.name, userEmail: user.email,
      note: user.balance < 0 ? `⚠️ Balance is now negative (₦${user.balance.toLocaleString('en-NG')}) — user spent the money before reversal` : null
    });
  } catch (e) {
    console.error('[deposit-reverse]', e.message);
    res.status(500).json({ error: 'Reversal failed: ' + e.message });
  }
});
app.get('/api/deposit/paymentlink/status/:txRef', auth, async (req, res) => {
 try {
 const deposit = await PaymentLinkDeposit.findOne({ txRef: req.params.txRef, userId: req.user._id });
 if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
 if (deposit.status !== 'pending') return res.json({ status: deposit.status, creditAmount: deposit.creditAmount });
 if (process.env.FLW_V3_SECRET_KEY) {
 try {
 const verify = await flwAxios.get(`/transactions/verify_by_reference`, {
 params: { tx_ref: deposit.txRef }, timeout: 12000
 });
 const tx = verify.data?.data;
 if (tx && tx.status === 'successful' && tx.currency === (deposit.currency || 'NGN') && tx.amount >= deposit.amount) {
 await creditPaymentLinkDeposit(deposit, tx);
 return res.json({ status: 'success', creditAmount: deposit.creditAmount });
 }
 if (tx && (tx.status === 'failed' || tx.status === 'cancelled')) {
   await PaymentLinkDeposit.updateOne({ _id: deposit._id, status: 'pending' }, { $set: { status: 'failed', rawPayload: tx } });
   return res.json({ status: 'failed' });
 }
 if (tx && tx.status === 'pending') return res.json({ status: 'pending' });
 } catch (pollErr) {
 console.error('Payment link status poll error:', pollErr.response?.data || pollErr.message);
 }
 }
 res.json({ status: 'pending' });
 } catch (e) {
 console.error('Status check error:', e.message);
 res.status(500).json({ error: 'Failed to check deposit status' });
 }
});
const bankTransferDepositSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 reference: { type: String, required: true, unique: true },
 virtualAccountId: { type: String, default: '' },
 accountNumber: { type: String, default: '' },
 bankName: { type: String, default: '' },
 amount: { type: Number, required: true }, // what Flutterwave actually charges (incl. fee)
 creditAmount: { type: Number, required: true }, // what gets added to the wallet
 fee: { type: Number, default: 0 },
 status: { type: String, enum: ['pending', 'success', 'failed', 'expired'], default: 'pending' },
 expiresAt: { type: Date },
 flwChargeId: { type: String, default: '' },
 createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 7 }
});
const BankTransferDeposit = mongoose.model('BankTransferDeposit', bankTransferDepositSchema);
const FLW_BANK_TRANSFER_BANK_CODE = process.env.FLW_BANK_TRANSFER_BANK_CODE || '035';
const flwV4Axios = axios.create({
 baseURL: FLW_API_BASE,
 timeout: 15000,
 httpsAgent: flwProxyAgent || undefined,
 proxy: false
});
flwV4Axios.interceptors.request.use(async config => {
 const token = await getFlwAccessToken();
 config.headers = { ...config.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
 return config;
});
async function getOrCreateFlwCustomer(user) {
 if (user.flwCustomerId) return user.flwCustomerId;
 const nameParts = (user.name || 'KLS Customer').trim().split(/\s+/);
 const first = nameParts[0] || 'KLS';
 const last = nameParts.slice(1).join(' ') || 'Customer';
 const r = await flwV4Axios.post('/customers', { name: { first, last }, email: user.email });
 const customerId = r.data?.data?.id;
 if (!customerId) throw new Error('Flutterwave did not return a customer id');
 user.flwCustomerId = customerId;
 await user.save();
 return customerId;
}
app.post('/api/deposit/banktransfer/create', auth, async (req, res) => {
 try {
 if (!process.env.FLW_CLIENT_ID || !process.env.FLW_CLIENT_SECRET) {
 return res.status(503).json({ error: 'Bank transfer deposits are not configured yet — contact support.' });
 }
 const user = await User.findById(req.user._id);
 if (!user) return res.status(404).json({ error: 'User not found' });
 // ── NIGERIA-ONLY HARD GUARD ───────────────────────────────────────────────
 // A dynamic virtual account is an NGN bank account: only Nigeria is approved
 // on this Flutterwave account, so everyone else is sent to the payment link.
 const btGeo = await klsGeo.resolveCountry(req, user);
 if (!klsFlwMethods.supportsVirtualAccount(btGeo.code)) {
 return res.status(403).json({
 error: 'Bank transfer deposits are available to customers in Nigeria only. Use the payment link — it is priced in US dollars for your country.',
 country: btGeo.code,
 methods: ['paymentlink'],
 });
 }
 const { amount } = req.body;
 const parsedAmount = parseFloat(amount); // what the user wants CREDITED to their wallet
 if (!parsedAmount || parsedAmount < 100) return res.status(400).json({ error: 'Minimum deposit is ₦100' });
 const fee = calcDepositFee(parsedAmount);
 const chargeAmount = parsedAmount + fee; // what Flutterwave actually charges
 const customerId = await getOrCreateFlwCustomer(user);
 const reference = `${BRAND.txPrefix}-BT-${user._id}-${Date.now()}`;
 const expirySeconds = 1800; // 30 minutes
 const r = await flwV4Axios.post('/virtual-accounts', {
 reference, customer_id: customerId, expiry: expirySeconds,
 amount: chargeAmount, currency: 'NGN', account_type: 'dynamic',
 narration: `${BRAND.txPrefix} Wallet Deposit - ${user.name}`,
 bank_code: FLW_BANK_TRANSFER_BANK_CODE
 }, { headers: { 'X-Idempotency-Key': reference } });
 const d = r.data?.data;
 if (!d?.account_number) throw new Error('Flutterwave did not return account details');
 const expiresAt = new Date(Date.now() + expirySeconds * 1000);
 await BankTransferDeposit.create({
 userId: user._id, reference, virtualAccountId: d.id || '', accountNumber: d.account_number,
 bankName: d.account_bank_name || '', amount: chargeAmount, creditAmount: parsedAmount, fee,
 status: 'pending', expiresAt
 });
 res.json({
 reference, accountNumber: d.account_number, bankName: d.account_bank_name || '',
 amount: chargeAmount, creditAmount: parsedAmount, beneficiary: d.note || user.name,
 expiresAt
 });
 } catch (e) {
 console.error('Bank transfer create error:', e.response?.data || e.message);
 try {
 await SystemError.create({
 source: 'flutterwave',
 message: 'Failed to create bank transfer virtual account',
 detail: JSON.stringify(e.response?.data || e.message),
 context: { userId: req.user?._id, attemptedAmount: req.body?.amount }
 });
 } catch {}
 res.status(502).json({
 error: 'Our payment provider is temporarily unavailable. Your funds are safe — nothing was charged. Please try again shortly, or contact support if this keeps happening.'
 });
 }
});
app.get('/api/deposit/banktransfer/status/:reference', auth, async (req, res) => {
 try {
 const deposit = await BankTransferDeposit.findOne({ reference: req.params.reference, userId: req.user._id });
 if (!deposit) return res.status(404).json({ error: 'Deposit not found' });
 if (deposit.status !== 'pending') {
 console.log(`BT poll: deposit ${deposit.reference} already ${deposit.status}`);
 return res.json({ status: deposit.status });
 }
 if (deposit.expiresAt && Date.now() > new Date(deposit.expiresAt).getTime()) {
 deposit.status = 'expired';
 await deposit.save();
 console.log(`BT poll: deposit ${deposit.reference} expired`);
 return res.json({ status: 'expired' });
 }
 try {
 const fromDate = new Date(deposit.createdAt || Date.now() - 3600000);
 const toDate = new Date(Math.min(Date.now(), deposit.expiresAt ? new Date(deposit.expiresAt).getTime() : Date.now()));
 const fromStr = fromDate.toISOString().slice(0, 10);
 const toStr = new Date(toDate.getTime() + 86400000).toISOString().slice(0, 10); // +1 day buffer
 console.log(`BT poll: checking FLW v3 /transactions for ref=${deposit.reference} acct=${deposit.accountNumber} from=${fromStr} to=${toStr}`);
 const txListRes = await flwAxios.get('/transactions', {
 params: {
 from: fromStr,
 to: toStr,
 status: 'successful',
 currency: 'NGN',
 },
 timeout: 10000
 });
 const txList = txListRes.data?.data || [];
 console.log(`BT poll: FLW returned ${txList.length} successful NGN transactions`);
 const match = txList.find(t => {
 const amountOk = Number(t.amount) >= deposit.amount * 0.99; // allow tiny rounding
 const acctMatch =
 (t.meta?.accountNumber === deposit.accountNumber) ||
 (t.meta?.destinationAccountNumber === deposit.accountNumber) ||
 String(t.narration || '').includes(deposit.accountNumber) ||
 String(t.meta?.narration || '').includes(deposit.accountNumber);
 const refMatch = (t.tx_ref === deposit.reference);
 return (acctMatch || refMatch) && amountOk;
 });
 // Guard: if that charge was already credited as a permanent-VA deposit,
 // crediting it here as a bank transfer would pay the same money twice.
 if (match && await VirtualAccountDeposit.findOne({ flwRef: chargeKey(match) }).select('_id')) {
 console.log('BT poll: charge already credited as a VA deposit — ignoring');
 return res.json({ status: 'pending' });
 }
 if (match) {
 console.log(`BT poll: MATCH found — tx ${match.id} amount ₦${match.amount} for ref ${deposit.reference}`);
 const fresh = await BankTransferDeposit.findOneAndUpdate(
 { _id: deposit._id, status: 'pending' },
 { status: 'success', flwChargeId: String(match.id || match.flw_ref || '') },
 { new: true }
 );
 if (fresh) {
 const updatedUser = await User.findByIdAndUpdate(
 fresh.userId,
 { $inc: { balance: fresh.creditAmount } },
 { new: true }
 );
 await Transaction.create({
 userId: fresh.userId,
 type: 'deposit',
 amount: fresh.creditAmount,
 description: `VA bank transfer deposit — ₦${fresh.creditAmount.toLocaleString('en-NG')} credited (₦${fresh.amount.toLocaleString('en-NG')} received, ₦${fresh.fee} fee) via ${fresh.bankName || 'bank transfer'}`,
 status: 'success'
 });
 if (updatedUser) pushBalanceToUser(fresh.userId, updatedUser.balance);
 console.log(` BT poll credited ₦${fresh.creditAmount} for user ${fresh.userId}`);
 return res.json({ status: 'success' });
 } else {
 console.log(`BT poll: deposit ${deposit.reference} already credited (webhook beat us)`);
 return res.json({ status: 'success' });
 }
 } else {
 console.log(`BT poll: no matching transaction found yet for ${deposit.reference}`);
 }
 } catch (pollErr) {
 console.error('BT poll FLW API error:', pollErr.response?.data || pollErr.message);
 }
 res.json({ status: 'pending' });
 } catch (e) {
 console.error('BT status endpoint error:', e.message);
 res.status(500).json({ error: 'Failed to check deposit status' });
 }
});
app.get('/api/user/virtual-account/latest-deposit', auth, async (req, res) => {
 try {
 const user = await User.findById(req.user._id).select('balance virtualAccount email');
 if (!user) return res.status(404).json({ error: 'User not found' });
 const latest = await VirtualAccountDeposit.findOne({ userId: user._id })
 .sort({ createdAt: -1 })
 .select('status amount creditAmount createdAt flwRef');
 let reconCredit = null;
 const vaEnabled = user.virtualAccount?.enabled && user.virtualAccount?.accountNumber;
 if (vaEnabled) {
 const cacheKey = String(user._id);
 const lastCheck = _vaReconCache.get(cacheKey) || 0;
 if (Date.now() - lastCheck > 30000) { // throttle: check at most every 30s
 _vaReconCache.set(cacheKey, Date.now());
 try {
 const from = new Date(Date.now() - 2 * 60 * 60 * 1000);
 const to = new Date(Date.now() + 3600000);
 const txRes = await flwAxios.get('/transactions', {
 params: { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10),
 status: 'successful', currency: 'NGN' },
 timeout: 8000
 });
 const txList = txRes.data?.data || [];
 const vaAccNum = user.virtualAccount.accountNumber;
 for (const tx of txList) {
 const custEmail = (tx.customer?.email || '').toLowerCase();
 const txAccNum = tx.virtual_account_number || tx.meta?.accountNumber || tx.meta?.destinationAccountNumber;
 // Account number is the only trustworthy match here. Matching on e-mail alone
 // re-credited payment-link / bank-transfer payments the same user had already
 // made, which showed up as a second confirmation for one deposit.
 const isMatch = txAccNum && txAccNum === vaAccNum;
 if (!isMatch) continue;
 const flwRef = chargeKey(tx);
 if (!flwRef) continue;
 const already = await VirtualAccountDeposit.findOne({ flwRef }).select('_id');
 if (already) continue; // already credited
 console.log(`[VA-poll-reconcile] Found uncredited tx ${flwRef} for ${user.email} ₦${tx.amount}`);
 const out = await handleVaWebhookCredit(user, tx).catch(err => { console.warn('[VA-poll-reconcile] credit error:', err.message); return null; });
 if (out?.status === 'credited') { reconCredit = { flwRef, amount: tx.amount }; break; }
 continue;
 }
 } catch (reconErr) {
 console.warn('[VA-poll-reconcile] error:', reconErr.message);
 }
 }
 }
 const latestFinal = reconCredit
 ? await VirtualAccountDeposit.findOne({ userId: user._id }).sort({ createdAt: -1 }).select('status amount creditAmount createdAt flwRef')
 : latest;
 const freshUser = reconCredit ? await User.findById(user._id).select('balance') : user;
 res.json({
 balance: freshUser.balance || 0,
 vaEnabled: vaEnabled || false,
 reconCredit, // non-null if we just credited something in this poll
 latestDeposit: latestFinal ? {
 status: latestFinal.status,
 amount: latestFinal.amount,
 creditAmount:latestFinal.creditAmount,
 createdAt: latestFinal.createdAt,
 flwRef: latestFinal.flwRef
 } : null
 });
 } catch (e) {
 console.error('VA latest-deposit poll error:', e.message);
 res.status(500).json({ error: 'Failed to check VA status' });
 }
});
const _vaReconCache = new Map();
app.get('/api/user/virtual-account/deposits', auth, async (req, res) => {
 try {
 const deposits = await VirtualAccountDeposit.find({ userId: req.user._id })
 .sort({ createdAt: -1 }).limit(20)
 .select('amount creditAmount status createdAt flwRef');
 res.json({ deposits });
 } catch (e) {
 res.status(500).json({ error: 'Failed to fetch VA deposits' });
 }
});
async function sendWhatsAppNotification(user, amount, bank, accountName, receiptId, receiptImageUrl, aiResult) {
 try {
 const instance = process.env.ULTRAMSG_INSTANCE;
 const token = process.env.ULTRAMSG_TOKEN;
 const phone = process.env.ADMIN_WHATSAPP;
 const siteUrl = process.env.SITE_URL || 'https://your-site.onrender.com';
 const adminPath = process.env.ADMIN_SECRET_PATH || 'ksl-admin-secret';
 const passcode = process.env.ADMIN_PASSCODE;
 if (!instance || !token || !phone) {
 const msg = 'UltraMsg not configured — WhatsApp notification skipped';
 console.log(msg);
 await SystemError.create({
 source: 'ultramsg',
 message: msg,
 detail: 'Missing ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, or ADMIN_WHATSAPP in environment variables.',
 context: { userEmail: user.email, amount, receiptId: String(receiptId) }
 });
 return { sent: false, error: msg };
 }
 const approveLink = `${siteUrl}/api/admin/receipts/${receiptId}/quick-action?action=approved&passcode=${encodeURIComponent(passcode)}`;
 const rejectLink = `${siteUrl}/api/admin/receipts/${receiptId}/quick-action?action=rejected&passcode=${encodeURIComponent(passcode)}`;
 const aiSummary = aiResult
 ? ` AI: ${aiResult.verdict.toUpperCase()} (${aiResult.confidence}%)\n Reason: ${aiResult.reason}${aiResult.flags?.length ? '\n Flags: ' + aiResult.flags.join(', ') : ''}\n\n`
 : '';
 const msg =
 `*KLS DEPOSIT — MANUAL REVIEW*\n\n` +
 `User: ${user.name}\n` +
 `Email: ${user.email}\n` +
 `Amount: ₦${amount.toLocaleString('en-NG')}\n` +
 `Bank: ${bank}\n` +
 `Sender: ${accountName || 'Not provided'}\n` +
 `Time: ${new Date().toLocaleString('en-NG')}\n\n` +
 aiSummary +
 `APPROVE:\n${approveLink}\n\n` +
 `REJECT:\n${rejectLink}\n\n` +
 `Admin Panel: ${siteUrl}/${adminPath}`;
 const baseUrl = `https://api.ultramsg.com/${instance}`;
 await axios.post(`${baseUrl}/messages/chat`, { token, to: phone, body: msg }, { timeout: 10000 });
 console.log(' WhatsApp text notification sent via UltraMsg');
 const receiptUrl = receiptImageUrl.startsWith('http') ? receiptImageUrl : `${siteUrl}${receiptImageUrl}`;
 await axios.post(`${baseUrl}/messages/image`, {
 token, to: phone,
 image: receiptUrl,
 caption: ` Receipt — ${user.name} — ₦${amount.toLocaleString('en-NG')} via ${bank}`
 }, { timeout: 10000 });
 console.log(' WhatsApp receipt image sent via UltraMsg');
 return { sent: true };
 } catch (e) {
 const detail = e?.response?.data ? JSON.stringify(e.response.data) : e.message;
 console.log('WhatsApp notification failed (non-fatal):', detail);
 try {
 await SystemError.create({
 source: 'ultramsg',
 message: 'Failed to send WhatsApp deposit notification',
 detail,
 context: { userEmail: user?.email, amount, receiptId: String(receiptId || '') }
 });
 } catch (logErr) { console.log('Failed to persist SystemError:', logErr.message); }
 return { sent: false, error: detail };
 }
}
app.get('/api/admin/receipts/:id/quick-action', async (req, res) => {
 try {
 const { action, passcode } = req.query;
 if (!passcode || passcode !== process.env.ADMIN_PASSCODE)
 return res.status(403).send(`<h2> Wrong passcode. Access denied.</h2>`);
 if (!['approved', 'rejected'].includes(action))
 return res.status(400).send(`<h2>Invalid action.</h2>`);
 const receipt = await Receipt.findById(req.params.id);
 if (!receipt) return res.status(404).send(`<h2>Receipt not found.</h2>`);
 if (receipt.status !== 'pending')
 return res.send(`<h2> Already ${receipt.status}. No action needed.</h2>`);
 receipt.status = action;
 receipt.adminNote = `Quick-${action} via WhatsApp link`;
 await receipt.save();
 if (action === 'approved') {
 const user = await User.findById(receipt.userId);
 if (user) {
 user.balance = (user.balance || 0) + receipt.claimedAmount;
 await user.save();
 await Transaction.create({
 userId: user._id,
 type: 'deposit',
 amount: receipt.claimedAmount,
 description: `Deposit approved via WhatsApp quick-action (${receipt.claimedBank})`,
 status: 'success'
 });
 }
 return res.send(`
 <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#ffd700;">
 <h1> APPROVED</h1>
 <p style="color:#fff;">₦${receipt.claimedAmount.toLocaleString('en-NG')} credited to <b>${receipt.userName}</b> (${receipt.userEmail})</p>
 <p style="color:#aaa;">You can close this tab.</p>
 </body></html>
 `);
 } else {
 return res.send(`
 <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#ff4444;">
 <h1> REJECTED</h1>
 <p style="color:#fff;">Deposit from <b>${receipt.userName}</b> has been rejected.</p>
 <p style="color:#aaa;">You can close this tab.</p>
 </body></html>
 `);
 }
 } catch (e) {
 res.status(500).send(`<h2>Error: ${e.message}</h2>`);
 }
});
app.post('/api/visit', async (req, res) => {
 try {
 const { visitorId } = req.body;
 let isNewVisitor = false;
 if (visitorId) {
 const before = await VisitorLog.findOneAndUpdate(
 { visitorId },
 { $inc: { visitCount: 1 }, $set: { lastSeen: new Date() }, $setOnInsert: { visitorId, firstSeen: new Date() } },
 { upsert: true, new: false, includeResultMetadata: true }
 );
 isNewVisitor = !before?.lastErrorObject?.updatedExisting;
 }
 const stats = await VisitorStats.findOneAndUpdate(
 { key: 'global' },
 { $inc: { visitors: isNewVisitor ? 1 : 0 }, $setOnInsert: { key: 'global' } },
 { upsert: true, new: true }
 );
 res.json({ visitors: stats.visitors });
 } catch (e) {
 console.error('Visit tracking error:', e.message);
 res.status(500).json({ error: 'Failed to record visit' });
 }
});
app.get('/api/visit', async (req, res) => {
 try {
 const stats = await VisitorStats.findOne({ key: 'global' });
 res.json({ visitors: stats?.visitors || 0 });
 } catch (e) {
 res.status(500).json({ error: 'Failed to load visitor stats' });
 }
});
app.get('/api/ads', async (req, res) => {
 try {
 const ads = await Ad.find({ active: true }).sort({ createdAt: -1 });
 res.json(ads);
 } catch (e) { res.status(500).json({ error: 'Failed to load ads' }); }
});
// Attaches each sender's CURRENT profile picture to a list of chat/DM messages.
// Returned as an extra `senderPicture` field, and left as an empty string when the user
// never uploaded one — the UI then falls back to an initial instead of a stock avatar.
async function withSenderPictures(messages, idField) {
 const list = messages.map(m => (typeof m.toObject === 'function' ? m.toObject() : m));
 const ids = [...new Set(list.map(m => String(m[idField] && m[idField]._id ? m[idField]._id : m[idField])).filter(Boolean))];
 if (!ids.length) return list;
 let picMap = {};
 try {
 const users = await User.find({ _id: { $in: ids } }).select('profilePicture');
 picMap = Object.fromEntries(users.map(u => [String(u._id), u.profilePicture || '']));
 } catch { picMap = {}; }
 return list.map(m => {
 const sid = String(m[idField] && m[idField]._id ? m[idField]._id : m[idField]);
 return { ...m, senderPicture: picMap[sid] || '' };
 });
}
app.get('/api/chat/groups', auth, async (req, res) => {
 const groups = await ChatGroup.find({ active: true }).sort({ createdAt: 1 });
 res.json(groups);
});
app.get('/api/chat/groups/:groupId/messages', auth, async (req, res) => {
 try {
 const group = await ChatGroup.findById(req.params.groupId);
 if (!group || !group.active) return res.status(404).json({ error: 'Group not found' });
 const after = req.query.after; // ISO date — only return messages after this (for polling)
 const filter = { groupId: group._id, deleted: false };
 if (after) filter.createdAt = { $gt: new Date(after) };
 const limit = after ? 100 : 50; // full history capped, polling deltas uncapped-ish
 const messages = await ChatMessage.find(filter).sort({ createdAt: after ? 1 : -1 }).limit(limit);
 const ordered = after ? messages : messages.reverse();
 res.json(await withSenderPictures(ordered, 'userId'));
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/chat/groups/:groupId/messages', auth, chatUpload.single('attachment'), async (req, res) => {
 try {
 const text = (req.body.text || '').trim();
 const file = req.file;
 if (!text && !file) return res.status(400).json({ error: 'Message cannot be empty' });
 if (text.length > 1000) return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
 const group = await ChatGroup.findById(req.params.groupId);
 if (!group || !group.active) return res.status(404).json({ error: 'Group not found or closed' });
 let attachmentUrl = '', attachmentType = '', attachmentName = '';
 if (file) {
 attachmentUrl = fileUrl(file);
 attachmentName = file.originalname;
 if (/^image\//.test(file.mimetype)) attachmentType = 'image';
 else if (/^video\//.test(file.mimetype)) attachmentType = 'video';
 else if (/^audio\//.test(file.mimetype)) attachmentType = 'audio';
 else attachmentType = 'file';
 }
 const msg = await ChatMessage.create({
 groupId: group._id, userId: req.user._id, userName: req.user.name,
 text, attachmentUrl, attachmentType, attachmentName
 });
 res.json({ ...msg.toObject(), senderPicture: req.user.profilePicture || '' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dm/start', auth, async (req, res) => {
 try {
 const { userId } = req.body;
 if (!userId) return res.status(400).json({ error: 'userId required' });
 if (String(userId) === String(req.user._id)) return res.status(400).json({ error: "You can't message yourself" });
 const otherUser = await User.findById(userId).select('name');
 if (!otherUser) return res.status(404).json({ error: 'User not found' });
 let convo = await Conversation.findOne({ participants: { $all: [req.user._id, userId], $size: 2 } });
 if (!convo) convo = await Conversation.create({ participants: [req.user._id, userId] });
 res.json(convo);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dm/conversations', auth, async (req, res) => {
 try {
 const convos = await Conversation.find({ participants: req.user._id }).sort({ lastMessageAt: -1 }).limit(100);
 const otherIds = convos.map(c => c.participants.find(p => String(p) !== String(req.user._id)));
 const others = await User.find({ _id: { $in: otherIds } }).select('name profilePicture');
 const otherMap = Object.fromEntries(others.map(u => [String(u._id), u.name]));
 const otherPicMap = Object.fromEntries(others.map(u => [String(u._id), u.profilePicture || '']));
 const unreadCounts = await DirectMessage.aggregate([
 { $match: { conversationId: { $in: convos.map(c => c._id) }, senderId: { $ne: req.user._id }, readBy: { $ne: req.user._id }, deleted: false } },
 { $group: { _id: '$conversationId', count: { $sum: 1 } } }
 ]);
 const unreadMap = Object.fromEntries(unreadCounts.map(u => [String(u._id), u.count]));
 res.json(convos.map(c => {
 const otherId = c.participants.find(p => String(p) !== String(req.user._id));
 return {
 _id: c._id, otherUserId: otherId, otherUserName: otherMap[String(otherId)] || 'Unknown user',
 otherUserPicture: otherPicMap[String(otherId)] || '',
 lastMessageText: c.lastMessageText, lastMessageAt: c.lastMessageAt,
 unreadCount: unreadMap[String(c._id)] || 0
 };
 }));
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/dm/conversations/:id/messages', auth, async (req, res) => {
 try {
 const convo = await Conversation.findById(req.params.id);
 if (!convo || !convo.participants.some(p => String(p) === String(req.user._id)))
 return res.status(404).json({ error: 'Conversation not found' });
 const after = req.query.after;
 const filter = { conversationId: convo._id, deleted: false };
 if (after) filter.createdAt = { $gt: new Date(after) };
 const limit = after ? 100 : 50;
 const messages = await DirectMessage.find(filter).sort({ createdAt: after ? 1 : -1 }).limit(limit);
 const ordered = after ? messages : messages.reverse();
 res.json(await withSenderPictures(ordered, 'senderId'));
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dm/conversations/:id/messages', auth, chatUpload.single('attachment'), async (req, res) => {
 try {
 const text = (req.body.text || '').trim();
 const file = req.file;
 if (!text && !file) return res.status(400).json({ error: 'Message cannot be empty' });
 if (text.length > 1000) return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
 const convo = await Conversation.findById(req.params.id);
 if (!convo || !convo.participants.some(p => String(p) === String(req.user._id)))
 return res.status(404).json({ error: 'Conversation not found' });
 let attachmentUrl = '', attachmentType = '', attachmentName = '';
 if (file) {
 attachmentUrl = fileUrl(file);
 attachmentName = file.originalname;
 if (/^image\//.test(file.mimetype)) attachmentType = 'image';
 else if (/^video\//.test(file.mimetype)) attachmentType = 'video';
 else if (/^audio\//.test(file.mimetype)) attachmentType = 'audio';
 else attachmentType = 'file';
 }
 const msg = await DirectMessage.create({
 conversationId: convo._id, senderId: req.user._id, senderName: req.user.name,
 text, attachmentUrl, attachmentType, attachmentName, readBy: [req.user._id]
 });
 convo.lastMessageText = text ? text.slice(0, 100) : (attachmentType === 'audio' ? 'Voice note' : attachmentType ? 'Attachment' : '');
 convo.lastMessageAt = new Date();
 await convo.save();
 res.json({ ...msg.toObject(), senderPicture: req.user.profilePicture || '' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/dm/conversations/:id/read', auth, async (req, res) => {
 try {
 const convo = await Conversation.findById(req.params.id);
 if (!convo || !convo.participants.some(p => String(p) === String(req.user._id)))
 return res.status(404).json({ error: 'Conversation not found' });
 await DirectMessage.updateMany(
 { conversationId: convo._id, readBy: { $ne: req.user._id } },
 { $addToSet: { readBy: req.user._id } }
 );
 res.json({ message: 'Marked as read' });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/chat/groups', adminAuth, async (req, res) => res.json(await ChatGroup.find().sort({ createdAt: -1 })));
app.post('/api/admin/chat/groups', adminAuth, async (req, res) => {
 try {
 const { name, description } = req.body;
 if (!name) return res.status(400).json({ error: 'Group name required' });
 const group = await ChatGroup.create({ name, description: description || '' });
 res.json(group);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/chat/groups/:id', adminAuth, async (req, res) => {
 try {
 const { name, description, active } = req.body;
 const update = {};
 if (name !== undefined) update.name = name;
 if (description !== undefined) update.description = description;
 if (active !== undefined) update.active = active === true || active === 'true';
 const group = await ChatGroup.findByIdAndUpdate(req.params.id, update, { new: true });
 if (!group) return res.status(404).json({ error: 'Not found' });
 res.json(group);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/chat/groups/:id', adminAuth, async (req, res) => {
 await ChatGroup.findByIdAndDelete(req.params.id);
 await ChatMessage.deleteMany({ groupId: req.params.id });
 res.json({ message: 'Group deleted' });
});
app.delete('/api/admin/chat/messages/:id', adminAuth, async (req, res) => {
 const msg = await ChatMessage.findByIdAndUpdate(req.params.id, { deleted: true }, { new: true });
 if (!msg) return res.status(404).json({ error: 'Not found' });
 res.json({ message: 'Message removed' });
});
app.get('/api/games/my-id', auth, async (req, res) => {
 res.json({ gameId: req.user.gameId });
});
app.post('/api/games/score', auth, async (req, res) => {
 try {
 const { game, mode, score, battleCode } = req.body;
 if (!['space-shooter','turbo-run','base-defense'].includes(game)) return res.status(400).json({ error: 'Unknown game' });
 const parsedScore = parseInt(score);
 if (isNaN(parsedScore) || parsedScore < 0 || parsedScore > 10000000) return res.status(400).json({ error: 'Invalid score' });
 const record = await GameScore.create({
 userId: req.user._id, gameId: req.user.gameId, game,
 mode: mode === 'battle' ? 'battle' : 'bot',
 battleCode: mode === 'battle' ? (battleCode || '').trim().toUpperCase() : '',
 score: parsedScore
 });
 checkAndAwardBadges(req.user._id).catch(() => {});
 res.json({ success: true, id: record._id });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/games/leaderboard', optionalAuth, async (req, res) => {
 try {
 const game = req.query.game || 'space-shooter';
 const top = await GameScore.aggregate([
 { $match: { game } },
 { $group: { _id: '$userId', bestScore: { $max: '$score' }, gamesPlayed: { $sum: 1 } } },
 { $sort: { bestScore: -1 } },
 { $limit: 10 },
 { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
 { $unwind: '$user' },
 { $project: { name: '$user.name', gameId: '$user.gameId', bestScore: 1, gamesPlayed: 1 } }
 ]);
 res.json(top);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/games/leaderboard', adminAuth, async (req, res) => {
 try {
 const game = req.query.game || 'space-shooter';
 const top = await GameScore.aggregate([
 { $match: { game } },
 { $group: { _id: '$userId', bestScore: { $max: '$score' }, gamesPlayed: { $sum: 1 } } },
 { $sort: { bestScore: -1 } },
 { $limit: 10 },
 { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
 { $unwind: '$user' },
 { $project: { name: '$user.name', gameId: '$user.gameId', bestScore: 1, gamesPlayed: 1 } }
 ]);
 res.json(top);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/games/battle/:code', auth, async (req, res) => {
 try {
 const code = (req.params.code || '').trim().toUpperCase();
 const scores = await GameScore.find({ mode: 'battle', battleCode: code }).sort({ score: -1 }).limit(20).populate('userId', 'name gameId');
 res.json(scores.map(s => ({ name: s.userId?.name, gameId: s.userId?.gameId, score: s.score, at: s.createdAt })));
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/games/my-scores', auth, async (req, res) => {
 const scores = await GameScore.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20);
 res.json(scores);
});
app.get('/api/v1/me', apiKeyAuth, async (req, res) => {
 res.json({ id: req.apiUser._id, name: req.apiUser.name, email: req.apiUser.email, balance: req.apiUser.balance, gameId: req.apiUser.gameId, restricted: req.apiUser.restricted });
});
app.get('/api/v1/balance', apiKeyAuth, async (req, res) => {
 res.json({ balance: req.apiUser.balance || 0 });
});
app.get('/api/v1/purchases', apiKeyAuth, async (req, res) => {
 const u = await User.findById(req.apiUser._id).select('purchaseDetails');
 res.json(u.purchaseDetails || []);
});
app.get('/api/v1/purchases/:purchaseId', apiKeyAuth, async (req, res) => {
 const u = await User.findById(req.apiUser._id).select('purchaseDetails');
 const purchase = (u.purchaseDetails || []).id(req.params.purchaseId);
 if (!purchase) return res.status(404).json({ error: 'Purchase not found on your account' });
 res.json(purchase);
});
app.get('/api/v1/listings', apiKeyAuth, async (req, res) => {
 const filter = { available: true };
 if (req.query.type && req.query.type !== 'all') filter.type = req.query.type;
 const logs = await Log.find(filter).select('-details -toolLink -deliverableFile').sort({ createdAt: -1 });
 const visible = logs.filter(l => l.type === 'tool' || l.maxPurchases <= 0 || l.soldCount < l.maxPurchases);
 res.json(visible);
});
app.get('/api/v1/listings/:id', apiKeyAuth, async (req, res) => {
 const log = await Log.findById(req.params.id).select('-details -toolLink -deliverableFile');
 if (!log) return res.status(404).json({ error: 'Not found' });
 res.json(log);
});
app.post('/api/v1/buy/:id', apiKeyAuth, async (req, res) => {
 try {
 const log = await Log.findById(req.params.id);
 if (!log || !log.available) return res.status(404).json({ error: 'Item not available' });
 const user = await User.findById(req.apiUser._id);
 if (log.listingType === 'folder') {
 const available = (log.subAccounts || []).filter(sa => !sa.sold);
 if (!available.length) return res.status(400).json({ error: 'Sold out' });
 let targetId = req.body.subAccountId;
 if (!targetId) {
 available.sort((a, b) => (a.price||0) - (b.price||0));
 targetId = available[0]._id;
 }
 const claimed = await Log.findOneAndUpdate(
 { _id: log._id, 'subAccounts._id': targetId, 'subAccounts.sold': false },
 { $set: { 'subAccounts.$.sold': true, 'subAccounts.$.soldTo': user._id, 'subAccounts.$.soldAt': new Date() } },
 { new: true }
 );
 if (!claimed) return res.status(400).json({ error: 'That account was just sold to someone else — try again or omit subAccountId to auto-pick another.' });
 const sub = claimed.subAccounts.id(targetId);
 if ((user.balance || 0) < sub.price) {
 await Log.updateOne({ _id: log._id, 'subAccounts._id': targetId }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
 return res.status(400).json({ error: `Insufficient balance — this account costs ₦${sub.price}` });
 }
 user.balance = (user.balance || 0) - sub.price;
 user.purchaseDetails.push({
 logId: log._id, logTitle: `${log.title} — ${sub.label}`, logType: log.type, logDetails: sub.details || '',
 toolLink: sub.toolLink || '', deliveryType: sub.deliveryType || 'link',
 deliverableFile: sub.deliverableFile || '', deliverableFileName: sub.deliverableFileName || '',
 pricePaid: sub.price, subAccountId: sub._id
 });
 await user.save();
 const purchaseRecord = user.purchaseDetails[user.purchaseDetails.length - 1];
 await Transaction.create({ userId: user._id, type: 'purchase', amount: sub.price, description: `Purchased via API: ${log.title} — ${sub.label}`, status: 'success' });
 await creditReferralCommission(user, sub.price, `${log.title} — ${sub.label}`);
 checkAndAwardBadges(user._id).catch(() => {});
 return res.json({
 message: 'Purchase successful', newBalance: user.balance, purchaseId: purchaseRecord._id, purchasedAt: purchaseRecord.purchasedAt,
 itemPrice: sub.price, totalCharged: sub.price,
 logDetails: sub.details || '', toolLink: sub.toolLink || '', deliveryType: sub.deliveryType || 'link',
 deliverableFile: sub.deliverableFile || '', deliverableFileName: sub.deliverableFileName || ''
 });
 }
 if (log.type === 'log') {
 if (log.maxPurchases > 0 && log.soldCount >= log.maxPurchases) return res.status(400).json({ error: 'Sold out' });
 } else if (log.toolQty > 0 && log.soldCount >= log.toolQty) {
 return res.status(400).json({ error: 'Out of stock' });
 }
 if ((user.balance || 0) < log.price) return res.status(400).json({ error: `Insufficient balance — this item costs ₦${log.price}` });
 user.balance = (user.balance || 0) - log.price;
 user.purchaseDetails.push({
 logId: log._id, logTitle: log.title, logType: log.type, logDetails: log.details || '',
 toolLink: log.toolLink || '', deliveryType: log.deliveryType || 'link',
 deliverableFile: log.deliverableFile || '', deliverableFileName: log.deliverableFileName || '',
 pricePaid: log.price
 });
 await user.save();
 const purchaseRecord = user.purchaseDetails[user.purchaseDetails.length - 1];
 await Transaction.create({ userId: user._id, type: 'purchase', amount: log.price, description: `Purchased via API: ${log.title}`, status: 'success' });
 await creditReferralCommission(user, log.price, log.title);
 checkAndAwardBadges(user._id).catch(() => {});
 log.soldCount += 1;
 await log.save();
 res.json({
 message: 'Purchase successful', newBalance: user.balance, purchaseId: purchaseRecord._id, purchasedAt: purchaseRecord.purchasedAt,
 itemPrice: log.price, totalCharged: log.price,
 logDetails: log.details || '', toolLink: log.toolLink || '', deliveryType: log.deliveryType || 'link',
 deliverableFile: log.deliverableFile || '', deliverableFileName: log.deliverableFileName || ''
 });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/v1/buy-multi/:id', apiKeyAuth, async (req, res) => {
 const claimedIds = [];
 try {
 const { subAccountIds } = req.body;
 if (!Array.isArray(subAccountIds) || !subAccountIds.length)
 return res.status(400).json({ error: 'subAccountIds must be a non-empty array' });
 if (subAccountIds.length > 50) return res.status(400).json({ error: 'Max 50 accounts per batch' });
 const log = await Log.findById(req.params.id);
 if (!log || !log.available) return res.status(404).json({ error: 'Item not available' });
 if (log.listingType !== 'folder') return res.status(400).json({ error: 'This item does not support multi-buy' });
 const user = await User.findById(req.apiUser._id);
 const claimedSubs = [];
 for (const subId of subAccountIds) {
 const claimed = await Log.findOneAndUpdate(
 { _id: log._id, 'subAccounts._id': subId, 'subAccounts.sold': false },
 { $set: { 'subAccounts.$.sold': true, 'subAccounts.$.soldTo': user._id, 'subAccounts.$.soldAt': new Date() } },
 { new: true }
 );
 if (!claimed) {
 for (const rid of claimedIds) await Log.updateOne({ _id: log._id, 'subAccounts._id': rid }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
 return res.status(400).json({ error: 'One of the requested accounts was already sold. Nothing was charged — retry with different IDs.' });
 }
 claimedIds.push(subId);
 claimedSubs.push(claimed.subAccounts.id(subId));
 }
 const total = claimedSubs.reduce((s, sa) => s + (sa.price || 0), 0);
 if ((user.balance || 0) < total) {
 for (const rid of claimedIds) await Log.updateOne({ _id: log._id, 'subAccounts._id': rid }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } });
 return res.status(400).json({ error: `Insufficient balance — this batch costs ₦${total}` });
 }
 user.balance = (user.balance || 0) - total;
 for (const sub of claimedSubs) {
 user.purchaseDetails.push({
 logId: log._id, logTitle: `${log.title} — ${sub.label}`, logType: log.type, logDetails: sub.details || '',
 toolLink: sub.toolLink || '', deliveryType: sub.deliveryType || 'link',
 deliverableFile: sub.deliverableFile || '', deliverableFileName: sub.deliverableFileName || '',
 pricePaid: sub.price, subAccountId: sub._id
 });
 }
 await user.save();
 const newRecords = user.purchaseDetails.slice(-claimedSubs.length);
 await Transaction.create({ userId: user._id, type: 'purchase', amount: total, description: `Purchased ${claimedSubs.length} accounts via API: ${log.title}`, status: 'success' });
 for (const sub of claimedSubs) await creditReferralCommission(user, sub.price, `${log.title} — ${sub.label}`);
 checkAndAwardBadges(user._id).catch(() => {});
 res.json({
 message: `${claimedSubs.length} accounts purchased`, newBalance: user.balance, totalCharged: total,
 items: newRecords.map(r => ({
 purchaseId: r._id, purchasedAt: r.purchasedAt, pricePaid: r.pricePaid, logTitle: r.logTitle,
 logDetails: r.logDetails, toolLink: r.toolLink, deliveryType: r.deliveryType,
 deliverableFile: r.deliverableFile, deliverableFileName: r.deliverableFileName
 }))
 });
 } catch (e) {
 for (const rid of claimedIds) { try { await Log.updateOne({ _id: req.params.id, 'subAccounts._id': rid }, { $set: { 'subAccounts.$.sold': false, 'subAccounts.$.soldTo': null, 'subAccounts.$.soldAt': null } }); } catch {} }
 res.status(500).json({ error: e.message });
 }
});
// Developer API — same live services as Server 1, but with a slightly smaller profit (cheaper).
app.get('/api/v1/numbers/countries', apiKeyAuth, async (req, res) => {
 try {
   const payload = await novaGetCatalog({ scope: 'global' });
   res.json(novaCountryRows(payload).map(c => ({ code: c.iso || c.code || c.country_code || c.iso2, name: c.name || c.country_name || c.label })));
 } catch (e) { novaErrorResponse(res, e); }
});
app.get('/api/v1/numbers/options', apiKeyAuth, async (req, res) => {
 try {
   const country = String(req.query.country || 'US').trim();
   const serverId = Number(req.query.serverId || req.query.server_id || 0);
   const payload = await novaCatalogForCountry(country);
   const cfg = await getNumberServerConfig();
   res.json(novaServiceRows(payload)
     .filter(s => !serverId || Number(s.server_id ?? s.serverId) === serverId)
     .map(s => ({
       id: s.id ?? s.service_id, serviceId: s.id ?? s.service_id, provider: novaServiceDisplayName(s),
       serverId: Number(s.server_id ?? s.serverId), serverName: String(s.server_name || s.server || ''), country,
       price: novaServicePriceNgn(s, cfg, { api: true })
     })));
 } catch (e) { novaErrorResponse(res, e); }
});
// Legacy {provider, country} callers: pick the cheapest matching service across servers.
async function novaFindServiceByName(countryCode, provider, serverId) {
  const rows = (await novaCatalogForCountry(countryCode)).services || [];
  const want = String(provider || '').trim().toLowerCase();
  const matches = rows.filter(s => [s.name, s.service, s.application, s.code, novaServiceDisplayName(s)].some(v => String(v || '').trim().toLowerCase() === want)
    && (!serverId || Number(s.server_id ?? s.serverId) === serverId) && Number(s.price_minor) >= 0);
  matches.sort((a, b) => Number(a.price_minor) - Number(b.price_minor));
  const m = matches[0];
  return m ? { serviceId: Number(m.id ?? m.service_id), serverId: Number(m.server_id ?? m.serverId) } : null;
}
app.post('/api/v1/buy-number', apiKeyAuth, async (req, res) => {
 try {
   const b = req.body || {};
   const countryCode = String(b.country || '').trim();
   if (!countryCode) return res.status(400).json({ error: 'country is required (plus serviceId + serverId, or provider)' });
   let serviceId = Number(b.serviceId || b.service_id);
   let serverId = Number(b.serverId || b.server_id);
   if (!Number.isInteger(serviceId) || serviceId <= 0 || !Number.isInteger(serverId) || serverId <= 0) {
     if (!b.provider) return res.status(400).json({ error: 'Send serviceId and serverId (from /numbers/options), or provider and country.' });
     const found = await novaFindServiceByName(countryCode, b.provider, Number.isInteger(serverId) && serverId > 0 ? serverId : 0);
     if (!found) return res.status(400).json({ error: 'Out of stock for that provider/country. Nothing was charged.' });
     serviceId = found.serviceId; serverId = found.serverId;
   }
   const r = await novaPurchaseNumber({ userId: req.apiUser._id, serviceId, serverId, countryCode, expectedPrice: b.expected_price ?? b.expectedPrice, pricing: 'api' });
   const l = r.listing;
   res.json({ order_id: l._id, number: l.phoneNumber, price: r.sellPrice, status: 'waiting', provider: l.provider, country: l.country, server_id: serverId, expires_at: l.expiresAt });
 } catch (e) {
   if (e.orderId) e.orderId = String(e.orderId);
   novaPurchaseErrorResponse(res, e);
 }
});
app.get('/api/v1/get-sms', apiKeyAuth, async (req, res) => {
 try {
   const { order_id } = req.query;
   if (!order_id) return res.status(400).json({ error: 'order_id is required' });
   let listing = await NumberListing.findOne({ _id: order_id, soldTo: req.apiUser._id });
   if (!listing) return res.status(404).json({ error: 'Order not found' });
   if (listing.status === 'sold' && !listing.code) { try { const code = await fetchCodeFromProvider(listing); if (code) { listing.code = code; listing.codeAddedAt = new Date(); await listing.save(); } } catch (_) {} }
   listing = await expireStaleNumberOrder(listing);
   res.json({ order_id: listing._id, status: listing.code ? 'received' : listing.status === 'sold' ? 'waiting' : listing.status, sms: listing.code || null });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/v1/cancel-number', apiKeyAuth, async (req, res) => {
 try {
   const { order_id } = req.body; if (!order_id) return res.status(400).json({ error: 'order_id is required' });
   const listing = await NumberListing.findOne({ _id: order_id, soldTo: req.apiUser._id });
   if (!listing) return res.status(404).json({ error: 'Order not found' });
   if (listing.status !== 'sold' || listing.code) return res.status(400).json({ error: 'This order can no longer be cancelled' });
   // Atomic claim: only ONE concurrent request can move sold -> cancelled, so only one refund can happen.
   const cancelled = await NumberListing.findOneAndUpdate(
     { _id: listing._id, soldTo: req.apiUser._id, status: 'sold', code: '' },
     { $set: { status: 'cancelled', cancelledAt: new Date() } }, { new: true });
   if (!cancelled) return res.status(409).json({ error: 'This order has already changed state; check it with get-sms.' });
   await User.updateOne({ _id: cancelled.soldTo }, { $inc: { balance: cancelled.sellPrice } });
   await Transaction.create({ userId: cancelled.soldTo, type: 'admin_credit', amount: cancelled.sellPrice, description: `Refund: ${cancelled.provider} number (${cancelled.country}) — cancelled via API`, status: 'success' });
   const released = await releaseNumberOnProvider(cancelled);
   await NumberListing.updateOne({ _id: cancelled._id }, { $set: { providerCancelled: !!released?.ok, providerCancelDetail: String(released?.detail && typeof released.detail === 'string' ? released.detail : (released?.ok ? 'cancel requested' : '')).slice(0, 200) } });
   res.json({ order_id: cancelled._id, status: 'cancelled', refunded: cancelled.sellPrice, provider_cancelled: !!released?.ok });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/v1/categories', apiKeyAuth, async (req, res) => {
 try {
 const cats = await Category.find().sort({ name: 1 });
 res.json({ categories: cats.map(c => ({ id: c._id, name: c.name })) });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/v1/marketplace', apiKeyAuth, async (req, res) => {
 try {
 const { category, type, search } = req.query;
 const page = Math.max(1, parseInt(req.query.page) || 1);
 const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
 const skip = (page - 1) * limit;
 const filter = { available: true };
 if (type && type !== 'all') filter.type = type;
 if (category) filter.category = category;
 if (search) filter.$or = [
 { title: { $regex: search, $options: 'i' } },
 { description: { $regex: search, $options: 'i' } },
 { category: { $regex: search, $options: 'i' } }
 ];
 const [total, logs] = await Promise.all([
 Log.countDocuments(filter),
 Log.find(filter)
 .select('title description type category price soldCount maxPurchases toolQty listingType picture available createdAt')
 .sort({ createdAt: -1 })
 .skip(skip).limit(limit)
 ]);
 const items = logs.map(l => {
 const isTool = l.type === 'tool';
 const soldOut = isTool ? (l.toolQty > 0 && l.soldCount >= l.toolQty) : (l.maxPurchases > 0 && l.soldCount >= l.maxPurchases);
 return {
 id: l._id,
 title: l.title,
 description: l.description,
 type: l.type,
 listingType: l.listingType,
 category: l.category,
 price: l.price,
 soldCount: l.soldCount,
 stockLeft: isTool ? (l.toolQty > 0 ? Math.max(0, l.toolQty - l.soldCount) : null) : (l.maxPurchases > 0 ? Math.max(0, l.maxPurchases - l.soldCount) : null),
 soldOut,
 picture: l.picture || null,
 available: l.available,
 createdAt: l.createdAt
 };
 });
 res.json({
 page, limit, total,
 totalPages: Math.ceil(total / limit),
 items
 });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/v1/tools', apiKeyAuth, async (req, res) => {
 try {
 const { category, search } = req.query;
 const page = Math.max(1, parseInt(req.query.page) || 1);
 const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
 const skip = (page - 1) * limit;
 const filter = { available: true, type: 'tool' };
 if (category) filter.category = category;
 if (search) filter.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
 const [total, tools] = await Promise.all([
 Log.countDocuments(filter),
 Log.find(filter)
 .select('title description category price soldCount toolQty picture listingType createdAt')
 .sort({ createdAt: -1 })
 .skip(skip).limit(limit)
 ]);
 res.json({
 page, limit, total, totalPages: Math.ceil(total / limit),
 tools: tools.map(t => ({
 id: t._id, title: t.title, description: t.description,
 category: t.category, price: t.price, soldCount: t.soldCount,
 stockTotal: t.toolQty || null,
 stockLeft: t.toolQty > 0 ? Math.max(0, t.toolQty - t.soldCount) : null,
 soldOut: t.toolQty > 0 && t.soldCount >= t.toolQty,
 picture: t.picture || null, listingType: t.listingType, createdAt: t.createdAt
 }))
 });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/v1/marketplace/:id', apiKeyAuth, async (req, res) => {
 try {
 const log = await Log.findById(req.params.id)
 .select('-details -toolLink -deliverableFile -deliverableFileName -subAccounts');
 if (!log) return res.status(404).json({ error: 'Item not found' });
 const isTool = log.type === 'tool';
 const soldOut = isTool ? (log.toolQty > 0 && log.soldCount >= log.toolQty) : (log.maxPurchases > 0 && log.soldCount >= log.maxPurchases);
 res.json({
 id: log._id, title: log.title, description: log.description,
 type: log.type, listingType: log.listingType, category: log.category,
 price: log.price, soldCount: log.soldCount,
 stockLeft: isTool ? (log.toolQty > 0 ? Math.max(0, log.toolQty - log.soldCount) : null) : (log.maxPurchases > 0 ? Math.max(0, log.maxPurchases - log.soldCount) : null),
 soldOut, picture: log.picture || null, available: log.available,
 averageRating: log.reviews?.length ? (log.reviews.reduce((s,r)=>s+r.rating,0)/log.reviews.length).toFixed(1) : null,
 reviewCount: log.reviews?.length || 0,
 createdAt: log.createdAt
 });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/v1/transactions', apiKeyAuth, async (req, res) => {
 try {
 const page = Math.max(1, parseInt(req.query.page) || 1);
 const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
 const [total, txs] = await Promise.all([
 Transaction.countDocuments({ userId: req.apiUser._id }),
 Transaction.find({ userId: req.apiUser._id })
 .sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit)
 .select('type amount description status createdAt')
 ]);
 res.json({ page, limit, total, totalPages: Math.ceil(total/limit), transactions: txs });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/top-buyers', optionalAuth, async (req, res) => {
 try {
 const top = await Transaction.aggregate([
 { $match: { type: 'purchase', status: 'success' } },
 { $group: { _id: '$userId', totalSpent: { $sum: '$amount' }, purchaseCount: { $sum: 1 } } },
 { $sort: { totalSpent: -1 } },
 { $limit: 10 },
 { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
 { $unwind: '$user' },
 { $project: { name: '$user.name', profilePicture: '$user.profilePicture', totalSpent: 1, purchaseCount: 1 } }
 ]);
 res.json(top);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/support', async (req, res) => {
 try {
 const { name, email, subject, message, userId } = req.body;
 if (!name || !email || !message) return res.status(400).json({ error: 'Name, email and message required' });
 await Support.create({ name, email, subject: subject || 'General', message, userId });
 res.json({ message: 'Support ticket submitted!' });
 } catch { res.status(500).json({ error: 'Failed to submit ticket' }); }
});
const supportMessageSchema = new mongoose.Schema({
 userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
 sender: { type: String, enum: ['user', 'admin'], required: true },
 senderName: { type: String, default: '' },
 text: { type: String, default: '', maxlength: 2000 },
 attachmentUrl: { type: String, default: '' },
 attachmentType: { type: String, enum: ['', 'image'], default: '' },
 attachmentName: { type: String, default: '' },
 readByUser: { type: Boolean, default: false },
 readByAdmin: { type: Boolean, default: false },
 conversationStatus: { type: String, enum: ['open', 'closed'], default: 'open', index: true },
 closedAt: { type: Date, default: null },
 createdAt: { type: Date, default: Date.now, index: true }
});
const SupportMessage = mongoose.models.SupportMessage || mongoose.model('SupportMessage', supportMessageSchema);

app.get('/api/support/live', auth, async (req, res) => {
 try {
  const messages = await SupportMessage.find({ userId: req.user._id }).sort({ createdAt: 1 }).limit(300).lean();
  const latest = messages[messages.length - 1];
  await SupportMessage.updateMany({ userId: req.user._id, sender: 'admin', readByUser: false }, { $set: { readByUser: true } });
  res.json({ messages, status: latest?.conversationStatus || 'open', closedAt: latest?.closedAt || null });
 } catch { res.status(500).json({ error: 'Could not load support chat' }); }
});
app.post('/api/support/live', auth, chatUpload.single('attachment'), async (req, res) => {
 try {
  const text = String(req.body.text || '').trim();
  const attachmentUrl = req.file ? fileUrl(req.file) : '';
  if (!text && !attachmentUrl) return res.status(400).json({ error: 'Message or image is required' });
  if (req.file && !/^image\//i.test(req.file.mimetype || '')) return res.status(400).json({ error: 'Support attachments must be images' });
  if (text.length > 2000) return res.status(400).json({ error: 'Message is too long' });
  const latest = await SupportMessage.findOne({ userId: req.user._id }).sort({ createdAt: -1 }).select('conversationStatus');
  if (latest?.conversationStatus === 'closed') return res.status(409).json({ error: 'This conversation is closed. Reopen it to send a new message.' });
  res.json(await SupportMessage.create({ userId: req.user._id, sender: 'user', senderName: req.user.name, text, attachmentUrl, attachmentType: attachmentUrl ? 'image' : '', attachmentName: req.file?.originalname || '', readByUser: true }));
 } catch { res.status(500).json({ error: 'Could not send message' }); }
});
app.post('/api/support/live/status', auth, async (req, res) => {
 try {
  const status = req.body?.status === 'open' ? 'open' : 'closed';
  const closedAt = status === 'closed' ? new Date() : null;
  await SupportMessage.updateMany({ userId: req.user._id }, { $set: { conversationStatus: status, closedAt } });
  res.json({ status, closedAt });
 } catch { res.status(500).json({ error: 'Could not update conversation' }); }
});
app.get('/api/admin/support/live', anyAdminAuth, async (req, res) => {
 try {
  res.json(await SupportMessage.aggregate([
   { $sort: { createdAt: 1 } },
    { $group: { _id: '$userId', lastMessage: { $last: { $cond: [{ $ne: ['$text', ''] }, '$text', '📷 Image'] } }, lastAt: { $last: '$createdAt' }, status: { $last: '$conversationStatus' }, unread: { $sum: { $cond: [{ $and: [{ $eq: ['$sender', 'user'] }, { $eq: ['$readByAdmin', false] }] }, 1, 0] } } } },
   { $sort: { lastAt: -1 } },
   { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
   { $unwind: '$user' },
   { $project: { userId: '$_id', name: '$user.name', email: '$user.email', lastMessage: 1, lastAt: 1, status: { $ifNull: ['$status', 'open'] }, unread: 1 } }
  ]));
 } catch { res.status(500).json({ error: 'Could not load live chats' }); }
});
app.get('/api/admin/support/live/:userId', anyAdminAuth, async (req, res) => {
 try {
  const messages = await SupportMessage.find({ userId: req.params.userId }).sort({ createdAt: 1 }).limit(300).lean();
  const latest = messages[messages.length - 1];
  await SupportMessage.updateMany({ userId: req.params.userId, sender: 'user', readByAdmin: false }, { $set: { readByAdmin: true } });
  res.json({ messages, status: latest?.conversationStatus || 'open', closedAt: latest?.closedAt || null });
 } catch { res.status(500).json({ error: 'Could not load conversation' }); }
});
app.post('/api/admin/support/live/:userId', anyAdminAuth, chatUpload.single('attachment'), async (req, res) => {
 try {
  const text = String(req.body.text || '').trim();
  const attachmentUrl = req.file ? fileUrl(req.file) : '';
  if (!text && !attachmentUrl) return res.status(400).json({ error: 'Reply or image is required' });
  if (req.file && !/^image\//i.test(req.file.mimetype || '')) return res.status(400).json({ error: 'Support attachments must be images' });
  if (text.length > 2000) return res.status(400).json({ error: 'Reply is too long' });
  const latest = await SupportMessage.findOne({ userId: req.params.userId }).sort({ createdAt: -1 }).select('conversationStatus');
  if (latest?.conversationStatus === 'closed') return res.status(409).json({ error: 'Reopen this conversation before replying.' });
  res.json(await SupportMessage.create({ userId: req.params.userId, sender: 'admin', senderName: req.subAdmin?.name || 'KLS Support', text, attachmentUrl, attachmentType: attachmentUrl ? 'image' : '', attachmentName: req.file?.originalname || '', readByAdmin: true }));
 } catch { res.status(500).json({ error: 'Could not send reply' }); }
});
app.post('/api/admin/support/live/:userId/status', anyAdminAuth, async (req, res) => {
 try {
  const status = req.body?.status === 'open' ? 'open' : 'closed';
  const closedAt = status === 'closed' ? new Date() : null;
  await SupportMessage.updateMany({ userId: req.params.userId }, { $set: { conversationStatus: status, closedAt } });
  res.json({ status, closedAt });
 } catch { res.status(500).json({ error: 'Could not update conversation' }); }
});

/**
 * Operations dashboard — one call that answers "is the shop healthy right now?":
 * numbers in stock per server, boost/provider balances and unanswered chats.
 */
app.get('/api/admin/ops-overview', anyAdminAuth, async (req, res) => {
 try {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const BoostSettings = mongoose.models.BoostSettings || null;
  const cfg = await getNumberServerConfig().catch(() => null);
  const [s1, s2, s1Sold, s2Sold, soldToday, unread, waiting, recent, boostCfg, alertRows] = await Promise.all([
   NumberListing.countDocuments({ server: 'server1', status: 'available' }),
   NumberListing.countDocuments({ server: 'server2', status: 'available' }),
   NumberListing.countDocuments({ server: 'server1', status: { $in: ['sold', 'delivered'] } }),
   NumberListing.countDocuments({ server: 'server2', status: { $in: ['sold', 'delivered'] } }),
   NumberListing.countDocuments({ soldAt: { $gte: dayAgo } }),
   SupportMessage.countDocuments({ sender: 'user', readByAdmin: false }),
   SupportMessage.distinct('userId', { sender: 'user', readByAdmin: false }),
   SupportMessage.find({ sender: 'user', readByAdmin: false }).sort({ createdAt: -1 }).limit(8)
     .populate('userId', 'name email').lean(),
   BoostSettings ? BoostSettings.findOne().lean() : null,
   AdminAlertLog.find().sort({ lastSentAt: -1 }).limit(10).lean()
  ]);
  res.json({
   numbers: {
    server1: { available: s1, sold: s1Sold },
    server2: { available: s2, sold: s2Sold },
    soldLast24h: soldToday,
    providerBalanceUsd: cfg ? Number(cfg.lastBalanceUsd || 0) : null,
    providerBalanceAt: cfg ? cfg.lastBalanceAt : null,
    lowBalanceThresholdUsd: cfg ? Number(cfg.lowBalanceThresholdUsd || 0) : null,
    lastError: cfg ? (cfg.lastBalanceError || '') : ''
   },
   boost: {
    providerBalance: boostCfg ? boostCfg.lastProviderBalance : null,
    providerBalanceAt: boostCfg ? boostCfg.lastProviderBalanceAt : null,
    enabled: boostCfg ? boostCfg.enabled !== false : null
   },
   chat: {
    unreadMessages: unread,
    waitingUsers: (waiting || []).length,
    recent: (recent || []).map(m => ({
     name: m.userId?.name || 'User',
     email: m.userId?.email || '',
     text: String(m.text || '').slice(0, 140),
     createdAt: m.createdAt,
     userId: m.userId?._id || m.userId
    }))
   },
   alerts: (alertRows || []).map(a => ({ type: a.type, title: a.lastTitle, lastSentAt: a.lastSentAt })),
   activeAlerts: Array.from(numbersAlerts.values())
  });
 } catch (e) { res.status(500).json({ error: e.message || 'Could not load overview' }); }
});


const SUPPORT_FAQ = [
 { keywords: ['deposit', 'fund', 'top up', 'topup', 'add money', 'add fund'], reply: "To deposit: go to the Deposit page, choose Bank Transfer or Card, enter an amount, and follow the on-screen steps. Funds usually reflect within a minute or two. If a deposit doesn't reflect after 10+ minutes, contact support with your reference." },
 { keywords: ['virtual account', 'account number', 'bank transfer'], reply: "Your virtual account is a one-time bank account number generated just for your deposit — transfer the exact amount shown, from any Nigerian bank, and your wallet updates automatically once it clears." },
 { keywords: ['balance', 'wallet', 'how much do i have', 'my money'], reply: "You can see your current wallet balance at the top of the app, or on your Deposit page — it also shows your total lifetime deposits. It updates instantly after every purchase, deposit, or refund." },
 { keywords: ['refund', 'money back', 'chargeback'], reply: "If an item you purchased doesn't work as described, contact support with your receipt ID (found in Transactions) and the admin team will review it — refunds and replacements are handled case by case." },
 { keywords: ['buy', 'purchase', 'order', 'checkout'], reply: "To buy something: open Marketplace, pick a listing, and confirm the purchase — it's deducted straight from your wallet balance and delivered instantly to your Purchases page." },
 { keywords: ['delivery', 'deliver', 'received', 'where is my'], reply: "Delivery is instant for almost everything — check your Purchases page right after buying. If nothing shows up after a few minutes, contact support with your receipt ID." },
 { keywords: ['referral', 'refer a friend', 'refer', 'commission', 'invite'], reply: "Share your referral link from the Referrals page. You earn a 4% commission automatically whenever someone you referred makes a purchase." },
 { keywords: ['api', 'developer', 'integrate', 'endpoint', 'fetch', 'json'], reply: "Generate an API Key + Secret from Settings API Access, then check the API Docs page (in the menu) for endpoints, JSON responses, and code examples in cURL, JavaScript, and Python." },
 { keywords: ['number', 'otp', 'virtual number', 'buy number', 'sms verification', 'phone verification'], reply: "Buy Numbers gives you a real phone number to receive SMS/OTP codes for verifying accounts. There are two servers: Server 1 is USA/Canada numbers for many different services (not only WhatsApp), and you can also pick other countries. Server 2 covers many other services (not just WhatsApp) across different countries. Pick a server on the Buy Numbers page, choose your service/country, and the code arrives automatically once the sender sends it — no manual refresh needed." },
 { keywords: ['server 1', 'server1', 'usa whatsapp', 'canada'], reply: "Server 1 is no longer USA WhatsApp only — it now gives USA/Canada numbers for many different services, and you can also choose any other country the provider has. Search your country, search your service, see the price, and buy." },
 { keywords: ['server 2', 'server2'], reply: "Server 2 covers a wide range of services beyond WhatsApp — pick your country and the service you need to verify (e.g. Telegram, Facebook, Google, etc.), buy a number, and the code arrives automatically once it's sent." },
 { keywords: ['sms', 'otp not arriving', 'code not coming', 'no code'], reply: "Codes usually arrive within a minute or two of the sender texting the number — the order screen updates automatically, no need to refresh. If nothing arrives before your order times out, it's cancelled automatically and you're not charged." },
 { keywords: ['badge', 'achievement', 'unlock'], reply: "Badges are earned automatically as you use the platform — spending, referring friends, and playing games all count. Check the Referrals or Home page to see which ones you've unlocked." },
 { keywords: ['password', 'login', 'forgot', 'can\'t sign in', 'cant sign in'], reply: "Use the 'Forgot Password' link on the Login page to reset it via email. If you're still stuck, contact support directly." },
 { keywords: ['restrict', 'blocked', 'suspend', 'banned'], reply: "If your account was restricted, it's usually tied to a security check (e.g. signup details). Contact support with your account email and the team will review it." },
 { keywords: ['fee', 'charge', 'extra cost'], reply: "A small fee may apply on deposits and API-based purchases to cover payment processing — the exact amount is always shown before you confirm." },
 { keywords: ['contact', 'human', 'agent', 'real person', 'talk to someone'], reply: "For anything beyond the basics, tap the Support button (bottom-right, headset icon) — it has Contact Owner, Community, Channel, and Telegram, plus this assistant." }
];
function matchSupportFaq(message) {
 const lower = message.toLowerCase();
 let best = null, bestScore = 0;
 for (const item of SUPPORT_FAQ) {
 const score = item.keywords.reduce((s, k) => s + (lower.includes(k) ? k.length : 0), 0); // longer/more-specific keyword matches score higher
 if (score > bestScore) { best = item; bestScore = score; }
 }
 return best ? best.reply : null;
}
app.post('/api/support/ai-chat', auth, async (req, res) => {
 try {
 const { message } = req.body;
 if (!message || !String(message).trim()) return res.status(400).json({ error: 'Message is required' });
 const faqReply = matchSupportFaq(message);
 if (faqReply) return res.json({ reply: faqReply, source: 'faq' });
 res.json({ reply: "I'm not sure about that one — please reach out on WhatsApp support and the team will help you directly.", source: 'fallback' });
 } catch (e) { res.status(500).json({ error: 'Failed to get a reply — please try again.' }); }
});
app.post('/api/admin/verify', (req, res) => {
 req.body.passcode === process.env.ADMIN_PASSCODE ? res.json({ success: true }) : res.status(403).json({ error: 'Wrong passcode' });
});
app.get('/api/admin/restock-requests', anyAdminAuth, async (req, res) => {
 try {
 const grouped = await RestockRequest.aggregate([
 { $group: { _id: '$logId', logTitle: { $first: '$logTitle' }, count: { $sum: 1 }, requesters: { $push: { userName: '$userName', createdAt: '$createdAt' } }, lastRequestedAt: { $max: '$createdAt' } } },
 { $sort: { count: -1 } }
 ]);
 res.json(grouped);
 } catch (e) { res.status(500).json({ error: 'Failed to load restock requests' }); }
});
app.get('/api/admin/inventory-breakdown', adminAuth, async (req, res) => {
 try {
 const logs = await Log.find({ available: true });
 const rows = logs.map(l => {
 let unsoldCount, subtotal, priceLabel;
 if (l.type === 'tool') {
 unsoldCount = 1;
 subtotal = l.price || 0;
 priceLabel = `₦${(l.price || 0).toLocaleString('en-NG')} (fixed, tools aren't multiplied by stock)`;
 } else if (l.listingType === 'folder') {
 const unsold = (l.subAccounts || []).filter(sa => !sa.sold);
 unsoldCount = unsold.length;
 subtotal = unsold.reduce((s, sa) => s + (sa.price || 0), 0);
 priceLabel = `${unsoldCount} unsold sub-account(s)`;
 } else {
 unsoldCount = Math.max(0, (l.maxPurchases || 1) - (l.soldCount || 0));
 subtotal = l.price || 0;
 priceLabel = `₦${(l.price || 0).toLocaleString('en-NG')} (${unsoldCount} remaining, counted once)`;
 }
 return { id: l._id, title: l.title, type: l.type, listingType: l.listingType, unsoldCount, subtotal, priceLabel };
 }).filter(r => r.subtotal > 0).sort((a, b) => b.subtotal - a.subtotal);
 res.json(rows);
 } catch (e) { res.status(500).json({ error: 'Failed to load breakdown: ' + e.message }); }
});
app.get('/api/admin/logs', adminAuth, async (req, res) => {
 res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
 res.set('Pragma', 'no-cache');
 res.set('Expires', '0');
 const logs = await Log.find().sort({ createdAt: -1 });
 if (req.query.includeSold === '1') return res.json(logs); // full history, including old sold sub-accounts
 const withStaleSoldStripped = logs.map(l => {
 if (l.listingType !== 'folder') return l;
 const obj = l.toObject();
 obj.subAccounts = stripStaleSoldSubAccounts(obj.subAccounts);
 return obj;
 });
 res.json(withStaleSoldStripped);
});
app.post('/api/admin/logs/clean-sold', adminAuth, async (req, res) => {
 try {
 const folderLogs = await Log.find({ listingType: 'folder', 'subAccounts.sold': true });
 let logsAffected = 0, subAccountsRemoved = 0;
 for (const log of folderLogs) {
 const before = log.subAccounts.length;
 log.subAccounts = log.subAccounts.filter(sa => !sa.sold);
 const removed = before - log.subAccounts.length;
 if (removed > 0) {
 await log.save();
 logsAffected++;
 subAccountsRemoved += removed;
 }
 }
 res.json({ logsAffected, subAccountsRemoved });
 } catch (e) { res.status(500).json({ error: 'Cleanup failed: ' + e.message }); }
});
function heuristicSplitLogs(text) {
 const raw = String(text).replace(/\r\n/g, '\n');
 let blocks = raw.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
 if (blocks.length > 1) return blocks;
 const numberedSplit = raw.split(/\n(?=\s*(?:\d{1,3}[\.\)]|account\s*\d{1,3}\s*[:.\)])\s*)/i)
 .map(b => b.trim()).filter(Boolean);
 if (numberedSplit.length > 1) return numberedSplit;
 const lines = raw.split('\n');
 const counts = {};
 lines.forEach(l => {
 const key = l.replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, 12);
 if (key.length >= 3) counts[key] = (counts[key] || 0) + 1;
 });
 const anchorKey = Object.keys(counts).find(k => counts[k] >= 2 && counts[k] <= 200);
 if (anchorKey) {
 const anchorIndexes = [];
 lines.forEach((l, i) => {
 const key = l.replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, 12);
 if (key === anchorKey) anchorIndexes.push(i);
 });
 if (anchorIndexes.length > 1) {
 const chunks = [];
 for (let i = 0; i < anchorIndexes.length; i++) {
 const start = anchorIndexes[i];
 const end = i + 1 < anchorIndexes.length ? anchorIndexes[i + 1] : lines.length;
 const chunk = lines.slice(start, end).join('\n').trim();
 if (chunk) chunks.push(chunk);
 }
 if (chunks.length > 1) return chunks;
 }
 }
 return raw.trim() ? [raw.trim()] : [];
}
app.post('/api/admin/ai-split-logs', adminAuth, async (req, res) => {
 try {
 const { text } = req.body;
 if (!text || !String(text).trim()) return res.status(400).json({ error: 'Paste the raw logs text first' });
 const accounts = heuristicSplitLogs(text);
 if (!accounts.length) return res.status(400).json({ error: 'Could not detect any account entries in this text — check the paste and try again.' });
 if (accounts.length === 1) {
 return res.json({ accounts, note: 'Only detected 1 entry — if you pasted multiple accounts, try separating each one with a blank line for reliable splitting.' });
 }
 res.json({ accounts });
 } catch (e) {
 console.error('Split logs error:', e.message);
 res.status(500).json({ error: 'Splitting failed: ' + e.message });
 }
});
app.post('/api/admin/logs', adminAuth, uploadLogFields, async (req, res) => {
 try {
 const { title, description, details, toolLink, toolQty, maxPurchases, price, category, type, deliveryType, listingType, subAccounts, adminReviewType, adminReviewContent, adminReviewRating, tutorialType, tutorialLinkUrl } = req.body;
 const isFolder = listingType === 'folder';
 if (!title) return res.status(400).json({ error: 'Title required' });
 if (!isFolder && !price) return res.status(400).json({ error: 'Price required' });
 const picFile = req.files?.picture?.[0];
 const deliverableFile = req.files?.deliverableFile?.[0];
 const reviewFile = req.files?.adminReviewFile?.[0];
 const picture = picFile ? fileUrl(picFile) : null;
 let tutorial = { tutorialType: 'none', images: [], videoUrl: '', linkUrl: '' };
 if (tutorialType === 'images') {
 const tutorialImageFiles = req.files?.tutorialImages || [];
 if (!tutorialImageFiles.length) return res.status(400).json({ error: 'Please upload at least one tutorial image' });
 tutorial = { tutorialType: 'images', images: tutorialImageFiles.map(fileUrl), videoUrl: '', linkUrl: '' };
 } else if (tutorialType === 'video') {
 const tutorialVideoFile = req.files?.tutorialVideo?.[0];
 if (!tutorialVideoFile) return res.status(400).json({ error: 'Please upload a tutorial video' });
 tutorial = { tutorialType: 'video', images: [], videoUrl: fileUrl(tutorialVideoFile), linkUrl: '' };
 } else if (tutorialType === 'link') {
 if (!tutorialLinkUrl) return res.status(400).json({ error: 'Please provide a tutorial link' });
 tutorial = { tutorialType: 'link', images: [], videoUrl: '', linkUrl: tutorialLinkUrl };
 }
 let adminReview = { reviewType: 'none', content: '' };
 if (adminReviewType && adminReviewType !== 'none') {
 adminReview.reviewType = adminReviewType;
 if ((adminReviewType === 'image' || adminReviewType === 'video') && reviewFile) adminReview.content = fileUrl(reviewFile);
 else if (adminReviewType === 'text' || adminReviewType === 'link') adminReview.content = adminReviewContent || '';
 if (adminReviewRating) adminReview.rating = parseInt(adminReviewRating);
 }
 const finalDeliveryType = deliveryType === 'file' ? 'file' : 'link';
 if (!isFolder && type === 'tool') {
 if (finalDeliveryType === 'file' && !deliverableFile) return res.status(400).json({ error: 'Please upload the deliverable file' });
 if (finalDeliveryType === 'link' && !toolLink) return res.status(400).json({ error: 'Tool link is required' });
 }
 let parsedSubAccounts = [];
 if (isFolder) {
 try { parsedSubAccounts = subAccounts ? JSON.parse(subAccounts) : []; } catch { return res.status(400).json({ error: 'Invalid sub-accounts data' }); }
 if (!parsedSubAccounts.length) return res.status(400).json({ error: 'A folder needs at least one sub-account' });
 parsedSubAccounts = parsedSubAccounts.map((sa, idx) => {
 let saAdminReview = { reviewType: 'none', content: '' };
 if (sa.adminReviewType && sa.adminReviewType !== 'none') {
 saAdminReview.reviewType = sa.adminReviewType;
 const saReviewFile = req.files?.[`subReviewFile_${idx}`]?.[0];
 if ((sa.adminReviewType === 'image' || sa.adminReviewType === 'video') && saReviewFile) saAdminReview.content = fileUrl(saReviewFile);
 else if (sa.adminReviewType === 'text' || sa.adminReviewType === 'link') saAdminReview.content = sa.adminReviewContent || '';
 if (sa.adminReviewRating) saAdminReview.rating = parseInt(sa.adminReviewRating);
 }
 let saTutorial = { tutorialType: 'none', images: [], videoUrl: '', linkUrl: '' };
 if (sa.tutorialType && sa.tutorialType !== 'none') {
 saTutorial.tutorialType = sa.tutorialType;
 const saTutFile = req.files?.[`subTutorialFile_${idx}`]?.[0];
 if (sa.tutorialType === 'video' && saTutFile) saTutorial.videoUrl = fileUrl(saTutFile);
 else if (sa.tutorialType === 'images' && saTutFile) saTutorial.images = [fileUrl(saTutFile)];
 else if (sa.tutorialType === 'link') saTutorial.linkUrl = sa.tutorialLinkUrl || '';
 }
 return {
 label: sa.label || 'Account', details: sa.details || '', toolLink: sa.toolLink || '',
 deliveryType: sa.deliveryType === 'file' ? 'file' : 'link',
 price: parseFloat(sa.price) || 0, picture: sa.picture || '',
 adminReview: saAdminReview, tutorial: saTutorial
 };
 });
 if (parsedSubAccounts.some(sa => !sa.price)) return res.status(400).json({ error: 'Every sub-account needs a price' });
 }
 const log = await Log.create({
 type: type || 'log', listingType: isFolder ? 'folder' : 'simple',
 title, description: description || '', details: isFolder ? '' : (details || ''),
 toolLink: isFolder ? '' : (toolLink || ''),
 deliveryType: finalDeliveryType,
 deliverableFile: isFolder ? '' : (deliverableFile ? fileUrl(deliverableFile) : ''),
 deliverableFileName: isFolder ? '' : (deliverableFile ? deliverableFile.originalname : ''),
 toolQty: parseInt(toolQty) || 0, maxPurchases: parseInt(maxPurchases) || 1,
 price: isFolder ? undefined : parseFloat(price),
 subAccounts: isFolder ? parsedSubAccounts : [],
 category: category || 'General', picture,
 adminReview, tutorial
 });
 try {
  const { announceNewStock } = require('./lib/restock-notify');
  await announceNewStock(Announcement, log);
 } catch (notifyError) {
  console.error('[new-stock] announcement failed (non-fatal):', notifyError.message);
 }
 res.json(log);
 } catch (e) { res.status(500).json({ error: 'Failed: ' + e.message }); }
});
app.put('/api/admin/logs/:id', adminAuth, uploadLogFields, async (req, res) => {
 try {
 const { title, description, details, toolLink, toolQty, maxPurchases, price, category, type, available, deliveryType, subAccounts, adminReviewType, adminReviewContent, adminReviewRating, clearAdminReview, tutorialType, tutorialLinkUrl, clearTutorial } = req.body;
 const existing = await Log.findById(req.params.id);
 if (!existing) return res.status(404).json({ error: 'Not found' });
 const update = { title, description, category, type: type || 'log', available: available === 'true' };
 if (existing.listingType !== 'folder') {
 update.details = details; update.toolLink = toolLink;
 update.toolQty = parseInt(toolQty) || 0; update.maxPurchases = parseInt(maxPurchases) || 1;
 update.price = parseFloat(price);
 } else if (subAccounts) {
 try {
 const incoming = JSON.parse(subAccounts);
 update.subAccounts = incoming.map((sa, idx) => {
 let saAdminReview = sa.adminReview || { reviewType: 'none', content: '' };
 if (sa.clearAdminReview) {
 saAdminReview = { reviewType: 'none', content: '' };
 } else if (sa.adminReviewType && sa.adminReviewType !== 'none') {
 saAdminReview = { reviewType: sa.adminReviewType };
 const saReviewFile = req.files?.[`subReviewFile_${idx}`]?.[0];
 if ((sa.adminReviewType === 'image' || sa.adminReviewType === 'video') && saReviewFile) saAdminReview.content = fileUrl(saReviewFile);
 else if (sa.adminReviewType === 'image' || sa.adminReviewType === 'video') saAdminReview.content = (sa.adminReview && sa.adminReview.content) || '';
 else saAdminReview.content = sa.adminReviewContent || '';
 if (sa.adminReviewRating) saAdminReview.rating = parseInt(sa.adminReviewRating);
 }
 let saTutorial = sa.tutorial || { tutorialType: 'none', images: [], videoUrl: '', linkUrl: '' };
 if (sa.clearTutorial) {
 saTutorial = { tutorialType: 'none', images: [], videoUrl: '', linkUrl: '' };
 } else if (sa.tutorialType && sa.tutorialType !== 'none') {
 saTutorial = { tutorialType: sa.tutorialType, images: [], videoUrl: '', linkUrl: '' };
 const saTutFile = req.files?.[`subTutorialFile_${idx}`]?.[0];
 if (sa.tutorialType === 'video') saTutorial.videoUrl = saTutFile ? fileUrl(saTutFile) : (sa.tutorial?.videoUrl || '');
 else if (sa.tutorialType === 'images') saTutorial.images = saTutFile ? [fileUrl(saTutFile)] : (sa.tutorial?.images || []);
 else if (sa.tutorialType === 'link') saTutorial.linkUrl = sa.tutorialLinkUrl || '';
 }
 return {
 _id: sa._id, label: sa.label || 'Account', details: sa.details || '', toolLink: sa.toolLink || '',
 deliveryType: sa.deliveryType === 'file' ? 'file' : 'link',
 price: parseFloat(sa.price) || 0, picture: sa.picture || '',
 sold: !!sa.sold, soldTo: sa.soldTo, soldAt: sa.soldAt, reviews: sa.reviews || [],
 adminReview: saAdminReview, tutorial: saTutorial
 };
 });
 } catch { return res.status(400).json({ error: 'Invalid sub-accounts data' }); }
 }
 if (deliveryType) update.deliveryType = deliveryType === 'file' ? 'file' : 'link';
 const picFile = req.files?.picture?.[0];
 const deliverableFile = req.files?.deliverableFile?.[0];
 const reviewFile = req.files?.adminReviewFile?.[0];
 if (picFile) update.picture = fileUrl(picFile);
 if (deliverableFile) {
 update.deliverableFile = fileUrl(deliverableFile);
 update.deliverableFileName = deliverableFile.originalname;
 }
 if (clearAdminReview === 'true') {
 update.adminReview = { reviewType: 'none', content: '' };
 } else if (adminReviewType && adminReviewType !== 'none') {
 const ar = { reviewType: adminReviewType };
 if ((adminReviewType === 'image' || adminReviewType === 'video') && reviewFile) ar.content = fileUrl(reviewFile);
 else if (adminReviewType === 'image' || adminReviewType === 'video') ar.content = existing.adminReview?.content || '';
 else ar.content = adminReviewContent || '';
 if (adminReviewRating) ar.rating = parseInt(adminReviewRating);
 update.adminReview = ar;
 }
 if (clearTutorial === 'true') {
 update.tutorial = { tutorialType: 'none', images: [], videoUrl: '', linkUrl: '' };
 } else if (tutorialType === 'images') {
 const tutorialImageFiles = req.files?.tutorialImages || [];
 if (tutorialImageFiles.length) update.tutorial = { tutorialType: 'images', images: tutorialImageFiles.map(fileUrl), videoUrl: '', linkUrl: '' };
 } else if (tutorialType === 'video') {
 const tutorialVideoFile = req.files?.tutorialVideo?.[0];
 if (tutorialVideoFile) update.tutorial = { tutorialType: 'video', images: [], videoUrl: fileUrl(tutorialVideoFile), linkUrl: '' };
 } else if (tutorialType === 'link' && tutorialLinkUrl) {
 update.tutorial = { tutorialType: 'link', images: [], videoUrl: '', linkUrl: tutorialLinkUrl };
 }
 const log = await Log.findByIdAndUpdate(req.params.id, update, { new: true });
 if (!log) return res.status(404).json({ error: 'Not found' });
 res.json(log);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/logs/:id', adminAuth, async (req, res) => { await Log.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); });
app.delete('/api/admin/logs/:id/tutorial', adminAuth, async (req, res) => {
 const log = await Log.findByIdAndUpdate(
 req.params.id,
 { tutorial: { tutorialType: 'none', images: [], videoUrl: '', linkUrl: '' } },
 { new: true }
 );
 if (!log) return res.status(404).json({ error: 'Not found' });
 res.json({ message: 'Tutorial removed', log });
});
app.get('/api/admin/users', adminAuth, async (req, res) => {
 const { search, limit } = req.query;
 const filter = search
 ? { $or: [
 { name: new RegExp(search, 'i') },
 { email: new RegExp(search, 'i') },
 { contactPhone: new RegExp(search, 'i') },
 { gameId: new RegExp(search, 'i') },
 { 'virtualAccount.accountNumber': new RegExp(search, 'i') }
 ] }
 : {};
 const query = User.find(filter).select('-password -apiSecret').sort({ createdAt: -1 });
 if (limit) query.limit(Math.min(Number(limit) || 50, 200));
 res.json(await query);
});
// Heartbeat — the browser pings this while a page is open so someone reading
// the site (rather than clicking API-backed buttons) still counts as online.
app.post('/api/heartbeat', auth, async (req, res) => {
 try {
 await User.updateOne({ _id: req.user._id }, { $set: { lastActiveAt: new Date(), lastSeen: new Date() } });
 res.json({ ok: true, at: new Date() });
 } catch (e) {
 console.error('[KLS] heartbeat failed:', e.message);
 res.status(500).json({ error: e.message });
 }
});
app.get('/api/admin/active-users', adminAuth, async (req, res) => {
 try {
 const since = activitySince();
 // Older accounts predate the lastActiveAt field, so also accept lastSeen.
 // Without this an account created before that field existed could deposit,
 // be credited and still never appear in the "online" list.
 const users = await User.find({ $or: [{ lastActiveAt: { $gte: since } }, { lastSeen: { $gte: since } }] })
 .select('name email profilePicture lastActiveAt lastSeen gameId balance country contactPhone virtualAccount createdAt')
 .sort({ lastActiveAt: -1, lastSeen: -1 })
 .lean();
 const rows = users.map(u => ({ ...u, lastActiveAt: u.lastActiveAt || u.lastSeen }));
 console.log(`[KLS] Admin active-users: ${rows.length} online in last ${ACTIVITY_WINDOW_HOURS}h`);
 res.json(rows);
 } catch (e) {
 console.error('[KLS] active-users failed:', e.message);
 res.status(500).json({ error: 'Failed to load active users' });
 }
});
app.get('/api/active-users', optionalAuth, async (req, res) => {
 try {
 const since = activitySince();
 const users = await User.find({ $or: [{ lastActiveAt: { $gte: since } }, { lastSeen: { $gte: since } }] })
 .select('name profilePicture lastActiveAt lastSeen')
 .sort({ lastActiveAt: -1 })
 .limit(50);
 res.json({ count: users.length, users });
 } catch (e) { res.status(500).json({ error: 'Failed to load active users' }); }
});
app.post('/api/admin/credit', adminAuth, async (req, res) => {
 try {
 const { userId, amount, reason } = req.body;
 if (!userId) return res.status(400).json({ error: 'User ID required' });
 const parsed = parseFloat(amount);
 if (isNaN(parsed) || parsed <= 0) return res.status(400).json({ error: 'Valid amount required' });
 // Atomic $inc — reading the balance and saving it back could wipe out a
 // deposit or purchase that landed in the same second, which is how a credit
 // can look like it "did not reflect" on the customer's side.
 const user = await User.findByIdAndUpdate(userId, { $inc: { balance: parsed } }, { new: true });
 if (!user) return res.status(404).json({ error: 'User not found' });
 await Transaction.create({ userId: user._id, type: 'admin_credit', amount: parsed, description: reason || 'Admin manual credit', status: 'success' });
 pushBalanceToUser(user._id, user.balance, parsed);
 console.log(`[KLS] Admin credited ₦${parsed} to ${user.email} — new balance ₦${user.balance}`);
 res.json({ success: true, message: ` Credited ₦${parsed.toLocaleString('en-NG')} to ${user.name}`, newBalance: user.balance, userName: user.name, userEmail: user.email });
 } catch (e) { res.status(500).json({ error: 'Credit failed: ' + e.message }); }
});
app.post('/api/admin/deduct', adminAuth, async (req, res) => {
 try {
 const { userId, amount, reason } = req.body;
 if (!userId) return res.status(400).json({ error: 'User ID required' });
 const parsed = parseFloat(amount);
 if (isNaN(parsed) || parsed <= 0) return res.status(400).json({ error: 'Valid amount required' });
 // Deduct FULL requested amount using atomic $inc — balance CAN go negative.
 // Example: balance ₦3500, deduct ₦5000 → balance becomes -₦1500 (displayed in red).
 // This mirrors how credit works and lets admin accurately record any amount.
 const user = await User.findByIdAndUpdate(userId, { $inc: { balance: -parsed } }, { new: true });
 if (!user) return res.status(404).json({ error: 'User not found' });
 await Transaction.create({ userId: user._id, type: 'admin_debit', amount: parsed, description: reason || 'Admin manual deduction', status: 'success' });
 pushBalanceToUser(user._id, user.balance);
 const balLabel = user.balance < 0 ? `-₦${Math.abs(user.balance).toLocaleString('en-NG')}` : `₦${user.balance.toLocaleString('en-NG')}`;
 console.log(`[KLS] Admin deducted ₦${parsed} from ${user.email} — new balance ${balLabel}`);
 res.json({ success: true, message: `✅ Deducted ₦${parsed.toLocaleString('en-NG')} from ${user.name} — new balance: ${balLabel}`, newBalance: user.balance, userName: user.name, userEmail: user.email });
 } catch (e) { res.status(500).json({ error: 'Deduction failed: ' + e.message }); }
});
function getWeekBounds(date = new Date()) {
 const d = new Date(date);
 const day = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
 const diffToMonday = day === 0 ? -6 : 1 - day; // if Sunday, Monday was 6 days ago
 const monday = new Date(d);
 monday.setHours(0, 0, 0, 0);
 monday.setDate(d.getDate() + diffToMonday);
 const nextMonday = new Date(monday);
 nextMonday.setDate(monday.getDate() + 7);
 const weekKey = monday.toISOString().slice(0, 10);
 return { start: monday, end: nextMonday, weekKey };
}
app.get('/api/admin/weekly-top-buyer', adminAuth, async (req, res) => {
 try {
 let start, end, weekKey;
 if (req.query.weekKey) {
 start = new Date(req.query.weekKey + 'T00:00:00.000Z');
 end = new Date(start); end.setDate(start.getDate() + 7);
 weekKey = req.query.weekKey;
 } else {
 ({ start, end, weekKey } = getWeekBounds());
 }
 const purchases = await Transaction.aggregate([
 { $match: { type: 'purchase', status: 'success', createdAt: { $gte: start, $lt: end } } },
 { $group: { _id: '$userId', purchaseCount: { $sum: 1 } } },
 { $sort: { purchaseCount: -1 } },
 { $limit: 10 }
 ]);
 const userIds = purchases.map(p => p._id);
 const users = await User.find({ _id: { $in: userIds } }).select('name email');
 const userMap = Object.fromEntries(users.map(u => [String(u._id), u]));
 const leaderboard = purchases.map(p => ({
 userId: p._id, purchaseCount: p.purchaseCount,
 name: userMap[String(p._id)]?.name || 'Unknown', email: userMap[String(p._id)]?.email || ''
 }));
 const alreadyPaid = await WeeklyReward.findOne({ weekKey });
 res.json({ weekKey, weekStart: start, weekEnd: end, leaderboard, alreadyPaid: alreadyPaid || null });
 } catch (e) { res.status(500).json({ error: 'Failed to load weekly leaderboard: ' + e.message }); }
});
app.post('/api/admin/weekly-top-buyer/pay', adminAuth, async (req, res) => {
 try {
 const { weekKey, userId, amount } = req.body;
 if (!weekKey || !userId) return res.status(400).json({ error: 'weekKey and userId are required' });
 const existing = await WeeklyReward.findOne({ weekKey });
 if (existing) return res.status(409).json({ error: `Week ${weekKey} was already paid out to ${existing.winnerName}.` });
 const user = await User.findById(userId);
 if (!user) return res.status(404).json({ error: 'User not found' });
 const rewardAmount = parseFloat(amount) || 50;
 const { start, end } = getWeekBounds(new Date(weekKey + 'T00:00:00.000Z'));
 const purchaseCount = await Transaction.countDocuments({ userId, type: 'purchase', status: 'success', createdAt: { $gte: start, $lt: end } });
 user.balance = (user.balance || 0) + rewardAmount;
 await user.save();
 await Transaction.create({ userId: user._id, type: 'admin_credit', amount: rewardAmount, description: ` Weekly top buyer reward (week of ${weekKey})`, status: 'success' });
 await WeeklyReward.create({ weekKey, winnerId: user._id, winnerName: user.name, purchaseCount, amount: rewardAmount });
 res.json({ success: true, message: ` Awarded ₦${rewardAmount} to ${user.name} for week of ${weekKey}!`, newBalance: user.balance });
 } catch (e) {
 if (e.code === 11000) return res.status(409).json({ error: 'This week was already paid out (race condition caught).' });
 res.status(500).json({ error: 'Failed to pay weekly reward: ' + e.message });
 }
});
app.put('/api/admin/users/:id/restrict', adminAuth, async (req, res) => {
 try {
 const { restricted, reason } = req.body;
 const update = { restricted: !!restricted };
 if (restricted) { update.restrictedReason = reason || 'Restricted by admin'; update.restrictedAt = new Date(); }
 else { update.restrictedReason = ''; update.restrictedAt = null; }
 const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password -apiSecret');
 if (!user) return res.status(404).json({ error: 'User not found' });
 res.json({ success: true, user, message: restricted ? ` ${user.name} has been restricted` : ` ${user.name} has been unrestricted` });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/security/suspicious-emails', anyAdminAuth, async (req, res) => {
 try {
 const users = await User.find({ restricted: { $ne: true } }).select('name email createdAt referredBy balance');
 const suspicious = users.filter(u => isBlockedEmailDomain(u.email));
 res.json(suspicious);
 } catch (e) { res.status(500).json({ error: 'Failed to scan for suspicious emails' }); }
});
app.get('/api/admin/security/referral-clusters', anyAdminAuth, async (req, res) => {
 try {
 const CLUSTER_THRESHOLD = 3; // 3+ referred accounts sharing one signup IP is flagged
 const rows = await User.aggregate([
 { $match: { referredBy: { $ne: null }, signupIp: { $nin: [null, ''] } } },
 { $group: { _id: { referredBy: '$referredBy', ip: '$signupIp' }, count: { $sum: 1 }, users: { $push: { id: '$_id', name: '$name', email: '$email', createdAt: '$createdAt' } } } },
 { $match: { count: { $gte: CLUSTER_THRESHOLD } } },
 { $sort: { count: -1 } }
 ]);
 const referrerIds = rows.map(r => r._id.referredBy);
 const referrers = await User.find({ _id: { $in: referrerIds } }).select('name email restricted');
 const referrerMap = Object.fromEntries(referrers.map(r => [r._id.toString(), r]));
 res.json(rows.map(r => ({
 referrer: referrerMap[r._id.referredBy.toString()] || null,
 signupIp: r._id.ip,
 count: r.count,
 users: r.users
 })));
 } catch (e) { res.status(500).json({ error: 'Failed to scan for referral clusters' }); }
});
app.post('/api/admin/security/bulk-restrict', anyAdminAuth, async (req, res) => {
 try {
 const { userIds, reason } = req.body;
 if (!Array.isArray(userIds) || !userIds.length) return res.status(400).json({ error: 'userIds array is required' });
 const result = await User.updateMany(
 { _id: { $in: userIds } },
 { restricted: true, restrictedReason: reason || 'Referral/signup abuse detected', restrictedAt: new Date() }
 );
 res.json({ message: `Restricted ${result.modifiedCount} account(s)` });
 } catch (e) { res.status(500).json({ error: 'Bulk restrict failed: ' + e.message }); }
});
async function permanentlyDeleteUsers(userIds) {
 await Promise.all([
 Transaction.deleteMany({ userId: { $in: userIds } }),
 ReferralEarning.deleteMany({ $or: [{ referrerId: { $in: userIds } }, { referredUserId: { $in: userIds } }] }),
 GameScore.deleteMany({ userId: { $in: userIds } }),
 UserBadge.deleteMany({ userId: { $in: userIds } })
 ]);
 const result = await User.deleteMany({ _id: { $in: userIds } });
 return result.deletedCount;
}
app.post('/api/admin/security/delete-users', adminAuth, async (req, res) => {
 try {
 const { userIds } = req.body;
 if (!Array.isArray(userIds) || !userIds.length) return res.status(400).json({ error: 'userIds array is required' });
 const deletedCount = await permanentlyDeleteUsers(userIds);
 res.json({ message: `Permanently deleted ${deletedCount} account(s)` });
 } catch (e) { res.status(500).json({ error: 'Delete failed: ' + e.message }); }
});
app.post('/api/admin/security/purge-suspicious-emails', adminAuth, async (req, res) => {
 try {
 const users = await User.find({}).select('_id email');
 const toDelete = users.filter(u => isBlockedEmailDomain(u.email)).map(u => u._id);
 if (!toDelete.length) return res.json({ message: 'No suspicious accounts found — nothing to delete.', deletedCount: 0 });
 const deletedCount = await permanentlyDeleteUsers(toDelete);
 res.json({ message: `Permanently deleted ${deletedCount} account(s) using fake/disposable email domains`, deletedCount });
 } catch (e) { res.status(500).json({ error: 'Purge failed: ' + e.message }); }
});
app.get('/api/admin/users/:id/logins', adminAuth, async (req, res) => {
 const user = await User.findById(req.params.id).select('name email lastLoginAt lastLoginIp lastLoginUserAgent loginHistory');
 if (!user) return res.status(404).json({ error: 'User not found' });
 res.json(user);
});
app.get('/api/admin/receipts', anyAdminAuth, async (req, res) => {
 const receipts = await Receipt.find({ status: 'pending' }).populate('userId', 'name email').sort({ createdAt: -1 });
 res.json(receipts);
});
app.get('/api/admin/receipts/all', anyAdminAuth, async (req, res) => {
 const receipts = await Receipt.find().populate('userId', 'name email').sort({ createdAt: -1 }).limit(200);
 res.json(receipts);
});
app.post('/api/admin/receipts/:id/action', anyAdminAuth, async (req, res) => {
 try {
 const { action, note } = req.body;
 const receipt = await Receipt.findById(req.params.id);
 if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
 if (receipt.status !== 'pending') return res.status(400).json({ error: 'Receipt already processed' });
 receipt.status = action;
 receipt.adminNote = note || '';
 receipt.seenByUser = false;
 await receipt.save();
 if (action === 'approved') {
 const user = await User.findById(receipt.userId);
 if (user) {
 user.balance = (user.balance || 0) + receipt.claimedAmount;
 await user.save();
 await Transaction.create({ userId: user._id, type: 'deposit', amount: receipt.claimedAmount, description: `Manual deposit approved by admin via ${receipt.claimedBank}`, status: 'success' });
 }
 }
 res.json({ message: `Receipt ${action} successfully` });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/system-errors', anyAdminAuth, async (req, res) => {
 const errors = await SystemError.find().sort({ createdAt: -1 }).limit(100);
 res.json(errors);
});
app.put('/api/admin/system-errors/:id/resolve', anyAdminAuth, async (req, res) => {
 await SystemError.findByIdAndUpdate(req.params.id, { resolved: true });
 res.json({ message: 'Marked resolved' });
});
app.get('/api/admin/ads', adminAuth, async (req, res) => res.json(await Ad.find().sort({ createdAt: -1 })));
app.post('/api/admin/ads', adminAuth, upload.single('image'), async (req, res) => {
 try {
 const { title, link } = req.body;
 if (!link) return res.status(400).json({ error: 'Ad link is required' });
 const imageUrl = req.file ? fileUrl(req.file) : (req.body.imageUrl || '');
 const ad = await Ad.create({ title: title || '', link, imageUrl });
 res.json(ad);
 } catch (e) { res.status(500).json({ error: 'Failed to create ad: ' + e.message }); }
});
app.put('/api/admin/ads/:id', adminAuth, upload.single('image'), async (req, res) => {
 try {
 const { title, link, active } = req.body;
 const update = { title, link };
 if (active !== undefined) update.active = active === 'true';
 if (req.file) update.imageUrl = fileUrl(req.file);
 const ad = await Ad.findByIdAndUpdate(req.params.id, update, { new: true });
 if (!ad) return res.status(404).json({ error: 'Ad not found' });
 res.json(ad);
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/ads/:id', adminAuth, async (req, res) => { await Ad.findByIdAndDelete(req.params.id); res.json({ message: 'Ad removed' }); });
app.get('/api/deposit-tutorials', optionalAuth, async (req, res) => {
 try {
 const docs = await DepositTutorial.find({});
 const byMethod = {};
 docs.forEach(d => { byMethod[d.method] = { videoUrl: d.videoUrl, imageUrls: d.imageUrls, caption: d.caption }; });
 res.json(byMethod);
 } catch (e) { res.status(500).json({ error: 'Failed to load tutorials' }); }
});
app.get('/api/config/cloudinary', (req, res) => {
 res.json({
 cloudName: cloudinaryConfigured ? process.env.CLOUDINARY_CLOUD_NAME : null,
 uploadPreset: process.env.CLOUDINARY_UNSIGNED_PRESET || null,
 configured: cloudinaryConfigured && !!process.env.CLOUDINARY_UNSIGNED_PRESET
 });
});
app.post('/api/admin/deposit-tutorials/:method', adminAuth, depositTutorialUpload, async (req, res) => {
 try {
 const { method } = req.params;
 if (!['paymentlink'].includes(method)) return res.status(400).json({ error: 'Invalid method' });
 const update = { method, updatedAt: new Date() };
 if (req.body.caption !== undefined) update.caption = req.body.caption;
 if (req.body.videoUrl) update.videoUrl = req.body.videoUrl;
 else if (req.files?.video?.[0]) update.videoUrl = fileUrl(req.files.video[0]);
 if (req.files?.images?.length) update.imageUrls = req.files.images.map(fileUrl);
 const doc = await DepositTutorial.findOneAndUpdate({ method }, update, { upsert: true, new: true });
 res.json(doc);
 } catch (e) { res.status(500).json({ error: 'Failed to save tutorial: ' + e.message }); }
});
app.delete('/api/admin/deposit-tutorials/:method', adminAuth, async (req, res) => {
 try {
 const { method } = req.params;
 await DepositTutorial.findOneAndUpdate({ method }, { videoUrl: '', imageUrls: [], caption: '' }, { upsert: true });
 res.json({ message: 'Tutorial cleared' });
 } catch (e) { res.status(500).json({ error: 'Failed to clear tutorial' }); }
});
// Cancels an order on whichever provider it came from (Server 1 = NovaSolution, Server 2 = Grizzly).
async function releaseNumberOnProvider(listing) {
 if (listing.grizzlyActivationId) {
 // status 8 = cancel the activation on Grizzly so the same order is cancelled there too
 // (and our provider-side money comes back). ACCESS_CANCEL = confirmed by Grizzly.
 try {
 const raw = String(await grizzlyRequest('setStatus', { id: listing.grizzlyActivationId, status: 8 }) || '').trim();
 const ok = /ACCESS_CANCEL|ACCESS_ACTIVATION/i.test(raw);
 listing.providerCancelled = ok;
 listing.providerCancelDetail = raw.slice(0, 200);
 if (!ok) console.error('grizzly cancel returned unexpected response:', raw);
 return { ok, detail: raw };
 } catch (e) {
 console.error('grizzly cancel failed (our refund still proceeds):', e.message);
 listing.providerCancelled = false;
 listing.providerCancelDetail = String(e.message || e).slice(0, 200);
 return { ok: false, detail: listing.providerCancelDetail };
 }
 }
 if (listing.novaSessionId) {
 try {
   const result = await novaRequest('POST', `/numbers/sessions/${encodeURIComponent(listing.novaSessionId)}/cancel`);
   listing.providerCancelled = true; listing.providerCancelDetail = 'provider cancellation requested';
   return { ok: true, detail: result };
 } catch (e) {
   listing.providerCancelled = false; listing.providerCancelDetail = String(e.message || e).slice(0, 200);
   return { ok: false, detail: listing.providerCancelDetail };
 }
 }
 return { ok: false, detail: 'no provider order id' };
}
// Reads the SMS code for an order from whichever provider it came from. Returns the code or ''.
async function fetchCodeFromProvider(listing) {
 if (listing.grizzlyActivationId) {
 const raw = await grizzlyRequest('getStatus', { id: listing.grizzlyActivationId });
 const text = String(raw || '').trim();
 if (text.startsWith('STATUS_OK:')) return text.slice('STATUS_OK:'.length).trim();
 return '';
 }
 if (listing.novaSessionId) {
   const result = novaUnwrap(await novaRequest('POST', `/numbers/sessions/${encodeURIComponent(listing.novaSessionId)}/poll`));
   const session = result.session || result;
   const sms = session.sms || session.code || result.sms || result.code || '';
   if (typeof sms === 'string') return sms;
   if (sms && typeof sms === 'object') return String(sms.code || sms.otp || sms.text || '');
   return '';
 }
 return '';
}
async function expireStaleNumberOrder(listing) {
 if (listing.status === 'sold' && listing.expiresAt && listing.expiresAt.getTime() < Date.now() && !listing.code) {
   await releaseNumberOnProvider(listing);
   const expired = await NumberListing.findOneAndUpdate(
     { _id: listing._id, status: 'sold', code: '' },
     { $set: { status: 'expired', expiredAt: new Date(), providerCancelled: !!listing.providerCancelled, providerCancelDetail: listing.providerCancelDetail || '' } },
     { new: true }
   );
   if (expired) {
     const user = await User.findById(expired.soldTo);
     if (user) {
       await User.updateOne({ _id: user._id }, { $inc: { balance: expired.sellPrice } });
       await Transaction.create({ userId: user._id, type: 'admin_credit', amount: expired.sellPrice, description: `Refund: ${expired.provider} number (${expired.country}) — no code received in time`, status: 'success' });
     }
     return expired;
   }
   return await NumberListing.findById(listing._id) || listing;
 }
 return listing;
}

// Retries provider-side cancellation for Server 1 orders we already refunded (cancelled/expired) when Nova's
// cancel call failed, so we are not left paying for a number the customer no longer holds.
let _novaCancelRetryRunning = false;
async function retryFailedNovaCancellations() {
  if (_novaCancelRetryRunning || !process.env.NOVA_API_KEY || mongoose.connection.readyState !== 1) return;
  _novaCancelRetryRunning = true;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await NumberListing.find({
      server: 'server1', novaSessionId: { $ne: '' }, status: { $in: ['cancelled', 'expired'] },
      providerCancelled: false, providerCancelAttempts: { $lt: 5 },
      $or: [{ cancelledAt: { $gte: since } }, { expiredAt: { $gte: since } }]
    }).limit(25);
    for (const l of rows) {
      try {
        await novaRequest('POST', `/numbers/sessions/${encodeURIComponent(l.novaSessionId)}/cancel`);
        await NumberListing.updateOne({ _id: l._id }, { $set: { providerCancelled: true, providerCancelDetail: 'provider cancellation confirmed on retry' }, $inc: { providerCancelAttempts: 1 } });
      } catch (e) {
        await NumberListing.updateOne({ _id: l._id }, { $set: { providerCancelDetail: String(e.message || e).slice(0, 200) }, $inc: { providerCancelAttempts: 1 } });
      }
    }
  } catch (e) { console.error('[nova-cancel-retry] error:', e.message); }
  finally { _novaCancelRetryRunning = false; }
}
// Orders whose Nova outcome was unclear (timeout/5xx on both attempts). The wallet stays debited until an admin decides.
app.get('/api/admin/numbers/needs-review', anyAdminAuth, async (req, res) => {
  try {
    const rows = await NumberListing.find({ status: 'needs_review' }).sort({ soldAt: -1 }).limit(200).populate('soldTo', 'email username');
    res.json(rows.map(l => ({ id: l._id, user: l.soldTo, provider: l.provider, country: l.country, amount: l.sellPrice, novaServiceId: l.novaServiceId, novaServerId: l.novaServerId, idempotencyKey: l.novaIdempotencyKey, error: l.providerError, at: l.soldAt })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// action 'refund'  : Nova did NOT create the order -> credit the wallet (atomic, once).
// action 'confirm' : Nova DID create it -> attach the number/session so the customer can poll for the SMS.
app.post('/api/admin/numbers/:id/resolve', adminAuth, async (req, res) => {
  try {
    const action = String(req.body.action || '');
    if (action === 'refund') {
      const l = await NumberListing.findOneAndUpdate({ _id: req.params.id, status: 'needs_review' }, { $set: { status: 'cancelled', cancelledAt: new Date(), providerCancelDetail: 'Manual review: no provider order found, refunded' } }, { new: true });
      if (!l) return res.status(409).json({ error: 'Order is not awaiting review (already resolved?)' });
      await User.updateOne({ _id: l.soldTo }, { $inc: { balance: l.sellPrice } });
      await Transaction.create({ userId: l.soldTo, type: 'admin_credit', amount: l.sellPrice, description: `Refund: ${l.provider} number order could not be confirmed with the provider`, status: 'success' });
      return res.json({ status: 'cancelled', refunded: l.sellPrice });
    }
    if (action === 'confirm') {
      const phoneNumber = String(req.body.phoneNumber || '').trim();
      const sessionId = String(req.body.sessionId || '').trim();
      if (!phoneNumber || !sessionId) return res.status(400).json({ error: 'phoneNumber and sessionId (from the provider dashboard) are required' });
      const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : new Date(Date.now() + NUMBER_RENTAL_WINDOW_MS);
      if (isNaN(expiresAt)) return res.status(400).json({ error: 'expiresAt is not a valid date' });
      const l = await NumberListing.findOneAndUpdate({ _id: req.params.id, status: 'needs_review' }, { $set: { status: 'sold', phoneNumber, novaSessionId: sessionId, novaOrderNumber: phoneNumber, expiresAt, providerError: '' } }, { new: true });
      if (!l) return res.status(409).json({ error: 'Order is not awaiting review (already resolved?)' });
      try { await Transaction.create({ userId: l.soldTo, type: 'purchase', amount: l.sellPrice, description: `Rented ${l.provider} number (${l.country}) via the provider`, status: 'success' }); } catch (_) {}
      return res.json({ status: 'sold', orderId: l._id, phoneNumber });
    }
    res.status(400).json({ error: "action must be 'refund' or 'confirm'" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NovaSolution number-provider integration ────────────────────────────────
// Configure NOVA_API_KEY in Render Environment. Never expose this key to browsers.
const NOVA_BASE_URL = String(process.env.NOVA_BASE_URL || 'https://www.novasolution.ng/api/v1').replace(/\/+$/, '');
const novaAxios = axios.create({
  baseURL: NOVA_BASE_URL,
  timeout: 25000,
  headers: {
    Accept: 'application/json',
    ...(process.env.NOVA_API_KEY ? { Authorization: `Bearer ${process.env.NOVA_API_KEY}` } : {})
  }
});
// The provider allows 60 requests/minute per key. Every call (numbers, Boost 2, purchases) goes
// through this gate so we never exceed ~50/minute no matter how many things run together.
var _novaGateNext = 0;
async function novaGate() {
  const now = Date.now();
  const at = Math.max(now, _novaGateNext);
  _novaGateNext = at + 1200;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}
async function novaRequest(method, path, options = {}) {
  if (!process.env.NOVA_API_KEY) {
    const e = new Error('This service is not available right now. Please contact the administrator.');
    e.status = 503;
    throw e;
  }
  try {
    await novaGate();
    const response = await novaAxios.request({ method, url: path, ...options });
    return response.data;
  } catch (err) {
    const status = err.response?.status || err.status || 502;
    const message = err.response?.data?.message || err.response?.data?.error ||
      (status === 502 ? 'The service could not be reached. Please try again.' : 'Request failed. Please try again.');
    const e = new Error(message);
    e.status = status;
    e.retryAfter = Number(err.response?.headers?.['retry-after']) || 0;
    e.provider = true;
    // No HTTP response (timeout / dropped connection), a 5xx, or 408 => we cannot know whether Nova acted on the request.
    e.ambiguous = !err.response || status >= 500 || status === 408;
    e.details = err.response?.data?.errors;
    throw e;
  }
}
function novaErrorResponse(res, err) {
  const status = Number(err.status) || 502;
  return res.status(status >= 400 && status <= 599 ? status : 502)
    .json({ error: err.message || 'Request failed', details: err.details || undefined });
}

function novaUnwrap(payload) {
  if (payload && payload.data && typeof payload.data === 'object') return payload.data;
  return payload || {};
}
function novaServiceRows(payload) {
  const d = novaUnwrap(payload);
  return Array.isArray(d.services) ? d.services : (Array.isArray(payload?.services) ? payload.services : []);
}
function novaCountryRows(payload) {
  const d = novaUnwrap(payload);
  return Array.isArray(d.countries) ? d.countries : (Array.isArray(payload?.countries) ? payload.countries : []);
}
function novaServerRows(payload) {
  const d = novaUnwrap(payload);
  return Array.isArray(d.servers) ? d.servers : (Array.isArray(payload?.servers) ? payload.servers : []);
}
function novaCountryParam(c) {
  // The provider accepts an ISO code or a name. ISO is the most reliable.
  const iso = String(c.iso || c.iso2 || c.country_code || '').trim();
  if (iso) return iso.toUpperCase();
  return String(c.slug || c.country_slug || c.api_value || c.name || c.country_name || c.label || c.code || '').trim().toLowerCase().replace(/\s+/g, '-');
}
async function novaResolveCountry(rawCountry) {
  const raw = String(rawCountry || '').trim();
  if (/^(us|usa|united states)$/i.test(raw)) return { scope: 'usa', country: undefined };
  const payload = await novaGetCatalog({ scope: 'global' });
  const rows = novaCountryRows(payload);
  const match = rows.find(c => [c.iso, c.code, c.country_code, c.iso2, c.id, c.slug, c.name, c.country_name, c.label]
    .some(v => String(v || '').trim().toLowerCase() === raw.toLowerCase()));
  const apiCountry = match ? novaCountryParam(match) : raw.toLowerCase().replace(/\s+/g, '-');
  return { scope: 'global', country: apiCountry };
}

// ── Real service names + logos ───────────────────────────────────────────────
// Providers sometimes send short codes ("wa", "tg", "vn") instead of names. Turn those into the
// real brand name so customers see WhatsApp / Telegram / TikTok, never a bare code.
const NOVA_CODE_NAMES = {
  wa: 'WhatsApp', wb: 'WhatsApp', bye: 'WhatsApp Business', tg: 'Telegram', vi: 'Viber', sg: 'Signal',
  go: 'Google', gp: 'Google', gm: 'Gmail', yl: 'YouTube', ig: 'Instagram', ig4: 'Instagram', fb: 'Facebook',
  tw: 'Twitter / X', x: 'Twitter / X', tk: 'TikTok', tt: 'TikTok', lf: 'TikTok', ds: 'Discord',
  sn: 'Snapchat', li: 'LinkedIn', nf: 'Netflix', am: 'Amazon', pp: 'PayPal', ub: 'Uber', we: 'WeChat',
  wx: 'WeChat', vk: 'VK', ok: 'Odnoklassniki', ya: 'Yandex', qq: 'Tencent QQ', st: 'Spotify',
  tn: 'Tinder', ab: 'Airbnb', ew: 'eBay', re: 'Reddit', ts: 'Twitch', pm: 'Pinterest',
  ot: 'Other (any service)'
};
const NOVA_BRAND_NAMES = [
  [/whats\s*app/i, 'WhatsApp'], [/telegram/i, 'Telegram'], [/tik\s*tok|douyin/i, 'TikTok'], [/facebook/i, 'Facebook'],
  [/instagram/i, 'Instagram'], [/twitter|^x$/i, 'Twitter / X'], [/gmail/i, 'Gmail'], [/youtube/i, 'YouTube'],
  [/google/i, 'Google'], [/discord/i, 'Discord'], [/snap\s*chat/i, 'Snapchat'], [/linked\s*in/i, 'LinkedIn'],
  [/viber/i, 'Viber'], [/we\s*chat|weixin/i, 'WeChat'], [/signal/i, 'Signal'], [/microsoft|outlook|hotmail/i, 'Microsoft'],
  [/apple|icloud/i, 'Apple'], [/amazon/i, 'Amazon'], [/paypal/i, 'PayPal'], [/uber/i, 'Uber'], [/netflix/i, 'Netflix'],
  [/spotify/i, 'Spotify'], [/tinder/i, 'Tinder'], [/openai|chat\s*gpt/i, 'OpenAI / ChatGPT']
];
function novaServiceDisplayName(s) {
  const cands = [s?.name, s?.service, s?.application, s?.service_name, s?.display_name, s?.title, s?.label]
    .map(v => String(v == null ? '' : v).trim()).filter(Boolean);
  const code = String(s?.code || s?.slug || s?.short_name || '').trim().toLowerCase();
  const codeLike = v => /^[a-z0-9]{1,3}$/i.test(v) || (v === v.toLowerCase() && /^[a-z]{1,4}\d?$/.test(v));
  // A real descriptive name (e.g. "WhatsApp Business", "Amazon Prime") is kept as sent, just tidied.
  const real = cands.find(v => !codeLike(v));
  if (real) {
    const brand = NOVA_BRAND_NAMES.find(([re]) => re.test(real));
    if (brand && real.length <= brand[1].length + 2) return brand[1];
    return real.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).trim();
  }
  for (const v of [code, ...cands.map(c => c.toLowerCase())]) if (v && NOVA_CODE_NAMES[v]) return NOVA_CODE_NAMES[v];
  return cands[0] || (code ? code.toUpperCase() : `Service ${s?.id ?? ''}`.trim());
}

// Services for one country across EVERY server that can sell it. USA numbers can live on the
// dedicated USA servers (scope 'usa') and also on the all-countries servers, so for the United States
// both catalogues are merged — that is why picking "United States" on a global server used to say
// "not available". Any one catalogue failing never hides the others.
function novaIsUsa(raw) { return /^(us|usa|united states|united states of america)$/i.test(String(raw || '').trim()); }
async function novaCatalogForCountry(rawCountry, opts = {}) {
  const raw = String(rawCountry || '').trim();
  const jobs = [];
  if (novaIsUsa(raw)) {
    jobs.push(novaGetCatalog({ scope: 'usa' }, opts));
    jobs.push((async () => {
      const g = await novaGetCatalog({ scope: 'global' });
      const row = novaCountryRows(g).find(c => novaIsUsa(c.iso || c.iso2 || c.code || c.country_code) || novaIsUsa(c.name || c.country_name || c.label));
      return novaGetCatalog({ scope: 'global', country: row ? novaCountryParam(row) : 'US' }, opts);
    })());
  } else {
    const r = await novaResolveCountry(raw);
    const params = { scope: 'global' }; if (r.country) params.country = r.country;
    jobs.push(novaGetCatalog(params, opts));
  }
  const settled = await Promise.allSettled(jobs);
  const ok = settled.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (!ok.length) throw settled[0].reason;
  const seen = new Set(), services = [], servers = [], countries = [];
  for (const cat of ok) {
    for (const sv of (cat.services || [])) {
      const k = `${sv.id ?? sv.service_id}:${sv.server_id ?? sv.serverId ?? sv.server?.id ?? ''}`;
      if (!seen.has(k)) { seen.add(k); services.push(sv); }
    }
    servers.push(...(cat.servers || [])); countries.push(...(cat.countries || []));
  }
  const newest = ok.map(c => c.syncedAt).filter(Boolean).sort().pop();
  return { services, servers, countries, syncedAt: newest, stale: ok.some(c => c.stale), partial: ok.some(c => c.partial) };
}
function novaServicePriceNgn(service, cfg, opts) {
  // Nova's price_minor is a minor-unit amount; convert to major units before markup.
  const minor = Number(service?.price_minor);
  if (!Number.isFinite(minor) || minor < 0) return null;
  const cost = minor / 100;
  const tiers = Array.isArray(cfg?.server1MarkupTiers) ? cfg.server1MarkupTiers : [];
  const sorted = tiers.slice().sort((a, b) => Number(a.upTo) - Number(b.upTo));
  const tier = sorted.find(t => cost <= Number(t.upTo));
  const fallback = sorted.length ? Number(sorted[sorted.length - 1].profit || 0) : 0;
  let markup = tier ? Number(tier.profit || 0) : Math.max(fallback, Math.round(cost * (Number(cfg?.highCostMarkupPercent) || 20) / 100));
  // Developer-API buyers keep apiProfitPercent % of the normal profit (cheaper than the site price).
  if (opts && opts.api) { const pct = Number(cfg?.apiProfitPercent); markup = Math.round(Math.max(0, markup) * (Number.isFinite(pct) ? pct : 75) / 100); }
  return Math.ceil(cost + Math.max(0, markup));
}

// Internal proxy endpoints for the number-picker flow. Catalog requests are server-side,
// so the Nova key is never sent to the customer browser.
app.get('/api/nova/numbers/catalog', auth, async (req, res) => {
  try {
    const scope = String(req.query.scope || 'usa').toLowerCase() === 'global' ? 'global' : 'usa';
    const params = { scope };
    if (req.query.country) params.country = String(req.query.country);
    const data = await novaRequest('GET', '/catalog/numbers', { params });
    res.json(data);
  } catch (err) { novaErrorResponse(res, err); }
});
app.get('/api/nova/balance', adminAuth, async (req, res) => {
  try { res.json(await novaRequest('GET', '/balance')); }
  catch (err) { novaErrorResponse(res, err); }
});
// Purchases, polling and cancellation go through the wallet-owned /api/numbers routes below.
// ── End NovaSolution integration ────────────────────────────────────────────


app.get('/api/numbers/options', async (req, res) => {
 try {
 const rows = await NumberPricing.find({ enabled: true }).sort({ country: 1, provider: 1 });
 res.json(rows.map(r => ({ id: r._id, provider: r.provider, country: r.country, price: r.price, available: true })));
 } catch (e) { res.status(500).json({ error: 'Failed to load numbers' }); }
});
app.get('/api/numbers/nova-servers', optionalAuth, async (req, res) => {
 try {
   // 'usa' scope = servers that sell USA numbers; 'global' scope = all-countries servers.
   // Keep the provider's own server names (e.g. "USA Server 1"), minus any brand word.
   const scopes = await Promise.allSettled(['usa', 'global'].map(scope => novaGetCatalog({ scope })));
   if (scopes.every(r => r.status === 'rejected')) throw scopes[0].reason;
   const clean = n => String(n || '').replace(/nova\s*solution|novasolution|nova/ig, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—:·|]+|[\s\-–—:·|]+$/g, '').trim();
   const seen = new Map();
   const add = (id, rawName, scope) => {
     id = Number(id);
     if (!Number.isInteger(id) || id <= 0) return;
     const name = clean(rawName);
     const prev = seen.get(id);
     if (!prev) seen.set(id, { id, name, scope });
     else { if (!prev.name && name) prev.name = name; if (scope === 'usa') prev.scope = 'usa'; }
   };
   ['usa', 'global'].forEach((scope, i) => {
     if (scopes[i].status !== 'fulfilled') return;
     for (const sv of novaServerRows(scopes[i].value)) add(sv.id, sv.name || sv.label || sv.title, scope);
     for (const row of novaServiceRows(scopes[i].value)) add(row.server_id ?? row.serverId, row.server_name || row.server, scope);
   });
   const servers = [...seen.values()].sort((x, y) => (x.scope === y.scope ? x.id - y.id : (x.scope === 'usa' ? -1 : 1)))
     .map(sv => {
       const isUsa = sv.scope === 'usa';
       const base = sv.name || `Server ${sv.id}`;
       const name = isUsa ? (/usa|united states/i.test(base) ? base : `USA ${base}`) : (/^all\b/i.test(base) ? base : `All Countries ${base}`);
       return { id: sv.id, name, scope: isUsa ? 'usa' : 'global' };
     });
   res.set('Cache-Control', 'no-store'); res.json(servers);
 } catch (e) { novaErrorResponse(res, e); }
});
app.get('/api/numbers/live-countries', optionalAuth, async (req, res) => {
 try {
   const usa = await novaGetCatalog({ scope: 'usa' });
   const global = await novaGetCatalog({ scope: 'global' });
   const rows = [...novaCountryRows(usa), ...novaCountryRows(global)];
   const unique = new Map();
   for (const c of rows) {
     const code = String(c.iso || c.code || c.country_code || c.iso2 || c.id || '').trim();
     const name = String(c.name || c.country_name || c.label || code).trim();
     if (code && name && !unique.has(code.toLowerCase())) unique.set(code.toLowerCase(), { code, name, flag: countryFlag(name), pinned: /^(us|usa|united states|ca|canada)$/i.test(code) || /united states|canada/i.test(name) });
   }
   res.set('Cache-Control', 'no-store'); res.json([...unique.values()].sort((a,b)=>(b.pinned-a.pinned)||a.name.localeCompare(b.name)));
 } catch (e) { novaErrorResponse(res, e); }
});
// ── Catalog cache ───────────────────────────────────────────────────────────
// The provider's catalog is stored in our database. Customers read the stored copy, so opening
// the page never hits the provider (no more rate-limit errors). It is only re-pulled when the
// admin syncs, when a customer taps Refresh (at most once per cooldown), or when nothing is
// stored yet. If a re-pull fails, the previously stored copy keeps being served.
const NovaCache = mongoose.models.NovaCache || mongoose.model('NovaCache', new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed },
  syncedAt: { type: Date, default: Date.now },
  error: { type: String, default: '' }
}, { minimize: false }));
const NOVA_REFRESH_COOLDOWN_MS = 30 * 1000;
const _novaInflight = new Map();
const _sleep = ms => new Promise(r => setTimeout(r, ms));
// v2: the old keys may hold a truncated (first-page-only) catalogue, so a new prefix forces one clean re-pull.
function novaCacheKey(params) {
  if (params.scope === 'usa') return 'numbers:v2:usa';
  return params.country ? 'numbers:v2:c:' + params.country : 'numbers:v2:global';
}
async function novaRequestRetry(method, path, options) {
  for (let attempt = 0; ; attempt++) {
    try { return await novaRequest(method, path, options); }
    catch (e) { if (e.status === 429 && attempt < 3) { await _sleep(Math.min(65, e.retryAfter || 20) * 1000); continue; } throw e; }
  }
}
// Reads every page of a number catalog (the provider may paginate).
async function novaFetchCatalogFull(params, hooks = {}) {
  const first = await novaRequestRetry('GET', '/catalog/numbers', { params });
  let services = novaServiceRows(first);
  // Let callers show page 1 immediately while the remaining pages keep loading in the background.
  const _progress = () => { if (hooks.onProgress) { try { hooks.onProgress({ servers: novaServerRows(first), countries: novaCountryRows(first), services: services.slice() }); } catch (_) {} } };
  _progress();
  const rowKey = r => `${r.id ?? r.service_id}:${r.server_id ?? r.serverId ?? r.server?.id ?? ''}`;
  const seen = new Set(services.map(rowKey));
  const hasMoreFlag = payload => {
    const d = novaUnwrap(payload) || {}, top = payload || {};
    const pg = d.pagination || top.pagination || d.meta || top.meta || {};
    const cur = Number(pg.current_page ?? pg.page), last = Number(pg.last_page ?? pg.total_pages ?? pg.pages);
    return !!(d.has_more || top.has_more || d.next_page || top.next_page || d.next_page_url || top.next_page_url ||
      pg.has_more || pg.next_page || (top.links && top.links.next) || (d.links && d.links.next) ||
      (Number.isFinite(cur) && Number.isFinite(last) && cur < last));
  };
  // Keep asking for the next page while the provider says there is one — or, if it gives no hint,
  // while a full-looking page keeps bringing NEW rows (stops the moment a page adds nothing new).
  let page = 1, last = first;
  while (page < 60) {
    const flagged = hasMoreFlag(last);
    if (!flagged && !(page === 1 && services.length >= 20) && !(page > 1 && last.__added >= 20)) break;
    page++;
    let next;
    try { next = await novaRequestRetry('GET', '/catalog/numbers', { params: { ...params, page } }); } catch (e) { break; }
    const more = novaServiceRows(next).filter(r => { const k = rowKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!more.length) break;
    services = services.concat(more);
    last = Object.assign({}, next, { __added: more.length });
    _progress();
  }
  return { servers: novaServerRows(first), countries: novaCountryRows(first), services };
}
// A stored catalog older than this is still served instantly, but is quietly re-pulled in the background.
const NOVA_BG_REFRESH_MS = 10 * 60 * 1000;
const _novaPartial = new Map(); // cache key -> { payload, wait } while a first-time pull is still paging
function novaStartCatalogJob(key, params) {
  let job = _novaInflight.get(key);
  if (job) return job;
  let wake; const wait = new Promise(r => { wake = r; });
  _novaPartial.set(key, { payload: null, wait });
  job = novaFetchCatalogFull(params, { onProgress: p => { const e = _novaPartial.get(key); if (e) { e.payload = p; wake(true); } } }).then(async payload => {
    const syncedAt = new Date();
    await NovaCache.updateOne({ key }, { $set: { payload, syncedAt, error: '' } }, { upsert: true });
    return { ...payload, syncedAt, stale: false };
  }).finally(() => { _novaInflight.delete(key); _novaPartial.delete(key); wake(false); });
  _novaInflight.set(key, job);
  return job;
}
// opts.refresh -> customer tapped Refresh (cooldown applies); opts.fresh -> force a re-pull if older than 60s;
// opts.quick   -> if nothing is stored yet, answer with whatever pages have arrived so far (partial:true)
//                 instead of making the customer wait for the whole catalogue.
async function novaGetCatalog(params, opts = {}) {
  const key = novaCacheKey(params);
  const doc = await NovaCache.findOne({ key }).lean();
  const age = doc ? Date.now() - new Date(doc.syncedAt).getTime() : Infinity;
  const need = !doc || (opts.refresh && age > NOVA_REFRESH_COOLDOWN_MS) || (opts.fresh && age > 60 * 1000);
  if (!need) {
    // Serve the stored copy right away; refresh it behind the scenes when it is getting old.
    if (doc && age > NOVA_BG_REFRESH_MS && !_novaInflight.has(key)) novaStartCatalogJob(key, params).catch(() => {});
    return { ...doc.payload, syncedAt: doc.syncedAt, stale: false };
  }
  const job = novaStartCatalogJob(key, params);
  try {
    if (!doc && opts.quick) {
      const entry = _novaPartial.get(key);
      if (entry) {
        const done = job.then(v => ({ full: v }));
        const gotPage = entry.wait.then(ok => ok ? { page: true } : new Promise(() => {}));
        const w = await Promise.race([done, gotPage]);
        if (w.full) return w.full;
        const cur = _novaPartial.get(key);
        if (cur && cur.payload) return { ...cur.payload, syncedAt: new Date(), stale: false, partial: true };
      }
    }
    return await job;
  }
  catch (e) {
    if (doc) {
      NovaCache.updateOne({ key }, { $set: { error: String(e.message || '').slice(0, 300) } }).catch(() => {});
      return { ...doc.payload, syncedAt: doc.syncedAt, stale: true, error: e.message };
    }
    throw e;
  }
}
async function novaCatalogServices(params, opts) { return (await novaGetCatalog(params, opts)).services || []; }
// Pre-load the two main catalogues shortly after boot so the first customer isn't waiting on the provider.
setTimeout(() => { novaGetCatalog({ scope: 'usa' }).catch(() => {}); novaGetCatalog({ scope: 'global' }).catch(() => {}); }, 6000);

// Admin "Sync all": pulls the server/country lists and every country's services, one at a time
// with a short pause so the provider is never hammered. Old data stays if a country fails.
const novaSync = { running: false, total: 0, done: 0, failed: 0, current: '', startedAt: null, finishedAt: null, message: '' };
async function novaSyncAll() {
  if (novaSync.running) return;
  Object.assign(novaSync, { running: true, total: 2, done: 0, failed: 0, current: 'servers', startedAt: new Date(), finishedAt: null, message: 'Starting…' });
  try {
    const usa = await novaGetCatalog({ scope: 'usa' }, { refresh: true, fresh: true }); novaSync.done++;
    const glob = await novaGetCatalog({ scope: 'global' }, { refresh: true, fresh: true }); novaSync.done++;
    const slugs = [...new Set(novaCountryRows(glob).map(novaCountryParam).filter(Boolean))];
    novaSync.total = 2 + slugs.length;
    for (const slug of slugs) {
      novaSync.current = slug;
      try {
        const r = await novaGetCatalog({ scope: 'global', country: slug }, { refresh: true, fresh: true });
        if (r.stale) novaSync.failed++;
      } catch (e) { novaSync.failed++; }
      novaSync.done++;
    }
    novaSync.message = `Synced. ${usa.services.length} USA service(s), ${slugs.length} countr${slugs.length === 1 ? 'y' : 'ies'}${novaSync.failed ? `, ${novaSync.failed} could not be refreshed (old data kept)` : ''}.`;
  } catch (e) {
    novaSync.message = 'Sync failed: ' + (e.message || 'provider unreachable') + ' — previously stored services are still shown to customers.';
  } finally { novaSync.running = false; novaSync.current = ''; novaSync.finishedAt = new Date(); }
}
app.post('/api/admin/numbers/sync', anyAdminAuth, (req, res) => { if (!novaSync.running) novaSyncAll().catch(() => {}); res.status(202).json({ ...novaSync }); });
app.get('/api/admin/numbers/sync-status', anyAdminAuth, async (req, res) => {
  const stored = await NovaCache.countDocuments({ key: /^numbers:/ }).catch(() => 0);
  const last = await NovaCache.findOne({ key: /^numbers:/ }).sort({ syncedAt: -1 }).select('syncedAt').lean().catch(() => null);
  res.json({ ...novaSync, stored, lastSyncedAt: last?.syncedAt || null });
});
app.get('/api/numbers/live-services', optionalAuth, async (req, res) => {
 try {
   const country = String(req.query.country || '').trim();
   if (!country) return res.status(400).json({ error: 'country is required' });
   const serverId = Number(req.query.serverId || req.query.server_id || 0);
   const cat = await novaCatalogForCountry(country, { refresh: String(req.query.refresh || '') === '1', quick: true });
   const services = cat.services || [];
   const cfg = await getNumberServerConfig();
   const sidOf = s => Number(s.server_id ?? s.serverId ?? s.server?.id);
   // Only filter by server when the rows actually say which server they belong to.
   const hasServerInfo = services.some(s => Number.isInteger(sidOf(s)) && sidOf(s) > 0);
   const picked = (serverId && hasServerInfo) ? services.filter(s => sidOf(s) === serverId) : services;
   const minorOf = s => { const m = Number(s.price_minor); if (Number.isFinite(m)) return m; const x = Number(s.price ?? s.cost); return Number.isFinite(x) ? Math.round(x * 100) : NaN; };
   const out = picked.map(s => {
     const minor = minorOf(s);
     const name = novaServiceDisplayName(s);
     return {
       serviceId: String(s.id ?? s.service_id), provider: name,
       serverId: sidOf(s), serverName: String(s.server_name || s.server?.name || ''),
       price: novaServicePriceNgn({ ...s, price_minor: minor }, cfg), costNgn: Number.isFinite(minor) ? minor / 100 : 0, priceMinor: Number.isFinite(minor) ? minor : 0,
       emoji: serviceEmoji(s.code || s.slug || name, name), icon: serviceIconUrl(s.code || s.slug || name, name), rawName: s.name || s.service || '',
       syncedAt: cat.syncedAt, stale: !!cat.stale, partial: !!cat.partial
     };
   }).filter(x => x.price != null && x.price > 0)
     // Popular apps first (WhatsApp, Telegram, …), then A→Z, so nothing is hard to find.
     .sort((a, b) => {
       const pa = POPULAR_NAME_ORDER(a.provider), pb = POPULAR_NAME_ORDER(b.provider);
       return (pa - pb) || a.provider.localeCompare(b.provider) || a.price - b.price;
     });
   res.set('Cache-Control', 'no-store');
   res.json(out);
 } catch (e) { novaErrorResponse(res, e); }
});
// Popular-service suggestions for Server 1 (logo + name), available BEFORE any country is chosen.
// Built from a fixed brand list — no provider call — so it appears instantly, like Server 2's chips.
const S1_POPULAR_SERVICES = ['WhatsApp', 'Telegram', 'Google', 'Instagram', 'Facebook', 'TikTok', 'Twitter / X', 'Snapchat', 'Discord', 'LinkedIn', 'Viber', 'Microsoft', 'Amazon', 'Netflix', 'PayPal', 'Uber'];
app.get('/api/numbers/nova-popular-services', (req, res) => {
  const list = S1_POPULAR_SERVICES.map(name => ({ name, icon: serviceIconUrl('', name), emoji: serviceEmoji('', name), popular: true }));
  res.set('Cache-Control', 'public, max-age=3600'); res.json(list);
});
// Warm the stored catalogue for the busiest countries a little after boot, one at a time, so the very first
// customer to pick them gets an instant list instead of triggering a slow first-time pull.
setTimeout(async () => {
  for (const c of ['Nigeria', 'United Kingdom', 'India', 'Ghana', 'South Africa', 'Kenya', 'Indonesia', 'Philippines']) {
    try { await novaCatalogForCountry(c); } catch (_) {}
    await _sleep(4000);
  }
}, 45000);
function POPULAR_NAME_ORDER(name) {
  const order = ['whatsapp', 'telegram', 'tiktok', 'facebook', 'instagram', 'google', 'twitter', 'snapchat', 'discord', 'linkedin', 'viber', 'microsoft', 'amazon', 'netflix', 'paypal', 'uber'];
  const n = String(name || '').toLowerCase();
  const i = order.findIndex(k => n.includes(k));
  return i === -1 ? 999 : i;
}
function novaHttpError(status, message, extra) {
  const e = new Error(message); e.status = status; Object.assign(e, extra || {}); return e;
}
// Places the provider order with a stable Idempotency-Key. It either returns the response or throws:
//  - a plain Nova error  -> Nova clearly rejected the order (4xx), so refunding is safe;
//  - an error with ambiguousOutcome=true -> timeout / network drop / 5xx on both attempts. Nova MAY have
//    created the order, so the caller must NOT refund automatically.
async function novaPlaceOrder(serviceId, idempotencyKey) {
  const call = () => novaRequest('POST', '/orders', { headers: { 'Idempotency-Key': idempotencyKey }, data: { type: 'numbers', service_id: serviceId } });
  try { return await call(); }
  catch (first) {
    if (!first.ambiguous) throw first;
    console.error('[NOVA] order outcome unclear, retrying once with the same Idempotency-Key:', first.message);
    await new Promise(r => setTimeout(r, 1500));
    try { return await call(); }
    catch (second) {
      // A 409 on the replay usually means "this key already created an order", so it is also unclear.
      if (!second.ambiguous && second.status !== 409) throw second;
      second.ambiguousOutcome = true;
      throw second;
    }
  }
}
// Shared Server 1 (NovaSolution) purchase used by the customer route and the developer API.
// pricing: 'customer' (normal markup) or 'api' (apiProfitPercent % of the markup).
async function novaPurchaseNumber({ userId, serviceId, serverId, countryCode, expectedPrice, pricing }) {
  const cfg = await getNumberServerConfig();
  if (!cfg.server1Enabled) throw novaHttpError(400, 'Number purchases are temporarily disabled.');
  if (!Number.isInteger(serviceId) || serviceId <= 0 || !countryCode || !Number.isInteger(serverId) || serverId <= 0) {
    throw novaHttpError(400, 'Select a server, country and service before purchasing.');
  }
  // Use the stored catalogue (the same one the customer just saw) so checkout is instant. The provider itself
  // is the final authority: it rejects an unavailable service, and the cost-vs-price guard below refunds if
  // the real cost jumped. Only if the service is missing from the stored copy do we pay for a live re-pull.
  let catalogPayload = await novaCatalogForCountry(countryCode);
  let services = catalogPayload.services || [];
  const _sid0 = x => Number(x.server_id ?? x.serverId ?? x.server?.id);
  if (!services.some(x => Number(x.id ?? x.service_id) === serviceId && (!services.some(y => _sid0(y) > 0) || _sid0(x) === serverId))) {
    catalogPayload = await novaCatalogForCountry(countryCode, { fresh: true });
    services = catalogPayload.services || [];
  }
  const sidOf = x => Number(x.server_id ?? x.serverId ?? x.server?.id);
  const hasServerInfo = services.some(x => Number.isInteger(sidOf(x)) && sidOf(x) > 0);
  let service = services.find(x => Number(x.id ?? x.service_id) === serviceId && (!hasServerInfo || sidOf(x) === serverId));
  if (service && !Number.isFinite(Number(service.price_minor)) && Number.isFinite(Number(service.price ?? service.cost))) service = { ...service, price_minor: Math.round(Number(service.price ?? service.cost) * 100) };
  if (!service) throw novaHttpError(400, 'That service is no longer available on this server. Refresh and choose again.', { code: 'SERVICE_UNAVAILABLE' });
  const sellPrice = novaServicePriceNgn(service, cfg, { api: pricing === 'api' });
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) throw novaHttpError(400, 'No valid price is available for this service right now.');
  // Price lock: the caller sends the price the customer confirmed; never charge a different amount silently.
  const expected = Number(expectedPrice);
  const hasExpected = expectedPrice !== undefined && expectedPrice !== null && expectedPrice !== '' && Number.isFinite(expected);
  if (hasExpected && expected !== sellPrice) {
    throw novaHttpError(409, `The price changed from ₦${expected.toLocaleString('en-NG')} to ₦${sellPrice.toLocaleString('en-NG')}. You have not been charged — please review and confirm again.`, { code: 'PRICE_CHANGED', newPrice: sellPrice });
  }
  // Atomic wallet debit prevents simultaneous requests from spending the same balance.
  const debitedUser = await User.findOneAndUpdate({ _id: userId, balance: { $gte: sellPrice } }, { $inc: { balance: -sellPrice } }, { new: true });
  if (!debitedUser) throw novaHttpError(400, 'Insufficient balance. Please deposit funds.');
  const idempotencyKey = require('crypto').randomUUID();
  let providerResult;
  try {
    providerResult = await novaPlaceOrder(serviceId, idempotencyKey);
  } catch (providerErr) {
    if (providerErr.ambiguousOutcome) {
      // Nova may have created the order. Keep the money on hold and flag it for a manual check
      // instead of refunding (which could leave you paying Nova for a number the customer got refunded for).
      let held = null;
      try {
        held = await NumberListing.create({
          provider: novaServiceDisplayName(service),
          country: String(countryCode), phoneNumber: 'pending-review',
          cost: Number(service.price_minor || 0) / 100, sellPrice, status: 'needs_review', soldTo: userId, soldAt: new Date(),
          server: 'server1', novaServiceId: serviceId, novaServerId: serverId, novaIdempotencyKey: idempotencyKey,
          providerError: String(providerErr.message || '').slice(0, 300), providerErrorAt: new Date()
        });
      } catch (recErr) {
        console.error('[NOVA-REVIEW] could not record held order:', recErr.message);
      }
      console.error(`[NOVA-REVIEW] UNCONFIRMED ORDER user=${userId} amount=${sellPrice} service=${serviceId} server=${serverId} idempotencyKey=${idempotencyKey} listing=${held?._id || 'NOT SAVED'}`);
      throw novaHttpError(502, 'We could not confirm this order with the provider. Your payment is on hold while we check — if no number was issued you will be refunded in full. Please do not retry yet.', { code: 'ORDER_UNCONFIRMED', orderId: held?._id });
    }
    await User.updateOne({ _id: userId }, { $inc: { balance: sellPrice } });
    await Transaction.create({ userId, type: 'admin_credit', amount: sellPrice, description: 'Refund: the provider rejected the number order', status: 'success' });
    throw providerErr;
  }
  const pd = novaUnwrap(providerResult);
  const order = pd.order || providerResult.order || {};
  const session = pd.session || providerResult.session || {};
  const phoneNumber = String(session.number || order.number || pd.number || '').trim();
  const sessionId = String(session.id ?? pd.session_id ?? order.session_id ?? '').trim();
  const actualMinor = Number(session.price_minor ?? order.price_minor ?? pd.price_minor);
  const actualCostNgn = Number.isFinite(actualMinor) && actualMinor >= 0 ? actualMinor / 100 : null;
  if (actualCostNgn !== null && actualCostNgn >= sellPrice) {
    try { if (sessionId) await novaRequest('POST', `/numbers/sessions/${encodeURIComponent(sessionId)}/cancel`); } catch (_) {}
    await User.updateOne({ _id: userId }, { $inc: { balance: sellPrice } });
    await Transaction.create({ userId, type: 'admin_credit', amount: sellPrice, description: 'Refund: the provider price exceeded the configured customer price', status: 'success' });
    throw novaHttpError(409, 'Pricing changed during checkout. Your wallet was refunded; refresh the catalog and try again.', { code: 'PRICE_CHANGED' });
  }
  if (!phoneNumber || !sessionId) {
    try { if (sessionId) await novaRequest('POST', `/numbers/sessions/${encodeURIComponent(sessionId)}/cancel`); } catch (_) {}
    await User.updateOne({ _id: userId }, { $inc: { balance: sellPrice } });
    await Transaction.create({ userId, type: 'admin_credit', amount: sellPrice, description: 'Refund: the provider returned an incomplete number order', status: 'success' });
    throw novaHttpError(502, 'The order came back incomplete. Your wallet has been refunded; please try again.');
  }
  let listing;
  let serverName = `Server ${serverId}`;
  try {
    const servers = novaServerRows(catalogPayload);
    const countries = novaCountryRows(catalogPayload);
    const serverRow = servers.find(x => Number(x.id) === serverId) || {};
    serverName = String(serverRow.name || serverName);
    const countryRow = countries.find(x => String(x.code || x.country_code || x.iso2 || '').toLowerCase() === String(countryCode).toLowerCase()) || {};
    listing = await NumberListing.create({
      provider: novaServiceDisplayName(service),
      country: String(session.country || countryRow.name || countryRow.country_name || countryCode),
      phoneNumber, cost: actualCostNgn !== null ? actualCostNgn : Number(service.price_minor || 0) / 100, sellPrice, status: 'sold', soldTo: userId, soldAt: new Date(),
      expiresAt: session.expires_at ? new Date(session.expires_at) : new Date(Date.now() + NUMBER_RENTAL_WINDOW_MS),
      server: 'server1', novaSessionId: sessionId, novaOrderNumber: String(order.number || phoneNumber),
      novaServiceId: serviceId, novaServerId: serverId, novaIdempotencyKey: idempotencyKey
    });
  } catch (saveErr) {
    try { await novaRequest('POST', `/numbers/sessions/${encodeURIComponent(sessionId)}/cancel`); } catch (_) {}
    await User.updateOne({ _id: userId }, { $inc: { balance: sellPrice } });
    await Transaction.create({ userId, type: 'admin_credit', amount: sellPrice, description: 'Refund: the provider order could not be saved locally', status: 'success' });
    throw saveErr;
  }
  // The provider order and local listing now exist. Do not refund a valid number just
  // because the transaction-log or referral subsystem has a temporary database error.
  try { await Transaction.create({ userId, type: 'purchase', amount: sellPrice, description: `Rented ${listing.provider} number (${listing.country}) via ${serverName}${pricing === 'api' ? ' (API)' : ''}`, status: 'success' }); }
  catch (txErr) { console.error('the provider purchase transaction log failed:', txErr.message); }
  creditReferralCommission(debitedUser, sellPrice, `${listing.provider} number (${listing.country})`).catch(err => console.error('the provider referral credit failed:', err.message));
  return { listing, sellPrice, sessionId, serverName };
}
function novaPurchaseErrorResponse(res, e) {
  console.error('the provider number purchase failed:', e.message);
  let st = Number(e.status);
  if (!(st >= 400 && st <= 599)) st = 500;
  // A provider-side 401/403 means OUR Nova key is wrong; never send that to the customer as 401
  // (the browser would treat it as "you are logged out").
  if (e.provider && (st === 401 || st === 403)) st = 502;
  const body = { error: e.message || 'Failed to buy number from the provider.' };
  if (typeof e.code === 'string') body.code = e.code;
  if (e.newPrice) body.newPrice = e.newPrice;
  if (e.orderId) body.orderId = e.orderId;
  res.status(st).json(body);
}
app.post('/api/numbers/buy', auth, async (req, res) => {
 try {
   const r = await novaPurchaseNumber({
     userId: req.user._id,
     serviceId: Number(req.body.serviceId || req.body.service_id),
     serverId: Number(req.body.serverId || req.body.server_id),
     countryCode: String(req.body.country || '').trim(),
     expectedPrice: req.body.expectedPrice,
     pricing: 'customer'
   });
   const l = r.listing;
   res.json({ orderId: l._id, phoneNumber: l.phoneNumber, expiresAt: l.expiresAt, provider: l.provider, country: l.country, server: `Server ${l.novaServerId}`, amountPaid: r.sellPrice, sessionId: r.sessionId });
 } catch (e) { novaPurchaseErrorResponse(res, e); }
});
app.get('/api/numbers/status/:orderId', auth, async (req, res) => {
 try {
 let listing = await NumberListing.findOne({ _id: req.params.orderId, soldTo: req.user._id });
 if (!listing) return res.status(404).json({ error: 'Order not found' });
 if (listing.status === 'sold' && !listing.code) {
 try {
 const code = await fetchCodeFromProvider(listing);
 if (code) {
 listing.code = code;
 listing.codeAddedAt = new Date();
 listing.providerError = '';
 listing.providerErrorAt = null;
 await listing.save();
 // Tell Grizzly the activation is finished so it closes cleanly on their side.
 if (listing.grizzlyActivationId) {
 grizzlyRequest('setStatus', { id: listing.grizzlyActivationId, status: 6 }).catch(() => {});
 }
 if (listing.novaSessionId) novaRequest('POST', `/numbers/sessions/${encodeURIComponent(listing.novaSessionId)}/done`).catch(() => {});
 } else if (listing.providerError) {
 listing.providerError = '';
 listing.providerErrorAt = null;
 await listing.save();
 }
 } catch (e) {
 console.error('code poll failed (will retry next poll):', e.message);
 listing.providerError = String(e.message || e).slice(0, 300);
 listing.providerErrorAt = new Date();
 try { await listing.save(); } catch (_) {}
 }
 }

 listing = await expireStaleNumberOrder(listing);
 res.json({
 id: listing._id, provider: listing.provider, country: listing.country, phoneNumber: listing.phoneNumber,
 status: listing.code ? 'delivered' : listing.status === 'sold' ? 'pending' : listing.status,
 code: listing.code, expiresAt: listing.expiresAt, createdAt: listing.soldAt || listing.createdAt,
 server: listing.server || 'server1', sellPrice: listing.sellPrice,
 providerError: listing.providerError || '', providerErrorAt: listing.providerErrorAt || null,
 codeAddedAt: listing.codeAddedAt || null, cancelledAt: listing.cancelledAt || null, expiredAt: listing.expiredAt || null, operator: listing.operator || '', providerCancelled: !!listing.providerCancelled,
 refunded: listing.status === 'expired' || listing.status === 'cancelled' ? listing.sellPrice : null
 });
 } catch (e) { res.status(500).json({ error: 'Failed to check status' }); }
});
app.post('/api/numbers/cancel/:orderId', auth, async (req, res) => {
 try {
 const listing = await NumberListing.findOne({ _id: req.params.orderId, soldTo: req.user._id });
 if (!listing) return res.status(404).json({ error: 'Order not found' });
 if (listing.status !== 'sold' || listing.code) return res.status(400).json({ error: 'This order can no longer be cancelled' });
 const released = await releaseNumberOnProvider(listing);
 const cancelled = await NumberListing.findOneAndUpdate({ _id: listing._id, soldTo: req.user._id, status: 'sold', code: '' }, { $set: { status: 'cancelled', cancelledAt: new Date(), providerCancelled: !!released?.ok, providerCancelDetail: String(released?.detail || '').slice(0, 200) } }, { new: true });
 if (!cancelled) return res.status(409).json({ error: 'This order has already changed state; refresh your order status.' });
 const user = await User.findById(listing.soldTo);
 if (user) { await User.updateOne({ _id: user._id }, { $inc: { balance: listing.sellPrice } }); await Transaction.create({ userId: user._id, type: 'admin_credit', amount: listing.sellPrice, description: `Refund: ${listing.provider} number (${listing.country}) — cancelled by user`, status: 'success' }); }
 res.json({
 status: 'cancelled', refunded: listing.sellPrice,
 providerCancelled: !!released?.ok,
 providerMessage: released?.ok
 ? 'Cancelled on the provider too — the activation is closed on their side.'
 : 'You were refunded in full. The provider did not confirm the cancellation yet; it closes automatically when the number expires.'
 });
 } catch (e) { res.status(500).json({ error: 'Failed to cancel: ' + e.message }); }
});
app.get('/api/numbers/my-orders', auth, async (req, res) => {
 try {
 const mine = await NumberListing.find({ soldTo: req.user._id }).sort({ soldAt: -1 }).limit(50);
 for (const l of mine) await expireStaleNumberOrder(l);
 res.json(mine.map(l => ({
 id: l._id, provider: l.provider, country: l.country, phoneNumber: l.phoneNumber,
 status: l.code ? 'delivered' : l.status === 'sold' ? 'pending' : l.status,
 code: l.code, expiresAt: l.expiresAt, createdAt: l.soldAt || l.createdAt, sellPrice: l.sellPrice,
 server: l.server || 'server1', providerError: l.providerError || '', providerErrorAt: l.providerErrorAt || null,
 codeAddedAt: l.codeAddedAt || null, cancelledAt: l.cancelledAt || null, expiredAt: l.expiredAt || null, operator: l.operator || '', providerCancelled: !!l.providerCancelled,
 refunded: l.status === 'expired' || l.status === 'cancelled' ? l.sellPrice : null
 })));
 } catch (e) { res.status(500).json({ error: 'Failed to load orders' }); }
});

// ── Per-server number history: search + date range + pagination ───────────────
// Each server's history is queried completely separately (server=server1|server2 is required
// on every call), so Server 1 and Server 2 never mix in the same list or page count.
app.get('/api/numbers/my-orders/search', auth, async (req, res) => {
 try {
 const server = req.query.server === 'server2' ? 'server2' : 'server1';
 const page = Math.max(1, parseInt(req.query.page, 10) || 1);
 // Exports need the whole filtered set in one call; normal paging stays capped at 50.
 const maxLimit = String(req.query.all || '') === '1' ? 2000 : 50;
 const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || 10));
 const q = String(req.query.q || '').trim();
 const status = String(req.query.status || '').trim();

 // server1 is the historical default — older rows may predate the `server` field entirely.
 const filter = { soldTo: req.user._id };
 filter.$and = [server === 'server1'
 ? { $or: [{ server: 'server1' }, { server: { $exists: false } }, { server: null }, { server: '' }] }
 : { server: 'server2' }];

 // Date range filters on the purchase date (soldAt), falling back to createdAt for old rows.
 const from = req.query.from ? new Date(String(req.query.from) + 'T00:00:00.000Z') : null;
 const to = req.query.to ? new Date(String(req.query.to) + 'T23:59:59.999Z') : null;
 if (from && !isNaN(from)) filter.$and.push({ $or: [{ soldAt: { $gte: from } }, { soldAt: null, createdAt: { $gte: from } }] });
 if (to && !isNaN(to)) filter.$and.push({ $or: [{ soldAt: { $lte: to } }, { soldAt: null, createdAt: { $lte: to } }] });

 if (q) {
 const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
 filter.$and.push({ $or: [{ phoneNumber: rx }, { provider: rx }, { country: rx }, { code: rx }] });
 }
 if (status) {
 if (status === 'delivered') filter.$and.push({ code: { $nin: ['', null] } });
 else if (status === 'pending') filter.$and.push({ status: 'sold', $or: [{ code: '' }, { code: null }] });
 else filter.$and.push({ status });
 }

 const total = await NumberListing.countDocuments(filter);
 const pages = Math.max(1, Math.ceil(total / limit));
 const safePage = Math.min(page, pages);
 const rows = await NumberListing.find(filter)
 .sort({ soldAt: -1, createdAt: -1 })
 .skip((safePage - 1) * limit)
 .limit(limit);
 for (const l of rows) await expireStaleNumberOrder(l);

 res.json({
 server, page: safePage, pages, limit, total,
 orders: rows.map(l => ({
 id: l._id, provider: l.provider, country: l.country, phoneNumber: l.phoneNumber,
 status: l.code ? 'delivered' : l.status === 'sold' ? 'pending' : l.status,
 code: l.code, expiresAt: l.expiresAt, createdAt: l.soldAt || l.createdAt, sellPrice: l.sellPrice,
 server: l.server || 'server1',
 codeAddedAt: l.codeAddedAt || null, cancelledAt: l.cancelledAt || null, expiredAt: l.expiredAt || null, operator: l.operator || '', providerCancelled: !!l.providerCancelled,
 refunded: l.status === 'expired' || l.status === 'cancelled' ? l.sellPrice : null
 }))
 });
 } catch (e) { res.status(500).json({ error: 'Failed to search orders' }); }
});

// ── Provider performance analytics (admin) ───────────────────────────────────
// Success rate, average time-to-OTP and failure counts grouped by server,
// service (provider), country and operator, so the admin can see what actually
// delivers before choosing where to send traffic.
app.get('/api/admin/numbers/analytics', anyAdminAuth, async (req, res) => {
  try {
    const days = Math.min(180, Math.max(1, parseInt(req.query.days, 10) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const filter = { soldTo: { $ne: null }, $or: [{ soldAt: { $gte: since } }, { soldAt: null, createdAt: { $gte: since } }] };
    if (req.query.server === 'server1' || req.query.server === 'server2') {
      filter.server = req.query.server === 'server1'
        ? { $in: ['server1', null, ''] }
        : 'server2';
    }
    const rows = await NumberListing.find(filter).select(
      'server provider country operator status code sellPrice cost soldAt createdAt codeAddedAt cancelledAt expiredAt providerError'
    ).limit(20000);

    const blank = () => ({ total: 0, delivered: 0, cancelled: 0, expired: 0, pending: 0, msTotal: 0, msCount: 0, revenue: 0, cost: 0 });
    const overall = blank();
    const buckets = { server: {}, service: {}, country: {}, operator: {} };
    const add = (group, key, row, ms) => {
      if (!key) return;
      const b = (buckets[group][key] ||= blank());
      apply(b, row, ms);
    };
    function apply(b, row, ms) {
      b.total++;
      b.revenue += Number(row.sellPrice || 0);
      b.cost += Number(row.cost || 0);
      if (row.code) { b.delivered++; if (ms != null) { b.msTotal += ms; b.msCount++; } }
      else if (row.status === 'cancelled') b.cancelled++;
      else if (row.status === 'expired') b.expired++;
      else b.pending++;
    }
    for (const row of rows) {
      const start = row.soldAt || row.createdAt;
      const ms = row.code && row.codeAddedAt && start ? row.codeAddedAt.getTime() - new Date(start).getTime() : null;
      apply(overall, row, ms);
      add('server', row.server || 'server1', row, ms);
      add('service', row.provider || 'Unknown', row, ms);
      add('country', row.country || 'Unknown', row, ms);
      add('operator', (row.operator || (row.server === 'server2' ? 'any' : 'n/a')), row, ms);
    }
    const shape = (key, b) => ({
      key,
      total: b.total,
      delivered: b.delivered,
      cancelled: b.cancelled,
      expired: b.expired,
      pending: b.pending,
      failures: b.cancelled + b.expired,
      successRate: b.total ? Math.round((b.delivered / b.total) * 1000) / 10 : 0,
      avgSeconds: b.msCount ? Math.round(b.msTotal / b.msCount / 1000) : null,
      revenue: Math.round(b.revenue),
      cost: Math.round(b.cost),
      profit: Math.round(b.revenue - b.cost)
    });
    const list = (group, limit = 25) => Object.entries(buckets[group])
      .map(([k, b]) => shape(k, b))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    const providerErrors = {};
    for (const row of rows) {
      if (!row.providerError) continue;
      const msg = String(row.providerError).slice(0, 90);
      providerErrors[msg] = (providerErrors[msg] || 0) + 1;
    }

    res.json({
      days,
      generatedAt: new Date(),
      overall: shape('all', overall),
      byServer: list('server', 5),
      byService: list('service'),
      byCountry: list('country'),
      byOperator: list('operator'),
      topErrors: Object.entries(providerErrors).map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count).slice(0, 10),
      best: {
        service: list('service').filter(r => r.total >= 3).sort((a, b) => b.successRate - a.successRate)[0] || null,
        country: list('country').filter(r => r.total >= 3).sort((a, b) => b.successRate - a.successRate)[0] || null,
        operator: list('operator').filter(r => r.total >= 3).sort((a, b) => b.successRate - a.successRate)[0] || null
      }
    });
  } catch (e) { res.status(500).json({ error: 'Failed to build analytics: ' + e.message }); }
});

// ── Live health checks for Server 1 (NovaSolution) and Server 2 (GrizzlySMS) ─────
// Results are cached briefly so a busy page doesn't hammer the providers.
let _healthCache = null, _healthCheckedAt = 0, _healthInFlight = null;
const HEALTH_TTL_MS = 60 * 1000;

async function checkNumberServersHealth() {
 const cfg = await getNumberServerConfig().catch(() => ({ server1Enabled: true, server2Enabled: true, usdToNgn: 0 }));
 const started = Date.now();

 const s1 = { id: 'server1', name: 'Server 1 — NovaSolution Numbers', enabled: !!cfg.server1Enabled, online: false, latencyMs: null, message: '', balance: null };
 const s2 = { id: 'server2', name: 'Server 2 — All services', enabled: !!cfg.server2Enabled, online: false, latencyMs: null, message: '', balance: null, balanceNgn: null };

 await Promise.all([
 (async () => {
 if (!s1.enabled) { s1.message = 'Switched off by admin'; return; }
 const t = Date.now();
 try {
 const r = novaUnwrap(await novaRequest('GET', '/balance'));
 s1.online = true;
 s1.balance = Number(r.balance_ngn ?? r.balance ?? 0);
 s1.message = 'Reachable';
 } catch (e) { s1.message = String(e.message || e).slice(0, 200); }
 s1.latencyMs = Date.now() - t;
 })(),
 (async () => {
 if (!s2.enabled) { s2.message = 'Switched off by admin'; return; }
 const t = Date.now();
 try {
 const raw = await grizzlyRequest('getBalance');
 const text = String(raw || '');
 if (!text.startsWith('ACCESS_BALANCE')) throw new Error(text || 'Unexpected reply');
 s2.balance = Number(text.split(':')[1] || 0);
 s2.balanceNgn = Math.round(s2.balance * (cfg.usdToNgn || 0));
 s2.online = true;
 s2.message = 'Reachable';
 } catch (e) { s2.message = String(e.message || e).slice(0, 200); }
 s2.latencyMs = Date.now() - t;
 })()
 ]);

 _healthCache = { checkedAt: new Date().toISOString(), tookMs: Date.now() - started, servers: [s1, s2] };
 _healthCheckedAt = Date.now();
 return _healthCache;
}

async function getNumberServersHealth(force) {
 if (!force && _healthCache && Date.now() - _healthCheckedAt < HEALTH_TTL_MS) return { ..._healthCache, cached: true };
 if (_healthInFlight) return _healthInFlight;
 _healthInFlight = checkNumberServersHealth().finally(() => { _healthInFlight = null; });
 return _healthInFlight;
}

// Public: the buy page uses this to show green/red status dots.
app.get('/api/numbers/health', async (req, res) => {
 try { res.json(await getNumberServersHealth(req.query.force === '1')); }
 catch (e) { res.status(500).json({ error: 'Health check failed: ' + e.message }); }
});

// Admin: same check, always fresh, plus admin-only balances.
app.get('/api/admin/numbers/health', anyAdminAuth, async (req, res) => {
 try { res.json(await getNumberServersHealth(true)); }
 catch (e) { res.status(500).json({ error: 'Health check failed: ' + e.message }); }
});

// Admin: every purchased number with its delivery state and any provider error.
app.get('/api/admin/numbers/orders', anyAdminAuth, async (req, res) => {
 try {
 const q = {};
 if (req.query.server === 'server1' || req.query.server === 'server2') q.server = req.query.server;
 const status = req.query.status;
 if (status === 'pending') Object.assign(q, { status: 'sold', code: '' });
 else if (status === 'delivered') q.code = { $ne: '' };
 else if (status === 'expired' || status === 'cancelled') q.status = status;
 else if (status === 'errors') q.providerError = { $nin: ['', null] };
 else q.soldTo = { $ne: null };
 if (req.query.q) {
 const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
 q.$or = [{ phoneNumber: rx }, { provider: rx }, { country: rx }];
 }
 const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
 const rows = await NumberListing.find(q).sort({ soldAt: -1, createdAt: -1 }).limit(limit).populate('soldTo', 'username email');
 res.json(rows.map(l => ({
 id: l._id, server: l.server || 'server1', provider: l.provider, country: l.country,
 phoneNumber: l.phoneNumber, sellPrice: l.sellPrice, cost: l.cost,
 status: l.code ? 'delivered' : l.status === 'sold' ? 'pending' : l.status,
 code: l.code, providerError: l.providerError || '', providerErrorAt: l.providerErrorAt || null,
 createdAt: l.soldAt || l.createdAt, expiresAt: l.expiresAt,
 user: l.soldTo ? (l.soldTo.username || l.soldTo.email || '') : ''
 })));
 } catch (e) { res.status(500).json({ error: 'Failed to load orders: ' + e.message }); }
});

// ══════════════════════ SERVER 2 — GrizzlySMS ══════════════════════
// Flow mirrors Server 1: pick service → country → provider(price tier) → buy → poll → cancel.
// Grizzly quotes in USD; every price shown to customers is converted to ₦ and marked up.

// Which servers a customer can use right now.
app.get('/api/numbers/servers', async (req, res) => {
 try {
 const cfg = await getNumberServerConfig();
 res.json([
 { id: 'server1', name: 'Server 1', description: 'Live server catalog with services and live prices.', enabled: !!cfg.server1Enabled },
 { id: 'server2', name: 'Server 2 — All services & countries', description: 'Hundreds of services and countries, live stock and live prices.', enabled: !!cfg.server2Enabled, providerMode: cfg.server2ProviderMode || 'pools', defaultOperator: cfg.server2DefaultOperator || 'any' }
 ]);
 } catch (e) { res.status(500).json({ error: 'Failed to load servers' }); }
});

let _grizzlyServicesCache = null, _grizzlyServicesAt = 0, _grizzlyServicesJob = null;
let _grizzlyCountriesCache = null, _grizzlyCountriesAt = 0, _grizzlyCountriesJob = null;
const GRIZZLY_LIST_TTL = 60 * 60 * 1000;
function refreshGrizzlyServices() {
 if (_grizzlyServicesJob) return _grizzlyServicesJob;
 _grizzlyServicesJob = (async () => {
  const r = await grizzlyRequest('getServicesList');
  _grizzlyServicesCache = (r.services || []).map(s => ({
   code: s.code,
   name: prettifyServiceName(s.name),
   emoji: serviceEmoji(s.code, s.name),
   icon: serviceIconUrl(s.code, s.name),
   popular: POPULAR_SERVICE_CODES.includes(String(s.code).toLowerCase())
  }));
  _grizzlyServicesAt = Date.now();
  return _grizzlyServicesCache;
 })().finally(() => { _grizzlyServicesJob = null; });
 return _grizzlyServicesJob;
}
// Stale-while-revalidate: an old list is returned instantly while a fresh one loads behind it.
async function getGrizzlyServices() {
 if (_grizzlyServicesCache) {
  if (Date.now() - _grizzlyServicesAt >= GRIZZLY_LIST_TTL) refreshGrizzlyServices().catch(() => {});
  return _grizzlyServicesCache;
 }
 return refreshGrizzlyServices();
}
function refreshGrizzlyCountries() {
 if (_grizzlyCountriesJob) return _grizzlyCountriesJob;
 _grizzlyCountriesJob = (async () => {
  const r = await grizzlyRequest('getCountries');
  _grizzlyCountriesCache = Object.values(r || {})
   .filter(c => c && c.visible !== 0)
   .map(c => {
    const name = c.eng || c.rus || String(c.id);
    return { id: String(c.id), name, flag: countryFlag(name) };
   });
  _grizzlyCountriesAt = Date.now();
  return _grizzlyCountriesCache;
 })().finally(() => { _grizzlyCountriesJob = null; });
 return _grizzlyCountriesJob;
}
async function getGrizzlyCountries() {
 if (_grizzlyCountriesCache) {
  if (Date.now() - _grizzlyCountriesAt >= GRIZZLY_LIST_TTL) refreshGrizzlyCountries().catch(() => {});
  return _grizzlyCountriesCache;
 }
 return refreshGrizzlyCountries();
}
// Short-lived per-service stock/price cache (shared by everyone opening the same service).
const _grizzlyPricesCache = new Map(), _grizzlyPricesJobs = new Map();
const GRIZZLY_PRICES_TTL = 20 * 1000;
async function getGrizzlyPricesCached(service) {
 const hit = _grizzlyPricesCache.get(service);
 if (hit && Date.now() - hit.at < GRIZZLY_PRICES_TTL) return hit.data;
 if (_grizzlyPricesJobs.has(service)) return _grizzlyPricesJobs.get(service);
 const job = grizzlyRequest('getPrices', { service }).then(data => {
  _grizzlyPricesCache.set(service, { at: Date.now(), data });
  if (_grizzlyPricesCache.size > 300) _grizzlyPricesCache.delete(_grizzlyPricesCache.keys().next().value);
  return data;
 }).catch(e => { if (hit) return hit.data; throw e; }).finally(() => _grizzlyPricesJobs.delete(service));
 _grizzlyPricesJobs.set(service, job);
 return job;
}
// Warm everything the picker needs right after boot, then keep it fresh in the background.
function warmGrizzly() {
 getGrizzlyServices().catch(() => {});
 getGrizzlyCountries().catch(() => {});
 POPULAR_SERVICE_CODES.slice(0, 8).forEach((c, i) => setTimeout(() => getGrizzlyPricesCached(c).catch(() => {}), 1500 * (i + 1)));
}
setTimeout(warmGrizzly, 4000);
setInterval(() => { refreshGrizzlyServices().catch(() => {}); refreshGrizzlyCountries().catch(() => {}); }, 45 * 60 * 1000);

async function requireServer2(res) {
 const cfg = await getNumberServerConfig();
 if (!cfg.server2Enabled) { res.status(400).json({ error: 'Server 2 is temporarily switched off — please try Server 1.' }); return null; }
 return cfg;
}

// Full service catalogue (every service Grizzly sells), each with an icon. The client
// searches this list locally, so nothing is truncated here — a cut-off list is exactly
// why WhatsApp/Telegram used to be impossible to find.
app.get('/api/numbers/server2/services', async (req, res) => {
 try {
 if (!(await requireServer2(res))) return;
 const q = String(req.query.search || '').trim().toLowerCase();
 let list = await getGrizzlyServices();
 if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q);
 // Popular first, then alphabetical.
 list = list.slice().sort((a, b) =>
 (b.popular ? 1 : 0) - (a.popular ? 1 : 0) ||
 (a.popular && b.popular ? POPULAR_SERVICE_CODES.indexOf(a.code) - POPULAR_SERVICE_CODES.indexOf(b.code) : 0) ||
 a.name.localeCompare(b.name));
 res.json(list);
 } catch (e) { res.status(502).json({ error: e.message }); }
});

// Countries that actually have stock for the chosen service, with our ₦ price and flag.
app.get('/api/numbers/server2/countries', async (req, res) => {
 try {
 const cfg = await requireServer2(res);
 if (!cfg) return;
 const service = String(req.query.service || '').trim();
 if (!service) return res.status(400).json({ error: 'service is required' });
 const [prices, countries] = await Promise.all([getGrizzlyPricesCached(service), getGrizzlyCountries()]);
 const byId = new Map(countries.map(c => [c.id, c]));
 const out = [];
 for (const [countryId, services] of Object.entries(prices || {})) {
 const info = services?.[service];
 if (!info || !info.count) continue;
 const meta = byId.get(String(countryId));
 const name = meta?.name || `Country ${countryId}`;
 const { price, costNgn } = grizzlyPriceNgn(info.cost, cfg);
 out.push({ id: String(countryId), name, flag: meta?.flag || countryFlag(name), count: info.count, price, costNgn });
 }
 // Default is alphabetical (A→Z) so a country is easy to find; ?sort=price gives cheapest first.
 if (String(req.query.sort || 'name') === 'price') out.sort((a, b) => a.price - b.price || b.count - a.count);
 else out.sort((a, b) => a.name.localeCompare(b.name));
 res.json(out);
 } catch (e) { res.status(502).json({ error: e.message }); }
});

// "Providers" on Grizzly are price tiers — each tier is a different pool of numbers.
app.get('/api/numbers/server2/providers', async (req, res) => {
 try {
 const cfg = await requireServer2(res);
 if (!cfg) return;
 const service = String(req.query.service || '').trim();
 const country = String(req.query.country || '').trim();
 if (!service || !country) return res.status(400).json({ error: 'service and country are required' });
 const data = await grizzlyRequest('getPricesV2', { service, country });
 const tiers = data?.[country]?.[service] || {};
 const countries = await getGrizzlyCountries();
 const meta = countries.find(c => c.id === String(country));
 const availableTiers = Object.entries(tiers).filter(([, count]) => Number(count) > 0)
   .sort(([a], [b]) => Number(a) - Number(b));
 const shownTiers = cfg.server2HideLowPools ? availableTiers.slice(3) : availableTiers;
 const out = shownTiers.map(([costUsd, count], i) => {
 const { price, costNgn } = grizzlyPriceNgn(Number(costUsd), cfg);
 return {
 maxPrice: Number(costUsd), count: Number(count), price, costNgn,
 label: `Pool ${i + 1 + (cfg.server2HideLowPools ? 3 : 0)}`, flag: meta?.flag || '🌍', countryName: meta?.name || country
 };
 }).sort((a, b) => a.price - b.price || a.maxPrice - b.maxPrice);
 res.json(out);
 } catch (e) { res.status(502).json({ error: e.message }); }
});


// Operators available for a country (Grizzly/sms-activate `getOperators`).
// "any" always leads the list so a customer can let the provider choose.
const _grizzlyOperatorsCache = new Map();
async function getGrizzlyOperators(country) {
 const key = String(country);
 const hit = _grizzlyOperatorsCache.get(key);
 if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.list;
 let raw;
 try { raw = await grizzlyRequest('getOperators', { country: key }); }
 catch (e) { return ['any']; }
 const bag = raw?.countryOperators?.[key] ?? raw?.countryOperators ?? {};
 let list = Array.isArray(bag) ? bag : Object.values(bag || {});
 list = list.map(v => String(v).trim()).filter(Boolean);
 list = ['any', ...list.filter(v => v.toLowerCase() !== 'any')];
 list = [...new Set(list)];
 _grizzlyOperatorsCache.set(key, { list, at: Date.now() });
 return list;
}

app.get('/api/numbers/server2/operators', async (req, res) => {
 try {
 if (!(await requireServer2(res))) return;
 const country = String(req.query.country || '').trim();
 if (!country) return res.status(400).json({ error: 'country is required' });
 const list = await getGrizzlyOperators(country);
 res.json(list.map(code => ({
 code,
 name: code === 'any' ? 'Any operator (recommended)' : prettifyServiceName(code)
 })));
 } catch (e) { res.status(502).json({ error: e.message }); }
});

// Buy: charge the customer in ₦, then request the number from Grizzly.
app.post('/api/numbers/server2/buy', auth, async (req, res) => {
 try {
 const cfg = await requireServer2(res);
 if (!cfg) return;
 const service = String(req.body.service || '').trim();
 const country = String(req.body.country || '').trim();
 const maxPrice = Number(req.body.maxPrice || 0);
 if (!service || !country || !maxPrice) return res.status(400).json({ error: 'Please re-pick service, country and provider, then try again.' });
 // Operator choice — only honoured when the admin turned operator picking on.
 const mode = cfg.server2ProviderMode || 'pools';
 let operator = String(req.body.operator || '').trim().toLowerCase();
 if (mode === 'pools' || !operator) operator = String(cfg.server2DefaultOperator || 'any').toLowerCase();
 if (operator && operator !== 'any') {
 const allowed = await getGrizzlyOperators(country);
 if (!allowed.map(o => o.toLowerCase()).includes(operator)) {
 return res.status(400).json({ error: 'That operator is not available for this country — pick another one.' });
 }
 }

 // Re-check live stock + price so a customer can never pay a stale amount.
 const data = await grizzlyRequest('getPricesV2', { service, country });
 const tiers = data?.[country]?.[service] || {};
 const tierKey = Object.keys(tiers).find(k => Math.abs(Number(k) - maxPrice) < 0.0001);
 if (!tierKey || !Number(tiers[tierKey])) return res.status(400).json({ error: 'That provider just sold out — please pick another one.' });
 if (cfg.server2HideLowPools) {
 const lowPools = Object.entries(tiers).filter(([, c]) => Number(c) > 0).map(([k]) => Number(k)).sort((a, b) => a - b).slice(0, 3);
 if (lowPools.some(k => Math.abs(k - maxPrice) < 0.0001)) return res.status(400).json({ error: 'That provider is not available right now — please pick another one.' });
 }
 const { price: chargeAmount, costNgn } = grizzlyPriceNgn(maxPrice, cfg);

 const user = await User.findById(req.user._id);
 if ((user.balance || 0) < chargeAmount) return res.status(400).json({ error: 'Insufficient balance. Please deposit funds.' });

 let bought;
 try {
 const buyParams = { service, country, maxPrice };
 if (operator && operator !== 'any') buyParams.operator = operator;
 bought = await grizzlyRequest('getNumberV2', buyParams);
 } catch (e) {
 SystemError.create({ source: 'grizzly', message: `getNumberV2 failed: ${e.message}`, detail: `service=${service} country=${country} maxPrice=${maxPrice}`, context: { userId: user._id } }).catch(() => {});
 return res.status(400).json({ error: e.message });
 }
 if (!bought || !bought.phoneNumber) return res.status(400).json({ error: 'Provider did not return a number — nothing was charged, please try again.' });

 const services = await getGrizzlyServices();
 const countries = await getGrizzlyCountries();
 const serviceName = services.find(s => s.code === service)?.name || service;
 const countryName = countries.find(c => c.id === country)?.name || country;

 const claimed = await NumberListing.create({
 provider: serviceName, country: countryName, phoneNumber: bought.phoneNumber,
 sellPrice: chargeAmount, cost: costNgn, costUsd: Number(bought.activationCost || maxPrice),
 status: 'sold', soldTo: user._id, soldAt: new Date(),
 expiresAt: new Date(Date.now() + NUMBER_RENTAL_WINDOW_MS),
 server: 'server2', grizzlyActivationId: String(bought.activationId), operator: operator || 'any'
 });
 user.balance = (user.balance || 0) - chargeAmount;
 await user.save();
 await Transaction.create({ userId: user._id, type: 'purchase', amount: chargeAmount, description: `Rented ${serviceName} number (${countryName}) — Server 2`, status: 'success' });
 await creditReferralCommission(user, chargeAmount, `${serviceName} number (${countryName})`);

 res.json({ orderId: claimed._id, phoneNumber: claimed.phoneNumber, expiresAt: claimed.expiresAt, provider: claimed.provider, country: claimed.country, amountPaid: chargeAmount });
 } catch (e) { res.status(500).json({ error: 'Failed to buy number: ' + e.message }); }
});

// ── Admin: server switches, ₦ rate, profit ladder, provider balance, profit report ──
app.get('/api/admin/numbers/server-config', anyAdminAuth, async (req, res) => {
 try {
 const cfg = await getNumberServerConfig();
 res.json({
 server1Enabled: cfg.server1Enabled, server2Enabled: cfg.server2Enabled,
 usdToNgn: cfg.usdToNgn, markupTiers: cfg.markupTiers, server1MarkupTiers: cfg.server1MarkupTiers, apiProfitPercent: cfg.apiProfitPercent, highCostMarkupPercent: cfg.highCostMarkupPercent, roundTo: cfg.roundTo,
 server2ProviderMode: cfg.server2ProviderMode || 'pools', server2DefaultOperator: cfg.server2DefaultOperator || 'any',
 server2HideLowPools: !!cfg.server2HideLowPools,
 autoRateEnabled: cfg.autoRateEnabled, autoRateMarginPercent: cfg.autoRateMarginPercent,
 autoRateIntervalHours: cfg.autoRateIntervalHours, autoRateMinRate: cfg.autoRateMinRate, autoRateMaxRate: cfg.autoRateMaxRate,
 lastAutoRate: cfg.lastAutoRate, lastAutoRateAt: cfg.lastAutoRateAt, lastAutoRateSource: cfg.lastAutoRateSource, lastAutoRateError: cfg.lastAutoRateError,
 balanceAlertsEnabled: cfg.balanceAlertsEnabled, lowBalanceThresholdUsd: cfg.lowBalanceThresholdUsd,
 balanceAlertEmail: cfg.balanceAlertEmail, balanceCheckIntervalMinutes: cfg.balanceCheckIntervalMinutes,
 lastBalanceUsd: cfg.lastBalanceUsd, lastBalanceAt: cfg.lastBalanceAt, lastBalanceError: cfg.lastBalanceError
 });
 } catch (e) { res.status(500).json({ error: 'Failed to load config' }); }
});
app.put('/api/admin/numbers/server-config', anyAdminAuth, async (req, res) => {
 try {
 const cfg = await getNumberServerConfig();
 const b = req.body || {};
 if (typeof b.server1Enabled === 'boolean') cfg.server1Enabled = b.server1Enabled;
 if (typeof b.server2Enabled === 'boolean') cfg.server2Enabled = b.server2Enabled;
 if (typeof b.server2HideLowPools === 'boolean') cfg.server2HideLowPools = b.server2HideLowPools;
 if (Array.isArray(b.server1MarkupTiers)) {
 const rows = b.server1MarkupTiers.map(t => ({ upTo: Number(t.upTo), profit: Number(t.profit) }))
 .filter(t => Number.isFinite(t.upTo) && t.upTo > 0 && Number.isFinite(t.profit) && t.profit >= 0).sort((a, b) => a.upTo - b.upTo);
 if (rows.length) cfg.server1MarkupTiers = rows;
 }
 if (Number(b.apiProfitPercent) >= 0 && Number(b.apiProfitPercent) <= 100) cfg.apiProfitPercent = Number(b.apiProfitPercent);
 if (Number(b.usdToNgn) > 0) cfg.usdToNgn = Number(b.usdToNgn);
 if (Array.isArray(b.markupTiers)) {
 // Validate the ladder before it can ever price a sale: every row must be a real number,
 // profits must be >= 0, and the ranges must climb strictly (no duplicate or overlapping
 // ceilings, and therefore no gap between one tier's ceiling and the next tier's start).
 const rows = b.markupTiers.map((t, i) => ({ i: i + 1, upTo: Number(t.upTo), profit: Number(t.profit) }));
 if (!rows.length) return res.status(400).json({ error: 'Profit ladder needs at least one tier.' });
 for (const t of rows) {
 if (!Number.isFinite(t.upTo) || t.upTo <= 0) return res.status(400).json({ error: `Tier ${t.i}: "cost up to ₦" must be a number greater than 0.` });
 if (!Number.isFinite(t.profit) || t.profit < 0) return res.status(400).json({ error: `Tier ${t.i}: profit must be ₦0 or more.` });
 }
 const sorted = rows.slice().sort((a, b2) => a.upTo - b2.upTo);
 for (let i = 1; i < sorted.length; i++) {
 if (sorted[i].upTo === sorted[i - 1].upTo) return res.status(400).json({ error: `Two tiers both end at ₦${sorted[i].upTo} — ranges overlap. Give each tier a different ceiling.` });
 }
 cfg.markupTiers = sorted.map(t => ({ upTo: t.upTo, profit: t.profit }));
 }
 if (b.highCostMarkupPercent !== undefined) {
 const pct = Number(b.highCostMarkupPercent);
 if (!Number.isFinite(pct) || pct < 0) return res.status(400).json({ error: 'Markup % above the last tier must be 0 or more.' });
 cfg.highCostMarkupPercent = pct;
 }
 if (Number(b.roundTo) > 0) cfg.roundTo = Number(b.roundTo);
 if (b.server2ProviderMode !== undefined) {
 const mode = String(b.server2ProviderMode);
 if (!['pools', 'operators', 'both'].includes(mode)) return res.status(400).json({ error: 'Provider listing method must be pools, operators or both.' });
 cfg.server2ProviderMode = mode;
 }
 if (b.server2DefaultOperator !== undefined) {
 cfg.server2DefaultOperator = String(b.server2DefaultOperator || 'any').trim().toLowerCase() || 'any';
 }
 if (typeof b.autoRateEnabled === 'boolean') cfg.autoRateEnabled = b.autoRateEnabled;
 if (b.autoRateMarginPercent !== undefined) {
 const m = Number(b.autoRateMarginPercent);
 if (!Number.isFinite(m) || m < 0 || m > 100) return res.status(400).json({ error: 'Rate safety margin must be between 0 and 100%.' });
 cfg.autoRateMarginPercent = m;
 }
 if (Number(b.autoRateIntervalHours) > 0) cfg.autoRateIntervalHours = Math.min(168, Number(b.autoRateIntervalHours));
 if (Number(b.autoRateMinRate) > 0) cfg.autoRateMinRate = Number(b.autoRateMinRate);
 if (Number(b.autoRateMaxRate) > 0) cfg.autoRateMaxRate = Number(b.autoRateMaxRate);
 if (cfg.autoRateMaxRate <= cfg.autoRateMinRate) return res.status(400).json({ error: 'Rate safety ceiling must be higher than the floor.' });
 if (typeof b.balanceAlertsEnabled === 'boolean') cfg.balanceAlertsEnabled = b.balanceAlertsEnabled;
 if (b.lowBalanceThresholdUsd !== undefined) {
 const t = Number(b.lowBalanceThresholdUsd);
 if (!Number.isFinite(t) || t < 0) return res.status(400).json({ error: 'Low-balance warning level must be $0 or more.' });
 cfg.lowBalanceThresholdUsd = t;
 }
 if (b.balanceAlertEmail !== undefined) {
 const email = String(b.balanceAlertEmail || '').trim().toLowerCase();
 if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'That alert email address does not look valid.' });
 cfg.balanceAlertEmail = email;
 }
 if (Number(b.balanceCheckIntervalMinutes) > 0) cfg.balanceCheckIntervalMinutes = Math.max(5, Math.min(1440, Number(b.balanceCheckIntervalMinutes)));
 cfg.updatedAt = new Date();
 await cfg.save();
 res.json({ message: 'Saved' });
 } catch (e) { res.status(500).json({ error: 'Failed to save config: ' + e.message }); }
});
app.get('/api/admin/numbers/server2/operators', anyAdminAuth, async (req, res) => {
 try {
 const country = String(req.query.country || '').trim();
 if (!country) return res.status(400).json({ error: 'country is required' });
 const list = await getGrizzlyOperators(country);
 res.json(list.map(code => ({ code, name: code === 'any' ? 'Any operator (recommended)' : prettifyServiceName(code) })));
 } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/admin/numbers/server2/countries', anyAdminAuth, async (req, res) => {
 try { res.json(await getGrizzlyCountries()); }
 catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/admin/numbers/server2/services', anyAdminAuth, async (req, res) => {
 try { res.json(await getGrizzlyServices()); }
 catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/admin/numbers/grizzly-balance', anyAdminAuth, async (req, res) => {
 try {
 const r = await checkGrizzlyBalanceAndAlert();
 const cfg = await getNumberServerConfig();
 res.json({
 balance: r.balance, currency: 'USD', balanceNgn: r.balanceNgn,
 threshold: r.threshold, low: r.threshold > 0 && r.balance < r.threshold,
 checkedAt: cfg.lastBalanceAt, usdToNgn: cfg.usdToNgn
 });
 } catch (e) { res.status(502).json({ error: e.message }); }
});

// Warning banner feed — the admin panel polls this and shows a banner for anything here.
app.get('/api/admin/numbers/alerts', anyAdminAuth, async (req, res) => {
 try {
 const cfg = await getNumberServerConfig();
 res.json({
 alerts: Array.from(numbersAlerts.values()),
 balance: { usd: cfg.lastBalanceUsd, at: cfg.lastBalanceAt, error: cfg.lastBalanceError, threshold: cfg.lowBalanceThresholdUsd },
 rate: { usdToNgn: cfg.usdToNgn, live: cfg.lastAutoRate, at: cfg.lastAutoRateAt, source: cfg.lastAutoRateSource, error: cfg.lastAutoRateError, auto: cfg.autoRateEnabled }
 });
 } catch (e) { res.status(500).json({ error: 'Failed to load alerts: ' + e.message }); }
});

// Re-run the balance check right now (also refreshes the banner).
app.post('/api/admin/numbers/alerts/check', anyAdminAuth, async (req, res) => {
 try { res.json(await checkGrizzlyBalanceAndAlert()); }
 catch (e) { res.status(502).json({ error: e.message }); }
});

// Send a test alert email so the owner can prove notifications actually arrive.
app.post('/api/admin/numbers/alerts/test-email', anyAdminAuth, async (req, res) => {
 try {
 const cfg = await getNumberServerConfig();
 const to = String(req.body?.email || cfg.balanceAlertEmail || '').trim();
 if (!to) return res.status(400).json({ error: 'Add an alert email address first.' });
 const r = await sendAdminEmail(to, '[KLS Alert] Test alert email',
 'This is a test. Low Gizzle SMS balance and failed balance checks will be emailed to this address.');
 if (!r.sent) return res.status(400).json({ error: r.reason || 'Email could not be sent' });
 res.json({ message: 'Test email sent to ' + to + ' via ' + r.via });
 } catch (e) { res.status(500).json({ error: e.message }); }
});

// Live dollar rate: read status / force an update now.
app.get('/api/admin/numbers/usd-rate', anyAdminAuth, async (req, res) => {
 try {
 const cfg = await getNumberServerConfig();
 res.json({
 usdToNgn: cfg.usdToNgn, autoRateEnabled: cfg.autoRateEnabled,
 autoRateMarginPercent: cfg.autoRateMarginPercent, autoRateIntervalHours: cfg.autoRateIntervalHours,
 autoRateMinRate: cfg.autoRateMinRate, autoRateMaxRate: cfg.autoRateMaxRate,
 lastAutoRate: cfg.lastAutoRate, lastAutoRateAt: cfg.lastAutoRateAt,
 lastAutoRateSource: cfg.lastAutoRateSource, lastAutoRateError: cfg.lastAutoRateError
 });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/admin/numbers/usd-rate/refresh', anyAdminAuth, async (req, res) => {
 try {
 const r = await refreshUsdRate(true);
 if (r.error) return res.status(502).json({ error: r.error });
 res.json(r);
 } catch (e) { res.status(502).json({ error: e.message }); }
});
// Simple markup preview so the owner can sanity-check the ladder before saving.
app.get('/api/admin/numbers/markup-preview', anyAdminAuth, async (req, res) => {
 try {
 const cfg = await getNumberServerConfig();
 const samples = [0.1, 0.3, 0.5, 0.88, 1.5, 3, 5, 10];
 res.json(samples.map(usd => {
 const { costNgn, price } = grizzlyPriceNgn(usd, cfg);
 return { usd, costNgn, price, profit: price - costNgn };
 }));
 } catch (e) { res.status(500).json({ error: 'Failed to preview' }); }
});
// Profit report: what customers paid minus what the number cost us.
app.get('/api/admin/numbers/profit', anyAdminAuth, async (req, res) => {
 try {
 const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
 const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
 const rows = await NumberListing.find({ soldAt: { $gte: since }, soldTo: { $ne: null } });
 const summary = { days, orders: 0, revenue: 0, cost: 0, profit: 0, refunded: 0, byServer: {} };
 for (const l of rows) {
 const key = l.server === 'server2' ? 'server2' : 'server1';
 summary.byServer[key] = summary.byServer[key] || { orders: 0, revenue: 0, cost: 0, profit: 0, refunded: 0 };
 const bucket = summary.byServer[key];
 bucket.orders++; summary.orders++;
 if (l.status === 'expired' || l.status === 'cancelled') {
 bucket.refunded += l.sellPrice; summary.refunded += l.sellPrice;
 continue; // refunded orders earn nothing
 }
 bucket.revenue += l.sellPrice; summary.revenue += l.sellPrice;
 bucket.cost += l.cost || 0; summary.cost += l.cost || 0;
 bucket.profit += l.sellPrice - (l.cost || 0); summary.profit += l.sellPrice - (l.cost || 0);
 }
 res.json(summary);
 } catch (e) { res.status(500).json({ error: 'Failed to load profit report' }); }
});

app.get('/api/admin/numbers/nova-balance', anyAdminAuth, async (req, res) => {
 try { res.json(novaUnwrap(await novaRequest('GET', '/balance'))); } catch (e) { novaErrorResponse(res, e); }
});
app.get('/api/admin/numbers/nova-catalog', anyAdminAuth, async (req, res) => {
 try {
   const scope = String(req.query.scope || 'usa') === 'global' ? 'global' : 'usa';
   const params = { scope, ...(req.query.country ? { country: String(req.query.country) } : {}) };
   res.json(await novaGetCatalog(params, { refresh: String(req.query.refresh || '') === '1' }));
 } catch (e) { novaErrorResponse(res, e); }
});
app.get('/api/admin/user-number-prices', anyAdminAuth, async (req, res) => {
 try {
 const filter = req.query.userId ? { userId: req.query.userId } : {};
 const rows = await UserNumberPrice.find(filter).populate('userId', 'name email').sort({ updatedAt: -1 });
 res.json(rows.map(r => ({
 id: r._id, userId: r.userId?._id, userName: r.userId?.name || 'Unknown', userEmail: r.userId?.email || '',
 provider: r.provider, country: r.country, price: r.price, updatedAt: r.updatedAt
 })));
 } catch (e) { res.status(500).json({ error: 'Failed to load user price overrides' }); }
});
app.post('/api/admin/user-number-prices', anyAdminAuth, async (req, res) => {
 try {
 const { userId, provider, country, price } = req.body;
 if (!userId || !provider || !country || price === undefined) return res.status(400).json({ error: 'userId, provider, country and price are required' });
 const user = await User.findById(userId).select('name');
 if (!user) return res.status(404).json({ error: 'User not found' });
 const doc = await UserNumberPrice.findOneAndUpdate(
 { userId, provider: provider.trim(), country: country.trim() },
 { price: Number(price), updatedAt: new Date() },
 { upsert: true, new: true }
 );
 res.json(doc);
 } catch (e) { res.status(500).json({ error: 'Failed to save price override: ' + e.message }); }
});
app.delete('/api/admin/user-number-prices/:id', anyAdminAuth, async (req, res) => {
 try {
 await UserNumberPrice.findByIdAndDelete(req.params.id);
 res.json({ ok: true });
 } catch (e) { res.status(500).json({ error: 'Failed to remove price override' }); }
});
app.get('/api/admin/number-pricing', anyAdminAuth, async (req, res) => {
 try { res.json(await NumberPricing.find({}).sort({ provider: 1, country: 1 })); }
 catch (e) { res.status(500).json({ error: 'Failed to load pricing' }); }
});
app.post('/api/admin/number-pricing', anyAdminAuth, async (req, res) => {
 try {
   const { provider, country, price, apiPrice, enabled } = req.body;
   if (!provider || !country || price === undefined || !Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: 'provider, country and a valid price are required' });
   const doc = await NumberPricing.findOneAndUpdate({ provider: String(provider).trim(), country: String(country).trim() }, { price: Number(price), apiPrice: apiPrice ? Number(apiPrice) : 0, enabled: enabled !== undefined ? !!enabled : true, updatedAt: new Date(), mode: 'manual' }, { upsert: true, new: true });
   res.json(doc);
 } catch (e) { res.status(500).json({ error: 'Failed to save price: ' + e.message }); }
});
app.put('/api/admin/number-pricing/:id/toggle', anyAdminAuth, async (req, res) => {
 try {
 const doc = await NumberPricing.findById(req.params.id);
 if (!doc) return res.status(404).json({ error: 'Not found' });
 doc.enabled = !doc.enabled;
 await doc.save();
 res.json(doc);
 } catch (e) { res.status(500).json({ error: 'Failed to toggle' }); }
});
app.put('/api/admin/number-pricing/:id/price', anyAdminAuth, async (req, res) => {
 try {
 const { price, apiPrice } = req.body;
 const update = {};
 if (price !== undefined) update.price = Number(price);
 if (apiPrice !== undefined) update.apiPrice = Number(apiPrice);
 if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });
 update.updatedAt = new Date();
 const doc = await NumberPricing.findByIdAndUpdate(req.params.id, update, { new: true });
 if (!doc) return res.status(404).json({ error: 'Not found' });
 res.json(doc);
 } catch (e) { res.status(500).json({ error: 'Failed to update price' }); }
});
app.put('/api/admin/number-pricing/:id', anyAdminAuth, async (req, res) => {
 try {
 const { provider, country, price, apiPrice, enabled } = req.body;
 const update = { updatedAt: new Date() };
 if (provider !== undefined) update.provider = String(provider).trim();
 if (country !== undefined) update.country = String(country).trim();
 if (price !== undefined) update.price = Number(price);
 if (apiPrice !== undefined) update.apiPrice = Number(apiPrice);
 if (enabled !== undefined) update.enabled = !!enabled;
 const doc = await NumberPricing.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
 if (!doc) return res.status(404).json({ error: 'Not found' });
 res.json(doc);
 } catch (e) {
 if (e.code === 11000) return res.status(400).json({ error: 'Another entry already exists with that same service + country combination' });
 res.status(500).json({ error: 'Failed to update: ' + e.message });
 }
});
app.delete('/api/admin/number-pricing/:id', anyAdminAuth, async (req, res) => {
 try { await NumberPricing.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
 catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});
app.get('/api/admin/number-stock', anyAdminAuth, async (req, res) => {
 try {
 const { status } = req.query;
 const filter = status ? { status } : {};
 const docs = await NumberListing.find(filter).populate('soldTo', 'name email').sort({ createdAt: -1 }).limit(500);
 res.json(docs);
 } catch (e) { res.status(500).json({ error: 'Failed to load stock' }); }
});
app.put('/api/admin/number-stock/:id/code', anyAdminAuth, async (req, res) => {
 try {
 const { code } = req.body;
 if (!code) return res.status(400).json({ error: 'code is required' });
 const listing = await NumberListing.findById(req.params.id);
 if (!listing) return res.status(404).json({ error: 'Not found' });
 listing.code = code;
 listing.codeAddedAt = new Date();
 await listing.save();
 res.json(listing);
 } catch (e) { res.status(500).json({ error: 'Failed to save code' }); }
});
app.delete('/api/admin/number-stock/:id', anyAdminAuth, async (req, res) => {
 try {
 const listing = await NumberListing.findById(req.params.id);
 if (!listing) return res.status(404).json({ error: 'Not found' });
 if (listing.status === 'sold') return res.status(400).json({ error: 'Cannot delete a number currently rented to a user' });
 await listing.deleteOne();
 res.json({ message: 'Deleted' });
 } catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});
app.get('/api/badges', optionalAuth, async (req, res) => {
 try { res.json(await Badge.find({ enabled: true }).sort({ createdAt: 1 })); }
 catch (e) { res.status(500).json({ error: 'Failed to load badges' }); }
});
app.get('/api/badges/mine', auth, async (req, res) => {
 try {
 const earned = await UserBadge.find({ userId: req.user._id }).populate('badgeId');
 res.json(earned.filter(e => e.badgeId).map(e => ({ ...e.badgeId.toObject(), awardedAt: e.awardedAt })));
 } catch (e) { res.status(500).json({ error: 'Failed to load your badges' }); }
});
app.get('/api/badges/user/:userId', optionalAuth, async (req, res) => {
 try {
 const earned = await UserBadge.find({ userId: req.params.userId }).populate('badgeId');
 res.json(earned.filter(e => e.badgeId && e.badgeId.enabled).map(e => ({ name: e.badgeId.name, icon: e.badgeId.icon })));
 } catch (e) { res.status(500).json({ error: 'Failed to load badges' }); }
});
app.get('/api/admin/badges', anyAdminAuth, async (req, res) => {
 try { res.json(await Badge.find({}).sort({ createdAt: -1 })); }
 catch (e) { res.status(500).json({ error: 'Failed to load badges' }); }
});
app.post('/api/admin/badges', anyAdminAuth, async (req, res) => {
 try {
 const { name, icon, description, criteriaType, criteriaValue } = req.body;
 if (!name) return res.status(400).json({ error: 'name is required' });
 const badge = await Badge.create({
 name: name.trim(), icon: icon || '', description: description || '',
 criteriaType: criteriaType || 'manual', criteriaValue: Number(criteriaValue) || 0
 });
 res.json(badge);
 } catch (e) { res.status(500).json({ error: 'Failed to create badge: ' + e.message }); }
});
app.put('/api/admin/badges/:id', anyAdminAuth, async (req, res) => {
 try {
 const { name, icon, description, criteriaType, criteriaValue, enabled } = req.body;
 const update = {};
 if (name !== undefined) update.name = name.trim();
 if (icon !== undefined) update.icon = icon;
 if (description !== undefined) update.description = description;
 if (criteriaType !== undefined) update.criteriaType = criteriaType;
 if (criteriaValue !== undefined) update.criteriaValue = Number(criteriaValue);
 if (enabled !== undefined) update.enabled = !!enabled;
 const badge = await Badge.findByIdAndUpdate(req.params.id, update, { new: true });
 if (!badge) return res.status(404).json({ error: 'Not found' });
 res.json(badge);
 } catch (e) { res.status(500).json({ error: 'Failed to update badge' }); }
});
app.delete('/api/admin/badges/:id', anyAdminAuth, async (req, res) => {
 try {
 await Badge.findByIdAndDelete(req.params.id);
 await UserBadge.deleteMany({ badgeId: req.params.id });
 res.json({ message: 'Deleted' });
 } catch (e) { res.status(500).json({ error: 'Failed to delete badge' }); }
});
app.post('/api/admin/badges/:id/award', anyAdminAuth, async (req, res) => {
 try {
 const { email } = req.body;
 if (!email) return res.status(400).json({ error: 'email is required' });
 const user = await User.findOne({ email: email.trim().toLowerCase() });
 if (!user) return res.status(404).json({ error: 'No user found with that email' });
 await UserBadge.findOneAndUpdate({ userId: user._id, badgeId: req.params.id }, { userId: user._id, badgeId: req.params.id }, { upsert: true });
 res.json({ message: `Awarded to ${user.name}` });
 } catch (e) { res.status(500).json({ error: 'Failed to award badge: ' + e.message }); }
});
app.post('/api/admin/badges/:id/revoke', anyAdminAuth, async (req, res) => {
 try {
 const { email } = req.body;
 if (!email) return res.status(400).json({ error: 'email is required' });
 const user = await User.findOne({ email: email.trim().toLowerCase() });
 if (!user) return res.status(404).json({ error: 'No user found with that email' });
 await UserBadge.deleteOne({ userId: user._id, badgeId: req.params.id });
 res.json({ message: `Revoked from ${user.name}` });
 } catch (e) { res.status(500).json({ error: 'Failed to revoke badge: ' + e.message }); }
});
app.get('/api/deposit/payment-methods', optionalAuth, async (req, res) => {
 try {
 const [docs, vaSettings] = await Promise.all([
 PaymentMethodSetting.find({}),
 getVASettings()
 ]);
 const byMethod = {
 paymentlink: { enabled: true, disabledMessage: '' },
 virtualaccount: { enabled: vaSettings.globalEnabled, disabledMessage: vaSettings.globalEnabled ? '' : 'Virtual accounts are temporarily unavailable. Please use Payment Link instead.' }
 };
 docs.forEach(d => { byMethod[d.method] = { enabled: d.enabled, disabledMessage: d.disabledMessage || '' }; });
 byMethod.virtualaccount = { enabled: vaSettings.globalEnabled, disabledMessage: vaSettings.globalEnabled ? '' : 'Virtual accounts are temporarily unavailable. Please use Payment Link instead.' };
 // Country gate: outside Nigeria only the payment link exists, priced in USD.
 const geo = await klsGeo.resolveCountry(req, req.user || null);
 const isNg = klsFlwMethods.supportsVirtualAccount(geo.code);
 if (!isNg) {
 byMethod.virtualaccount = { enabled: false, disabledMessage: 'Virtual accounts are available in Nigeria only. Use the payment link — it is priced in US dollars.' };
 byMethod.banktransfer = { enabled: false, disabledMessage: 'Bank transfer deposits are available in Nigeria only.' };
 }
 byMethod.country = geo.code;
 byMethod.payCurrency = klsCountries.payCurrencyFor(geo.code);
 byMethod.methods = isNg ? ['virtualaccount', 'paymentlink'] : ['paymentlink'];
 byMethod.checkoutMethods = klsFlwMethods.describeFor(geo.code);
 res.json(byMethod);
 } catch (e) { res.status(500).json({ error: 'Failed to load payment method settings' }); }
});
// Where is this visitor? Public on purpose: the browser needs it before login so
// public/js/money.js can pick the display currency (naira inside Nigeria, US
// dollars everywhere else) on the very first paint. Returns nothing but a
// two-letter country code and the currency that follows from it.
app.get('/api/public/geo', async (req, res) => {
 res.set('Cache-Control', 'no-store');
 try {
  const geo = await klsGeo.resolveCountry(req, req.user || null);
  res.json({ country: geo.code, source: geo.source, currency: geo.code === 'NG' ? 'NGN' : 'USD' });
 } catch (e) {
  res.json({ country: 'NG', source: 'default', currency: 'NGN' });
 }
});
app.get('/api/public/site-links', async (req, res) => {
 res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
 res.set('Pragma', 'no-cache');
 res.set('Expires', '0');
 try {
 const links = await getSiteLinks();
 const tgUser = String(links.telegramUsername || 'klslogs').replace(/^@/, '');
   const tgLink = links.telegramLink || ('https://t.me/' + tgUser);
   res.json({ whatsappNumber: links.whatsappNumber, adminPhone: links.adminPhone || links.whatsappNumber, whatsappGroupLink: links.whatsappGroupLink, whatsappChannelLink: links.whatsappChannelLink, telegramUsername: tgUser, telegramLink: tgLink, telegramChannelLink: links.telegramChannelLink || '', telegramCommunityLink: links.telegramCommunityLink || '', whatsappChatLink: links.whatsappChatLink || ('https://wa.me/' + links.whatsappNumber), supportHours: links.supportHours || '' });
 } catch (e) { res.status(500).json({ error: 'Failed to load site links' }); }
});
app.get('/api/admin/site-links', anyAdminAuth, async (req, res) => {
 try { res.json(await getSiteLinks()); } catch (e) { res.status(500).json({ error: 'Failed to load site links' }); }
});
app.post('/api/admin/site-links', anyAdminAuth, async (req, res) => {
 try {
 const { whatsappNumber, adminPhone, whatsappGroupLink, whatsappChannelLink , telegramUsername, telegramLink, telegramChannelLink, telegramCommunityLink, whatsappChatLink, supportHours } = req.body;
 const update = { updatedAt: new Date() };
 if (whatsappNumber !== undefined) {
 const cleaned = String(whatsappNumber).replace(/[^\d]/g, '');
 if (cleaned.length < 10) return res.status(400).json({ error: 'WhatsApp number must be at least 10 digits' });
 update.whatsappNumber = cleaned;
 process.env.ADMIN_WHATSAPP = cleaned;
 }
 if (adminPhone !== undefined) {
 const cleaned = String(adminPhone).replace(/[^\d]/g, '');
 if (cleaned.length < 10) return res.status(400).json({ error: 'Admin phone must be at least 10 digits' });
 update.adminPhone = cleaned;
 }
 if (whatsappGroupLink !== undefined) {
 const link = String(whatsappGroupLink).trim();
 if (link && !link.startsWith('https://')) return res.status(400).json({ error: 'Group link must start with https://' });
 update.whatsappGroupLink = link;
 }
 if (whatsappChannelLink !== undefined) {
 const link = String(whatsappChannelLink).trim();
 if (link && !link.startsWith('https://')) return res.status(400).json({ error: 'Channel link must start with https://' });
 update.whatsappChannelLink = link;
 }
  // NOTE: telegramUsername is treated as the source of truth. It's processed
  // AFTER telegramLink on purpose: the admin UI always submits both fields
  // together (the link input is pre-filled from the last saved value and only
  // labeled "auto-filled" — it doesn't actually track the username input live),
  // so if telegramLink were applied last it could silently overwrite a fresh
  // username change with the stale link that was sitting in that field.
  if (telegramLink !== undefined && String(telegramLink).trim()) {
   const link = String(telegramLink).trim();
   if (!/^https:\/\//.test(link)) return res.status(400).json({ error: 'Telegram link must start with https://' });
   update.telegramLink = link;
  }
  if (telegramUsername !== undefined) {
   const u = String(telegramUsername).trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, '');
   if (u && !/^[A-Za-z0-9_]{4,32}$/.test(u)) return res.status(400).json({ error: 'Telegram username must be 4-32 letters, numbers or underscores' });
   update.telegramUsername = u;
   if (u) update.telegramLink = 'https://t.me/' + u;
  }
  if (whatsappChatLink !== undefined) {
   const link = String(whatsappChatLink).trim();
   if (link && !/^https:\/\//.test(link)) return res.status(400).json({ error: 'WhatsApp link must start with https://' });
   update.whatsappChatLink = link;
  }
  if (supportHours !== undefined) update.supportHours = String(supportHours).trim().slice(0, 120);
 const doc = await SiteLinks.findByIdAndUpdate('main', { $set: update }, { upsert: true, new: true });
 console.log(`[admin] site-links updated:`, JSON.stringify(update));
 res.json({ ok: true, whatsappNumber: doc.whatsappNumber, adminPhone: doc.adminPhone || doc.whatsappNumber, whatsappGroupLink: doc.whatsappGroupLink, whatsappChannelLink: doc.whatsappChannelLink, telegramUsername: doc.telegramUsername, telegramLink: doc.telegramLink, telegramChannelLink: doc.telegramChannelLink || '', telegramCommunityLink: doc.telegramCommunityLink || '', whatsappChatLink: doc.whatsappChatLink, supportHours: doc.supportHours });
 } catch (e) { res.status(500).json({ error: 'Failed to update site links: ' + e.message }); }
});
app.get('/api/admin/payment-methods', anyAdminAuth, async (req, res) => {
 try {
 const docs = await PaymentMethodSetting.find({});
 const byMethod = { paymentlink: { enabled: true, disabledMessage: '' } };
 docs.forEach(d => { byMethod[d.method] = { enabled: d.enabled, disabledMessage: d.disabledMessage || '' }; });
 res.json(byMethod);
 } catch (e) { res.status(500).json({ error: 'Failed to load payment method settings' }); }
});
app.post('/api/admin/payment-methods/:method', adminAuth, async (req, res) => {
 try {
 const { method } = req.params;
 if (!['paymentlink'].includes(method)) return res.status(400).json({ error: 'Invalid method' });
 const { enabled, disabledMessage } = req.body;
 const update = { method, updatedAt: new Date() };
 if (enabled !== undefined) update.enabled = !!enabled;
 if (disabledMessage !== undefined) update.disabledMessage = disabledMessage;
 const doc = await PaymentMethodSetting.findOneAndUpdate({ method }, update, { upsert: true, new: true });
 res.json(doc);
 } catch (e) { res.status(500).json({ error: 'Failed to update payment method: ' + e.message }); }
});
app.get('/api/admin/giveaways', adminAuth, async (req, res) => {
 res.json(await Giveaway.find().sort({ createdAt: -1 }));
});
app.post('/api/admin/giveaways', adminAuth, upload.single('image'), async (req, res) => {
 try {
 const { title, description, category, credentials, startsInMinutes } = req.body;
 if (!title || !credentials) return res.status(400).json({ error: 'Title and credentials are required' });
 const imageUrl = req.file ? fileUrl(req.file) : (req.body.imageUrl || '');
 const minutes = parseFloat(startsInMinutes) || 0;
 const startsAt = new Date(Date.now() + Math.max(0, minutes) * 60 * 1000);
 const giveaway = await Giveaway.create({ title, description: description || '', category: category || '', credentials, imageUrl, startsAt });
 res.json(giveaway);
 } catch (e) { res.status(500).json({ error: 'Failed to create giveaway: ' + e.message }); }
});
app.delete('/api/admin/giveaways/:id', adminAuth, async (req, res) => {
 await Giveaway.findByIdAndDelete(req.params.id);
 res.json({ message: 'Giveaway removed' });
});
app.get('/api/giveaways', optionalAuth, async (req, res) => {
 const all = await Giveaway.find().sort({ createdAt: -1 }).limit(100);
 res.json(all.map(g => ({
 _id: g._id, title: g.title, description: g.description, category: g.category,
 imageUrl: g.imageUrl, status: g.status, startsAt: g.startsAt, winnerName: g.winnerName,
 winnerProfilePicture: g.winnerProfilePicture, claimedAt: g.claimedAt, createdAt: g.createdAt
 })));
});
app.post('/api/giveaways/:id/claim', auth, async (req, res) => {
 try {
 const giveaway = await Giveaway.findById(req.params.id);
 if (!giveaway) return res.status(404).json({ error: 'Giveaway not found' });
 if (giveaway.startsAt && giveaway.startsAt.getTime() > Date.now()) {
 return res.status(403).json({ error: 'This giveaway hasn\'t started yet — hang tight!', startsAt: giveaway.startsAt });
 }
 const user = await User.findById(req.user._id);
 const won = await Giveaway.findOneAndUpdate(
 { _id: req.params.id, status: 'active', startsAt: { $lte: new Date() } },
 { status: 'claimed', winnerId: user._id, winnerName: user.name, winnerProfilePicture: user.profilePicture || '', claimedAt: new Date() },
 { new: true }
 );
 if (!won) return res.status(409).json({ error: 'Too slow! Someone already claimed this giveaway.' });
 res.json({ message: ' You won!', credentials: won.credentials, title: won.title });
 } catch (e) { res.status(500).json({ error: 'Failed to claim giveaway: ' + e.message }); }
});
app.get('/api/admin/visits', adminAuth, async (req, res) => {
 const stats = await VisitorStats.findOne({ key: 'global' });
 res.json({ visitors: stats?.visitors || 0 });
});
async function computeInventoryValue() {
 const logs = await Log.find({ available: true });
 let logsValue = 0, toolsValue = 0;
 for (const l of logs) {
 if (l.type === 'tool') {
 toolsValue += (l.price || 0);
 } else if (l.listingType === 'folder') {
 logsValue += (l.subAccounts || []).filter(sa => !sa.sold).reduce((s, sa) => s + (sa.price || 0), 0);
 } else {
 logsValue += (l.price || 0);
 }
 }
 return { logsValue, toolsValue };
}
app.get('/api/admin/staff/dashboard', subAdminAuth, async (req, res) => {
 try {
 const [userCount, activeLogs, activeTools, txns, visits, pendingReceipts, openSupport, inventoryValue] = await Promise.all([
 User.countDocuments(),
 Log.countDocuments({ type: 'log', available: true }),
 Log.countDocuments({ type: 'tool', available: true }),
 Transaction.find({ type: 'purchase', status: 'success' }),
 VisitorStats.findOne({ key: 'global' }),
 Receipt.countDocuments({ status: 'pending' }),
 Support.countDocuments({ status: { $ne: 'resolved' } }),
 computeInventoryValue()
 ]);
 const revenue = txns.reduce((s, t) => s + t.amount, 0);
 res.json({
 userCount, activeLogs, activeTools, revenue,
 visitors: visits?.visitors || 0,
 pendingReceipts, openSupport,
 logsValue: inventoryValue.logsValue, toolsValue: inventoryValue.toolsValue
 });
 } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/system-errors', adminAuth, async (req, res) => {
 const errors = await SystemError.find({ resolved: false }).sort({ createdAt: -1 }).limit(100);
 res.json(errors);
});
app.put('/api/admin/system-errors/:id/resolve', adminAuth, async (req, res) => {
 const err = await SystemError.findByIdAndUpdate(req.params.id, { resolved: true }, { new: true });
 if (!err) return res.status(404).json({ error: 'Not found' });
 res.json(err);
});
app.get('/api/admin/support', anyAdminAuth, async (req, res) => res.json(await Support.find().sort({ createdAt: -1 })));
app.put('/api/admin/support/:id', anyAdminAuth, async (req, res) => { const t = await Support.findByIdAndUpdate(req.params.id, { adminReply: req.body.reply, status: 'resolved', seenByUser: false }, { new: true }); res.json(t); });
app.get('/api/admin/transactions', adminAuth, async (req, res) => res.json(await Transaction.find().populate('userId', 'name email').sort({ createdAt: -1 }).limit(200)));
const SITE_ORIGIN = process.env.SITE_URL || '';
// Page titles/descriptions come from site.config.js — edit them there.
let indexHtmlTemplate = null;
function getIndexHtmlTemplate() {
 if (!indexHtmlTemplate) indexHtmlTemplate = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
 return indexHtmlTemplate;
}
function renderIndexWithSeo(reqPath) {
 const meta = PAGE_SEO[reqPath] || PAGE_SEO['/'];
 const url = SITE_ORIGIN ? SITE_ORIGIN.replace(/\/$/, '') + reqPath : reqPath;
 let html = getIndexHtmlTemplate();
 html = html.replace(/<title>.*?<\/title>/, `<title>${meta.title}</title>`);
 html = html.replace(/<meta name="description" content=".*?"\/>/, `<meta name="description" content="${meta.description}"/>`);
 const ogTags = `<meta property="og:title" content="${meta.title}"/>\n <meta property="og:description" content="${meta.description}"/>\n <meta property="og:type" content="website"/>\n ${url ? `<meta property="og:url" content="${url}"/>\n <link rel="canonical" href="${url}"/>` : ''}\n <meta name="twitter:card" content="summary"/>\n <meta name="twitter:title" content="${meta.title}"/>\n <meta name="twitter:description" content="${meta.description}"/>`;
 html = html.replace('<!--SEO_META-->', ogTags);
 return html;
}
app.get(`/${process.env.ADMIN_SECRET_PATH || 'ksl-admin-secret'}`, (req, res) => {
  // No caching: admins were seeing an old admin.html (missing the Boost tab)
  // served from the browser/proxy cache after a deploy.
  res.set('Cache-Control', 'no-store, must-revalidate');
  (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'admin.html')));
});
// Direct /admin.html hits must not be cached either.
app.get('/admin.html', (req, res) => {
  res.set('Cache-Control', 'no-store, must-revalidate');
  (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'admin.html')));
});
app.get('/dashboard', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))));
app.get('/games', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'game.html'))));
app.get('/giveaways', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'giveaway.html'))));
app.get('/buy-number', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'buy-number.html'))));
app.get('/virtual-account', (req, res) => res.redirect(301, '/deposit'));
app.get('/number-history', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'number-history.html'))));
app.get('/order-status', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'order-status.html'))));
app.get('/marketplace2', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'marketplace2.html'))));
app.get('/marketplace', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'marketplace.html'))));
app.get('/tools', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'tools.html'))));
// Friendly category deep links — /logs/whatsapp, /marketplace/gmail, /tools/vpn.
// These only serve the same HTML page; the category is applied client-side from the
// URL, so no API contract changes and nothing existing breaks.
app.get('/logs', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'marketplace.html'))));
app.get('/logs/:category', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'marketplace.html'))));
app.get('/marketplace/:category', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'marketplace.html'))));
app.get('/tools/:category', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'tools.html'))));
app.get('/referrals', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'referrals.html'))));
app.get('/purchases', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'purchases.html'))));
app.get('/boost', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'boost.html'))));
app.get('/boost1', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'boost1.html'))));
app.get('/boost2', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'boost2.html'))));
app.get('/boost-history', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'boost-history.html'))));
app.get('/boost-services', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'boost-services.html'))));
app.get('/all-services', (req, res) => res.redirect(301, '/boost-services'));
app.get('/transactions', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'transactions.html'))));
app.get('/support', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'support.html'))));
// Legacy bill/VTU paths (airtime, data, cable TV, electricity, betting) were removed.
// Kept as permanent redirects so old links and bookmarks land on the homepage.
app.get(['/services', '/airtime', '/data', '/cable', '/electricity', '/betting', '/data-bill'], (req, res) => res.redirect(301, '/'));
app.get('/settings', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'settings.html'))));
app.get('/api-docs', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'apidocs.html'))));
app.get('/apidocs', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'apidocs.html'))));
app.get('/groups', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'groups.html'))));
app.get('/messages', (req, res) => (res.set('Cache-Control', 'no-store, must-revalidate'), res.sendFile(path.join(__dirname, 'public', 'messages.html'))));
app.get('/chat', (req, res) => res.redirect(301, '/groups'));
// NOTE: the SPA catch-all used to live here, which silently shadowed EVERY route
// registered further down this file (global payments, wallet, countries, the
// operations layer). Those endpoints answered with index.html instead of JSON,
// which is why the wallet said "undefined is not an object" and the deposit
// page rendered blank. It is now mounted at the very bottom, after every route.
const sseClients = new Map(); // userId (string) Set<res>
app.get('/api/user/events', auth, (req, res) => {
 res.setHeader('Content-Type', 'text/event-stream');
 res.setHeader('Cache-Control', 'no-cache');
 res.setHeader('Connection', 'keep-alive');
 res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering for Render/Railway
 res.flushHeaders();
 const userId = String(req.user._id);
 if (!sseClients.has(userId)) sseClients.set(userId, new Set());
 sseClients.get(userId).add(res);
 const keepAlive = setInterval(() => {
 try { res.write(': ping\n\n'); } catch { clearInterval(keepAlive); }
 }, 25000);
 req.on('close', () => {
 clearInterval(keepAlive);
 sseClients.get(userId)?.delete(res);
 if (!sseClients.get(userId)?.size) sseClients.delete(userId);
 });
 User.findById(req.user._id).select('balance').then(u => {
 if (u) res.write(`event: balance\ndata: ${JSON.stringify({ balance: u.balance || 0 })}\n\n`);
 }).catch(() => {});
});
function pushBalanceToUser(userId, newBalance, creditAmount = null) {
 const clients = sseClients.get(String(userId));
 if (!clients || !clients.size) return;
 const payload = { balance: newBalance, source: 'virtual_account' };
 if (creditAmount !== null && creditAmount > 0) payload.creditAmount = creditAmount;
 const msg = `event: balance\ndata: ${JSON.stringify(payload)}\n\n`;
 for (const res of clients) {
 try { res.write(msg); } catch { clients.delete(res); }
 }
}
// ═══ AUTOMATIC PENDING DEPOSITS RECONCILIATION ═══════════════════════════
// Continuously checks all pending deposits (Payment Links, Virtual Accounts, and Bank Transfers)
// against Flutterwave so users do NOT stay stuck in pending and do NOT require admin manual acceptance.
// Also marks failed/cancelled/refunded payments so they never credit the user balance.
let _pendingCheckRunning = false;
async function checkAllPendingDeposits() {
  if (_pendingCheckRunning) return;
  _pendingCheckRunning = true;
  try {
    if (!process.env.FLW_V3_SECRET_KEY) return;
    const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // 1. Check all pending PaymentLinkDeposit records
    const pendingPLs = await PaymentLinkDeposit.find({
      status: 'pending',
      createdAt: { $gte: since48h }
    }).limit(60);

    for (const dep of pendingPLs) {
      try {
        const verify = await flwAxios.get('/transactions/verify_by_reference', {
          params: { tx_ref: dep.txRef },
          timeout: 10000
        });
        const tx = verify.data?.data;
        if (tx) {
          const txStatus = String(tx.status || '').trim().toLowerCase();
          if (txStatus === 'successful' || txStatus === 'completed') {
            const expectedCurrency = String(dep.currency || 'NGN').toUpperCase();
            const gotCurrency = String(tx.currency || 'NGN').toUpperCase();
            const receivedAmt = Number(tx.charged_amount || tx.amount || 0);
            if (gotCurrency === expectedCurrency && receivedAmt >= (dep.amount * 0.98)) {
              console.log(`[Auto-Reconcile] Pending PaymentLink ${dep.txRef} succeeded on Flutterwave! Crediting user...`);
              await creditPaymentLinkDeposit(dep, tx);
            }
          } else if (txStatus === 'failed' || txStatus === 'cancelled') {
            console.log(`[Auto-Reconcile] Pending PaymentLink ${dep.txRef} failed on Flutterwave. Marking as failed.`);
            await PaymentLinkDeposit.updateOne(
              { _id: dep._id, status: 'pending' },
              { $set: { status: 'failed', rawPayload: tx } }
            );
          }
        }
      } catch (err) {
        if (err.response?.status === 404 && (Date.now() - new Date(dep.createdAt).getTime() > 24 * 60 * 60 * 1000)) {
          await PaymentLinkDeposit.updateOne({ _id: dep._id, status: 'pending' }, { $set: { status: 'failed', failureReason: 'expired_unpaid' } });
        }
      }
    }

    // 2. Check pending BankTransferDeposit records
    const pendingBTs = await BankTransferDeposit.find({
      status: 'pending',
      createdAt: { $gte: since48h }
    }).limit(50);

    for (const dep of pendingBTs) {
      try {
        const verify = await flwAxios.get('/transactions/verify_by_reference', {
          params: { tx_ref: dep.reference },
          timeout: 10000
        });
        const tx = verify.data?.data;
        if (tx) {
          const txStatus = String(tx.status || '').trim().toLowerCase();
          if (txStatus === 'successful' || txStatus === 'completed') {
            const claimed = await BankTransferDeposit.findOneAndUpdate(
              { _id: dep._id, status: 'pending' },
              { status: 'success', flwChargeId: String(tx.flw_ref || tx.id || '') },
              { new: true }
            );
            if (claimed) {
              const u = await User.findByIdAndUpdate(claimed.userId, { $inc: { balance: claimed.creditAmount } }, { new: true });
              await Transaction.create({
                userId: claimed.userId,
                type: 'deposit',
                amount: claimed.creditAmount,
                txRef: chargeKey(tx),
                description: `VA bank transfer deposit — ₦${claimed.creditAmount.toLocaleString('en-NG')} credited (auto-check) via ${claimed.bankName || 'bank transfer'}`,
                status: 'success'
              });
              if (u) pushBalanceToUser(claimed.userId, u.balance, claimed.creditAmount);
              console.log(`[Auto-Reconcile] Bank transfer ${dep.reference} confirmed and credited!`);
            }
          } else if (txStatus === 'failed' || txStatus === 'cancelled') {
            await BankTransferDeposit.updateOne({ _id: dep._id, status: 'pending' }, { $set: { status: 'failed' } });
          }
        }
      } catch (err) {
        if (dep.expiresAt && new Date() > dep.expiresAt) {
          await BankTransferDeposit.updateOne({ _id: dep._id, status: 'pending' }, { $set: { status: 'expired' } });
        }
      }
    }

    // 3. Check pending VirtualAccountDeposit records
    const pendingVAs = await VirtualAccountDeposit.find({
      status: 'pending',
      createdAt: { $gte: since48h }
    }).limit(50);

    for (const dep of pendingVAs) {
      try {
        const user = await User.findById(dep.userId);
        if (!user) continue;
        const out = await handleVaWebhookCredit(user, dep.rawPayload || { flw_ref: dep.flwRef, id: dep.flwTxId, amount: dep.amount, currency: 'NGN', status: 'successful' });
        if (out?.status === 'credited') {
          console.log(`[Auto-Reconcile] VirtualAccount deposit ${dep.flwRef} confirmed and credited!`);
        }
      } catch (err) {
        console.warn(`[Auto-Reconcile] Error checking VA deposit ${dep.flwRef}:`, err.message);
      }
    }
  } catch (e) {
    console.error('[Auto-Reconcile] checkAllPendingDeposits error:', e.message);
  } finally {
    _pendingCheckRunning = false;
  }
}

let _vaReconcileRunning = false;
async function reconcileVADeposits() {
 // Overlapping runs used to race each other (and the webhook) on the same
 // charge. One run at a time, always.
 if (_vaReconcileRunning) { console.log('[VA-reconcile] previous run still going — skipping this tick'); return; }
 _vaReconcileRunning = true;
 try {
 const settings = await getVASettings().catch(() => ({ globalEnabled: true }));
 if (!settings.globalEnabled) return;
 const from = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24 h
 const fromStr = from.toISOString().slice(0, 10);
 const toStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
 let page = 1, found = 0;
 while (page <= 5) { // cap at 5 pages (500 tx) to stay fast
 const res = await flwAxios.get('/transactions', {
 params: { from: fromStr, to: toStr, status: 'successful', currency: 'NGN', page, per_page: 100 },
 timeout: 12000
 });
 const list = res.data?.data || [];
 if (!list.length) break;
 for (const tx of list) {
 const isVA = tx.payment_type === 'account'
 || (tx.meta?.source || '').toLowerCase().includes('virtual')
 || tx.virtual_account_number;
 if (!isVA) continue;
 const flwRef = chargeKey(tx);
 if (!flwRef) continue;
 try {
 const already = await VirtualAccountDeposit.findOne({ flwRef }).select('_id');
 if (already) continue; // already credited
 if (await chargeBelongsToOtherChannel(tx)) continue; // payment link / bank transfer money
 let user = null;
 const vaNum = tx.virtual_account_number || tx.meta?.account_number || tx.meta?.accountNumber || tx.meta?.destinationAccountNumber;
 if (vaNum) user = await User.findOne({ 'virtualAccount.accountNumber': vaNum });
 if (!user) {
 const custEmail = (tx.customer?.email || '').trim().toLowerCase();
 // e-mail match is only accepted for a genuine virtual-account charge
 if (custEmail && (tx.payment_type === 'account' || tx.virtual_account_number)) {
 user = await User.findOne({ email: custEmail });
 }
 }
 if (!user || !user.virtualAccount?.enabled) continue;
 console.log(`[VA-reconcile] Crediting missed tx ${flwRef} for ${user.email} ₦${tx.amount}`);
 const out = await handleVaWebhookCredit(user, tx);
 if (out?.status === 'credited') found++;
 } catch (txErr) {
 // One bad charge must never abort the whole sweep.
 console.warn('[VA-reconcile] tx', flwRef, 'error:', txErr.message);
 }
 }
 if (list.length < 100) break; // last page
 page++;
 }
 if (found) console.log(`[VA-reconcile] Caught and credited ${found} missed VA payment(s)`);
 else console.log(`[VA-reconcile] No missed payments found`);
 } catch (e) {
 console.error('[VA-reconcile] error:', e.response?.data || e.message);
 } finally {
 _vaReconcileRunning = false;
 }
}
setTimeout(() => {
  reconcileVADeposits();
  checkAllPendingDeposits();
  setInterval(reconcileVADeposits, 60 * 1000);
  setInterval(checkAllPendingDeposits, 30 * 1000);
  setInterval(retryFailedNovaCancellations, 5 * 60 * 1000);
}, 5000);
// ═══ MACHINE TRANSLATION (whole-site language switch) ═════════════════════
// The phrase table in public/js/i18n.js covers the common UI strings instantly
// and offline. Anything it does not know is sent here in batches, translated
// once, then cached — in memory on the server and in localStorage in the
// browser — so a language switch translates every page, including copy that is
// rendered dynamically by script.js.
const I18N_CACHE = new Map();            // `${lang}\u0000${text}` -> translated
const I18N_MAX_ENTRIES = 20000;

async function translateOne(text, lang) {
  const key = lang + '\u0000' + text;
  if (I18N_CACHE.has(key)) return I18N_CACHE.get(key);
  let out = text;
  try {
    const r = await axios.get('https://translate.googleapis.com/translate_a/single', {
      params: { client: 'gtx', sl: 'en', tl: lang, dt: 't', q: text },
      timeout: 6000
    });
    const parts = (r.data && r.data[0]) || [];
    const joined = parts.map(p => (p && p[0]) || '').join('');
    if (joined.trim()) out = joined;
  } catch (e) { /* offline or rate-limited — fall back to English */ }
  if (I18N_CACHE.size > I18N_MAX_ENTRIES) I18N_CACHE.clear();
  I18N_CACHE.set(key, out);
  return out;
}

app.post('/api/i18n/translate', async (req, res) => {
  try {
    const lang = String(req.body?.lang || '').toLowerCase().slice(0, 5);
    const items = Array.isArray(req.body?.texts) ? req.body.texts : [];
    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(lang)) return res.status(400).json({ error: 'Bad language code' });
    if (lang === 'en') return res.json({ lang, translations: {} });
    const texts = items
      .map(t => String(t || '').trim())
      .filter(t => t && t.length <= 400)
      .slice(0, 80);
    const out = {};
    // Small concurrency so one big page never opens 80 sockets at once.
    for (let i = 0; i < texts.length; i += 8) {
      const chunk = texts.slice(i, i + 8);
      const done = await Promise.all(chunk.map(t => translateOne(t, lang)));
      chunk.forEach((t, k) => { out[t] = done[k]; });
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.json({ lang, translations: out });
  } catch (e) {
    res.status(500).json({ error: 'Translation service unavailable' });
  }
});

// ═══ GLOBAL PAYMENTS ══════════════════════════════════════════════════════
// Worldwide country directory, multi-currency quoting and per-user locale. See docs/API.md for the full endpoint reference.
const klsGlobalPay = require('./lib/global-payments')({
  app, express, mongoose, User, Transaction, auth,
  flwV4Axios, getOrCreateFlwCustomer, SystemError
});

// ═══ OPERATIONS LAYER ═════════════════════════════════════════════════════
// Wallet breakdown, admin deposit desk (search /
// manual retry / CSV + PDF export) and the webhook ledger with alerting.

/**
 * Manually re-run the confirmation for a single deposit, from any rail.
 * Always idempotent: a deposit that is already credited is reported as such
 * instead of being credited twice.
 */
async function retryDepositConfirmation(source, id) {
  if (source === 'paymentlink') {
    const dep = await PaymentLinkDeposit.findById(id);
    if (!dep) return { ok: false, message: 'Deposit not found' };
    if (dep.status === 'success') return { ok: true, credited: false, reference: dep.txRef, message: 'Already credited' };
    const verify = await flwAxios.get('/transactions/verify_by_reference', { params: { tx_ref: dep.txRef }, timeout: 15000 });
    const tx = verify.data?.data;
    if (!tx || tx.status !== 'successful') return { ok: true, credited: false, reference: dep.txRef, message: `Flutterwave reports status: ${tx?.status || 'not found'}` };
    await handlePaymentLinkWebhookCredit(dep, tx);
    const fresh = await PaymentLinkDeposit.findById(id).lean();
    return { ok: true, credited: fresh.status === 'success', creditNgn: dep.creditAmount, reference: dep.txRef, message: 'Confirmation re-run against Flutterwave' };
  }

  if (source === 'banktransfer') {
    const dep = await BankTransferDeposit.findById(id);
    if (!dep) return { ok: false, message: 'Deposit not found' };
    if (dep.status === 'success') return { ok: true, credited: false, reference: dep.reference, message: 'Already credited' };
    const verify = await flwAxios.get('/transactions/verify_by_reference', { params: { tx_ref: dep.reference }, timeout: 15000 });
    const tx = verify.data?.data;
    if (!tx || tx.status !== 'successful') return { ok: true, credited: false, reference: dep.reference, message: `Flutterwave reports status: ${tx?.status || 'not found'}` };
    const claimed = await BankTransferDeposit.findOneAndUpdate({ _id: dep._id, status: 'pending' }, { status: 'success', flwChargeId: String(tx.flw_ref || tx.id || '') }, { new: true });
    if (!claimed) return { ok: true, credited: false, reference: dep.reference, message: 'Another process credited it first' };
    const u = await User.findByIdAndUpdate(claimed.userId, { $inc: { balance: claimed.creditAmount } }, { new: true });
    await Transaction.create({ userId: claimed.userId, type: 'deposit', amount: claimed.creditAmount, description: `VA bank transfer deposit — manual retry (₦${claimed.creditAmount})`, status: 'success' });
    if (u) pushBalanceToUser(claimed.userId, u.balance);
    return { ok: true, credited: true, creditNgn: claimed.creditAmount, reference: claimed.reference, message: 'Credited on manual retry' };
  }

  if (source === 'virtualaccount') {
    const dep = await VirtualAccountDeposit.findById(id);
    if (!dep) return { ok: false, message: 'Deposit not found' };
    if (dep.status === 'success') return { ok: true, credited: false, reference: dep.flwRef, message: 'Already credited' };
    const user = await User.findById(dep.userId);
    if (!user) return { ok: false, message: 'Owner account no longer exists' };
    await handleVaWebhookCredit(user, dep.rawPayload || { flw_ref: dep.flwRef, id: dep.flwTxId, amount: dep.amount, currency: 'NGN', status: 'successful' });
    const fresh = await VirtualAccountDeposit.findById(id).lean();
    return { ok: true, credited: fresh.status === 'success', creditNgn: fresh.creditAmount, reference: dep.flwRef, message: 'Virtual account credit re-run' };
  }

  return { ok: false, message: 'Unknown deposit source' };
}

klsPlatform = require('./lib/platform')({
  app, express, mongoose, auth, adminAuth, anyAdminAuth,
  User, Transaction, SystemError,
  VirtualAccountDeposit, PaymentLinkDeposit, BankTransferDeposit,
  retryDeposit: retryDepositConfirmation,
});
klsGlobalPay.setPlatform(klsPlatform);

// ═══ ENGAGEMENT + ACCOUNT SECURITY ════════════════════════════════════════
// Password reset by emailed code, win-back emails for idle customers, daily
// and the logged-in device manager. See lib/engagement.js.
klsEngagement = require('./lib/engagement')({
  app, mongoose, User, Transaction, auth
});

// Email delivery dashboard, welcome emails, admin campaign controls and the
// referral reward that pays both sides on the new customer's first spend.
klsCampaigns = require('./lib/campaigns')({
  app, mongoose, User, Transaction, auth, anyAdminAuth, engagement: klsEngagement, AdminAccount
});

// ═══ SOCIAL MEDIA BOOSTING ════════════════════════════════════════════════
// Likes, followers and views resold through the Really Simple Social panel.
// Everything is namespaced under /api/boost + /api/admin/boost and can be
// switched off from the admin panel without touching any other feature.
let klsBoost = null;
try {
  klsBoost = require('./lib/boost')({
    app, mongoose, User, Transaction, auth, anyAdminAuth, SystemError, Announcement,
    // Unlocks the public developer endpoints /api/v1/boost/* (X-API-Key + X-API-Secret).
    apiKeyAuth
  });
} catch (boostErr) {
  console.error('[boost] module failed to load:', boostErr.message);
}

// ── Restock alerts ───────────────────────────────────────────────────────────
// Watches SMS server stock, the boost catalogue and every log/tool category.
// The moment something goes from empty to available, all users get a
// "Fully restocked — <category>" notification on the website.
try {
  require('./lib/restock-notify')({
    Announcement, NumberListing, Log,
    boostServiceModel: () => mongoose.models.BoostService || null,
  });
} catch (restockErr) {
  console.error('[restock] watcher failed to start:', restockErr.message);
}

/** Admin: post a restock alert by hand (e.g. after topping up a provider). */
app.post('/api/admin/restock-announce', anyAdminAuth, async (req, res) => {
  try {
    const label = String(req.body.category || '').trim();
    if (!label) return res.status(400).json({ error: 'category is required' });
    const link = /boost/i.test(label) ? '/boost'
      : /server|number|sms/i.test(label) ? '/buy-number' : '/marketplace';
    const ann = await Announcement.create({
      title: `Fully restocked — ${label}`,
      message: String(req.body.message || `${label} is fully restocked and available again.`),
      level: 'success',
      link, linkLabel: 'Open',
      active: true,
      createdBy: 'admin',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    res.json(ann);
  } catch (e) { res.status(500).json({ error: 'Failed to post restock alert' }); }
});


// ═══ 404 + SPA FALLBACK — MUST STAY LAST ══════════════════════════════════
// Anything under /api that reached this point genuinely does not exist, so it
// answers with JSON. Registering the HTML fallback ahead of an API route makes
// that route return a web page to fetch(), which is impossible to debug from
// the browser — keep this block at the very end of the file.
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `Unknown API endpoint: ${req.method} ${req.path}` });
});
app.get('*', (req, res) => {
  // Always hand back the freshly built HTML — no stale home page from a cache.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.type('html').send(renderIndexWithSeo(req.path));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(` KLS on :${PORT}`));
