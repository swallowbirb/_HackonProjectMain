import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomUser } from "../context/CustomUserContext";
import { motion } from "framer-motion";
import { ShoppingBag, Store, Shield, Tag } from "lucide-react";

const ROLES = [
  {
    id: "buyer",
    icon: ShoppingBag,
    title: "I want to buy",
    description: "Browse products, read reviews, and make secure purchases.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    hoverBg: "hover:bg-blue-500/20",
    border: "hover:border-blue-500/50",
  },
  {
    id: "seller",
    icon: Store,
    title: "I want to sell",
    description: "Create listings, manage your products, and grow your business.",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    hoverBg: "hover:bg-emerald-500/20",
    border: "hover:border-emerald-500/50",
  },
  {
    id: "brand",
    icon: Tag,
    title: "I represent a Brand",
    description: "Register your brand, protect keywords, and monitor enrolled sellers.",
    color: "text-[#FF9900]",
    bg: "bg-[#FF9900]/10",
    hoverBg: "hover:bg-[#FF9900]/20",
    border: "hover:border-[#FF9900]/50",
    badge: "Brand Owner",
  },
  {
    id: "admin",
    icon: Shield,
    title: "I am an admin",
    description: "Moderate listings, monitor risk scores, and manage platform safety.",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    hoverBg: "hover:bg-purple-500/20",
    border: "hover:border-purple-500/50",
    badge: "Testing Only",
    badgeColor: "text-amber-500/80 bg-amber-500/10 border-amber-500/20",
  },
];

export default function RoleSelectionPage() {
  const { role, updateRole, isLoadingRole } = useCustomUser();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);

  useEffect(() => {
    if (!isLoadingRole && role && role !== "pending") {
      const dest = ["seller", "admin", "brand"].includes(role) ? "/dashboard" : "/";
      navigate(dest);
    }
  }, [role, isLoadingRole, navigate]);

  const handleRoleSelect = async (selectedRoleId) => {
    setIsSubmitting(true);
    setSelectedRole(selectedRoleId);
    const success = await updateRole(selectedRoleId);
    if (success) {
      const dest = ["seller", "admin", "brand"].includes(selectedRoleId) ? "/dashboard" : "/";
      navigate(dest);
    } else {
      setIsSubmitting(false);
      setSelectedRole(null);
    }
  };

  if (isLoadingRole) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <div className="w-8 h-8 border-4 border-zinc-700 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="text-2xl font-black text-white">
              market<span className="text-[#FF9900]">place</span>
            </div>
            <span className="text-[#FF9900] text-xs font-bold">.security</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome to the Marketplace</h1>
          <p className="text-zinc-400 text-sm">How do you want to use the platform?</p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ROLES.map((roleItem, idx) => (
            <motion.button
              key={roleItem.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.08 }}
              disabled={isSubmitting}
              onClick={() => handleRoleSelect(roleItem.id)}
              className={`relative flex flex-col items-center justify-center p-8 border-2 border-zinc-800 rounded-2xl ${roleItem.hoverBg} ${roleItem.border} transition-all group disabled:opacity-50 disabled:cursor-not-allowed text-center`}
            >
              {roleItem.badge && (
                <span className={`absolute top-3 right-3 text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded border ${roleItem.badgeColor || 'text-[#FF9900]/80 bg-[#FF9900]/10 border-[#FF9900]/20'}`}>
                  {roleItem.badge}
                </span>
              )}

              <div className={`w-16 h-16 rounded-full ${roleItem.bg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                {isSubmitting && selectedRole === roleItem.id ? (
                  <div className="w-7 h-7 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
                ) : (
                  <roleItem.icon className={`w-8 h-8 ${roleItem.color}`} />
                )}
              </div>

              <h2 className="text-lg font-bold mb-2">{roleItem.title}</h2>
              <p className="text-sm text-zinc-400 text-center leading-relaxed">{roleItem.description}</p>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
