import { ShieldCheck, Shield, ShieldAlert, ShieldX, Eye } from 'lucide-react';

/**
 * Phase 3.5 — Trust tier badge.
 *
 * BUYER MODE (default, adminMode=false):
 *   All tiers render identically — "Return in Progress" with a neutral icon
 *   and the same reassuring copy. The buyer never learns which tier they're on
 *   or that their refund timing is being held.
 *
 * ADMIN MODE (adminMode=true):
 *   Full tier name, colour, and honest tooltip. Used on admin/seller dashboards.
 */

// ── Internal full metadata (admin-only) ──────────────────────────────────────
const TIER_META = {
  verified: {
    label: 'Verified',
    icon: ShieldCheck,
    classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    tooltip: 'Trusted account. Return is fast-tracked with an abbreviated evidence flow.',
    message: 'Return is fast-tracked. Refund will be issued shortly.',
  },
  trusted: {
    label: 'Trusted',
    icon: Shield,
    classes: 'bg-blue-50 text-blue-700 border-blue-200',
    tooltip: 'Good standing. Standard flow, fast-tracked through routing.',
    message: 'Return is being processed.',
  },
  standard: {
    label: 'Standard',
    icon: Shield,
    classes: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    tooltip: 'Default flow. Standard evidence and review.',
    message: 'Return is under review.',
  },
  watch: {
    label: 'Watch',
    icon: Eye,
    classes: 'bg-orange-50 text-orange-700 border-orange-200',
    tooltip: 'Extra verification required. Refund is withheld until grading clears.',
    message: 'Additional verification required. Refund after grading.',
  },
  restricted: {
    label: 'Restricted',
    icon: ShieldX,
    classes: 'bg-red-50 text-red-700 border-red-200',
    tooltip: 'Manual review only. In-person inspection required.',
    message: 'Return requires manual inspection.',
  },
};

// ── Neutral buyer-facing representation (same for every tier) ────────────────
const BUYER_META = {
  icon: Shield,
  classes: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  label: 'Return in Progress',
  message: 'Your return is being processed. We\'ll notify you once it\'s reviewed.',
};

export function getTierMeta(tier) {
  return TIER_META[tier] || TIER_META.standard;
}

/**
 * Props:
 *   tier        — trust tier string ('verified' | 'trusted' | 'standard' | 'watch' | 'restricted')
 *   showMessage — also render the status message below the badge
 *   adminMode   — show full tier name and colour (admin/seller dashboards only)
 *   className   — extra wrapper classes
 */
export default function TrustTierBadge({
  tier,
  showMessage = false,
  adminMode = false,
  className = '',
}) {
  if (!tier) return null;

  if (adminMode) {
    const meta = getTierMeta(tier);
    const Icon = meta.icon;
    return (
      <div className={className}>
        <span
          title={meta.tooltip}
          className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${meta.classes}`}
        >
          <Icon className="w-3.5 h-3.5" />
          Trust Tier: {meta.label}
        </span>
        {showMessage && (
          <p className="text-xs text-gray-500 mt-2">{meta.message}</p>
        )}
      </div>
    );
  }

  // Buyer mode — identical output regardless of actual tier
  const Icon = BUYER_META.icon;
  return (
    <div className={className}>
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${BUYER_META.classes}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {BUYER_META.label}
      </span>
      {showMessage && (
        <p className="text-xs text-gray-500 mt-2">{BUYER_META.message}</p>
      )}
    </div>
  );
}
