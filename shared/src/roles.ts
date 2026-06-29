// Roles & domain enums shared by server and web.

export const ROLES = ['admin', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const DEVICE_TYPES = ['PC', 'PS5', 'Xbox', 'VR'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const CUSTOMER_TIERS = ['Casual', 'Pro', 'Elite'] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

// Live status shown on the floor. `available`/`maintenance` are operator-set on the
// device; `active`/`reserved` are DERIVED on read from sessions / upcoming bookings.
export const DEVICE_LIVE_STATUS = ['available', 'active', 'reserved', 'maintenance'] as const;
export type DeviceLiveStatus = (typeof DEVICE_LIVE_STATUS)[number];

// Operator-controlled base status persisted on the device row.
export const DEVICE_BASE_STATUS = ['available', 'maintenance'] as const;
export type DeviceBaseStatus = (typeof DEVICE_BASE_STATUS)[number];

export const BOOKING_STATUS = ['upcoming', 'active', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];

// Account ledger: how a charge was collected and whether it's been settled.
export const PAYMENT_METHODS = ['Cash', 'UPI', 'Card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INVOICE_STATUS = ['pending', 'paid'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

// Sections of the app that staff may NOT access (admin-only). Enforced server-side
// AND used to hide nav items on the web.
export const ADMIN_ONLY_SECTIONS = ['devices', 'pricing', 'analytics'] as const;
export type AdminOnlySection = (typeof ADMIN_ONLY_SECTIONS)[number];

export function isAdminOnly(section: string): section is AdminOnlySection {
  return (ADMIN_ONLY_SECTIONS as readonly string[]).includes(section);
}
