import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from './lib/ThemeProvider';
import { CustomUserProvider, useCustomUser, CustomSignedIn, CustomSignedOut } from './context/CustomUserContext';
import DevTools from './components/shared/DevTools';
import { motion } from 'framer-motion';
import { Ban } from 'lucide-react';
import MarketplaceLayout from './layouts/MarketplaceLayout';

// Pages
import HomePage from './pages/HomePage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import RoleSelectionPage from './pages/RoleSelectionPage';
import SellerDashboard from './pages/SellerDashboard';
import NewProductPage from './pages/NewProductPage';
import EditProductPage from './pages/EditProductPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import SearchResultsPage from './pages/SearchResultsPage';
import ProductDetailPage from './pages/ProductDetailPage';
import StorePage from './pages/StorePage';
import BrandDashboard from './pages/brand/BrandDashboard';
import NewOfferPage from './pages/NewOfferPage';
import CatalogEntryDetailPage from './pages/CatalogEntryDetailPage';
import BuyerOrdersPage from './pages/BuyerOrdersPage';
import CartPage from './pages/CartPage';
import BrandStorePage from './pages/BrandStorePage';
import SellSecondhandPage from './pages/SellSecondhandPage';
import ItemEvidencePage from './pages/ItemEvidencePage';
import ItemStatusPage from './pages/ItemStatusPage';
import ResaleMarketplacePage from './pages/ResaleMarketplacePage';
import ResaleListingDetailPage from './pages/ResaleListingDetailPage';

// ─── Role Guards ────────────────────────────────────────────────────────────

function getDashboardRedirectPath(role) {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'seller') return '/seller/dashboard';
  if (role === 'brand') return '/brand/dashboard';
  return '/';
}

function SellerGuard({ children }) {
  const { role, mongoUser, isLoadingRole } = useCustomUser();
  if (isLoadingRole) return <LoadingScreen />;
  if (role !== 'seller') {
    return <Navigate to={getDashboardRedirectPath(role)} replace />;
  }
  if (mongoUser?.banned) return <BannedScreen />;
  return children;
}

function AdminGuard({ children }) {
  const { role, isLoadingRole } = useCustomUser();
  if (isLoadingRole) return <LoadingScreen />;
  if (role !== 'admin') {
    return <Navigate to={getDashboardRedirectPath(role)} replace />;
  }
  return children;
}

function BrandGuard({ children }) {
  const { role, isLoadingRole } = useCustomUser();
  if (isLoadingRole) return <LoadingScreen />;
  if (role !== 'brand') {
    return <Navigate to={getDashboardRedirectPath(role)} replace />;
  }
  return children;
}

function DashboardRedirect() {
  const { role, isLoadingRole } = useCustomUser();
  if (isLoadingRole) return <LoadingScreen />;
  return <Navigate to={getDashboardRedirectPath(role)} replace />;
}

function RoleGuard({ children }) {
  const { isSignedIn, isLoaded, role, isLoadingRole } = useCustomUser();
  const location = useLocation();

  if (!isLoaded || isLoadingRole) return <LoadingScreen />;

  if (isSignedIn && role === 'pending' && location.pathname !== '/role-selection') {
    return <Navigate to="/role-selection" replace />;
  }

  return children;
}

// ─── Utility Screens ────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-zinc-700 border-t-white rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    </div>
  );
}

function BannedScreen() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8 font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center space-y-6 shadow-2xl"
      >
        <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center justify-center mx-auto text-red-500">
          <Ban className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Account Banned</h1>
          <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
            Your seller account has been permanently banned due to security or policy violations.
          </p>
        </div>
        <a
          href="mailto:support@marketplace.security"
          className="inline-flex items-center justify-center w-full px-5 py-2.5 rounded-xl text-sm font-medium bg-white text-black hover:bg-zinc-200 transition-colors"
        >
          Contact Support
        </a>
      </motion.div>
    </div>
  );
}

// ─── App ────────────────────────────────────────────────────────────────────

function App() {
  return (
    <ThemeProvider>
      <CustomUserProvider>
        <BrowserRouter>
          <RoleGuard>
            <Routes>
              {/* Public marketplace routes (with Navbar + Footer) */}
              <Route path="/" element={<MarketplaceLayout><HomePage /></MarketplaceLayout>} />
              <Route path="/search" element={<MarketplaceLayout><SearchResultsPage /></MarketplaceLayout>} />
              <Route path="/resale" element={<MarketplaceLayout><ResaleMarketplacePage /></MarketplaceLayout>} />
              <Route path="/resale/:id" element={<MarketplaceLayout><ResaleListingDetailPage /></MarketplaceLayout>} />
              <Route path="/products/:id" element={<MarketplaceLayout><ProductDetailPage /></MarketplaceLayout>} />
              <Route path="/p/:entryId" element={<MarketplaceLayout><CatalogEntryDetailPage /></MarketplaceLayout>} />
              <Route path="/seller/:id/store" element={<MarketplaceLayout><StorePage /></MarketplaceLayout>} />
              <Route path="/brand-store/:id" element={<MarketplaceLayout><BrandStorePage /></MarketplaceLayout>} />

              {/* Auth routes */}
              <Route path="/sign-in/*" element={<CustomSignedOut><SignInPage /></CustomSignedOut>} />
              <Route path="/sign-up/*" element={<CustomSignedOut><SignUpPage /></CustomSignedOut>} />

              {/* Role selection */}
              <Route path="/role-selection" element={<CustomSignedIn><RoleSelectionPage /></CustomSignedIn>} />

              {/* Dashboard redirect */}
              <Route path="/dashboard" element={<CustomSignedIn><DashboardRedirect /></CustomSignedIn>} />

              {/* Buyer routes */}
              <Route
                path="/cart"
                element={<MarketplaceLayout><CartPage /></MarketplaceLayout>}
              />
              <Route
                path="/orders"
                element={<CustomSignedIn><MarketplaceLayout><BuyerOrdersPage /></MarketplaceLayout></CustomSignedIn>}
              />
              <Route
                path="/sell-secondhand"
                element={<CustomSignedIn><MarketplaceLayout><SellSecondhandPage /></MarketplaceLayout></CustomSignedIn>}
              />
              <Route
                path="/items/:itemId/evidence"
                element={<CustomSignedIn><MarketplaceLayout><ItemEvidencePage /></MarketplaceLayout></CustomSignedIn>}
              />
              <Route
                path="/items/:itemId/status"
                element={<CustomSignedIn><MarketplaceLayout><ItemStatusPage /></MarketplaceLayout></CustomSignedIn>}
              />

              {/* Seller routes */}
              <Route
                path="/seller/dashboard"
                element={<CustomSignedIn><SellerGuard><SellerDashboard /></SellerGuard></CustomSignedIn>}
              />
              <Route
                path="/seller/new-product"
                element={<CustomSignedIn><SellerGuard><NewProductPage /></SellerGuard></CustomSignedIn>}
              />
              <Route
                path="/seller/edit-product/:id"
                element={<CustomSignedIn><SellerGuard><EditProductPage /></SellerGuard></CustomSignedIn>}
              />
              <Route
                path="/seller/new-offer"
                element={<CustomSignedIn><SellerGuard><NewOfferPage /></SellerGuard></CustomSignedIn>}
              />

              {/* Brand routes */}
              <Route
                path="/brand/dashboard"
                element={<CustomSignedIn><BrandGuard><BrandDashboard /></BrandGuard></CustomSignedIn>}
              />

              {/* Admin routes */}
              <Route
                path="/admin/dashboard"
                element={<CustomSignedIn><AdminGuard><AdminDashboard /></AdminGuard></CustomSignedIn>}
              />
            </Routes>
          </RoleGuard>
        </BrowserRouter>
        <DevTools />
      </CustomUserProvider>
    </ThemeProvider>
  );
}

export default App;
