const express = require('express');
const sqlite3 = require('sqlite3-offline-next').verbose();
const path = require('path');
const cors = require('cors');

const app = express();

// Middleware configuration
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database setup (using sqlite3-offline-next)
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database via sqlite3-offline-next.');
  }
});

// Initialize database schema
db.serialize(() => {
  // Products table
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT,
      image_url TEXT,
      stock_quantity INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Categories table
  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Customers table
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Orders table
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      total_amount REAL NOT NULL,
      payment_status TEXT DEFAULT 'pending',
      order_status TEXT DEFAULT 'processing',
      shipping_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `);

  // Order Items table
  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);
});

// System & Health Check Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'ClassicFabTrends Backend API',
    database: 'sqlite3-offline-next',
    timestamp: new Date().toISOString()
  });
});

// Product API Endpoints
app.get('/api/products', (req, res) => {
  const query = 'SELECT * FROM products ORDER BY created_at DESC';
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/products/:id', (req, res) => {
  const query = 'SELECT * FROM products WHERE id = ?';
  db.get(query, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(row);
  });
});

app.post('/api/products', (req, res) => {
  const { name, description, price, category, image_url, stock_quantity } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Name and price are required parameters.' });
  }
  const query = `INSERT INTO products (name, description, price, category, image_url, stock_quantity) VALUES (?, ?, ?, ?, ?, ?)`;
  db.run(query, [name, description, price, category, image_url, stock_quantity || 0], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, message: 'Product successfully created.' });
  });
});

app.put('/api/products/:id', (req, res) => {
  const { name, description, price, category, image_url, stock_quantity } = req.body;
  const query = `UPDATE products SET name = ?, description = ?, price = ?, category = ?, image_url = ?, stock_quantity = ? WHERE id = ?`;
  db.run(query, [name, description, price, category, image_url, stock_quantity, req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product updated successfully.' });
  });
});

app.delete('/api/products/:id', (req, res) => {
  const query = 'DELETE FROM products WHERE id = ?';
  db.run(query, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted successfully.' });
  });
});

// Category API Endpoints
app.get('/api/categories', (req, res) => {
  db.all('SELECT * FROM categories ORDER BY name ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/categories', (req, res) => {
  const { name, slug } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'Category name and slug are required.' });
  db.run('INSERT INTO categories (name, slug) VALUES (?, ?)', [name, slug], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, message: 'Category added.' });
  });
});

// Order API Endpoints
app.get('/api/orders', (req, res) => {
  const query = `
    SELECT orders.*, customers.full_name, customers.email 
    FROM orders 
    LEFT JOIN customers ON orders.customer_id = customers.id 
    ORDER BY orders.created_at DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/orders', (req, res) => {
  const { customer_id, total_amount, shipping_address } = req.body;
  if (!total_amount) return res.status(400).json({ error: 'Order total amount is required.' });
  const query = 'INSERT INTO orders (customer_id, total_amount, shipping_address) VALUES (?, ?, ?)';
  db.run(query, [customer_id, total_amount, shipping_address], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ order_id: this.lastID, message: 'Order created successfully.' });
  });
});

// Single Page Application Fallback Route
app.get('*', (req, res) => {
  const indexFile = path.join(__dirname, 'public', 'index.html');
  res.sendFile(indexFile, (err) => {
    if (err) {
      res.status(200).send('ClassicFabTrends Node.js Backend Server is Running.');
    }
  });
});

// Server Listen & Vercel Module Export
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running locally on http://localhost:${PORT}`);
  });
}

module.exports = app;