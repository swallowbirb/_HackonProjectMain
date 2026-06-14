/**
 * routing.warehouse.js — "best warehouse, not nearest warehouse" selection.
 *
 * Pure + tested. The winning warehouse maximizes net recovery:
 *   score = resaleValue × (1 + w·demand) − inbound − expectedOutbound − holding
 * so a farther warehouse sitting near real demand can beat a nearer empty one.
 */

const { haversine, reverseLogisticsCost } = require('./routing.scoring');
const { WAREHOUSE, WAREHOUSES, CARRIER, HOLDING_COST_PER_DAY } = require('./routing.config');

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
 * @returns {{ warehouseCode, warehouse, score, breakdown } | null}
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

  const holdingPerDay = HOLDING_COST_PER_DAY[category] || HOLDING_COST_PER_DAY.general;
  const holdingCost = holdingPerDay * WAREHOUSE.holdingDays;

  const ranked = warehouses.map((wh) => {
    const inbound = reverseLogisticsCost({
      origin: sellerLoc,
      destination: wh.location,
      weightKg,
      category,
    });

    // Expected outbound: warehouse → an average nearby buyer.
    const expectedOutbound = Math.round(
      CARRIER.baseFee + CARRIER.perKm * WAREHOUSE.expectedOutboundKm
    );

    const demand = Number(demandByWarehouse[wh.code]) || 0;
    const demandBoostedValue = resaleValue * (1 + WAREHOUSE.demandWeight * demand);

    const score =
      demandBoostedValue -
      WAREHOUSE.inboundWeight * inbound -
      WAREHOUSE.outboundWeight * expectedOutbound -
      holdingCost;

    const distanceKm = Math.round(haversine(sellerLoc.coordinates, wh.location.coordinates));

    return {
      warehouseCode: wh.code,
      warehouse: wh,
      score: Math.round(score * 100) / 100,
      breakdown: {
        distanceKm,
        inbound,
        expectedOutbound,
        demand,
        demandBoostedValue: Math.round(demandBoostedValue),
        holdingCost,
      },
    };
  });

  ranked.sort((a, b) => b.score - a.score || a.warehouseCode.localeCompare(b.warehouseCode));
  return { ...ranked[0], ranked };
};

module.exports = { chooseWarehouse };
