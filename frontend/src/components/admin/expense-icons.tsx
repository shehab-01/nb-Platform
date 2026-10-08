import { createElement } from "react";
import {
  Briefcase,
  Building2,
  Car,
  Coffee,
  CreditCard,
  Droplets,
  Flame,
  Fuel,
  Gift,
  GraduationCap,
  Hammer,
  HeartPulse,
  House,
  Landmark,
  Leaf,
  Megaphone,
  Package,
  Phone,
  Plane,
  Printer,
  Receipt,
  Shapes,
  Shirt,
  ShoppingBasket,
  ShoppingCart,
  Tag,
  Truck,
  Users,
  Utensils,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The icons an expense category can wear, by the key the API stores
 * (expense_categories.icon). The default categories use the first seven;
 * the rest are offered in the New category picker. A key not listed here —
 * one written by a newer admin, say — shows as the plain tag.
 */
export const EXPENSE_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "shopping-basket", label: "Groceries", Icon: ShoppingBasket },
  { key: "package", label: "Packaging", Icon: Package },
  { key: "truck", label: "Delivery", Icon: Truck },
  { key: "zap", label: "Electricity", Icon: Zap },
  { key: "users", label: "People", Icon: Users },
  { key: "wrench", label: "Repairs", Icon: Wrench },
  { key: "shapes", label: "Miscellaneous", Icon: Shapes },
  { key: "tag", label: "Tag", Icon: Tag },
  { key: "house", label: "Rent", Icon: House },
  { key: "building-2", label: "Office", Icon: Building2 },
  { key: "shopping-cart", label: "Purchases", Icon: ShoppingCart },
  { key: "car", label: "Transport", Icon: Car },
  { key: "fuel", label: "Fuel", Icon: Fuel },
  { key: "phone", label: "Phone", Icon: Phone },
  { key: "wifi", label: "Internet", Icon: Wifi },
  { key: "megaphone", label: "Marketing", Icon: Megaphone },
  { key: "printer", label: "Printing", Icon: Printer },
  { key: "utensils", label: "Food", Icon: Utensils },
  { key: "coffee", label: "Tea & snacks", Icon: Coffee },
  { key: "droplets", label: "Water", Icon: Droplets },
  { key: "flame", label: "Gas", Icon: Flame },
  { key: "hammer", label: "Tools", Icon: Hammer },
  { key: "shirt", label: "Clothing", Icon: Shirt },
  { key: "briefcase", label: "Business", Icon: Briefcase },
  { key: "landmark", label: "Bank & tax", Icon: Landmark },
  { key: "receipt", label: "Bills", Icon: Receipt },
  { key: "credit-card", label: "Card fees", Icon: CreditCard },
  { key: "gift", label: "Gifts", Icon: Gift },
  { key: "heart-pulse", label: "Medical", Icon: HeartPulse },
  { key: "graduation-cap", label: "Training", Icon: GraduationCap },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "leaf", label: "Plants & raw goods", Icon: Leaf },
];

const BY_KEY = new Map(EXPENSE_ICONS.map((i) => [i.key, i.Icon]));

export function expenseIcon(key: string | undefined): LucideIcon {
  return (key && BY_KEY.get(key)) || Tag;
}

/** A category's icon by its key. The lookup happens here, inside one stable
 *  component, so callers never pick a component type during render. */
export function ExpenseIcon({ icon, className }: { icon?: string; className?: string }) {
  return createElement(expenseIcon(icon), { className, "aria-hidden": true });
}
