import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getBuyerOrders } from '../services/order.service';
import { initiateFromOrder } from '../services/secondhand.service';
import { Package, Loader2, Recycle, ChevronRight, Calendar, ArrowRight } from 'lucide-react';

export default function SellSecondhandPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getBuyerOrders(1, 50)
      .then((res) => { if (res.success) setOrders(res.data.orders); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async () => {
    if (!selectedOrder) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await initiateFromOrder({ orderId: selectedOrder._id, description });
      if (res.success) {
        const isCatalog = !!selectedOrder.catalogEntryId;
        const productTitle = isCatalog
          ? selectedOrder.catalogEntryId?.title
          : selectedOrder.productId?.title;
        navigate(`/items/${res.data.itemId}/evidence`, {
          state: { intakePath: 'sell-used', productTitle },
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 font-sans">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
            <Recycle className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">Sell on Second-Hand</h1>
            <p className="text-sm text-gray-500">Give your past purchases a second life</p>
          </div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">
          Pick an item you bought on this platform. We'll handle grading, pricing, and listing for you.
        </div>
      </motion.div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-zinc-400" /></div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No past orders found. Buy something first!</p>
        </div>
      ) : (
        <>
          {/* Order picker */}
          <div className="space-y-3 mb-8">
            <p className="text-sm font-semibold text-gray-700 mb-3">Select an item to list:</p>
            {orders.map((order) => {
              const isCatalog = !!order.catalogEntryId;
              const title = isCatalog ? order.catalogEntryId?.title : order.productId?.title;
              const img = isCatalog ? order.catalogEntryId?.officialImages?.[0] : order.productId?.images?.[0];
              const isSelected = selectedOrder?._id === order._id;

              return (
                <motion.button
                  key={order._id}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => setSelectedOrder(isSelected ? null : order)}
                  className={`w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 transition-all duration-200
                    ${isSelected
                      ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300'}`}
                >
                  <div className="w-14 h-14 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0">
                    {img
                      ? <img src={img} alt={title} className="w-full h-full object-contain mix-blend-multiply p-1" />
                      : <Package className="w-6 h-6 text-gray-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm line-clamp-1">{title}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(order.createdAt).toLocaleDateString()}
                      </span>
                      <span className="font-medium text-gray-700">₹{order.totalPrice.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors
                    ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'}`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                  </div>
                </motion.button>
              );
            })}
          </div>

          {/* Optional description */}
          <AnimatePresence>
            {selectedOrder && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6"
              >
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Add a note <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="E.g. Used for 6 months, works perfectly, minor scuff on corner..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent resize-none"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <div className="flex justify-end">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleSubmit}
              disabled={!selectedOrder || submitting}
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold px-6 py-2.5 rounded-xl transition-colors shadow-sm text-sm"
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
              ) : (
                <>Continue to Photos <ArrowRight className="w-4 h-4" /></>
              )}
            </motion.button>
          </div>
        </>
      )}
    </div>
  );
}
