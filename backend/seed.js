require('dotenv').config();
const mongoose = require('mongoose');
const { faker } = require('@faker-js/faker');

const User = require('./src/modules/users/user.model');
const Brand = require('./src/modules/brands/brand.model');
const BrandCatalogEntry = require('./src/modules/brandCatalog/brandCatalogEntry.model');
const SellerOffer = require('./src/modules/offers/sellerOffer.model');
const Product = require('./src/modules/products/product.model');
const Order = require('./src/modules/orders/order.model');
const Review = require('./src/modules/reviews/review.model');
const BrandEnrollment = require('./src/modules/brands/brandEnrollment.model');

const NUM_BRANDS = 30;
const NUM_RESELLERS = 1500;
const NUM_IND_SELLERS = 500;
const NUM_BUYERS = 5000;
const CATALOG_ENTRIES_PER_BRAND_MIN = 5;
const CATALOG_ENTRIES_PER_BRAND_MAX = 15;
const NUM_ORDERS = 15000;
const REVIEWS_PROBABILITY = 0.6; // 60% of orders get reviews

async function run() {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';
  try {
    console.log('Connecting to primary database...');
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 5000 });
    console.log('Connected to primary DB');
  } catch (err) {
    console.warn(`Primary DB connection failed: ${err.message}`);
    console.log(`Connecting to fallback local DB: ${fallbackUri}`);
    await mongoose.connect(fallbackUri);
    console.log('Connected to fallback DB');
  }

  console.log('Wiping database...');
  await User.deleteMany({});
  await Brand.deleteMany({});
  await BrandCatalogEntry.deleteMany({});
  await SellerOffer.deleteMany({});
  await Product.deleteMany({});
  await Order.deleteMany({});
  await Review.deleteMany({});
  await BrandEnrollment.deleteMany({});

  console.log('Generating Dev Users...');
  const admin = await User.create({ clerkId: 'mock_admin', email: 'admin@mock.com', firstName: 'Mock', lastName: 'Admin', role: 'admin', avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=Mock Admin` });
  const brandOwner = await User.create({ clerkId: 'mock_brand', email: 'brand@mock.com', firstName: 'Mock', lastName: 'Brand', role: 'brand', avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=Mock Brand` });
  const devSeller = await User.create({ clerkId: 'mock_seller', email: 'seller@mock.com', firstName: 'Mock', lastName: 'Seller', role: 'seller', storeName: 'Dev Store', storeDescription: 'Official dev testing store', averageRating: 0, totalReviewsReceived: 0, avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=Mock Seller` });
  const devBuyer = await User.create({ clerkId: 'mock_buyer', email: 'buyer@mock.com', firstName: 'Mock', lastName: 'Buyer', role: 'buyer', avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=Mock Buyer` });

  console.log(`Generating ${NUM_BRANDS} Brands...`);
  const brands = [];
  for (let i = 0; i < NUM_BRANDS; i++) {
    const name = faker.company.name();
    const brand = await Brand.create({
      name,
      ownerId: brandOwner._id,
      description: faker.company.catchPhrase(),
      logoUrl: faker.image.urlPicsumPhotos({ width: 200, height: 200, blur: 0, grayscale: false }),
      protectedKeywords: [name, faker.commerce.productMaterial()],
      category: faker.commerce.department(),
      isVerified: true
    });
    brands.push(brand);
  }

  console.log('Generating Catalog Entries...');
  const catalogEntries = [];
  for (const brand of brands) {
    const count = faker.number.int({ min: CATALOG_ENTRIES_PER_BRAND_MIN, max: CATALOG_ENTRIES_PER_BRAND_MAX });
    for (let i = 0; i < count; i++) {
      const entry = await BrandCatalogEntry.create({
        brandId: brand._id,
        sku: faker.string.alphanumeric(10).toUpperCase(),
        title: `${brand.name} ${faker.commerce.productName()}`,
        description: faker.commerce.productDescription(),
        bulletPoints: [
          faker.commerce.productAdjective(),
          faker.commerce.productAdjective(),
          faker.lorem.sentence()
        ],
        officialImages: [
          faker.image.urlPicsumPhotos({ width: 600, height: 600, blur: 0, grayscale: false }),
          faker.image.urlPicsumPhotos({ width: 600, height: 600, blur: 0, grayscale: false })
        ],
        category: brand.category,
        tags: [faker.commerce.productAdjective(), brand.name],
        isActive: true
      });
      catalogEntries.push(entry);
    }
  }

  console.log(`Generating ${NUM_RESELLERS + NUM_IND_SELLERS} Sellers...`);
  const resellers = [devSeller];
  const indSellers = [];
  const sellersBatch = [];
  for (let i = 0; i < NUM_RESELLERS - 1; i++) {
    sellersBatch.push({
      clerkId: faker.string.uuid(),
      email: `reseller${i}_${faker.internet.email()}`,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      role: 'seller',
      storeName: faker.company.name(),
      storeDescription: faker.company.catchPhrase(),
      averageRating: 0,
      totalReviewsReceived: 0
    });
  }
  const insertedResellers = await User.insertMany(sellersBatch);
  resellers.push(...insertedResellers);

  const indBatch = [];
  for (let i = 0; i < NUM_IND_SELLERS; i++) {
    indBatch.push({
      clerkId: faker.string.uuid(),
      email: `ind${i}_${faker.internet.email()}`,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      role: 'seller',
      storeName: faker.company.name() + ' Store',
      storeDescription: faker.company.catchPhrase(),
      averageRating: 0,
      totalReviewsReceived: 0
    });
  }
  const insertedIndSellers = await User.insertMany(indBatch);
  indSellers.push(...insertedIndSellers);

  console.log('Generating Brand Enrollments and Offers for Resellers...');
  const offersToInsert = [];
  const enrollmentsToInsert = [];
  
  for (const seller of resellers) {
    const numBrands = faker.number.int({ min: 1, max: 3 });
    const selectedBrands = faker.helpers.arrayElements(brands, numBrands);
    
    for (const brand of selectedBrands) {
      enrollmentsToInsert.push({
        brandId: brand._id,
        sellerId: seller._id,
        status: 'approved',
        appliedAt: faker.date.past(),
        reviewedAt: faker.date.recent()
      });

      const brandEntries = catalogEntries.filter(e => e.brandId.equals(brand._id));
      const entriesToSell = faker.helpers.arrayElements(brandEntries, faker.number.int({ min: 1, max: Math.min(brandEntries.length, 5) }));
      
      for (const entry of entriesToSell) {
        offersToInsert.push({
          catalogEntryId: entry._id,
          sellerId: seller._id,
          price: parseFloat(faker.commerce.price({ min: 10, max: 500 })),
          condition: faker.helpers.arrayElement(['New', 'Used', 'New']),
          quantity: faker.number.int({ min: 5, max: 100 }),
          status: 'active',
          isBuyBoxWinner: false
        });
      }
    }
  }
  await BrandEnrollment.insertMany(enrollmentsToInsert);
  
  const chunkSize = 1000;
  const insertedOffers = [];
  for (let i = 0; i < offersToInsert.length; i += chunkSize) {
    const chunk = offersToInsert.slice(i, i + chunkSize);
    const result = await SellerOffer.insertMany(chunk);
    insertedOffers.push(...result);
  }

  console.log('Recomputing Buy Box Winners...');
  const offerGroups = {};
  insertedOffers.forEach(o => {
    if (!offerGroups[o.catalogEntryId]) offerGroups[o.catalogEntryId] = [];
    offerGroups[o.catalogEntryId].push(o);
  });
  
  const updates = [];
  for (const entryId in offerGroups) {
    const group = offerGroups[entryId];
    const cheapest = group.sort((a, b) => a.price - b.price)[0];
    updates.push({
      updateOne: {
        filter: { _id: cheapest._id },
        update: { isBuyBoxWinner: true }
      }
    });
  }
  if (updates.length > 0) {
    await SellerOffer.bulkWrite(updates);
  }

  const catalogUpdates = [];
  for (const entryId in offerGroups) {
    catalogUpdates.push({
      updateOne: {
        filter: { _id: entryId },
        update: { activeOfferCount: offerGroups[entryId].length }
      }
    });
  }
  if(catalogUpdates.length > 0) {
    await BrandCatalogEntry.bulkWrite(catalogUpdates);
  }

  console.log('Generating Independent Products...');
  const productsToInsert = [];
  for (const seller of indSellers) {
    const numProducts = faker.number.int({ min: 1, max: 5 });
    for (let i = 0; i < numProducts; i++) {
      productsToInsert.push({
        title: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        price: parseFloat(faker.commerce.price({ min: 5, max: 200 })),
        category: faker.commerce.department(),
        images: [faker.image.urlPicsumPhotos({ width: 600, height: 600, blur: 0, grayscale: false })],
        brandName: '', // Completely unbranded/legit Generic product
        sellerId: seller._id,
        status: 'approved',
        condition: 'New'
      });
    }
  }
  const insertedProducts = await Product.insertMany(productsToInsert);

  console.log(`Generating ${NUM_BUYERS} Buyers...`);
  const newBuyersBatch = [];
  for (let i = 0; i < NUM_BUYERS - 1; i++) {
    newBuyersBatch.push({
      clerkId: faker.string.uuid(),
      email: `buyer${i}_${faker.internet.email()}`,
      firstName: faker.person.firstName(),
      lastName: faker.person.lastName(),
      role: 'buyer'
    });
  }
  const insertedBuyers = await User.insertMany(newBuyersBatch);
  const buyers = [devBuyer, ...insertedBuyers];

  console.log(`Generating ${NUM_ORDERS} Orders & Reviews...`);
  const ordersToInsert = [];
  const reviewsToInsert = [];
  
  const allSellableItems = [
    ...insertedOffers.map(o => ({ type: 'offer', item: o })),
    ...insertedProducts.map(p => ({ type: 'product', item: p }))
  ];

  const productSalesMap = {}; 

  const selectionPool = [];
  for (const sellable of allSellableItems) {
    let weight = 1;
    if (faker.number.float() < 0.2) weight = 10;
    for (let j = 0; j < weight; j++) {
      selectionPool.push(sellable);
    }
  }

  for (let i = 0; i < NUM_ORDERS; i++) {
    const buyer = faker.helpers.arrayElement(buyers);
    const sellable = faker.helpers.arrayElement(selectionPool);
    
    let productId = null;
    let catalogEntryId = null;
    let offerId = null;
    let sellerId = null;
    let price = 0;

    if (sellable.type === 'offer') {
      offerId = sellable.item._id;
      catalogEntryId = sellable.item.catalogEntryId;
      sellerId = sellable.item.sellerId;
      price = sellable.item.price;
      productId = catalogEntryId; 
    } else {
      productId = sellable.item._id;
      sellerId = sellable.item.sellerId;
      price = sellable.item.price;
    }

    const orderId = new mongoose.Types.ObjectId();
    const quantity = faker.number.int({ min: 1, max: 3 });

    ordersToInsert.push({
      _id: orderId,
      buyerId: buyer._id,
      sellerId: sellerId,
      productId: productId,
      catalogEntryId: catalogEntryId,
      offerId: offerId,
      quantity: quantity,
      totalPrice: price * quantity,
      status: 'completed',
      paymentDetails: {
        mockCreditCard: faker.finance.creditCardNumber()
      },
      createdAt: faker.date.recent({ days: 30 })
    });

    if (!productSalesMap[productId]) {
      productSalesMap[productId] = { totalSales: 0 };
    }
    productSalesMap[productId].totalSales += quantity;

    if (faker.number.float() < REVIEWS_PROBABILITY) {
      reviewsToInsert.push({
        productId: productId,
        buyerId: buyer._id,
        sellerId: sellerId,
        rating: faker.helpers.weightedArrayElement([
          { weight: 1, value: 1 },
          { weight: 1, value: 2 },
          { weight: 2, value: 3 },
          { weight: 6, value: 4 },
          { weight: 10, value: 5 }
        ]),
        title: faker.word.words({ min: 2, max: 6 }),
        text: faker.lorem.paragraph(),
        isVerifiedPurchase: true, // All legit for now
        isFlagged: false,
        deviceFingerprint: faker.string.uuid(),
        ipAddress: faker.internet.ipv4(),
        createdAt: faker.date.recent({ days: 20 })
      });
    }
  }

  const uniqueReviews = [];
  const reviewKeys = new Set();
  for (const review of reviewsToInsert) {
    const key = `${review.productId}_${review.buyerId}`;
    if (!reviewKeys.has(key)) {
      uniqueReviews.push(review);
      reviewKeys.add(key);
    }
  }

  for (let i = 0; i < ordersToInsert.length; i += chunkSize) {
    const chunk = ordersToInsert.slice(i, i + chunkSize);
    await Order.insertMany(chunk);
  }
  for (let i = 0; i < uniqueReviews.length; i += chunkSize) {
    const chunk = uniqueReviews.slice(i, i + chunkSize);
    await Review.insertMany(chunk);
  }

  console.log('Calculating Product Ratings & Sales...');
  const pUpdates = [];
  for (const pid in productSalesMap) {
    pUpdates.push({
      updateOne: {
        filter: { _id: pid },
        update: { totalSales: productSalesMap[pid].totalSales }
      }
    });
  }
  if (pUpdates.length > 0) {
    await Product.bulkWrite(pUpdates);
  }

  const reviewsList = await Review.find().lean();
  const productRatings = {};
  const sellerRatings = {};
  
  reviewsList.forEach(r => {
    if (!productRatings[r.productId]) productRatings[r.productId] = { sum: 0, count: 0 };
    productRatings[r.productId].sum += r.rating;
    productRatings[r.productId].count += 1;

    if (!sellerRatings[r.sellerId]) sellerRatings[r.sellerId] = { sum: 0, count: 0 };
    sellerRatings[r.sellerId].sum += r.rating;
    sellerRatings[r.sellerId].count += 1;
  });

  const ratingPUpdates = [];
  for (const pid in productRatings) {
    ratingPUpdates.push({
      updateOne: {
        filter: { _id: pid },
        update: { 
          averageRating: productRatings[pid].sum / productRatings[pid].count,
          reviewCount: productRatings[pid].count
        }
      }
    });
  }
  const ratingCUpdates = [];
  for (const pid in productRatings) {
    ratingCUpdates.push({
      updateOne: {
        filter: { _id: pid },
        update: { 
          averageRating: productRatings[pid].sum / productRatings[pid].count,
          reviewCount: productRatings[pid].count
        }
      }
    });
  }

  if (ratingPUpdates.length > 0) await Product.bulkWrite(ratingPUpdates);
  if (ratingCUpdates.length > 0) await BrandCatalogEntry.bulkWrite(ratingCUpdates);

  const sUpdates = [];
  for (const sid in sellerRatings) {
    sUpdates.push({
      updateOne: {
        filter: { _id: sid },
        update: {
          averageRating: sellerRatings[sid].sum / sellerRatings[sid].count,
          totalReviewsReceived: sellerRatings[sid].count
        }
      }
    });
  }
  if (sUpdates.length > 0) await User.bulkWrite(sUpdates);

  console.log('Seeding Complete! 🎉');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
