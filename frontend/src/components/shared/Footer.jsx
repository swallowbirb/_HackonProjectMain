import { Link, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';


const TwitterIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    stroke="currentColor"
    strokeWidth="2"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  </svg>
);

const GithubIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    stroke="currentColor"
    strokeWidth="2"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
  </svg>
);

const LinkedinIcon = (props) => (
  <svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    stroke="currentColor"
    strokeWidth="2"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </svg>
);

const FOOTER_CATEGORIES = [
  'Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books', 'Health & Beauty',
];

export default function Footer() {
  const navigate = useNavigate();

  return (
    <footer className="mt-auto">
      {/* Back to top */}
      <div
        className="amz-nav-secondary text-white text-center py-3 text-sm cursor-pointer hover:bg-[#37475A] transition-colors"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        Back to top
      </div>

      {/* Main footer */}
      <div className="amz-nav text-white py-10 px-6">
        <div className="max-w-[1200px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="font-bold text-sm mb-3">Get to Know Us</h3>
            <ul className="space-y-1.5 text-sm text-zinc-400">
              <li><Link to="/" className="hover:text-white transition-colors">About Us</Link></li>
              <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Press Releases</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-sm mb-3">Make Money with Us</h3>
            <ul className="space-y-1.5 text-sm text-zinc-400">
              <li><Link to="/role-selection" className="hover:text-white transition-colors">Sell on Marketplace</Link></li>
              <li><a href="#" className="hover:text-white transition-colors">Become an Affiliate</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-sm mb-3">Shop by Category</h3>
            <ul className="space-y-1.5 text-sm text-zinc-400">
              {FOOTER_CATEGORIES.map(cat => (
                <li key={cat}>
                  <button
                    onClick={() => navigate(`/search?category=${encodeURIComponent(cat)}`)}
                    className="hover:text-white transition-colors text-left"
                  >
                    {cat}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-sm mb-3">Let Us Help You</h3>
            <ul className="space-y-1.5 text-sm text-zinc-400">
              <li><a href="#" className="hover:text-white transition-colors">Your Account</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Returns Centre</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Help</a></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-[#0F1111] text-zinc-500 py-4 px-6 text-xs text-center flex flex-col md:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-white font-bold">
          <Shield className="w-4 h-4 text-[#FF9900]" />
          <span>marketplace<span className="text-[#FF9900]">.security</span></span>
        </div>
        <p>© 2026 AI-Powered Marketplace Security. Built for fraud detection research.</p>
        <div className="flex items-center gap-3">
          <a href="#" className="hover:text-white transition-colors"><TwitterIcon className="w-4 h-4" /></a>
          <a href="#" className="hover:text-white transition-colors"><GithubIcon className="w-4 h-4" /></a>
          <a href="#" className="hover:text-white transition-colors"><LinkedinIcon className="w-4 h-4" /></a>
        </div>
      </div>
    </footer>
  );
}
