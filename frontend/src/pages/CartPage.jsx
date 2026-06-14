import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useCustomUser } from '../context/CustomUserContext';
import { getProductById } from '../services/product.service';
import { createOrder } from '../services/order.service';
import CheckoutModal from '../components/shared/CheckoutModal';
import { ShoppingCart, Trash2, Minus, Plus, ArrowLeft, CheckCircle, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const PLACEHOLDER_IMAGE = 'https://placehold.co/120x120/EAEDED/555?text=No+Image';

export default function CartPage() {
  const { cart, removeFromCart, setQuantity, clearCart } = useCart();
  const { role, mongoUser } = useCustomUser();
  const navigate = useNavigate();

  const [products, setProducts] = useState({});
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);

  // Fetch product details for items in cart
  useEffect(() => {
    if (cart.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const ids = [...new Set(cart.map((i) => i.productId))];
    Promise.all(
      ids.map((id) =>
        getProductById(id)
          .then((res) => (res.success ? { id, data: res.data } : null))
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      const map = {};
      for (const r of results) {
        if (r) map[r.id] = r.data;
      }
      setProducts(map);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [cart]);

  const subtotal = cart.reduce((sum, item) => {
    const product = products[item.productId];
    if (!product) return sum;
    return sum + product.price * item.quantity;
  }, 0);

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCheckoutAll = async (mockCreditCard, paymentMethod = 'prepaid') => {
    if (!mongoUser || role !== 'buyer') return;
    setOrdering(true);
    setOrderError('');

    try {
      const results = await Promise.all(
        cart.map((item) =>
          createOrder({
            productId: item.productId,
            quantity: item.quantity,
            mockCreditCard,
            paymentMethod,
          })
        )
      );

      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        setOrderError(`${failed.length} item(s) failed to order.`);
      } else {
        setShowCheckout(false);
        setOrderSuccess(true);
        clearCart();
      }
    } catch (err) {
      if (err.response?.data?.code === 'COD_NOT_AVAILABLE') {
        setOrderError('Cash on Delivery isn’t available for this order during the festive sale. Please pay by card.');
      } else {
        setOrderError(
          err.response?.data?.message || 'Failed to place orders. Please try again.'
        );
        setShowCheckout(false);
      }
    } finally {
      setOrdering(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white h-28 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (orderSuccess) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white border border-gray-200 rounded-lg p-10 max-w-md mx-auto"
        >
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Orders Placed Successfully!</h2>
          <p className="text-sm text-gray-500 mb-6">All items have been ordered.</p>
          <div className="flex flex-col gap-3">
            <Link
              to="/orders"
              className="amz-btn-primary py-2.5 rounded-full text-sm font-semibold text-center"
            >
              View My Orders
            </Link>
            <Link
              to="/"
              className="amz-btn-secondary py-2.5 rounded-full text-sm font-semibold text-center"
            >
              Continue Shopping
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-16 text-center">
        <div className="bg-white border border-gray-200 rounded-lg p-10 max-w-md mx-auto">
          <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Your Cart is Empty</h2>
          <p className="text-sm text-gray-500 mb-6">Add items to your cart to see them here.</p>
          <Link
            to="/"
            className="amz-btn-primary py-2.5 px-8 rounded-full text-sm font-semibold inline-block"
          >
            Start Shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 md:px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Cart items */}
        <div className="bg-white border border-gray-200 rounded-md p-6">
          <div className="flex items-center justify-between mb-6 border-b border-gray-200 pb-4">
            <h1 className="text-2xl font-bold text-gray-900">Shopping Cart</h1>
            <span className="text-sm text-gray-500">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
          </div>

          <AnimatePresence>
            {cart.map((item) => {
              const product = products[item.productId];
              if (!product) return null;

              return (
                <motion.div
                  key={item.productId}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className="flex gap-4 py-4 border-b border-gray-100 last:border-none"
                >
                  {/* Image */}
                  <Link to={`/products/${item.productId}`} className="flex-shrink-0">
                    <img
                      src={product.images?.[0] || PLACEHOLDER_IMAGE}
                      alt={product.title}
                      className="w-24 h-24 object-contain border border-gray-200 rounded"
                      onError={(e) => { e.target.src = PLACEHOLDER_IMAGE; }}
                    />
                  </Link>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <Link
                      to={`/products/${item.productId}`}
                      className="text-sm font-medium text-[#007185] hover:text-[#C7511F] hover:underline line-clamp-2"
                    >
                      {product.title}
                    </Link>

                    <p className="text-xs text-green-700 mt-1 font-medium">In Stock</p>

                    {product.category && (
                      <p className="text-xs text-gray-500 mt-0.5">{product.category}</p>
                    )}

                    {/* Quantity controls */}
                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setQuantity(item.productId, item.quantity - 1)}
                          className="px-2 py-1 hover:bg-gray-100 transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-3 py-1 text-sm font-medium border-x border-gray-300 min-w-[36px] text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => setQuantity(item.productId, item.quantity + 1)}
                          className="px-2 py-1 hover:bg-gray-100 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <span className="text-gray-300">|</span>

                      <button
                        onClick={() => removeFromCart(item.productId)}
                        className="text-xs text-[#007185] hover:text-[#C7511F] hover:underline flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-[#B12704]">
                      ₹{(product.price * item.quantity).toFixed(2)}
                    </p>
                    {item.quantity > 1 && (
                      <p className="text-xs text-gray-500">₹{product.price.toFixed(2)} each</p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Order summary */}
        <div className="self-start sticky top-20 space-y-4">
          <div className="bg-white border border-gray-200 rounded-md p-5">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Items ({itemCount}):</span>
                <span className="font-medium">₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Shipping:</span>
                <span className="text-green-700 font-medium">FREE</span>
              </div>
            </div>

            <hr className="my-4 border-gray-200" />

            <div className="flex justify-between text-lg font-bold text-[#B12704]">
              <span>Order Total:</span>
              <span>₹{subtotal.toFixed(2)}</span>
            </div>

            {role === 'buyer' ? (
              <button
                onClick={() => setShowCheckout(true)}
                disabled={ordering}
                className="w-full amz-btn-primary py-2.5 rounded-full text-sm font-semibold mt-4 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Package className="w-4 h-4" /> Proceed to Checkout ({itemCount} item{itemCount !== 1 ? 's' : ''})
              </button>
            ) : (
              <p className="text-xs text-gray-500 text-center mt-4 bg-gray-50 border border-gray-200 rounded p-3">
                {!mongoUser ? 'Sign in as a buyer to checkout.' : 'Only buyers can place orders.'}
              </p>
            )}

            {orderError && (
              <p className="text-xs text-red-600 mt-2 text-center">{orderError}</p>
            )}
          </div>

          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-[#007185] hover:text-[#C7511F] hover:underline"
          >
            <ArrowLeft className="w-4 h-4" /> Continue Shopping
          </Link>
        </div>
      </div>

      {/* Checkout modal */}
      <CheckoutModal
        isOpen={showCheckout}
        onClose={() => setShowCheckout(false)}
        onConfirm={handleCheckoutAll}
        items={cart.map((item) => ({
          title: products[item.productId]?.title || 'Product',
          price: products[item.productId]?.price || 0,
          quantity: item.quantity,
        }))}
        isProcessing={ordering}
      />
    </div>
  );
}
