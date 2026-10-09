import { createElement } from "react";
import {
  Amphora,
  Apple,
  Bean,
  Beef,
  Carrot,
  Cherry,
  Citrus,
  CookingPot,
  Drumstick,
  Egg,
  Fish,
  Flame,
  Ham,
  LeafyGreen,
  Nut,
  Salad,
  Shrimp,
  Soup,
  Sprout,
  Wheat,
  type LucideIcon,
} from "lucide-react";

/**
 * The icons a product can wear, by the key the API stores
 * (production_products.icon). A key not listed here shows as the cooking pot.
 */
export const PRODUCT_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "cooking-pot", label: "Pot", Icon: CookingPot },
  { key: "fish", label: "Fish", Icon: Fish },
  { key: "shrimp", label: "Shrimp", Icon: Shrimp },
  { key: "beef", label: "Beef", Icon: Beef },
  { key: "drumstick", label: "Chicken", Icon: Drumstick },
  { key: "ham", label: "Meat", Icon: Ham },
  { key: "egg", label: "Egg", Icon: Egg },
  { key: "carrot", label: "Vegetable", Icon: Carrot },
  { key: "leafy-green", label: "Greens", Icon: LeafyGreen },
  { key: "salad", label: "Mixed", Icon: Salad },
  { key: "citrus", label: "Lemon", Icon: Citrus },
  { key: "apple", label: "Fruit", Icon: Apple },
  { key: "cherry", label: "Berry", Icon: Cherry },
  { key: "bean", label: "Bean", Icon: Bean },
  { key: "nut", label: "Nut", Icon: Nut },
  { key: "wheat", label: "Grain", Icon: Wheat },
  { key: "sprout", label: "Shoot", Icon: Sprout },
  { key: "flame", label: "Hot", Icon: Flame },
  { key: "soup", label: "Gravy", Icon: Soup },
  { key: "amphora", label: "Jar", Icon: Amphora },
];

const BY_KEY = new Map(PRODUCT_ICONS.map((i) => [i.key, i.Icon]));

/** A product's icon by its key, looked up inside one stable component so
 *  callers never pick a component type during render. */
export function ProductIcon({ icon, className }: { icon?: string; className?: string }) {
  return createElement((icon && BY_KEY.get(icon)) || CookingPot, {
    className,
    "aria-hidden": true,
  });
}
