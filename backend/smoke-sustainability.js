/**
 * smoke-sustainability.js — quick end-to-end check of the Phase 8 service logic
 * against the DB (no HTTP). Creates a throwaway user + item, runs donation +
 * resale-sale + redeem, prints results, then cleans up. Safe to re-run.
 */
require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Item = require('./src/modules/items/item.model');
const SustainabilityImpact = require('./src/modules/sustainability/sustainability.model');
const GreenCreditLedger = require('./src/modules/sustainability/greenCredit.model');
const svc = require('./src/modules/sustainability/sustainability.service');

async function connect() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  } catch (e) {
    await mongoose.connect('mongodb://127.0.0.1:27017/marketplace');
  }
}

async function run() {
  await connect();
  const tag = `smoke_p8_${Date.now()}`;

  const donor = await User.create({ clerkId: `${tag}_donor`, email: `${tag}+donor@x.com`, role: 'buyer', firstName: 'Donor' });
  const buyer = await User.create({ clerkId: `${tag}_buyer`, email: `${tag}+buyer@x.com`, role: 'buyer', firstName: 'Buyer' });
  const seller = await User.create({ clerkId: `${tag}_seller`, email: `${tag}+seller@x.com`, role: 'seller', firstName: 'Seller' });

  const donateItem = await Item.create({ intakePath: 'sell-used', initiatorUserId: donor._id, category: 'footwear', status: 'GRADED' });
  const saleItem = await Item.create({ intakePath: 'return', initiatorUserId: seller._id, category: 'clothing', status: 'LISTED' });

  console.log('\n=== DONATION ===');
  const don = await svc.recordDonation({ itemId: donateItem._id, donorId: donor._id });
  console.log('NGO matched   :', don.ngo?.name);
  console.log('CO2 saved     :', don.impact.co2SavedKg, 'kg  | water:', don.impact.waterSavedLiters, 'L');
  console.log('Donor credits :', don.donorBalance, `(should be ${svc.CREDITS.DONATION})`);
  console.log('Receipt       :', don.receipt.receiptId, '| file?', !!don.receipt.filePath);

  console.log('\n=== RESALE SALE ===');
  const fakeListing = { _id: new mongoose.Types.ObjectId(), itemId: saleItem._id, category: 'clothing', sellerId: seller._id };
  const fakeOrder = { _id: new mongoose.Types.ObjectId(), buyerId: buyer._id };
  const sale = await svc.recordResaleSale({ resaleListing: fakeListing, order: fakeOrder });
  console.log('CO2 saved     :', sale.impact.co2SavedKg, 'kg');
  console.log('Buyer balance :', sale.buyerBalance, `(should be ${svc.CREDITS.RESALE_SALE_BUYER})`);
  console.log('Seller balance:', await svc.getBalance(seller._id), `(should be ${svc.CREDITS.RESALE_SALE_SELLER})`);

  console.log('\n=== IDEMPOTENCY (re-run donation) ===');
  const dupCountBefore = await SustainabilityImpact.countDocuments({ itemId: donateItem._id });
  await svc.computeImpact({ itemId: donateItem._id, category: 'footwear', beneficiaryUserId: donor._id, eventType: 'donation' });
  const dupCountAfter = await SustainabilityImpact.countDocuments({ itemId: donateItem._id });
  console.log('impact docs before/after:', dupCountBefore, '/', dupCountAfter, '(should stay 1)');

  console.log('\n=== REDEEM ===');
  const redeem = await svc.redeemCredits(buyer._id, 5, {});
  console.log('Discount      : ₹', redeem.discount, '| balance after:', redeem.balanceAfter, '(10 - 5 = 5)');
  const overRedeem = await svc.redeemCredits(buyer._id, 999, {});
  console.log('Over-redeem   : ₹', overRedeem.discount, '| balance after:', overRedeem.balanceAfter, '(capped at balance 5 → 0)');

  console.log('\n=== USER SUMMARY (donor) ===');
  console.log(await svc.getUserImpactSummary(donor._id));

  console.log('\n=== PLATFORM SUMMARY ===');
  console.log(await svc.getPlatformImpactSummary());

  // Cleanup
  const ids = [donor._id, buyer._id, seller._id];
  await GreenCreditLedger.deleteMany({ userId: { $in: ids } });
  await SustainabilityImpact.deleteMany({ itemId: { $in: [donateItem._id, saleItem._id] } });
  await Item.deleteMany({ _id: { $in: [donateItem._id, saleItem._id] } });
  await User.deleteMany({ _id: { $in: ids } });

  await mongoose.disconnect();
  console.log('\nDone. Cleaned up + disconnected.');
}

run().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
