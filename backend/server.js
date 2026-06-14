require("dotenv").config();
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const connectDB = require("./src/config/database");
const { errorHandler } = require("./src/middleware/error.middleware");

// Routes
const userRoutes = require("./src/modules/users/user.routes");
const webhookRoutes = require("./src/modules/webhooks/webhook.routes");
const productRoutes = require("./src/modules/products/product.routes");
const adminRoutes = require("./src/modules/admin/admin.routes");
const reviewRoutes = require("./src/modules/reviews/review.routes");
const orderRoutes = require("./src/modules/orders/order.routes");
const brandRoutes = require("./src/modules/brands/brand.routes");
const brandCatalogRoutes = require("./src/modules/brandCatalog/brandCatalogEntry.routes");
const offerRoutes = require("./src/modules/offers/sellerOffer.routes");
const devRoutes = require("./src/modules/dev/dev.routes");

// Phase 0 — New module routes
const returnsRoutes = require("./src/modules/returns/return.routes");
const secondhandRoutes = require("./src/modules/secondhand/secondhand.routes");
const gradingRoutes = require("./src/modules/grading/grading.routes");
const routingRoutes = require("./src/modules/routing/routing.routes");
const demandRoutes = require("./src/modules/demand/demand.routes");
const healthCardRoutes = require("./src/modules/healthCard/healthCard.routes");
const sustainabilityRoutes = require("./src/modules/sustainability/sustainability.routes");
const trustRoutes = require("./src/modules/trust/trust.routes");
const uploadsRoutes = require("./src/modules/uploads/uploads.routes");
const itemsRoutes = require("./src/modules/items/item.routes");
const lifecycleRoutes = require("./src/modules/lifecycle/lifecycle.routes");
const preventionRoutes = require("./src/modules/prevention/prevention.routes");
const festiveRoutes = require("./src/modules/festive/festive.routes");
const promptRoutes = require("./src/modules/prompts/prompt.routes");
const resaleRoutes = require("./src/modules/resale/resale.routes");

const app = express();

// Database Connection
connectDB();

// Middleware
app.use(helmet());

// CORS — allow the frontend origin (Phase 3.5). In development we accept the
// configured FRONTEND_URL plus common Vite ports; falls back to permissive if unset.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser tools (no origin) and any whitelisted origin.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      // In development, be permissive so the team isn't blocked by port drift.
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// Webhook routes must come before express.json() so they can parse raw bodies
app.use("/api/webhooks", webhookRoutes);

app.use(express.json());


// Health Check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK" });
});

// Routes
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/brands", brandRoutes);
app.use("/api/brand-catalog", brandCatalogRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/dev", devRoutes);

// Phase 0 — New module routes
app.use("/api/returns", returnsRoutes);
app.use("/api/secondhand", secondhandRoutes);
app.use("/api/grading", gradingRoutes);
app.use("/api/routing", routingRoutes);
app.use("/api/demand", demandRoutes);
app.use("/api/health-card", healthCardRoutes);
app.use("/api/sustainability", sustainabilityRoutes);
app.use("/api/trust", trustRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/lifecycle", lifecycleRoutes);
app.use("/api/prevention", preventionRoutes);
app.use("/api/festive", festiveRoutes);
app.use("/api/prompts", promptRoutes);
app.use("/api/resale", resaleRoutes);

// Error Handler
app.use(errorHandler);

// Port configuration updated to resolve EADDRINUSE conflict
const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("hi");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
