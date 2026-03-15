import mysql from 'mysql2/promise';
import 'dotenv/config';

// Create a connection pool for MySQL
// These environment variables need to be set in your .env file
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'talismanic_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

/**
 * Initialize MySQL Database Schema if it doesn't exist
 */
export async function initMySQL() {
  try {
    const connection = await pool.getConnection();
    
    // Create bookings table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        service_type VARCHAR(255) NOT NULL,
        booking_date DATETIME NOT NULL,
        status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create orders table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        status ENUM('unpaid', 'paid', 'shipped', 'delivered') DEFAULT 'unpaid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    connection.release();
    console.log('✅ MySQL Database check complete');
  } catch (error) {
    console.warn('⚠️  MySQL Connection pending. Pastikan MySQL berjalan dan .env diisi dengan benar:', error.message);
  }
}

export default pool;
