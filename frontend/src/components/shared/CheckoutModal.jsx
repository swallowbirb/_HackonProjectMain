import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CreditCard, X, ShieldCheck, Lock, Package, Banknote, Sparkles, Info } from 'lucide-react';
import { getPaymentPolicy, getReturnWindow } from '../../services/festive.service';

/**
 * CheckoutModal — reusable for both single-product (Buy Now) and cart checkout.
 *
 * Single product:  pass `productTitle` + `price`
 * Cart:            pass `items` = [{ title, price, quantity }] — renders a line-item summary
 *
 * Calls `onConfirm(mockCreditCard, paymentMethod)` when the buyer submits.
 * (Existing callers that read only the first arg still work — paymentMethod defaults to prepaid.)
 *
 * Phase 7.5 — during a festive window the COD option is gated by trust tier × cart value,
 * and a festive return-window note is shown. None of this blocks the prepaid buy path.
 */
export default function CheckoutModal({
  isOpen,
  onClose,
  onConfirm,
  // Single-product props
  productTitle,
  price,
  // Cart props
  items,
  // Shared
  isProcessing,
}) {
  const [creditCard, setCreditCard] = useState('');
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('prepaid');

  // Festive policy state
  const [festive, setFestive] = useState(null);       // { festive, eventCode, codAllowed, cap, partialPrepaidToken }
  const [returnInfo, setReturnInfo] = useState(null);  // { windowDays, shrunk }
  const [policyLoading, setPolicyLoading] = useState(false);

  const isCartMode = Array.isArray(items) && items.length > 0;

  const total = isCartMode
    ? items.reduce((sum, i) => sum + (i.price || 0) * (i.quantity || 1), 0)
    : price || 0;

  const itemCount = isCartMode
    ? items.reduce((sum, i) => sum + (i.quantity || 1), 0)
    : 1;

  // Fetch festive payment policy + return window whenever the modal opens or total changes.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPolicyLoading(true);
    Promise.all([getPaymentPolicy(total), getReturnWindow()])
      .then(([pol, win]) => {
        if (cancelled) return;
        setFestive(pol);
        setReturnInfo(win);
        // If COD is not allowed, make sure we don't leave it selected.
        if (pol && pol.codAllowed === false && paymentMethod === 'cod') {
          setPaymentMethod('prepaid');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFestive(null);
          setReturnInfo(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPolicyLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, total]);

  const codAllowed = !festive || festive.codAllowed !== false; // default allow if no policy
  const isFestive = !!(festive && festive.festive);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (paymentMethod === 'prepaid' && !creditCard.trim()) {
      setError('Please enter a mock credit card number.');
      return;
    }
    setError('');
    onConfirm(paymentMethod === 'cod' ? '' : creditCard, paymentMethod);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div key="checkout-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="bg-[#f3f3f3] border-b border-gray-200 p-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Lock className="w-5 h-5 text-gray-500" /> Secure Checkout
              </h2>
              <button
                onClick={onClose}
                disabled={isProcessing}
                className="text-gray-500 hover:text-gray-900 p-1 rounded-full hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6">
              {/* Festive banner */}
              {isFestive && (
                <div className="mb-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                  <Sparkles className="w-5 h-5 text-amber-500 flex-shrink-0" />
                  <div className="text-xs text-amber-800 leading-relaxed">
                    <span className="font-bold">Festive sale is live.</span>{' '}
                    {returnInfo?.shrunk
                      ? `Returns on this order: ${returnInfo.windowDays} days.`
                      : `Standard ${returnInfo?.windowDays ?? 30}-day returns apply.`}
                  </div>
                </div>
              )}

              {/* Order summary */}
              <div className="mb-6">
                {isCartMode ? (
                  <>
                    <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                      <Package className="w-4 h-4" /> {itemCount} item{itemCount !== 1 ? 's' : ''} in your order
                    </p>
                    <ul className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {items.map((item, i) => (
                        <li key={i} className="flex justify-between text-sm text-gray-700">
                          <span className="line-clamp-1 flex-1 mr-2">
                            <span className="text-gray-400 mr-1">×{item.quantity}</span>
                            {item.title}
                          </span>
                          <span className="font-medium flex-shrink-0">
                            ${((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between">
                      <span className="font-bold text-gray-900">Total</span>
                      <span className="text-xl font-bold text-[#B12704]">${total.toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-500 mb-1">Purchasing:</p>
                    <p className="font-medium text-gray-900 line-clamp-2 leading-tight">{productTitle}</p>
                    <p className="text-xl font-bold text-[#B12704] mt-2">${total.toFixed(2)}</p>
                  </>
                )}
              </div>

              {/* Payment method selector */}
              <div className="mb-4">
                <p className="block text-sm font-bold text-gray-700 mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  {/* Prepaid */}
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('prepaid')}
                    className={`flex items-center gap-2 border rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      paymentMethod === 'prepaid'
                        ? 'border-[#FF9900] bg-amber-50 text-gray-900'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <CreditCard className="w-4 h-4" /> Card
                  </button>
                  {/* COD */}
                  <button
                    type="button"
                    disabled={!codAllowed}
                    onClick={() => codAllowed && setPaymentMethod('cod')}
                    className={`flex items-center gap-2 border rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      !codAllowed
                        ? 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed'
                        : paymentMethod === 'cod'
                        ? 'border-[#FF9900] bg-amber-50 text-gray-900'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Banknote className="w-4 h-4" /> Cash on Delivery
                  </button>
                </div>

                {/* COD-blocked explanation (festive) */}
                {isFestive && !codAllowed && (
                  <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg p-3 flex gap-2">
                    <Info className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-orange-800 leading-relaxed">
                      Cash on Delivery isn’t available for this order during the festive sale.
                      {festive?.partialPrepaidToken
                        ? ` You can pay a ₹${festive.partialPrepaidToken} token now and the rest on delivery, or pay by card.`
                        : ' Please pay by card.'}
                    </p>
                  </div>
                )}
                {isFestive && codAllowed && festive?.cap && (
                  <p className="mt-2 text-xs text-gray-500">
                    Cash on Delivery available on orders up to ₹{festive.cap} during the sale.
                  </p>
                )}
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Card input — only for prepaid */}
                {paymentMethod === 'prepaid' && (
                  <div>
                    <label htmlFor="creditCard" className="block text-sm font-bold text-gray-700 mb-1">
                      Mock Credit Card Number
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <CreditCard className="h-5 w-5 text-gray-400" />
                      </div>
                      <input
                        type="text"
                        id="creditCard"
                        value={creditCard}
                        onChange={(e) => setCreditCard(e.target.value)}
                        placeholder="e.g. 4111 1111 1111 1111"
                        className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-[#FF9900] focus:border-[#FF9900] sm:text-sm transition-colors text-gray-900"
                        disabled={isProcessing}
                      />
                    </div>
                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                  </div>
                )}

                {paymentMethod === 'cod' && (
                  <div className="bg-green-50 border border-green-200 rounded p-3 flex gap-2">
                    <Banknote className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <p className="text-xs text-green-800 leading-relaxed">
                      You’ll pay in cash when the order is delivered. No card needed.
                    </p>
                  </div>
                )}

                {paymentMethod === 'prepaid' && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 flex gap-2">
                    <ShieldCheck className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    <p className="text-xs text-blue-800 leading-relaxed">
                      This is a secure, mock environment. Any input will simulate a successful purchase instantly without charging you.
                    </p>
                  </div>
                )}

                <div className="pt-4 border-t border-gray-100 flex gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isProcessing}
                    className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isProcessing || policyLoading}
                    className="flex-1 flex items-center justify-center px-4 py-2 text-sm font-bold text-black bg-[#FF9900] border border-transparent rounded-md hover:bg-[#FFB347] transition-colors disabled:opacity-50"
                  >
                    {isProcessing ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin w-4 h-4 border-2 border-black/30 border-t-black rounded-full inline-block" />
                        Processing
                      </span>
                    ) : (
                      `${paymentMethod === 'cod' ? 'Place COD Order' : 'Confirm Purchase'} • $${total.toFixed(2)}`
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
