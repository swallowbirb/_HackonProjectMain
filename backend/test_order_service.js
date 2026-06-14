require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';
  try {
    await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    console.warn(`Primary connection failed: ${err.message}. Connecting to fallback.`);
    await mongoose.connect(fallbackUri);
  }
  const User = require('./src/modules/users/user.model');
  const Product = require('./src/modules/products/product.model');
  const orderService = require('./src/modules/orders/order.service');

  const buyer = await User.findOne({ role: 'buyer' });
  const product = await Product.findOne({});

  if (!buyer || !product) {
    console.log('No buyer or product found');
    process.exit(1);
  }

  try {
    const order = await orderService.createOrder({
      buyerId: buyer._id,
      productId: product._id,
      quantity: 1,
      mockCreditCard: '1234'
    });
    console.log('Success!', order);
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit(0);
}

run();
