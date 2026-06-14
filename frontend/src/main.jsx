import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import App from './App.jsx'
import './index.css'
import { CartProvider } from './context/CartContext.jsx'

// Import your publishable key
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  console.warn("Missing Publishable Key. Please set VITE_CLERK_PUBLISHABLE_KEY in your .env")
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY || "missing-key"} afterSignOutUrl="/">
      <CartProvider>
        <App />
      </CartProvider>
    </ClerkProvider>
  </React.StrictMode>,
)
