const express = require('express');
const router = express.Router();
const { getBooks, createBook, updateBook, inactivateBook, getBooksReport } = require('../controllers/books.controller');

router.get('/report', getBooksReport);

router.get('/', getBooks);
router.post('/', createBook);
router.put('/:id', updateBook);
router.patch('/:id/inactivate', inactivateBook);

module.exports = router;