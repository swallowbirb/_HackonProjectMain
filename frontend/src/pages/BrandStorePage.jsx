import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getBrandById } from '../services/brand.service';
import { getCatalogEntriesByBrand } from '../services/catalogEntry.service';
import ProductCard from '../components/shared/ProductCard';
import { ShieldCheck, Package, AlertTriangle } from 'lucide-react';

export default function BrandStorePage() {
  const { id } = useParams();
  const [brand, setBrand] = useState(null);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const brandRes = await getBrandById(id);
        if (brandRes.success) {
          setBrand(brandRes.data);
          const catalogRes = await getCatalogEntriesByBrand(id);
          if (catalogRes.success) {
            setProducts(catalogRes.data);
          }
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Brand not found');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#EAEDED]">
        <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-6">
          <div className="bg-white rounded-md h-40 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="bg-white rounded-md h-64 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !brand) {
    return (
      <div className="min-h-screen bg-[#EAEDED] flex items-center justify-center">
        <div className="bg-white p-12 rounded-md text-center border border-gray-200">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-800 mb-2">{error || 'Brand Not Found'}</h2>
          <Link to="/" className="text-[#007185] text-sm hover:underline">Back to Home</Link>
        </div>
      </div>
    );
  }

  const initials = brand.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="min-h-screen bg-[#EAEDED]">
      {/* Brand header */}
      <div className="bg-gradient-to-r from-[#111827] to-[#1f2937] text-white border-b-4 border-[#CC0C39]">
        <div className="max-w-[1200px] mx-auto px-6 py-10">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row items-center md:items-start gap-6"
          >
            {/* Brand avatar */}
            <div className="w-24 h-24 rounded-md bg-white flex items-center justify-center text-black font-black text-3xl flex-shrink-0 shadow-lg overflow-hidden border border-gray-200">
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt={brand.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              ) : (
                initials
              )}
            </div>

            {/* Brand info */}
            <div className="text-center md:text-left flex-1">
              <div className="flex items-center gap-2 justify-center md:justify-start mb-2">
                <ShieldCheck className="w-6 h-6 text-[#10b981]" />
                <h1 className="text-3xl font-black">{brand.name}</h1>
                <span className="bg-[#10b981] text-white text-xs font-bold px-2 py-0.5 rounded-full ml-2">
                  Official Store
                </span>
              </div>

              {brand.description && (
                <p className="text-sm text-white/80 max-w-2xl">{brand.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-white/70 justify-center md:justify-start">
                <span className="flex items-center gap-1">
                  <Package className="w-4 h-4" /> {products.length} official product{products.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Products section */}
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-gray-900">Official Catalog by {brand.name}</h2>
          <span className="text-sm text-gray-500">{products.length} results</span>
        </div>

        {products.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white border border-gray-200 rounded-md p-16 text-center"
          >
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-800 mb-2">No Products Yet</h3>
            <p className="text-gray-500 text-sm">This brand hasn't listed any catalog entries yet.</p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {products.map((product, i) => (
              <ProductCard 
                key={product._id} 
                product={{ ...product, isCatalogEntry: true, brandName: brand.name }} 
                index={i} 
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
