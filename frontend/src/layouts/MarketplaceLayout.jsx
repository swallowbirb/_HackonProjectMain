import Navbar from '../components/shared/Navbar';

export default function MarketplaceLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col bg-[#EAEDED]">
      <Navbar />
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
