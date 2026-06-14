import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getPublishedProducts } from '../services/product.service';
import ProductCard from '../components/shared/ProductCard';
import CategoryCard from '../components/shared/CategoryCard';
import { Search, Shield, TrendingUp, Star, ArrowRight, Zap } from 'lucide-react';

const CATEGORIES = [
  'Electronics', 'Clothing', 'Home & Garden', 'Sports',
  'Toys', 'Books', 'Automotive', 'Health & Beauty',
];



export default function HomePage() {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await getPublishedProducts();
        if (response.success) setProducts(response.data);
      } catch (err) {
        console.error('Failed to fetch products:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProducts();
  }, []);

  return (
    <div className="min-h-screen bg-[#EAEDED]">


      {/* Trust/Security Badges */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-[1200px] mx-auto px-6 py-4 flex flex-wrap items-center justify-center gap-8">
          {[
            { icon: <Shield className="w-5 h-5 text-[#007600]" />, text: 'AI Fraud Detection' },
            { icon: <Star className="w-5 h-5 text-[#FF9900]" />, text: 'Verified Reviews' },
            { icon: <TrendingUp className="w-5 h-5 text-[#007185]" />, text: 'Risk Scoring' },
            { icon: <Search className="w-5 h-5 text-[#C7511F]" />, text: 'Brand Protection' },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-center gap-2 text-sm text-gray-700 font-medium">
              {icon} {text}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-10">


        {/* Featured Products */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              Featured Products
              <span className="ml-2 text-sm font-normal text-gray-500">({products.length} items)</span>
            </h2>
            <Link to="/search" className="text-sm text-[#007185] hover:text-[#C7511F] flex items-center gap-1">
              See all results <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="bg-white rounded-md h-64 animate-pulse" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="bg-white rounded-md p-16 text-center border border-gray-200">
              <div className="text-5xl mb-4">🛍️</div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">No products yet</h3>
              <p className="text-gray-500 mb-4">Be the first to list a product on the marketplace!</p>
              <Link
                to="/role-selection"
                className="amz-btn-primary px-6 py-2 rounded text-sm inline-block"
              >
                Start Selling
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {products.slice(0, 20).map((product, i) => (
                <ProductCard key={product._id} product={product} index={i} />
              ))}
            </div>
          )}
        </section>


      </div>
    </div>
  );
}
