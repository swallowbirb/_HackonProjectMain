require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./src/modules/products/product.model');
const BrandCatalogEntry = require('./src/modules/brandCatalog/brandCatalogEntry.model');

async function test() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/marketplace');
  const p = await Product.findOne({ images: { $exists: true, $ne: [] } }).lean();
  const c = await BrandCatalogEntry.findOne({ officialImages: { $exists: true, $ne: [] } }).lean();
  console.log('Product images:', p ? p.images : 'None');
  console.log('Catalog entry officialImages:', c ? c.officialImages : 'None');
  process.exit(0);
}
test().catch(console.error);
