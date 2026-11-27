-- =====================================================================
-- Demo data for FoodBank (paste into the Neon SQL Editor, run once).
-- Only runs on an empty database. One transaction. Stock is reduced for every distributed line.
-- The three demo users are created LOCKED (no usable password). Set passwords yourself with
-- neon-set-demo-passwords.sql, so no password is ever written in this repository.
-- =====================================================================
BEGIN;
DO $$
DECLARE
  admin_id INT; s1 INT; s2 INT;
  it INT[] := '{}'; fam INT[] := '{}';
  d INT; rec RECORD; line INT[];
BEGIN
  IF EXISTS (SELECT 1 FROM food_items) THEN
    RAISE NOTICE 'food_items already has data - demo seed skipped';
    RETURN;
  END IF;

  INSERT INTO users (name, email, password_hash, role) VALUES ('Admin User', 'admin@foodbank.local', '!locked', 'admin')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING user_id INTO admin_id;
  INSERT INTO users (name, email, password_hash, role) VALUES ('Staff One', 'staff1@foodbank.local', '!locked', 'staff')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING user_id INTO s1;
  INSERT INTO users (name, email, password_hash, role) VALUES ('Staff Two', 'staff2@foodbank.local', '!locked', 'staff')
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING user_id INTO s2;

  FOR rec IN SELECT * FROM (VALUES
    ('Milk 1L','dairy',40,'bottle',-1,'shop','Fresh Mart','Fridge A'),
    ('Yoghurt cups','dairy',60,'pot',1,'shop','Fresh Mart','Fridge A'),
    ('White cheese 500g','dairy',25,'pack',9,'organization','Dairy Co-op','Fridge B'),
    ('Bread loaf','bakery',30,'loaf',2,'shop','Corner Bakery','Shelf 1'),
    ('Pita bread (10 pack)','bakery',45,'pack',4,'shop','Corner Bakery','Shelf 1'),
    ('Bananas','fresh',50,'kg',3,'individual',NULL,'Crate 2'),
    ('Tomatoes','fresh',35,'kg',6,'organization','City Farmers Market','Crate 3'),
    ('Potatoes','fresh',80,'kg',25,'organization','City Farmers Market','Crate 4'),
    ('Rice 5kg','dry',40,'bag',240,'organization','Grain Aid','Shelf 3'),
    ('Pasta 500g','dry',120,'pack',300,'shop','Hyper One','Shelf 3'),
    ('Lentils 1kg','dry',70,'bag',365,'individual',NULL,'Shelf 4'),
    ('Canned beans','canned',150,'can',6,'shop','Hyper One','Shelf 5'),
    ('Canned tuna','canned',90,'can',400,'organization','Grain Aid','Shelf 5'),
    ('Frozen chicken 1kg','frozen',20,'pack',60,'shop','Fresh Mart','Freezer 1'),
    ('Frozen vegetables','frozen',35,'bag',120,'individual',NULL,'Freezer 1'),
    ('Bottled water 1.5L','beverages',200,'bottle',500,'organization','Water For All','Pallet 1'),
    ('Orange juice 1L','beverages',30,'carton',12,'shop','Hyper One','Fridge B'),
    ('Soap bars','hygiene',100,'bar',900,'organization','Clean Hands NGO','Shelf 6'),
    ('Baby formula','other',15,'tin',45,'individual',NULL,'Shelf 7')
  ) AS v(name, category, qty, unit, expires_in, donor_type, donor_name, loc)
  LOOP
    INSERT INTO food_items (name, category, quantity, unit, donation_date, expiry_date, donor_type, donor_name, storage_location, created_by)
    VALUES (rec.name, rec.category, rec.qty, rec.unit, CURRENT_DATE - 30, CURRENT_DATE + rec.expires_in, rec.donor_type, rec.donor_name, rec.loc, s1)
    RETURNING item_id INTO d;
    it := it || d;
  END LOOP;

  FOR rec IN SELECT * FROM (VALUES ('FAM-0001',4,'01000000001'),('FAM-0002',2,NULL),('FAM-0003',6,'01000000003'),
                                   ('FAM-0004',3,NULL),('FAM-0005',5,'01000000005'),('FAM-0006',1,NULL)) AS v(ref, size, phone)
  LOOP
    INSERT INTO families (household_ref, household_size, contact_phone, created_by) VALUES (rec.ref, rec.size, rec.phone, s1)
    RETURNING family_id INTO d;
    fam := fam || d;
  END LOOP;

  -- days ago, family #, staff (1 or 2), lines as {item #, quantity, item #, quantity, ...} (1-based positions)
  FOR rec IN SELECT * FROM (VALUES
    (28,1,1,'{9,2,10,6,13,4}'::int[]), (21,2,2,'{10,4,11,3}'::int[]), (17,3,1,'{9,3,12,10,16,12}'::int[]),
    (12,4,2,'{8,6,13,4,18,4}'::int[]), (8,5,1,'{10,8,14,2,16,10}'::int[]), (5,1,2,'{11,4,17,6}'::int[]),
    (3,6,1,'{4,2,6,3,12,6}'::int[]), (1,3,2,'{2,12,5,6,7,4}'::int[])
  ) AS v(days_ago, fam_no, staff_no, lines)
  LOOP
    INSERT INTO distributions (family_id, staff_user_id, distributed_at)
    VALUES (fam[rec.fam_no], CASE rec.staff_no WHEN 1 THEN s1 ELSE s2 END, now() - make_interval(days => rec.days_ago))
    RETURNING distribution_id INTO d;
    FOR i IN 1 .. array_length(rec.lines, 1) BY 2 LOOP
      INSERT INTO distribution_items (distribution_id, item_id, quantity) VALUES (d, it[rec.lines[i]], rec.lines[i + 1]);
      UPDATE food_items SET quantity = quantity - rec.lines[i + 1], updated_at = now() WHERE item_id = it[rec.lines[i]];
    END LOOP;
  END LOOP;
  RAISE NOTICE 'demo data loaded';
END $$;
COMMIT;
