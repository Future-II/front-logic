const express = require('express');
const router = express.Router();
const excelDataController = require('../controllers/excelData.controller');
const upload = require('../../shared/middlewares/upload');

// Apply the controller methods to routes
router.post('/upload', upload.single('excelFile'), excelDataController.uploadExcel);
router.get('/records', excelDataController.getAllExcelData);
router.get('/records/summary', excelDataController.getDataSummary);
router.get('/records/:id', excelDataController.getExcelDataById);
router.get('/download/:id', excelDataController.downloadExcelFile);
router.delete('/records/:id', excelDataController.deleteExcelData);
router.patch('/toggle-checked/:id', excelDataController.toggleChecked);

module.exports = router;