-- Migration 002: Add phone and designation to staff_users, add guest_name and guest_phone to orders
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE staff_users ADD COLUMN IF NOT EXISTS designation text NOT NULL DEFAULT '';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_name text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_phone text NOT NULL DEFAULT '';

-- Insert Royal Non-Veg Feast Thali into menu_items if not exists
INSERT INTO menu_items (id, name, section, sub, description, price, veg, egg, signature, available, img, hero, sort_order)
VALUES (
  'royal-nonveg-thali',
  'Royal Non-Veg Feast Thali',
  'Pahari Dham',
  '',
  'Mutton Rogan Josh, Butter Chicken, Dal Makhani, Steamed Rice, Butter Naan, Pahari Raita, Gulab Jamun, Salad & Chutneys. Pre-order recommended.',
  790.00,
  false,
  false,
  true,
  true,
  'photos/mutton_rogan_josh.webp',
  'photos/mutton_rogan_josh.webp',
  15
)
ON CONFLICT (id) DO NOTHING;

-- Insert default thali settings
INSERT INTO settings (key, value)
VALUES (
  'thali',
  '{
    "veg": {
      "id": "pahari-dham-pahari-dham-thali",
      "name": "Pahari Dham Thali",
      "price": 650,
      "desc": "Traditional Himachali feast: Rajma Madra, Chana Madra, Sepu Badi, Khatta, Mahni, Chana Dal, Aloo Palak, Steamed Rice, Pahari Raita, Mittha, Salad, Papad & Pickle.",
      "img": "photos/dham_thali.webp",
      "hero": "photos/dham_thali_big.webp",
      "items": ["Rajma Madra", "Chana Madra", "Sepu Badi", "Khatta", "Mahni", "Chana Dal", "Aloo Palak", "Steamed Rice", "Pahari Raita", "Mittha", "Salad, Papad & Pickle"]
    },
    "nonveg": {
      "id": "royal-nonveg-thali",
      "name": "Royal Non-Veg Feast Thali",
      "price": 790,
      "desc": "Grand mountain feast: Mutton Rogan Josh, Butter Chicken, Dal Makhani, Steamed Rice, Butter Naan, Pahari Raita, Gulab Jamun, Salad & Chutneys.",
      "img": "photos/mutton_rogan_josh.webp",
      "hero": "photos/mutton_rogan_josh.webp",
      "items": ["Mutton Rogan Josh", "Butter Chicken", "Dal Makhani", "Steamed Rice", "Butter Naan", "Pahari Raita", "Gulab Jamun", "Salad & Chutneys"]
    }
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
