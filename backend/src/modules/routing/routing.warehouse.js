/**
 * routing.warehouse.js — "best warehouse, not nearest" selection.
 *
 * Pure + tested. For each warehouse we estimate how much money we'd actually
 * recover by sending the item there:
 *
 *   expectedRecovery = resaleValue × sellThrough(demand) − inboundCost
 *
 * where sellThrough scales 0→1 with the warehouse's nearby demand for this kind
 * of item (driven by the demand populator), and inboundCost is the reverse-
 * logistics cost to ship there (distance × weight). The winner maximises
 * expectedRecovery — so a farther warehouse sitting in real demand can beat a
 * nearer one with none, but only if it still turns a profit. If even the best is
 * a loss (≤ 0), `viable` is false and the caller donates/liquidates instead.
 */

const { reverseLogisticsCost, haversine } = require('./routing.scoring');
const { WAREHOUSES, SELL_THROUGH_REF } = require('./routing.config');

/**
 * Choose the best warehouse.
 *
 * @param {object} args
 *   sellerLoc: GeoJSON Point { coordinates:[lng,lat] }
 *   category: String
 *   weightKg: Number
 *   resaleValue: Number
 *   demandByWarehouse: { [warehouseCode]: demandNumber }  (0-100 normalized)
 *   warehouses: optional override list (defaults to config WAREHOUSES)
 * @returns {{ warehouseCode, warehouse, score, viable, breakdown, ranked } | null}
 */
const chooseWarehouse = ({
  sellerLoc,
  category,
  weightKg,
  resaleValue = 0,
  demandByWarehouse = {},
  warehouses = WAREHOUSES,
} = {}) => {
  if (!sellerLoc || !Array.isArray(warehouses) || warehouses.length === 0) return null;

  const ranked = warehouses.map((wh) => {
    const inbound = reverseLogisticsCost({
      origin: sellerLoc,
      destination: wh.location,
      weightKg,
      category,
    });

    const demand = Number(demandByWarehouse[wh.code]) || 0; // 0-100 normalized
    // How confidently this item sells here (0→1). Demand at/above the reference
    // level means a near-certain sale; below it scales the expected value down.
    const sellThrough = Math.max(0, Math.min(1, demand / SELL_THROUGH_REF));
    const expectedRecovery = Math.round(resaleValue * sellThrough - inbound);

    const distanceKm = Math.round(haversine(sellerLoc.coordinates, wh.location.coordinates));

    return {
      warehouseCode: wh.code,
      warehouse: wh,
      score: expectedRecovery,
      breakdown: {
        distanceKm,
        inbound,
        demand,
        sellThrough: Math.round(sellThrough * 100) / 100,
        resaleValue,
        expectedRecovery,
      },
    };
  });

  // Highest expected recovery wins; tie-break toward the nearer warehouse.
  ranked.sort((a, b) => b.score - a.score || a.breakdown.distanceKm - b.breakdown.distanceKm);

  const best = ranked[0];
  return { ...best, viable: best.score > 0, ranked };
};

module.exports = { chooseWarehouse };
