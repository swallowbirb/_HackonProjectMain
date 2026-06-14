// Additive product seeder — adds N products WITHOUT wiping any existing data.
// Safe to run alongside other seed data (grading/returns/etc. are untouched).
//
//   node seed-products.js            -> adds 500 products (default)
//   node seed-products.js 250        -> adds 250 products
//
require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // force Google DNS so Atlas SRV lookups resolve
const mongoose = require('mongoose');
const { faker } = require('@faker-js/faker');

const User = require('./src/modules/users/user.model');
const Product = require('./src/modules/products/product.model');

// How many products to add (CLI arg overrides the default).
const COUNT = Number(process.argv[2]) || 500;

// Categories must match the frontend's category list so search/filter works.
const CATEGORIES = [
  'Electronics', 'Clothing', 'Home & Garden', 'Sports',
  'Toys', 'Books', 'Automotive', 'Health & Beauty',
];

async function connect() {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';
  try {
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to primary DB');
  } catch (err) {
    console.warn(`Primary DB connection failed: ${err.message}`);
    console.log(`Connecting to fallback local DB: ${fallbackUri}`);
    await mongoose.connect(fallbackUri);
    console.log('Connected to fallback DB');
  }
}

// Reuse existing sellers; only create a small pool if the DB has none.
async function getSellers() {
  const existing = await User.find({ role: 'seller' }).select('_id').lean();
  if (existing.length > 0) {
    console.log(`Reusing ${existing.length} existing seller(s).`);
    return existing.map((s) => s._id);
  }

  console.log('No sellers found — creating 10 placeholder sellers.');
  const batch = Array.from({ length: 10 }, () => ({
    clerkId: faker.string.uuid(),
    email: faker.internet.email(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    role: 'seller',
    storeName: `${faker.company.name()} Store`,
    storeDescription: faker.company.catchPhrase(),
  }));
  const created = await User.insertMany(batch);
  return created.map((s) => s._id);
}

async function run() {
  await connect();

  const sellerIds = await getSellers();
  console.log(`Generating ${COUNT} products...`);

  const products = Array.from({ length: COUNT }, () => {
    // ~60% carry reviews, ~30% are "best sellers" (totalSales > 50).
    const hasReviews = faker.datatype.boolean({ probability: 0.6 });
    const reviewCount = hasReviews ? faker.number.int({ min: 1, max: 400 }) : 0;
    const averageRating = hasReviews
      ? faker.number.float({ min: 3.4, max: 5, fractionDigits: 1 })
      : 0;

    return {
      title: faker.commerce.productName(),
      description: faker.commerce.productDescription(),
      price: parseFloat(faker.commerce.price({ min: 5, max: 800 })),
      category: faker.helpers.arrayElement(CATEGORIES),
      images: [faker.image.urlPicsumPhotos({ width: 600, height: 600 })],
      brandName: '',
      sellerId: faker.helpers.arrayElement(sellerIds),
      status: 'approved',
      condition: faker.helpers.arrayElement(['New', 'New', 'Used']),
      averageRating,
      reviewCount,
      totalSales: faker.number.int({ min: 0, max: 250 }),
    };
  });

  // Insert in chunks to keep memory/throughput sane.
  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize);
    await Product.insertMany(chunk);
    inserted += chunk.length;
    console.log(`  inserted ${inserted}/${COUNT}`);
  }

  const total = await Product.countDocuments({ status: { $in: ['published', 'approved'] } });
  console.log(`Done. Added ${COUNT} products. Total visible products now: ${total}.`);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
