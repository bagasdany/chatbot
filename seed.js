import mysqlPool from './db/mysql.js';

async function seedData() {
  try {
    // Insert Bookings
    await mysqlPool.query(`
      INSERT INTO bookings (customer_name, service_type, booking_date, status) VALUES 
      ('Budi Santoso', 'Servis Berkala', DATE_ADD(NOW(), INTERVAL 1 DAY), 'confirmed'),
      ('Siti Rahayu', 'Ganti Oli', DATE_ADD(NOW(), INTERVAL 2 DAY), 'pending'),
      ('Agus Pratama', 'Tune Up', DATE_SUB(NOW(), INTERVAL 1 DAY), 'completed'),
      ('Maya Indah', 'Check Rem', DATE_ADD(NOW(), INTERVAL 5 DAY), 'pending')
    `);

    // Insert Orders
    await mysqlPool.query(`
      INSERT INTO orders (customer_name, product_name, amount, status) VALUES 
      ('Budi Santoso', 'Oli Mesin 4L', 450000, 'paid'),
      ('Siti Rahayu', 'Filter Udara', 120000, 'unpaid'),
      ('Agus Pratama', 'Busi Set', 200000, 'shipped'),
      ('Hendra Setiawan', 'Aki Mobil', 1250000, 'paid')
    `);

    console.log('✅ Dummy data successfully inserted into MySQL!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
}

seedData();
