const express = require('express');
const router = express.Router();
const { getReportePrestamos } = require('../controllers/reports.controller');

router.get('/loans', getReportePrestamos);

module.exports = router;