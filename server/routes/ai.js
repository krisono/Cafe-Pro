const express = require('express');
const router = express.Router();
const queries = require('../db/queries');
const aiService = require('../services/ai');
const fallback = require('../services/fallback');

router.get('/daily-brief', async (req, res) => {
  try {
    const snapshot = queries.getInventorySnapshot();
    const brief = await aiService.generateDailyBrief(snapshot);
    res.json({ brief, source: 'ai' });
  } catch (err) {
    console.warn('AI daily-brief failed, using fallback:', err.message);
    try {
      const snapshot = queries.getInventorySnapshot();
      const brief = fallback.generateDailyBrief(snapshot);
      res.json({ brief, source: 'fallback' });
    } catch (fallbackErr) {
      res.status(500).json({ error: fallbackErr.message });
    }
  }
});

router.post('/shelf-life', async (req, res) => {
  try {
    const { name, category, date } = req.body;
    if (!name || !category) {
      return res.status(400).json({ error: 'name and category are required' });
    }
    const today = date || new Date().toISOString().split('T')[0];
    const result = await aiService.estimateShelfLife({ name, category, date: today });
    res.json({ ...result, source: 'ai' });
  } catch (err) {
    console.warn('AI shelf-life failed, using fallback:', err.message);
    try {
      const { name, category, date } = req.body;
      const today = date || new Date().toISOString().split('T')[0];
      const result = fallback.estimateShelfLife({ name, category, date: today });
      res.json({ ...result, source: 'fallback' });
    } catch (fallbackErr) {
      res.status(500).json({ error: fallbackErr.message });
    }
  }
});

module.exports = router;
