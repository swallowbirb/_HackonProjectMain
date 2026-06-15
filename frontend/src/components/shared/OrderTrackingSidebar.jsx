import { motion, AnimatePresence } from 'framer-motion';
import { PackageCheck, Boxes, Truck, MapPin, Home, Ban, Package } from 'lucide-react';
import RouteCheckpointTracker from './RouteCheckpointTracker';

const AMBER = '#FF9900';

// Carrier lifecycle — mirrors backend FULFILLMENT_FLOW order.
export const FULFILLMENT_STEPS = [
  { key: 'placed', label: 'Order placed', sublabel: 'We received your order', icon: PackageCheck },
  { key: 'dispatched', label: 'Dispatched', sublabel: 'Packed & handed to carrier', icon: Boxes },
  { key: 'in_transit', label: 'In transit', sublabel: 'On the way to your city', icon: Truck },
  { key: 'out_for_delivery', label: 'Out for delivery', sublabel: 'Arriving today', icon: MapPin },
  { key: 'delivered', label: 'Delivered', sublabel: 'Enjoy your purchase', icon: Home },
];

const FLOW = FULFILLMENT_STEPS.map((s) => s.key);

/**
 * OrderTrackingSidebar — a thin, sticky left rail that visualises the carrier
 * journey of the selected order. Buyer-facing, purely visual (demo control to
 * advance the shipping stage is wired to the real fulfillment endpoint).
 */
export default function OrderTrackingSidebar({ order, onAdvance, advancing, title }) {
  if (!order) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
        <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-3">
          <Package className="w-6 h-6 text-gray-300" />
        </div>
        <p className="text-sm font-semibold text-gray-700">Track an order</p>
        <p className="text-xs text-gray-400 mt-1 leading-snug">
          Select an order to follow its delivery, checkpoint by checkpoint.
        </p>
      </div>
    );
  }

  const cancelled = order.status === 'cancelled';
  const status = order.fulfillmentStatus || 'placed';
  const currentIndex = Math.max(0, FLOW.indexOf(status));

  const itemTitle = order.catalogEntryId?.title || order.productId?.title || 'Your order';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: AMBER }}>
          {title || 'Live tracking'}
        </span>
      </div>
      <p className="text-sm font-bold text-gray-900 line-clamp-2 leading-tight mb-1">{itemTitle}</p>
      <p className="text-[11px] text-gray-400 mb-4">Order #{order._id.slice(-8).toUpperCase()}</p>

      <AnimatePresence mode="wait">
        {cancelled ? (
          <motion.div
            key="cancelled"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 text-sm font-medium px-3 py-3 rounded-xl"
          >
            <Ban className="w-4 h-4" /> This order was cancelled.
          </motion.div>
        ) : (
          <motion.div key="tracker" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <RouteCheckpointTracker
              steps={FULFILLMENT_STEPS}
              currentIndex={currentIndex}
              onAdvance={onAdvance}
              advancing={advancing}
              accent={AMBER}
              advanceLabel="Demo control — simulates the next carrier scan"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
