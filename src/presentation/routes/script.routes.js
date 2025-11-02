const express = require('express');
const upload = require('../../shared/middlewares/upload');

const { runTaqeemScript, retryTaqeemScript } = require('../controllers/script.controller');
const { runMeqyasScript, runMultipleMeqyasScript } = require('../controllers/meqyas.controller');
const { 
  loginOrOtp, 
  fillHalfReportForm,
  fillReportForm2,
  addAssetsToReport, 
  extractExistingReportData, 
  getAssetsByUserId, 
  getHalfReportById,
  withFormDataExtraction,
  checkMacros,
  pause,
  stop,
  deleteHalfReport,
  resume,
  retryMacros,
  getHalfReportsByUserId,
  reportDataExtraction,
  setCheck
 } = require('../controllers/halfReport.controller'); 
const authMiddleware = require('../../shared/middlewares/auth.middleware');

const scriptRouter = express.Router();

scriptRouter.post(
  '/taqeemLogin',
  upload.fields([
    { name: 'excel', maxCount: 1 },
    { name: 'pdfs', maxCount: 10 }
  ]),
  runTaqeemScript
);
scriptRouter.post("/equip/withFormExtract", authMiddleware, upload.fields([
  { name: 'excel', maxCount: 1 },
  { name: 'pdfs', maxCount: 10 }
]), withFormDataExtraction);

scriptRouter.post('/retryTaqeem/:batchId', retryTaqeemScript);

scriptRouter.post('/meqyas', runMeqyasScript);
scriptRouter.post('/meqyasMultiple', runMultipleMeqyasScript);

scriptRouter.post(
  '/equip/login',
  loginOrOtp
);

scriptRouter.post(
  '/equip/fillForm',
  upload.fields([
    { name: 'excel', maxCount: 1 },
    { name: 'pdfs', maxCount: 1 }
  ]),
  fillHalfReportForm
);

scriptRouter.post('/equip/fillForm2', authMiddleware, fillReportForm2);

scriptRouter.get('/equip/assets', authMiddleware, getAssetsByUserId);
scriptRouter.get('/equip/reports', authMiddleware, getHalfReportsByUserId);
scriptRouter.get('/equip/report', authMiddleware, getHalfReportById);

scriptRouter.post('/equip/check', authMiddleware, checkMacros);
scriptRouter.post('/equip/retry', authMiddleware, retryMacros);
scriptRouter.post('/equip/checkReport', authMiddleware, setCheck);
scriptRouter.delete("/equip/report/:reportId", authMiddleware, deleteHalfReport);

scriptRouter.post('/equip/pause', authMiddleware, pause);
scriptRouter.post('/equip/resume', authMiddleware, resume);
scriptRouter.post('/equip/stop', authMiddleware, stop);

scriptRouter.post(
  '/equip/extractData',
  authMiddleware,
  upload.fields([
    { name: 'excel', maxCount: 1 },
    { name: 'pdfs', maxCount: 0 }
  ]),
  extractExistingReportData
);

scriptRouter.post(
  '/equip/reportDataExtract',
  authMiddleware,
  upload.fields([
    { name: 'excel', maxCount: 1 },
    { name: 'pdfs', maxCount: 1 }
  ]),
  reportDataExtraction
);

scriptRouter.post('/equip/addAssets', addAssetsToReport);

module.exports = scriptRouter;
