const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(__dirname, 'report.db');
const db = new DatabaseSync(dbPath);

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

const products = [
  'Laptop Stand',
  'Wireless Mouse',
  'Mechanical Keyboard',
  'USB-C Cable',
  'Monitor Arm',
  'Noise Cancelling Headphones'
];

const customers = [
  'Alicia', 'Bennett', 'Charli', 'Darius', 'Eva', 'Farah',
  'Gabriel', 'Hannah', 'Isaac', 'Jade', 'Kofi', 'Lena',
  'Mason', 'Nina', 'Omar', 'Priya', 'Quinn', 'Rina'
];

db.exec(`
  DROP TABLE IF EXISTS orders;
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer TEXT,
    product TEXT,
    amount REAL,
    created_at TEXT
  );
`);

const insert = db.prepare('INSERT INTO orders (customer, product, amount, created_at) VALUES (?, ?, ?, ?)');
for (let i = 0; i < 200; i += 1) {
  const customer = customers[randomBetween(0, customers.length - 1)];
  const product = products[randomBetween(0, products.length - 1)];
  const amount = Number((randomBetween(5, 200) + Math.random()).toFixed(2));
  const created_at = randomDate(randomBetween(0, 29));
  insert.run(customer, product, amount, created_at);
}

const count = db.prepare('SELECT COUNT(*) AS total FROM orders').get();
console.log(`Seeded ${count.total} orders into ${dbPath}`);
