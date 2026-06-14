import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getBuyerOrders, cancelOrder, advanceFulfillment } from '../services/order.service';
import { initiateReturn } from '../services/return.service';
import { getMyItems } from '../services/item.service';
import { Package, Loader2, Calendar, CreditCard, ChevronRight, RotateCcw, X, ChevronDown, Activity, ArrowRight, Truck, Banknote, Ban } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const REASON_OPTIONS = [
  { value: 'defective', label: 'Item is defective or broken' },
  { value: 'not_as_described', label: 'Not as described' },
  { value: 'wrong_item', label: 'Wrong item received' },
  { value: 'changed_mind', label: 'Changed my mind' },
  { value: 'other', label: 'Other' },
];

// Fulfillment lifecycle (Phase 7.5) — label + the next step for the demo "advance" control.
const FULFILLMENT_FLOW = ['placed', 'dispatched', 'in_transit', 'out_for_delivery', 'delivered'];
const FULFILLMENT_META = {
  placed:          { label: 'Order placed',     color: 'bg-gray-100 text-gray-600' },
  dispatched:      { label: 'Dispatched',       color: 'bg-blue-100 text-blue-700' },
  in_transit:      { label: 'In transit',       color: 'bg-indigo-100 text-indigo-700' },
  out_for_delivery:{ label: 'Out for delivery', color: 'bg-amber-100 text-amber-700' },
  delivered:       { label: 'Delivered',        color: 'bg-emerald-100 text-emerald-700' },
};

// Maps item status to a human label + color
const STATUS_META = {
  INITIATED:        { label: 'Initiated',       color: 'bg-gray-100 text-gray-600' },
  EVIDENCE_PENDING: { label: 'Evidence Pending', color: 'bg-yellow-100 text-yellow-700' },
  GRADING:          { label: 'AI Grading',       color: 'bg-orange-100 text-orange-700' },
  GRADED:           { label: 'Graded',           color: 'bg-blue-100 text-blue-700' },
  ROUTED:           { label: 'Routed',           color: 'bg-purple-100 text-purple-700' },
  IN_TRANSIT:       { label: 'In Transit',       color: 'bg-indigo-100 text-indigo-700' },
  LISTED:           { label: 'Listed',           color: 'bg-emerald-100 text-emerald-700' },
  SOLD:             { label: 'Sold',             color: 'bg-emerald-200 text-emerald-800' },
  DONATED:          { label: 'Donated',          color: 'bg-teal-100 text-teal-700' },
  LIQUIDATED:       { label: 'Liquidated',       color: 'bg-gray-200 text-gray-600' },
  CANCELLED:        { label: 'Cancelled',        color: 'bg-red-100 text-red-600' },
  REJECTED:         { label: 'Rejected',         color: 'bg-red-100 text-red-600' },
};

export default function BuyerOrdersPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [myItems, setMyItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [returnModal, setReturnModal] = useState(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [returnError, setReturnError] = useState(null);

  // Phase 7.5 — per-order action state (cancel lock + fulfillment advance demo).
  const [actionOrderId, setActionOrderId] = useState(null);   // order currently mutating
  const [orderNotice, setOrderNotice] = useState({});         // { [orderId]: { type, message } }

  const patchOrder = (orderId, fields) =>
    setOrders((prev) => prev.map((o) => (o._id === orderId ? { ...o, ...fields } : o)));

  const handleAdvanceFulfillment = async (order) => {
    const current = order.fulfillmentStatus || 'placed';
    const idx = FULFILLMENT_FLOW.indexOf(current);
    const next = FULFILLMENT_FLOW[Math.min(idx + 1, FULFILLMENT_FLOW.length - 1)];
    if (next === current) return;
    setActionOrderId(order._id);
    setOrderNotice((n) => ({ ...n, [order._id]: null }));
    try {
      const res = await advanceFulfillment(order._id, next);
      if (res.success) patchOrder(order._id, { fulfillmentStatus: res.data.fulfillmentStatus });
    } catch (err) {
      setOrderNotice((n) => ({
        ...n,
        [order._id]: { type: 'error', message: err.response?.data?.message || 'Could not advance shipping.' },
      }));
    } finally {
      setActionOrderId(null);
    }
  };

  const handleCancelOrder = async (order) => {
    setActionOrderId(order._id);
    setOrderNotice((n) => ({ ...n, [order._id]: null }));
    try {
      const res = await cancelOrder(order._id);
      if (res.success) {
        patchOrder(order._id, { status: 'cancelled' });
        setOrderNotice((n) => ({ ...n, [order._id]: { type: 'success', message: 'Order cancelled.' } }));
      }
    } catch (err) {
      const code = err.response?.data?.code;
      const message =
        code === 'CANCEL_LOCKED'
          ? err.response?.data?.message ||
            'This order is in transit during the festive sale and can’t be cancelled. You can refuse delivery at the door, or return it after it arrives.'
          : err.response?.data?.message || 'Could not cancel this order.';
      setOrderNotice((n) => ({ ...n, [order._id]: { type: code === 'CANCEL_LOCKED' ? 'locked' : 'error', message } }));
    } finally {
      setActionOrderId(null);
    }
  };

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [ordersRes, itemsRes] = await Promise.all([
          getBuyerOrders(1, 50),
          getMyItems(),
        ]);
        if (ordersRes.success) setOrders(ordersRes.data.orders);
        if (itemsRes.success) setMyItems(itemsRes.data);
      } catch (err) {
        console.error('Failed to fetch data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAll();
  }, []);

  const openReturnModal = (order) => {
    setReturnModal({ order });
    setReasonCode('');
    setReasonText('');
    setReturnError(null);
  };

  const closeReturnModal = () => {
    setReturnModal(null);
    setReturnError(null);
  };

  const handleInitiateReturn = async () => {
    if (!reasonCode) { setReturnError('Please select a reason.'); return; }
    setSubmitting(true);
    setReturnError(null);
    try {
      const res = await initiateReturn({
        orderId: returnModal.order._id,
        reasonCode,
        reasonText,
      });
      if (res.success) {
        const isCatalog = !!returnModal.order.catalogEntryId;
        const productTitle = isCatalog
          ? returnModal.order.catalogEntryId?.title
          : returnModal.order.productId?.title;
        closeReturnModal();
        navigate(`/items/${res.data.itemId}/evidence`, {
          state: { intakePath: 'return', productTitle },
        });
      }
    } catch (err) {
      setReturnError(err.response?.data?.message || 'Failed to initiate return.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-5xl mx-auto px-4 py-8 font-sans">

        {/* Header + Tabs */}
        <div className="mb-6">
          <h1 className="text-3xl font-black text-gray-900 mb-4">Your Orders</h1>
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                activeTab === 'orders'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'activity'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Returns &amp; Listings
              {myItems.length > 0 && (
                <span className="bg-[#FF9900] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {myItems.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── ORDERS TAB ── */}
        {activeTab === 'orders' && (
          orders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Package className="w-8 h-8 text-gray-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">No orders yet</h2>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">
                You haven't placed any orders yet. Discover great products from verified brands and trusted sellers.
              </p>
              <Link
                to="/"
                className="inline-flex items-center justify-center bg-[#FF9900] hover:bg-[#FFB347] text-black font-bold px-6 py-2.5 rounded-xl transition-colors"
              >
                Start Shopping
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {orders.map((order) => {
                const isCatalogOrder = !!order.catalogEntryId;
                const itemTitle = isCatalogOrder ? order.catalogEntryId?.title : order.productId?.title;
                const itemImage = isCatalogOrder
                  ? order.catalogEntryId?.officialImages?.[0]
                  : order.productId?.images?.[0];
                const itemLink = isCatalogOrder
                  ? `/p/${order.catalogEntryId?._id}`
                  : `/products/${order.productId?._id}`;
                const sellerName = order.sellerId?.storeName || `${order.sellerId?.firstName} ${order.sellerId?.lastName}`.trim();

                return (
                  <div key={order._id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-wrap gap-6 items-center justify-between text-sm">
                      <div className="flex gap-6">
                        <div>
                          <p className="text-gray-500 mb-0.5">ORDER PLACED</p>
                          <p className="font-medium text-gray-900 flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            {new Date(order.createdAt).toLocaleDateString(undefined, {
                              year: 'numeric', month: 'long', day: 'numeric',
                            })}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500 mb-0.5">TOTAL</p>
                          <p className="font-medium text-gray-900">₹{order.totalPrice.toFixed(2)}</p>
                        </div>
                      </div>
                      <div className="text-right flex-1 sm:flex-none">
                        <p className="text-gray-500 mb-0.5">ORDER # {order._id.slice(-8).toUpperCase()}</p>
                        <Link to={itemLink} className="text-blue-600 hover:text-blue-800 font-medium hover:underline inline-flex items-center gap-0.5">
                          View details <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </div>

                    <div className="p-6">
                      {(() => {
                        const fs = order.fulfillmentStatus || 'placed';
                        const fm = FULFILLMENT_META[fs] || FULFILLMENT_META.placed;
                        const cancelled = order.status === 'cancelled';
                        return (
                          <div className="flex items-center gap-2 mb-4">
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${cancelled ? 'bg-red-100 text-red-600' : fm.color}`}>
                              {cancelled ? 'Cancelled' : fm.label}
                            </span>
                            {order.festivePolicy?.festive && (
                              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                Festive order
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="flex flex-col sm:flex-row gap-6">
                        <div className="w-24 h-24 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0 p-2 overflow-hidden border border-gray-200">
                          {itemImage ? (
                            <img src={itemImage} alt={itemTitle} className="w-full h-full object-contain mix-blend-multiply" />
                          ) : (
                            <Package className="w-8 h-8 text-gray-300" />
                          )}
                        </div>
                        <div className="flex-1">
                          <Link to={itemLink} className="text-lg font-bold text-gray-900 hover:text-blue-600 hover:underline line-clamp-2 leading-tight mb-2">
                            {itemTitle}
                          </Link>
                          <p className="text-sm text-gray-600 mb-1">
                            Sold by: <span className="font-medium text-gray-900">{sellerName}</span>
                          </p>
                          <p className="text-sm text-gray-600 mb-3">
                            Quantity: <span className="font-medium text-gray-900">{order.quantity}</span>
                          </p>
                          <div className="flex flex-wrap gap-3">
                            <Link
                              to={itemLink}
                              className="inline-flex items-center justify-center bg-[#FF9900] hover:bg-[#FFB347] text-black font-medium px-4 py-2 rounded-lg text-sm transition-colors shadow-sm"
                            >
                              Buy it again
                            </Link>
                            <Link
                              to={`${itemLink}#reviews`}
                              className="inline-flex items-center justify-center bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors shadow-sm"
                            >
                              Write a product review
                            </Link>
                            <button
                              onClick={() => openReturnModal(order)}
                              className="inline-flex items-center gap-1.5 justify-center bg-white border border-gray-300 hover:bg-red-50 hover:border-red-300 hover:text-red-600 text-gray-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors shadow-sm"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Return item
                            </button>

                            {/* Phase 7.5 — cancel (festive lock may block) + demo shipping advance */}
                            {order.status !== 'cancelled' && (order.fulfillmentStatus || 'placed') !== 'delivered' && (
                              <>
                                <button
                                  onClick={() => handleCancelOrder(order)}
                                  disabled={actionOrderId === order._id}
                                  className="inline-flex items-center gap-1.5 justify-center bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium px-4 py-2 rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                  Cancel order
                                </button>
                                <button
                                  onClick={() => handleAdvanceFulfillment(order)}
                                  disabled={actionOrderId === order._id}
                                  title="Demo: simulate the next shipping step"
                                  className="inline-flex items-center gap-1.5 justify-center bg-white border border-dashed border-gray-300 hover:bg-gray-50 text-gray-500 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
                                >
                                  <Truck className="w-3.5 h-3.5" />
                                  Advance shipping
                                </button>
                              </>
                            )}
                          </div>

                          {/* Action notice (cancel lock / success / error) */}
                          {orderNotice[order._id] && (
                            <div
                              className={`mt-3 text-xs rounded-lg px-3 py-2 border ${
                                orderNotice[order._id].type === 'locked'
                                  ? 'bg-orange-50 border-orange-200 text-orange-800'
                                  : orderNotice[order._id].type === 'success'
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                  : 'bg-red-50 border-red-200 text-red-600'
                              }`}
                            >
                              {orderNotice[order._id].message}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
                      {order.paymentMethod === 'cod' ? (
                        <>
                          <Banknote className="w-4 h-4 text-gray-400" />
                          Cash on Delivery
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4 text-gray-400" />
                          Paid with mock card ending in {order.paymentDetails?.mockCreditCard?.slice(-4) || '****'}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── ACTIVITY TAB ── */}
        {activeTab === 'activity' && (
          myItems.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Activity className="w-8 h-8 text-gray-400" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">No active returns or listings</h2>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">
                Return an item from your orders, or sell a past purchase via Second-Hand.
              </p>
              <button
                onClick={() => setActiveTab('orders')}
                className="inline-flex items-center justify-center bg-[#FF9900] hover:bg-[#FFB347] text-black font-bold px-6 py-2.5 rounded-xl transition-colors"
              >
                View Orders
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myItems.map((item) => {
                const meta = STATUS_META[item.status] || { label: item.status, color: 'bg-gray-100 text-gray-600' };
                const isReturn = item.intakePath === 'return';
                const title = item.originalProductId?.title || 'Item';
                const isTerminal = ['SOLD', 'DONATED', 'LIQUIDATED', 'CANCELLED', 'REJECTED'].includes(item.status);

                return (
                  <motion.div
                    key={item._id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex items-center gap-4 shadow-sm"
                  >
                    {/* Path icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isReturn ? 'bg-red-50' : 'bg-emerald-50'}`}>
                      {isReturn
                        ? <RotateCcw className="w-5 h-5 text-red-400" />
                        : <Activity className="w-5 h-5 text-emerald-500" />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isReturn ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                          {isReturn ? '↩ Return' : '♻ Resell'}
                        </span>
                        <p className="text-xs text-gray-400">{new Date(item.createdAt).toLocaleDateString()}</p>
                      </div>
                      <p className="font-semibold text-gray-900 text-sm truncate">{title}</p>
                    </div>

                    {/* Status badge */}
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${meta.color}`}>
                      {meta.label}
                    </span>

                    {/* Link to status page (only if not terminal) */}
                    {!isTerminal && (
                      <Link
                        to={`/items/${item._id}/status`}
                        state={{ intakePath: item.intakePath, productTitle: title }}
                        className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 hover:bg-[#FF9900] hover:text-black text-gray-400 flex items-center justify-center transition-colors"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </Link>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Return Modal */}
      <AnimatePresence>
        {returnModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={closeReturnModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <RotateCcw className="w-5 h-5 text-[#FF9900]" />
                  <h2 className="text-lg font-black text-gray-900">Initiate Return</h2>
                </div>
                <button
                  onClick={closeReturnModal}
                  className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Reason for return *</label>
                <div className="relative">
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 appearance-none focus:outline-none focus:ring-2 focus:ring-[#FF9900] focus:border-transparent"
                  >
                    <option value="">Select a reason…</option>
                    {REASON_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div className="mb-5">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Additional details <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder="Describe the issue..."
                  rows={3}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF9900] resize-none"
                />
              </div>

              {returnError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4">
                  {returnError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={closeReturnModal}
                  className="flex-1 border border-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleInitiateReturn}
                  disabled={submitting}
                  className="flex-1 bg-[#FF9900] hover:bg-[#FFB347] disabled:opacity-50 text-black font-bold py-2.5 rounded-xl text-sm transition-colors inline-flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {submitting ? 'Starting…' : 'Continue to Photos'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
