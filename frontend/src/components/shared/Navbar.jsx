import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCustomUser } from '../../context/CustomUserContext';
import { UserButton, useAuth } from '@clerk/clerk-react';
import { CustomSignedIn, CustomSignedOut } from '../../context/CustomUserContext';
import { Search, ShoppingCart, MapPin, ChevronDown, Menu } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCart } from '../../context/CartContext';

const CATEGORIES = [
  'All', 'Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Toys', 'Books', 'Automotive', 'Health & Beauty',
];

export default function Navbar() {
  const { role, mongoUser } = useCustomUser();
  const { signOut } = useAuth();
  const { cartCount } = useCart();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (selectedCategory !== 'All') params.set('category', selectedCategory);
    navigate(`/search?${params.toString()}`);
  };

  const getDashboardLink = () => {
    if (role === 'admin') return '/admin/dashboard';
    if (role === 'seller') return '/seller/dashboard';
    if (role === 'brand') return '/brand/dashboard';
    return '/';
  };

  return (
    <header className="sticky top-0 z-50 flex flex-col shadow-md">
      {/* Primary nav */}
      <div className="amz-nav text-white px-4 py-2">
        <div className="max-w-[1500px] mx-auto flex items-center gap-2 md:gap-3">
          {/* Logo */}
          <Link to="/" className="flex-shrink-0 mr-1">
            <div className="flex items-center gap-1 hover:outline hover:outline-white hover:outline-1 rounded px-1 py-1 transition-all">
              <div className="text-white font-bold text-xl tracking-tight leading-none">
                market<span className="text-[#FF9900]">place</span>
              </div>
              <div className="text-[#FF9900] text-[10px] font-bold mt-1">.security</div>
            </div>
          </Link>



          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex-1 flex h-10 min-w-0">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="hidden md:block bg-[#f3f3f3] text-black text-xs px-2 rounded-l-md border-r border-gray-300 flex-shrink-0 cursor-pointer hover:bg-[#e5e5e5] transition-colors"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products, brands..."
              className="flex-1 px-3 bg-white text-black text-sm outline-none min-w-0 rounded-l-md md:rounded-none"
            />
            <button
              type="submit"
              className="bg-[#FF9900] hover:bg-[#FFB347] text-black px-4 rounded-r-md flex items-center transition-colors flex-shrink-0"
            >
              <Search className="w-5 h-5" />
            </button>
          </form>

          {/* Right side links */}
          <div className="hidden md:flex items-center gap-1 flex-shrink-0">
            <CustomSignedOut>
              <Link
                to="/sign-in"
                className="flex flex-col hover:outline hover:outline-white hover:outline-1 rounded px-2 py-1 transition-all cursor-pointer text-xs"
              >
                <span className="text-zinc-300">Hello, Sign in</span>
                <span className="font-bold text-[13px] flex items-center gap-0.5">Account <ChevronDown className="w-3 h-3" /></span>
              </Link>
            </CustomSignedOut>

            <CustomSignedIn>
              <div
                ref={dropdownRef}
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="relative flex flex-col hover:outline hover:outline-white hover:outline-1 rounded px-2 py-1 transition-all cursor-pointer text-xs select-none"
              >
                <span className="text-zinc-300 text-[11px]">Hello, {mongoUser?.firstName || 'User'}</span>
                <span className="font-bold text-[13px] flex items-center gap-0.5">
                  Account & Lists <ChevronDown className={`w-3 h-3 text-zinc-300 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </span>

                {/* Dropdown Menu on Click */}
                <AnimatePresence>
                  {isDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-full mt-2 w-52 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl py-2 text-white z-50 overflow-hidden font-sans"
                    >
                      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2.5 bg-zinc-950/30">
                        {localStorage.getItem('mock_clerk_id') ? (
                          <div className="w-8 h-8 rounded-full bg-[#FF9900] text-black flex items-center justify-center font-bold text-sm border border-zinc-700 uppercase flex-shrink-0">
                            {(mongoUser?.firstName || 'M')[0]}
                          </div>
                        ) : (
                          <UserButton />
                        )}
                        <div className="flex flex-col overflow-hidden text-left">
                          <span className="font-semibold text-sm text-zinc-100 truncate">
                            {mongoUser?.firstName || 'User'}
                          </span>
                          <span className="text-[10px] text-zinc-400 capitalize bg-zinc-800 px-1.5 py-0.5 rounded-md w-fit font-medium">
                            {role || 'buyer'}
                          </span>
                        </div>
                      </div>
                      <div className="p-1 space-y-0.5">
                        <Link
                          to={getDashboardLink()}
                          onClick={() => setIsDropdownOpen(false)}
                          className="block px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors text-left"
                        >
                          Dashboard
                        </Link>
                        {role === 'admin' && (
                          <Link
                            to="/admin/demand-map"
                            onClick={() => setIsDropdownOpen(false)}
                            className="block px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors text-left"
                          >
                            Demand Map
                          </Link>
                        )}
                        <button
                          onClick={() => {
                            setIsDropdownOpen(false);
                            localStorage.removeItem('mock_clerk_id');
                            signOut();
                          }}
                          className="w-full text-left block px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg transition-colors cursor-pointer font-medium"
                        >
                          Sign Out
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </CustomSignedIn>

            {/* Returns & Orders */}
            {(!role || role === 'buyer') && (
              <>
                <Link
                  to="/orders"
                  className="flex flex-col hover:outline hover:outline-white hover:outline-1 rounded px-2 py-1 transition-all cursor-pointer text-xs select-none justify-center"
                >
                  <span className="text-zinc-300 text-[11px] leading-tight">Returns</span>
                  <span className="font-bold text-[13px] leading-tight">& Orders</span>
                </Link>
                <Link
                  to="/sell-secondhand"
                  className="flex flex-col hover:outline hover:outline-white hover:outline-1 rounded px-2 py-1 transition-all cursor-pointer text-xs select-none justify-center"
                >
                  <span className="text-zinc-300 text-[11px] leading-tight">Sell</span>
                  <span className="font-bold text-[13px] leading-tight text-emerald-400">Second-Hand</span>
                </Link>
                <Link
                  to="/looking-for"
                  className="flex flex-col hover:outline hover:outline-white hover:outline-1 rounded px-2 py-1 transition-all cursor-pointer text-xs select-none justify-center"
                >
                  <span className="text-zinc-300 text-[11px] leading-tight">Looking</span>
                  <span className="font-bold text-[13px] leading-tight text-indigo-300">For…</span>
                </Link>
              </>
            )}

            {/* Second-Life resale storefront — public to all */}
            <Link
              to="/resale"
              className="flex flex-col hover:outline hover:outline-white hover:outline-1 rounded px-2 py-1 transition-all cursor-pointer text-xs select-none justify-center"
            >
              <span className="text-zinc-300 text-[11px] leading-tight">Shop</span>
              <span className="font-bold text-[13px] leading-tight text-emerald-400">Second-Life</span>
            </Link>

            {/* Cart icon */}
            <Link to="/cart" className="relative flex items-end gap-1 hover:outline hover:outline-white hover:outline-1 rounded px-2 py-1 transition-all">
              <ShoppingCart className="w-8 h-8 text-white" />
              {cartCount > 0 && (
                <span className="absolute -top-1 left-5 bg-[#FF9900] text-black text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
              <span className="font-bold text-sm">Cart</span>
            </Link>
          </div>

          {/* Mobile menu button */}
          <button className="md:hidden ml-auto">
            <Menu className="w-6 h-6 text-white" />
          </button>
        </div>
      </div>


    </header>
  );
}
