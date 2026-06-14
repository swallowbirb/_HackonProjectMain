// TODO: implement wants registry & geo matching

const createWant = async (userId, data) => {
  // TODO: create Want document with GeoJSON location
};

const getWantsByUser = async (userId) => {
  // TODO: fetch active wants for user
};

const matchDemandForItem = async (category, location, radiusKm = 25) => {
  // TODO: $geoNear query on wants collection
  // Returns { count, wants[] } within radiusKm of item location
};

const deactivateWant = async (wantId, userId) => {
  // TODO: set active: false
};

module.exports = { createWant, getWantsByUser, matchDemandForItem, deactivateWant };
