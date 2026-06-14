require('dotenv').config();
const mongoose = require('mongoose');

const primaryUri = process.env.MONGODB_URI;
const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';

const connect = async () => {
  try {
    return await mongoose.connect(primaryUri, { serverSelectionTimeoutMS: 5000 });
  } catch (err) {
    console.warn(`Primary connection failed: ${err.message}. Connecting to fallback.`);
    return await mongoose.connect(fallbackUri);
  }
};

connect()
  .then(async () => {
    const Product = require('./src/modules/products/product.model');
    console.log('Running bulk update to remove "Generic " prefix...');
    
    const res = await Product.updateMany(
      { title: /^Generic / },
      [
        {
          $set: {
            title: {
              $replaceOne: {
                input: "$title",
                find: "Generic ",
                replacement: ""
              }
            }
          }
        }
      ]
    );
    
    console.log('Bulk update completed:', res);
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
