require('dotenv').config();
const mongoose = require('mongoose');

const Product = require('./src/modules/products/product.model');
const BrandCatalogEntry = require('./src/modules/brandCatalog/brandCatalogEntry.model');
const Brand = require('./src/modules/brands/brand.model');

const primaryUri = process.env.MONGODB_URI;
const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';

function convertUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('loremflickr.com')) return url;
  
  const match = url.match(/https:\/\/loremflickr\.com\/(\d+)\/(\d+)\/[a-zA-Z0-9_-]+(?:\?lock=(\d+))?/);
  if (match) {
    const width = match[1];
    const height = match[2];
    const lock = match[3] || Math.floor(Math.random() * 100000000).toString();
    return `https://picsum.photos/seed/${lock}/${width}/${height}`;
  }
  
  return url.replace('loremflickr.com', 'picsum.photos');
}

async function run() {
  try {
    console.log('Connecting to primary database...');
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    console.warn(`Primary DB connection failed: ${err.message}`);
    await mongoose.connect(fallbackUri);
  }
  console.log('Connected to DB');

  const brands = await Brand.find({ logoUrl: { $regex: 'loremflickr.com' } });
  let brandUpdates = 0;
  for (const b of brands) {
    b.logoUrl = convertUrl(b.logoUrl);
    await b.save();
    brandUpdates++;
  }
  console.log(`Updated ${brandUpdates} brands.`);

  const entries = await BrandCatalogEntry.find({ officialImages: { $regex: 'loremflickr.com' } });
  let entryUpdates = 0;
  for (const e of entries) {
    e.officialImages = e.officialImages.map(convertUrl);
    await e.save();
    entryUpdates++;
  }
  console.log(`Updated ${entryUpdates} catalog entries.`);

  const products = await Product.find({ images: { $regex: 'loremflickr.com' } });
  let productUpdates = 0;
  for (const p of products) {
    p.images = p.images.map(convertUrl);
    await p.save();
    productUpdates++;
  }
  console.log(`Updated ${productUpdates} products.`);

  console.log('Migration complete.');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
