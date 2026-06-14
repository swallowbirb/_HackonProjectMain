const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    clerkId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    role: {
      type: String,
      enum: ['pending', 'buyer', 'seller', 'brand', 'admin'],
      default: 'pending',
    },
    profileImageUrl: {
      type: String,
    },
    // Seller-specific store profile fields
    storeName: {
      type: String,
      trim: true,
    },
    storeDescription: {
      type: String,
      trim: true,
    },
    // Denormalized review counters (buyer: reviews written; seller: reviews received)
    reviewCount: {
      type: Number,
      default: 0,
    },
    totalReviewsReceived: {
      type: Number,
      default: 0,
    },
    // Seller aggregate rating across all products
    averageRating: {
      type: Number,
      default: 0,
    },
    // Timestamp of last activity
    lastActiveAt: {
      type: Date,
    },
    firstName: {
      type: String,
    },
    lastName: {
      type: String,
    },
    avatarUrl: {
      type: String,
    },
    // Hard block — seller is completely disabled
    banned: {
      type: Boolean,
      default: false,
    },
    // Soft block — seller temporarily restricted, can be reinstated
    suspended: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);

module.exports = User;
