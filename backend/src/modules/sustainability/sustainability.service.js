const mongoose = require('mongoose');
const SustainabilityImpact = require('./sustainability.model');
const GreenCreditLedger = require('./greenCredit.model');
const Ngo = require('./ngo.model');
const Item = require('../items/item.model');

let ItemLogger;
try {
  ItemLogger = require('../../utils/itemLogger');
} catch (_) {
  ItemLogger = { log: async () => {} };
}

/**
 * Category CO2/water factors — the footprint of MANUFACTURING ONE NEW item in
 * this category. Diverting an item from landfill into reuse displaces that
 * footprint. Each row cites its source. Figures are estimates, not audited LCAs.
 */
const CATEGORY_FACTORS = {
  clothing:    { co2PerItem: 20.0, waterPerItem: 2700, source: 'WRAP / INTEXTER (≈25 kg CO2/kg textile; 2700 L per cotton T-shirt)' },
  footwear:    { co2PerItem: 14.0, waterPerItem: 8000, source: 'Quantis World Apparel & Footwear LCA 2018' },
  electronics: { co2PerItem: 30.0, waterPerItem: 500,  source: 'Apple/Dell product carbon reports (avg consumer electronics)' },
  furniture:   { co2PerItem: 40.0, waterPerItem: 200,  source: 'EU JRC furniture LCA estimates' },
  books:       { co2PerItem: 2.5,  waterPerItem: 50,   source: 'Carbon Trust paper/print estimates' },
  default:     { co2PerItem: 10.0, waterPerItem: 500,  source: 'Cross-category average (estimate)' },
};

/**
 * Diversion factor by disposition — how fully the action displaces new manufacture.
 */
const DIVERSION_FACTOR = {
  resale_sale: 1.0,
  donation: 1.0,
  liquidate: 0.1,
};

// Green credit amounts (single source of truth).
const CREDITS = {
  RESALE_SALE_BUYER: 10,
  RESALE_SALE_SELLER: 10,
  DONATION: 25,
};

// 1 credit = ₹10 discount at checkout.
const CREDIT_TO_RUPEE = 10;

const resolveFactors = (category) => {
  const key = (category || '').toString().trim().toLowerCase();
  return CATEGORY_FACTORS[key] || CATEGORY_FACTORS.default;
};

// ── Green credit ledger ────────────────────────────────────────────────────

/**
 * Current balance = the latest entry's snapshot, else sum of deltas, else 0.
 */
const getBalance = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) return 0;
  const latest = await GreenCreditLedger.findOne({ userId }).sort({ createdAt: -1 }).lean();
  if (latest) return latest.balanceAfter;
  return 0;
};

/**
 * Append a ledger entry and return the new balance. Negative delta = redemption.
 * Balance can never go below 0.
 */
const awardCredits = async (userId, delta, reason, { itemId = null, orderId = null } = {}) => {
  if (!mongoose.isValidObjectId(userId)) return null;
  const current = await getBalance(userId);
  const balanceAfter = Math.max(0, current + delta);
  await GreenCreditLedger.create({ userId, delta, reason, itemId, orderId, balanceAfter });
  return balanceAfter;
};

// ── Impact computation (idempotent per item) ────────────────────────────────

/**
 * Compute and persist the CO2/water savings for an item's disposition. Idempotent:
 * if an impact record already exists for the item it is returned unchanged.
 *
 * @param {Object} args
 * @param {ObjectId} args.itemId
 * @param {String}  args.category
 * @param {ObjectId} args.beneficiaryUserId   buyer for sales, donor for donations
 * @param {String}  args.eventType            resale_sale | donation | liquidate
 * @param {Number}  [args.creditsEarned]      credits attributed to this record (for display)
 */
const computeImpact = async ({ itemId, category, beneficiaryUserId, eventType, creditsEarned = 0 }) => {
  const existing = await SustainabilityImpact.findOne({ itemId }).lean();
  if (existing) return existing;

  const factors = resolveFactors(category);
  const diversion = DIVERSION_FACTOR[eventType] ?? 1.0;
  const co2SavedKg = Math.round(factors.co2PerItem * diversion * 100) / 100;
  const waterSavedLiters = Math.round(factors.waterPerItem * diversion);

  try {
    const doc = await SustainabilityImpact.create({
      itemId,
      userId: beneficiaryUserId || null,
      category: category || 'general',
      co2SavedKg,
      waterSavedLiters,
      greenCreditsEarned: creditsEarned,
      factorSource: factors.source,
      eventType,
    });
    return doc.toObject();
  } catch (err) {
    // Unique-index race → another process computed it first; return that one.
    if (err.code === 11000) {
      return SustainabilityImpact.findOne({ itemId }).lean();
    }
    throw err;
  }
};

// ── Disposition triggers ─────────────────────────────────────────────────────

/**
 * Resale sale: award the buyer AND the seller, record impact, append SOLD.
 * Called (defensively) from order.service when a resale mirror product is bought.
 *
 * @param {Object} args
 * @param {Object} args.resaleListing  lean ResaleListing
 * @param {Object} args.order          the created Order
 */
const recordResaleSale = async ({ resaleListing, order }) => {
  const itemId = resaleListing.itemId;
  const category = resaleListing.category || 'general';

  const impact = await computeImpact({
    itemId,
    category,
    beneficiaryUserId: order.buyerId,
    eventType: 'resale_sale',
    creditsEarned: CREDITS.RESALE_SALE_BUYER,
  });

  const buyerBalance = await awardCredits(order.buyerId, CREDITS.RESALE_SALE_BUYER, 'resale_sale_buyer', {
    itemId,
    orderId: order._id,
  });
  if (resaleListing.sellerId) {
    await awardCredits(resaleListing.sellerId, CREDITS.RESALE_SALE_SELLER, 'resale_sale_seller', {
      itemId,
      orderId: order._id,
    });
  }

  // Mark listing sold + walk the item to SOLD (best-effort).
  try {
    const ResaleListing = require('../resale/resale.model');
    await ResaleListing.findByIdAndUpdate(resaleListing._id, { status: 'SOLD' });
  } catch (_) {}

  try {
    const lifecycleService = require('../lifecycle/lifecycle.service');
    await lifecycleService.appendEvent(itemId, 'SOLD', { role: 'system' }, { orderId: String(order._id) });
    await Item.findByIdAndUpdate(itemId, { status: 'SOLD' });
  } catch (_) {}

  await ItemLogger.log(
    itemId,
    'SUSTAINABILITY',
    `🌱 Resale sold — buyer +${CREDITS.RESALE_SALE_BUYER}, seller +${CREDITS.RESALE_SALE_SELLER} credits; ${impact.co2SavedKg} kg CO₂ saved`,
    { co2SavedKg: impact.co2SavedKg, waterSavedLiters: impact.waterSavedLiters }
  ).catch(() => {});

  return { impact, buyerBalance, creditsBuyer: CREDITS.RESALE_SALE_BUYER, creditsSeller: CREDITS.RESALE_SALE_SELLER };
};

/**
 * Donation: match nearest NGO, record impact, award donor, generate receipt,
 * append DONATED, unlist any resale draft.
 *
 * @param {Object} args
 * @param {ObjectId} args.itemId
 * @param {ObjectId} args.donorId
 * @param {{lng:Number, lat:Number}} [args.location]  donor location for NGO match
 */
const recordDonation = async ({ itemId, donorId, location }) => {
  const item = await Item.findById(itemId).lean();
  if (!item) throw new Error('Item not found');

  const category = item.category || 'general';
  const ngo = await matchNearestNgo(category, location);

  const impact = await computeImpact({
    itemId,
    category,
    beneficiaryUserId: donorId,
    eventType: 'donation',
    creditsEarned: CREDITS.DONATION,
  });

  const donorBalance = await awardCredits(donorId, CREDITS.DONATION, 'donation', { itemId });

  // Estimated fair-market value for the receipt (rough: half of original price if known).
  const fairMarketValue = await estimateFairMarketValue(item);

  const receipt = await generateReceipt({ item, donorId, ngo, fairMarketValue });

  // Append lifecycle + move item to DONATED.
  try {
    const lifecycleService = require('../lifecycle/lifecycle.service');
    await lifecycleService.appendEvent(
      itemId,
      'DONATED',
      { userId: donorId, role: 'ngo' },
      { ngoId: ngo?._id ? String(ngo._id) : null, receiptId: receipt.receiptId }
    );
    await Item.findByIdAndUpdate(itemId, { status: 'DONATED' });
  } catch (_) {}

  // Unlist any resale draft/listing for this item.
  try {
    const ResaleListing = require('../resale/resale.model');
    await ResaleListing.updateOne(
      { itemId, status: { $in: ['DRAFT', 'PUBLISHED'] } },
      { status: 'UNLISTED' }
    );
  } catch (_) {}

  await ItemLogger.log(
    itemId,
    'SUSTAINABILITY',
    `🎁 Donated to ${ngo ? ngo.name : 'NGO'} — donor +${CREDITS.DONATION} credits; ${impact.co2SavedKg} kg CO₂ saved`,
    { ngo: ngo?.name, receiptId: receipt.receiptId }
  ).catch(() => {});

  return { impact, donorBalance, creditsEarned: CREDITS.DONATION, ngo, receipt, fairMarketValue };
};

const estimateFairMarketValue = async (item) => {
  try {
    if (item.originalProductId) {
      const Product = require('../products/product.model');
      const p = await Product.findById(item.originalProductId).select('price').lean();
      if (p?.price) return Math.round(p.price * 0.5);
    }
  } catch (_) {}
  return 0;
};

// ── NGO matching ─────────────────────────────────────────────────────────────

// Default demo coordinate (Raipur, Chhattisgarh) when the donor has no location.
const DEFAULT_LOCATION = { lng: 81.6296, lat: 21.2514 };

/**
 * Nearest active NGO that accepts the category (or accepts all). Uses $geoNear.
 * Falls back to any active NGO if geo yields nothing.
 */
const matchNearestNgo = async (category, location) => {
  const loc = location && Number.isFinite(location.lng) && Number.isFinite(location.lat) ? location : DEFAULT_LOCATION;
  const cat = (category || '').toString().trim().toLowerCase();

  try {
    const results = await Ngo.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [loc.lng, loc.lat] },
          distanceField: 'distanceMeters',
          spherical: true,
          query: {
            active: true,
            $or: [{ categoriesAccepted: { $size: 0 } }, { categoriesAccepted: cat }],
          },
        },
      },
      { $limit: 1 },
    ]);
    if (results.length > 0) return results[0];
  } catch (_) {
    /* geo index missing or other error → fall through */
  }

  return Ngo.findOne({ active: true }).lean();
};

// ── Tax receipt (PDF) ────────────────────────────────────────────────────────

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const RECEIPT_DIR = path.join(__dirname, '../../../uploads/receipts');

/**
 * Generate a signed (SHA-256 placeholder — TODO(KMS)) tax-receipt PDF and write
 * it to disk. Returns { receiptId, url, signature }.
 */
const generateReceipt = async ({ item, donorId, ngo, fairMarketValue }) => {
  const receiptId = `RC-${Date.now()}-${String(item._id).slice(-6)}`;
  const issuedAt = new Date();

  // Build a canonical payload and sign it (SHA-256 placeholder for KMS/Ed25519).
  const payload = {
    receiptId,
    itemId: String(item._id),
    donorId: String(donorId),
    ngo: ngo ? ngo.name : 'Unassigned NGO',
    category: item.category || 'general',
    fairMarketValue,
    issuedAt: issuedAt.toISOString(),
  };
  const signature = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'); // TODO(KMS): replace with Ed25519 KMS signature

  const filePath = path.join(RECEIPT_DIR, `${receiptId}.pdf`);
  try {
    if (!fs.existsSync(RECEIPT_DIR)) fs.mkdirSync(RECEIPT_DIR, { recursive: true });
    await writePdf(filePath, { payload, signature });
  } catch (err) {
    // PDF generation is non-fatal — the donation still succeeds.
    console.warn(`[sustainability] receipt PDF generation failed: ${err.message}`);
    return { receiptId, url: null, signature };
  }

  return { receiptId, url: `/api/sustainability/receipt/${item._id}`, signature, filePath };
};

const writePdf = (filePath, { payload, signature }) =>
  new Promise((resolve, reject) => {
    let PDFDocument;
    try {
      PDFDocument = require('pdfkit');
    } catch (e) {
      return reject(new Error('pdfkit not installed'));
    }
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);

    doc.fontSize(20).text('Donation Tax Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).fillColor('#555').text('Second-Life Commerce — Sustainability Program', { align: 'center' });
    doc.moveDown(2);

    doc.fillColor('#000').fontSize(12);
    const row = (label, value) => doc.text(`${label}: `, { continued: true }).font('Helvetica-Bold').text(String(value)).font('Helvetica');
    doc.font('Helvetica');
    row('Receipt ID', payload.receiptId);
    row('Issued', new Date(payload.issuedAt).toLocaleString());
    row('Donated to', payload.ngo);
    row('Item category', payload.category);
    row('Estimated fair-market value', `₹${payload.fairMarketValue}`);
    doc.moveDown();
    doc.fontSize(9).fillColor('#777').text(
      'This receipt certifies an in-kind donation routed through the platform. Estimated value is indicative, not an audited appraisal.',
      { align: 'left' }
    );
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#999').text(`Signature (SHA-256): ${signature}`, { align: 'left' });
    doc.fontSize(8).fillColor('#999').text('Cryptographic KMS/Ed25519 signing: pending (TODO).');

    doc.end();
  });

const getReceiptPath = (receiptId) => path.join(RECEIPT_DIR, `${receiptId}.pdf`);

// ── Redemption ────────────────────────────────────────────────────────────────

/**
 * Redeem credits for a ₹ discount. Returns { discount, balanceAfter }.
 * Caps redemption at the requested amount AND the available balance.
 */
const redeemCredits = async (userId, amount, { orderId = null, maxDiscount = Infinity } = {}) => {
  const want = Math.max(0, Math.floor(Number(amount) || 0));
  if (want === 0) return { discount: 0, balanceAfter: await getBalance(userId) };

  const balance = await getBalance(userId);
  const creditsToSpend = Math.min(want, balance, Math.floor(maxDiscount / CREDIT_TO_RUPEE));
  if (creditsToSpend <= 0) return { discount: 0, balanceAfter: balance };

  const balanceAfter = await awardCredits(userId, -creditsToSpend, 'redeem_checkout', { orderId });
  return { discount: creditsToSpend * CREDIT_TO_RUPEE, creditsSpent: creditsToSpend, balanceAfter };
};

// ── Summaries ─────────────────────────────────────────────────────────────────

const getUserImpactSummary = async (userId) => {
  if (!mongoose.isValidObjectId(userId)) {
    return { totalCo2Kg: 0, totalWaterL: 0, creditBalance: 0, itemCount: 0, recentLedger: [] };
  }
  const uid = new mongoose.Types.ObjectId(userId);

  const [agg] = await SustainabilityImpact.aggregate([
    { $match: { userId: uid } },
    {
      $group: {
        _id: null,
        totalCo2Kg: { $sum: '$co2SavedKg' },
        totalWaterL: { $sum: '$waterSavedLiters' },
        itemCount: { $sum: 1 },
      },
    },
  ]);

  const [creditBalance, recentLedger] = await Promise.all([
    getBalance(userId),
    GreenCreditLedger.find({ userId: uid }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  return {
    totalCo2Kg: Math.round((agg?.totalCo2Kg || 0) * 100) / 100,
    totalWaterL: agg?.totalWaterL || 0,
    creditBalance,
    itemCount: agg?.itemCount || 0,
    recentLedger,
  };
};

const getPlatformImpactSummary = async () => {
  const [agg] = await SustainabilityImpact.aggregate([
    {
      $group: {
        _id: null,
        totalCo2Kg: { $sum: '$co2SavedKg' },
        totalWaterL: { $sum: '$waterSavedLiters' },
        totalCredits: { $sum: '$greenCreditsEarned' },
        itemCount: { $sum: 1 },
      },
    },
  ]);
  return {
    totalCo2Kg: Math.round((agg?.totalCo2Kg || 0) * 100) / 100,
    totalWaterL: agg?.totalWaterL || 0,
    totalCredits: agg?.totalCredits || 0,
    itemCount: agg?.itemCount || 0,
  };
};

const getItemImpact = async (itemId) => {
  if (!mongoose.isValidObjectId(itemId)) return null;
  return SustainabilityImpact.findOne({ itemId }).lean();
};

/**
 * Full donation summary for an item (survives reload) — NGO, credits, impact,
 * receipt availability. Returns null if the item was never donated.
 */
const getDonationDetails = async (itemId) => {
  if (!mongoose.isValidObjectId(itemId)) return null;

  const LifecycleEvent = require('../lifecycle/lifecycle.model');
  const event = await LifecycleEvent.findOne({ itemId, eventType: 'DONATED' })
    .sort({ sequence: -1 })
    .lean();
  if (!event) return null;

  const [impact, ngo] = await Promise.all([
    SustainabilityImpact.findOne({ itemId }).lean(),
    event.data?.ngoId ? Ngo.findById(event.data.ngoId).lean() : null,
  ]);

  const receiptId = event.data?.receiptId || null;
  const receiptAvailable = receiptId ? fs.existsSync(getReceiptPath(receiptId)) : false;

  return {
    donatedAt: event.timestamp,
    ngo: ngo ? { name: ngo.name, city: ngo.city, contact: ngo.contact } : null,
    creditsEarned: impact?.greenCreditsEarned ?? CREDITS.DONATION,
    co2SavedKg: impact?.co2SavedKg ?? 0,
    waterSavedLiters: impact?.waterSavedLiters ?? 0,
    factorSource: impact?.factorSource || '',
    receiptAvailable,
  };
};

module.exports = {
  CATEGORY_FACTORS,
  CREDITS,
  CREDIT_TO_RUPEE,
  computeImpact,
  awardCredits,
  getBalance,
  recordResaleSale,
  recordDonation,
  matchNearestNgo,
  redeemCredits,
  getUserImpactSummary,
  getPlatformImpactSummary,
  getItemImpact,
  getDonationDetails,
  getReceiptPath,
};
