require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');
const User = require('./src/modules/users/user.model');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const mockUsers = [
    { clerkId: 'mock_admin',  email: 'admin@mock.com',  firstName: 'Mock', lastName: 'Admin',  role: 'admin',  avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Mock Admin' },
    { clerkId: 'mock_brand',  email: 'brand@mock.com',  firstName: 'Mock', lastName: 'Brand',  role: 'brand',  avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Mock Brand' },
    { clerkId: 'mock_seller', email: 'seller@mock.com', firstName: 'Mock', lastName: 'Seller', role: 'seller', storeName: 'Dev Store', storeDescription: 'Official dev testing store', averageRating: 0, totalReviewsReceived: 0, avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Mock Seller' },
    { clerkId: 'mock_buyer',  email: 'buyer@mock.com',  firstName: 'Mock', lastName: 'Buyer',  role: 'buyer',  avatarUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Mock Buyer' },
  ];

  for (const u of mockUsers) {
    await User.findOneAndUpdate({ clerkId: u.clerkId }, u, { upsert: true, new: true });
    console.log(`✅ Upserted: ${u.clerkId}`);
  }

  console.log('Done!');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
