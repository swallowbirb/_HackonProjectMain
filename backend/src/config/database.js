const mongoose = require('mongoose');

const connectDB = async () => {
  const primaryUri = process.env.MONGODB_URI;
  const fallbackUri = 'mongodb://127.0.0.1:27017/marketplace';

  try {
    console.log('Connecting to primary database...');
    const conn = await mongoose.connect(primaryUri, {
      serverSelectionTimeoutMS: 5000
    });
    console.log(`Database connected successfully: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to primary MongoDB: ${error.message}`);
    console.log(`Attempting fallback connection to local MongoDB: ${fallbackUri}`);
    try {
      const conn = await mongoose.connect(fallbackUri);
      console.log(`Database connected successfully to fallback: ${conn.connection.host}`);
    } catch (fallbackError) {
      console.error(`Fallback MongoDB connection failed: ${fallbackError.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
