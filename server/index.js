require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { initializeDatabase } = require('./db/setup');

const inventoryRoutes = require('./routes/inventory');
const deliveriesRoutes = require('./routes/deliveries');
const aiRoutes = require('./routes/ai');
const usageRoutes = require('./routes/usage');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/inventory', inventoryRoutes);
app.use('/api/deliveries', deliveriesRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/usage', usageRoutes);

// catch-all so page refreshes work on HTML pages
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

initializeDatabase();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CafePro running at http://localhost:${PORT}`);
  });
}

module.exports = app;
