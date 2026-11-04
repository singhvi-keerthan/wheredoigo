// Shapes shared by the server, the pages and the cart builder.

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  isVeg: boolean;
  inStock: boolean;
  hasVariants: boolean;
  hasAddons: boolean;
  description: string | null;
  imageUrl: string | null;
}

export interface MenuCategory {
  title: string;
  items: MenuItem[];
}

export interface Menu {
  restaurantId: string;
  restaurantName: string;
  isOpen: boolean | null;
  sla: string | null;
  categories: MenuCategory[];
  fetchedAt: string;
}

export interface Option {
  id: string;
  name: string;
  price: number; // extra over the base price
  isDefault: boolean;
  inStock: boolean;
}

// A variant group: pick exactly one (size, milk…).
export interface VariantGroup {
  id: string;
  label: string;
  options: Option[];
}

// An addon group: pick between min and max (max -1 = no limit).
export interface AddonGroup {
  id: string;
  label: string;
  min: number;
  max: number;
  options: Option[];
}

export interface ItemDetails {
  itemId: string;
  name: string;
  basePrice: number;
  // Swiggy gives an item EITHER legacy `variations` OR `variantsV2`, and the
  // cart call must echo the same format back.
  variantFormat: "legacy" | "v2" | null;
  variantGroups: VariantGroup[];
  addonGroups: AddonGroup[];
  unavailable: string | null;
}

export interface Selection {
  groupId: string;
  optionId: string;
  name: string;
  price: number;
}

// What one person wants. Stored as JSON for a regular and for a day override.
export interface Choice {
  itemId: string;
  name: string;
  variantFormat: "legacy" | "v2" | null;
  variants: Selection[];
  addons: Selection[];
  unitPrice: number; // estimate shown on the site; Swiggy's cart is the real total
  note: string | null;
}

export interface PersonPick {
  personId: number;
  personName: string;
  choice: Choice;
}

export interface Settings {
  addressId: string | null;
  addressLabel: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  orderTime: string; // "HH:MM" IST
  reminderLeadMin: number;
  days: number[]; // 0 = Sunday … 6 = Saturday
  payment: "SwiggyPay" | "Cash";
  channelId: string | null;
  paused: boolean;
}
