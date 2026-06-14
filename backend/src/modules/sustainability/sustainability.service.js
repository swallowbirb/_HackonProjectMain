// TODO: implement CO2/water counters & green credits

// Category factor table (sourced from WRAP/INTEXTER data)
// Will be moved to seed data — see Task 0.8
const CATEGORY_FACTORS = {
  'clothing': { co2PerItem: 20.0, waterPerItem: 2700 },
  'electronics': { co2PerItem: 30.0, waterPerItem: 500 },
  'books': { co2PerItem: 2.5, waterPerItem: 50 },
  'footwear': { co2PerItem: 14.0, waterPerItem: 8000 },
  'furniture': { co2PerItem: 40.0, waterPerItem: 200 },
};

const computeImpact = async (itemId, category, userId, eventType = 'resell') => {
  // TODO:
  // 1. Look up category in factor table (or sustainability factors collection in DB)
  // 2. Calculate co2SavedKg, waterSavedLiters
  // 3. Compute greenCreditsEarned (1 credit per kg CO2 saved, rounded)
  // 4. Save SustainabilityImpact document
};

const getUserImpactSummary = async (userId) => {
  // TODO: aggregate total CO2, water, credits for user
};

const getPlatformImpactSummary = async () => {
  // TODO: aggregate totals across all users
};

module.exports = { computeImpact, getUserImpactSummary, getPlatformImpactSummary, CATEGORY_FACTORS };
