const express = require('express');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;
const projectRoot = __dirname;
const reportsDir = path.join(projectRoot, 'reports');
const dbPath = path.join(projectRoot, 'report.db');

fs.mkdirSync(reportsDir, { recursive: true });

const db = new DatabaseSync(dbPath);

function toAbsoluteReportPath(relativePath) {
  return path.join(projectRoot, relativePath);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function getReportData() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS totalOrders,
      COALESCE(SUM(amount), 0) AS totalRevenue
    FROM orders
  `).get();

  const topProducts = db.prepare(`
    SELECT product, SUM(amount) AS revenue
    FROM orders
    GROUP BY product
    ORDER BY revenue DESC, product ASC
    LIMIT 5
  `).all();

  const ordersPerDay = db.prepare(`
    SELECT DATE(created_at) AS date, COUNT(*) AS orderCount
    FROM orders
    WHERE created_at >= date('now', '-6 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all();

  const allOrders = db.prepare(`
    SELECT id, customer, product, amount, created_at
    FROM orders
    ORDER BY created_at DESC, id DESC
  `).all();

  return {
    totalOrders: Number(totals.totalOrders),
    totalRevenue: Number(totals.totalRevenue),
    topProducts,
    ordersPerDay,
    allOrders
  };
}

function buildReportHtml(report) {
  const generatedDate = new Date().toISOString().slice(0, 10);
  const topRows = report.topProducts.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${row.product}</td>
      <td>$${Number(row.revenue).toFixed(2)}</td>
    </tr>
  `).join('');

  const dailyRows = report.ordersPerDay.map((row) => `
    <tr>
      <td>${row.date}</td>
      <td>${row.orderCount}</td>
    </tr>
  `).join('');

  const allOrderRows = report.allOrders.map((row) => `
    <tr>
      <td>${row.id}</td>
      <td>${row.customer}</td>
      <td>${row.product}</td>
      <td>$${Number(row.amount).toFixed(2)}</td>
      <td>${row.created_at}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Sales Report</title>
        <style>
          @page { margin: 18mm; }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            color: #1f2937;
            background: white;
          }
          h1, h2, h3 { margin-bottom: 12px; }
          .meta { margin-bottom: 18px; color: #4b5563; }
          .metrics {
            display: grid;
            grid-template-columns: repeat(2, minmax(180px, 1fr));
            gap: 12px;
            margin-bottom: 24px;
          }
          .metric {
            border: 1px solid #d1d5db;
            border-radius: 8px;
            padding: 14px;
            background: #f9fafb;
          }
          .metric-label {
            display: block;
            font-size: 12px;
            text-transform: uppercase;
            color: #6b7280;
            margin-bottom: 6px;
          }
          .metric-value {
            font-size: 28px;
            font-weight: bold;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            margin-bottom: 28px;
          }
          th, td {
            border: 1px solid #d1d5db;
            padding: 8px 10px;
            text-align: left;
            vertical-align: middle;
          }
          thead {
            display: table-header-group;
          }
          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          thead th {
            background: #e5e7eb;
            font-weight: 700;
          }
          .section {
            margin-top: 24px;
          }
        </style>
      </head>
      <body>
        <h1>Sales Report</h1>
        <div class="meta">Generated on ${generatedDate}</div>

        <div class="metrics">
          <div class="metric">
            <span class="metric-label">Total Orders</span>
            <div class="metric-value">${report.totalOrders}</div>
          </div>
          <div class="metric">
            <span class="metric-label">Total Revenue</span>
            <div class="metric-value">$${Number(report.totalRevenue).toFixed(2)}</div>
          </div>
        </div>

        <div class="section">
          <h2>Top 5 products by revenue</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              ${topRows || '<tr><td colspan="3">No data</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Orders per day (last 7 days)</h2>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              ${dailyRows || '<tr><td colspan="2">No data</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>All orders</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${allOrderRows || '<tr><td colspan="5">No data</td></tr>'}
            </tbody>
          </table>
        </div>
      </body>
    </html>`;
}

async function generatePdfFromReport(report) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
  const html = buildReportHtml(report);
  await page.setContent(html, { waitUntil: 'load' });

  const reportId = Date.now();
  const relativePath = `reports/${reportId}.pdf`;
  const absolutePath = toAbsoluteReportPath(relativePath);
  await page.pdf({
    path: absolutePath,
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' }
  });

  await browser.close();
  return { reportId, relativePath, absolutePath };
}

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/reports', async (req, res) => {
  const force = Boolean(req.body && req.body.force === true);
  const today = new Date().toISOString().slice(0, 10);

  const existing = db.prepare(
    'SELECT id, path FROM reports WHERE date(created_at) = ? ORDER BY id DESC LIMIT 1'
  ).get(today);

  if (!force && existing) {
    return res.status(200).json({
      id: existing.id,
      file: `/reports/${existing.id}/file`
    });
  }

  const reportData = getReportData();
  const { relativePath } = await generatePdfFromReport(reportData);

  const result = db.prepare('INSERT INTO reports (path, created_at) VALUES (?, ?)').run(relativePath, new Date().toISOString());
  const rowId = result.lastInsertRowid;

  const response = {
    id: rowId,
    file: `/reports/${rowId}/file`
  };

  if (force && existing) {
    return res.status(201).json(response);
  }

  return res.status(201).json(response);
});

app.get('/reports/:id', (req, res) => {
  const row = db.prepare('SELECT id, path, created_at FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!row) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.json({
    id: row.id,
    created_at: row.created_at,
    file: `/reports/${row.id}/file`
  });
});

app.get('/reports/:id/file', (req, res) => {
  const row = db.prepare('SELECT path FROM reports WHERE id = ?').get(Number(req.params.id));
  if (!row) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const absolutePath = toAbsoluteReportPath(row.path);
  if (!fs.existsSync(absolutePath)) {
    return res.status(404).json({ error: 'File not found on disk' });
  }

  res.sendFile(absolutePath);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
