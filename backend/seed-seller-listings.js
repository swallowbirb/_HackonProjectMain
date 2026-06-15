require('dotenv').config();
const mongoose = require('mongoose');

const User = require('./src/modules/users/user.model');
const Product = require('./src/modules/products/product.model');

// ─── Product definitions ────────────────────────────────────────────────────
const PRODUCTS = [
  {
    title: 'Vintage Snapback Cap – Washed Cotton Heritage Edition',
    description: `A meticulously crafted snapback cap that blends old-school aesthetics with everyday wearability. Made from premium washed cotton that gets softer with every wear, this cap features a structured 6-panel design with a flat brim and an adjustable snap closure at the back for a universal fit.

The intentionally faded colorway gives it that lived-in, vintage feel straight out of the box — no breaking-in required. The embroidered logo on the front panel is stitched with precision, ensuring it holds its shape wash after wash. A breathable cotton sweatband lines the interior to keep you comfortable during long wear.

Whether you're heading to a weekend market, a casual hangout, or just running errands, this cap ties any outfit together effortlessly. Pairs perfectly with oversized tees, hoodies, or a clean denim jacket.

Key Features:
• 100% washed cotton construction
• Structured 6-panel flat-brim design
• Adjustable snap closure — fits most head sizes
• Embroidered front logo, sewn sweatband
• Pre-faded vintage colorway
• Hand wash recommended, air dry`,
    price: 89,
    category: 'Fashion',
    condition: 'New',
    brandName: 'HeritageWear',
    images: [
      'https://preview.redd.it/btgv41p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=aa8f0d37d765c332abf3c2cbaa01c356fd4495d9',
      'https://preview.redd.it/xb0642p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=6bac1a4f85e93eb7da6b372219652d34acd9d848',
      'https://preview.redd.it/tjslj6p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=c5770568492dde9c7b90132c846ddddcc821d74f',
      'https://preview.redd.it/o5rb52p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=84fc82b05863783a52a5973a3ca5318427d64755',
    ],
  },
  {
    title: 'Minimalist Wooden Desk Clock – Silent Quartz Movement',
    description: `Elevate your workspace or bedside table with this beautifully understated wooden desk clock. Crafted from sustainably sourced solid oak with a smooth matte finish, it brings warmth and character to any interior — whether your aesthetic is Scandinavian minimal, rustic farmhouse, or modern industrial.

Powered by a precision Japanese quartz movement, this clock runs whisper-quiet with no ticking sounds to disturb your focus or sleep. The clean sans-serif numerals are laser-etched directly into the wood for a crisp, permanent finish that won't peel or fade over time.

The compact footprint makes it ideal for desks, shelves, mantlepieces, or nightstands. Battery-powered (1× AA, included) — no cables, no clutter.

Key Features:
• Solid sustainably sourced oak body
• Silent Japanese quartz movement — zero tick noise
• Laser-etched numerals, no paint or stickers
• Compact form: 15cm × 8cm × 4cm
• Matte natural wood finish
• Runs on 1× AA battery (included)
• Makes a thoughtful housewarming or office gift`,
    price: 145,
    category: 'Home & Living',
    condition: 'New',
    brandName: 'CraftTimeCo',
    images: [
      'https://preview.redd.it/l6itt2p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=668e48ae547f9f10cf4665640a4032a8ccfb2967',
      'https://preview.redd.it/m5oi17p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=ca7de8f23ef9cec180271f7d1ef8cee897e0c0e2',
      'https://preview.redd.it/mq0va5v7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=16624232bdebbc439015be2d30604d753a31bc54',
      'https://preview.redd.it/cr5wz3p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=0cf917c5710ba856e8255864060766786881eb0d',
    ],
  },
  {
    title: 'Urban Field Jacket – Water-Resistant Waxed Canvas',
    description: `Built for the city but tough enough for the trail, this field jacket is the kind of piece you reach for without thinking. Constructed from heavyweight waxed canvas, it develops a unique patina over time — becoming more characterful the more you wear it.

The water-resistant finish sheds light rain and wind effortlessly, making this your go-to layer for unpredictable weather. Four exterior pockets (two chest, two hand-warmer) and two interior pockets give you ample storage without sacrificing the clean silhouette. A corduroy-lined collar adds a touch of softness against the neck.

The relaxed fit works over a hoodie in colder months or a simple tee when the weather turns. Reinforced stitching at all stress points means this jacket is made to last years, not seasons.

Key Features:
• Heavyweight waxed canvas shell — improves with age
• Water-resistant, windproof outer layer
• Corduroy-lined collar for added comfort
• 4 exterior + 2 interior pockets
• Reinforced seams and stress points
• Relaxed fit — size up if layering heavily
• Machine wash cold, re-wax periodically to maintain finish`,
    price: 215,
    category: 'Fashion',
    condition: 'New',
    brandName: 'FieldCraft',
    images: [
      'https://preview.redd.it/pvdow5werf7h1.jpg?width=1080&crop=smart&auto=webp&s=2a2b3232646481fb2b537f0d3ec905b6aab6b4c8',
      'https://preview.redd.it/5cho96werf7h1.jpg?width=960&format=pjpg&auto=webp&s=8107145e3f8fb31c4b8966d11f0387b42cacfbd1',
      'https://preview.redd.it/ntcoo4werf7h1.jpg?width=960&format=pjpg&auto=webp&s=ba9adc088151b30078da0cecb045ec9e5072014a',
      'https://preview.redd.it/jn5si5werf7h1.jpg?width=960&format=pjpg&auto=webp&s=ed02b575787bb7587106f4df3aeb7e21f8b0b004',
    ],
  },
  {
    title: 'Low-Maintenance Indoor Succulent — Ceramic Pot Included',
    description: `Bring a touch of nature indoors with this handpicked succulent, pre-potted in a premium matte ceramic pot. Succulents are nature's most forgiving houseplants — they thrive on neglect, survive irregular watering, and ask for nothing more than a bright windowsill.

Each plant is individually selected and potted by hand, then allowed to settle before shipping to ensure it arrives healthy and stress-free. The ceramic pot features a drainage hole with a matching saucer to protect your surfaces, and its neutral matte glaze pairs with any interior style from bohemian to ultra-modern.

Perfect for desks, bookshelves, kitchen windowsills, or bathroom counters. Also makes a genuinely useful and long-lasting gift — far better than cut flowers that wilt in a week.

Key Features:
• Healthy, established succulent — species varies seasonally
• Hand-thrown matte ceramic pot with drainage hole + saucer
• Pot dimensions: ~9cm diameter × 8cm tall
• Ships in protective packaging to prevent soil spillage
• Care card included: light, water, and repotting guidance
• Pet-friendly species where possible (noted on care card)
• No green thumb required`,
    price: 98,
    category: 'Home & Garden',
    condition: 'New',
    brandName: 'GreenNook',
    images: [
      'https://preview.redd.it/oiet54p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=166f3c1c8d843df40abdabe8369993151dcbab32',
      'https://preview.redd.it/2ay2v8p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=fd10fddf23f65c6ad1e0ada61f956d6205f67a3c',
      'https://preview.redd.it/xcehd3p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=0c0337689f250c6fb14397aa9ee35ca41731e987',
      'https://preview.redd.it/fvp9t6p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=547939bd21f211c241a74b498e334ab8f77ec1fe',
    ],
  },
  {
    title: 'Premium Shoe Cleaning Kit – 8-Piece Restore & Protect Set',
    description: `Your sneakers and leather shoes deserve better than a damp cloth. This professional-grade cleaning kit gives you everything you need to deep-clean, restore, and protect any footwear — from white canvas sneakers to suede boots to polished leather dress shoes.

The kit is built around a pH-balanced, all-surface foam cleanser that lifts dirt, scuffs, and oxidation without damaging materials or stripping color. Paired with the soft-bristle cleaning brush, stiff-bristle scrubbing brush, microfiber cloth, and suede eraser, you have the right tool for every surface and every level of grime.

The included water-repellent protector spray creates an invisible barrier that keeps mud, water, and stains off your freshly cleaned shoes for weeks. Compact enough to store in a shoebox, strong enough to tackle even neglected kicks.

Kit Contents:
• 120ml pH-balanced foam cleanser
• Soft-bristle detailing brush (uppers + mesh)
• Stiff-bristle scrubbing brush (soles + midsoles)
• Suede & nubuck eraser bar
• Water-repellent protector spray (100ml)
• 2× premium microfiber cloths
• Drawstring carry bag

Works on: Canvas, Leather, Suede, Nubuck, Mesh, Knit, Rubber`,
    price: 125,
    category: 'Footwear & Accessories',
    condition: 'New',
    brandName: 'SoleCraft',
    images: [
      'https://preview.redd.it/3gombpq7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=d65915d2019dc6b9d50b8059f0b6896d1c153f69',
      'https://preview.redd.it/65yvd1p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=d36ad1bb60f954e7dfbf6bc1d0dbf68d27266a73',
      'https://preview.redd.it/4zgv54p7mf7h1.jpg?width=960&format=pjpg&auto=webp&s=e5e27036e18017d6600c52ac6a635c0d10ffa363',
    ],
  },
];

// ─── Main ───────────────────────────────────────────────────────────────────
async function run() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.\n');

  // Fetch all sellers (not banned, not suspended)
  const sellers = await User.find({
    role: 'seller',
    banned: { $ne: true },
    suspended: { $ne: true },
  })
    .sort({ createdAt: 1 })
    .lean();

  if (sellers.length === 0) {
    console.error('No sellers found in the database. Aborting.');
    process.exit(1);
  }

  console.log(`Found ${sellers.length} seller(s):`);
  sellers.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.firstName} ${s.lastName} — ${s.email} (${s._id})`);
  });

  if (sellers.length < PRODUCTS.length) {
    console.warn(`\nWarning: only ${sellers.length} seller(s) but ${PRODUCTS.length} products defined.`);
    console.warn(`Only the first ${sellers.length} product(s) will be created.\n`);
  }

  const count = Math.min(sellers.length, PRODUCTS.length);
  const created = [];

  for (let i = 0; i < count; i++) {
    const seller = sellers[i];
    const productData = {
      ...PRODUCTS[i],
      sellerId: seller._id,
      status: 'approved',
    };

    const product = await Product.create(productData);
    created.push({ seller: `${seller.firstName} ${seller.lastName}`, product: product.title, id: product._id });
    console.log(`✓ Created "${product.title}" → seller: ${seller.firstName} ${seller.lastName}`);
  }

  console.log(`\n✅ Done. ${created.length} product(s) inserted.`);
  console.table(created.map(c => ({ Seller: c.seller, Product: c.product, ProductId: c.id.toString() })));

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
