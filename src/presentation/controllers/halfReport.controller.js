const { spawn } = require("child_process");
const path = require("path");
const AppError = require("../../shared/utils/appError");
const extractAssetData = require("../../application/taqeem/extractAssetData.uc.js");
const reportDataExtract = require("../../application/taqeem/reportDataExtract.uc.js");
const { getAssetsByUserIdUC } = require("../../application/reports/getAssetsByUserId.uc.js");
const { getHalfReportsByUserIdUC } = require("../../application/reports/getHalfReportsByUserId.uc.js");
const { noBaseDataExtraction } = require("../../application/taqeem/noBaseDataExtraction.uc.js")
const { formDataExtraction } = require("../../application/taqeem/formDataExtraction.uc.js")
const { getHalfReportByIdUC } = require("../../application/reports/getHalfReportById.uc.js")
const { checkHalfReport } = require("../../application/reports/checkHalfReport.uc.js")

let pyWorker = null;
let stdoutBuffer = "";
const pending = new Map(); 
const activeTasks = new Map(); 

// Import io instance (will be set by server.js)
let io = null;

function setSocketIO(socketIO) {
  io = socketIO;
}

// --- Ensure Python Worker ---
function ensurePyWorker() {
  if (pyWorker && !pyWorker.killed) return pyWorker;

  const isWin = process.platform === "win32";
  const venvPython = isWin
    ? path.join(__dirname, "../../../.venv/Scripts/python.exe")
    : path.join(__dirname, "../../../.venv/bin/python");

  const scriptPath = path.join(__dirname, "../../scripts/equip/worker_equip.py");
  const scriptDir = path.dirname(scriptPath);

  pyWorker = spawn(venvPython, [scriptPath], { cwd: scriptDir });

  pyWorker.on("spawn", () => console.log("[PY] Worker spawned"));

  pyWorker.stdout.on("data", (data) => {
    stdoutBuffer += data.toString();
    let lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        console.error("[PY] Invalid JSON line:", line);
        continue;
      }

      console.log("[PY] Response:", parsed);

      // Handle progress updates - emit to socket clients
      if (parsed.type === "PROGRESS" && io) {
        const reportId = parsed.reportId;
        if (reportId) {
          // Emit to room specific to this report
          io.to(`report_${reportId}`).emit('form_fill_progress', {
            reportId: reportId,
            status: parsed.status,
            message: parsed.message,
            timestamp: parsed.timestamp,
            data: {
              step: parsed.step,
              total_steps: parsed.total_steps,
              total: parsed.total,
              current: parsed.current,
              percentage: parsed.percentage,
              macro_id: parsed.macro_id,
              form_id: parsed.form_id,
              error: parsed.error
            }
          });
        }
        continue; // Don't process as regular response
      }

      // Store taskId for reportId mapping when task starts
      if (parsed.status === "STARTED" && parsed.taskId && parsed.reportId) {
        activeTasks.set(parsed.reportId, parsed.taskId);
        console.log(`[TASK REGISTERED] reportId=${parsed.reportId}, taskId=${parsed.taskId}`);
        continue;
      }

      // Immediate control responses
      if (["PAUSED", "RESUMED", "STOPPED"].includes(parsed.status)) {
        const handler = pending.get("control");
        if (handler) {
          handler.resolve(parsed);
          pending.delete("control");
        }
        
        if (parsed.status === "STOPPED" && parsed.reportId) {
          activeTasks.delete(parsed.reportId);
          
          // Emit stop confirmation to socket
          if (io) {
            io.to(`report_${parsed.reportId}`).emit('form_fill_stopped', {
              reportId: parsed.reportId,
              status: 'STOPPED',
              message: 'Form filling stopped by user',
              timestamp: new Date().toISOString()
            });
          }
        }
        continue;
      }

      // Task completion responses
      const finalStatuses = ["SUCCESS", "FAILED", "CLOSED", "LOGIN_SUCCESS", "NOT_FOUND", "OTP_REQUIRED", "OTP_FAILED"];
      if (finalStatuses.includes(parsed.status)) {
        const handler = pending.get("task");
        if (handler) {
          handler.resolve(parsed);
          pending.delete("task");
        }
        
        // Cleanup active task
        if (parsed.reportId) {
          activeTasks.delete(parsed.reportId);
          
          // Emit completion to socket
          if (io) {
            if (parsed.status === "SUCCESS") {
              io.to(`report_${parsed.reportId}`).emit('form_fill_complete', {
                reportId: parsed.reportId,
                status: 'SUCCESS',
                message: 'Form filling completed successfully',
                results: parsed.results,
                timestamp: new Date().toISOString()
              });
            } else if (parsed.status === "FAILED") {
              io.to(`report_${parsed.reportId}`).emit('form_fill_error', {
                reportId: parsed.reportId,
                status: 'FAILED',
                error: parsed.error,
                timestamp: new Date().toISOString()
              });
            }
          }
        }
      }
    }
  });

  pyWorker.stderr.on("data", (data) => console.error(`[PY STDERR] ${data.toString()}`));
  
  pyWorker.on("close", (code, signal) => {
    console.log(`[PY] Worker exited (code=${code}, signal=${signal})`);
    pending.forEach((handler) => handler.reject(new AppError("Python worker exited", 500)));
    pending.clear();
    pyWorker = null;
    stdoutBuffer = "";
  });

  return pyWorker;
}

// --- Send Command to Worker ---
function sendCommand(cmdObj, type = "task") {
  const py = ensurePyWorker();
  
  return new Promise((resolve, reject) => {
    const handler = { resolve, reject };
    pending.set(type, handler);

    try {
      py.stdin.write(JSON.stringify(cmdObj) + "\n");
    } catch (e) {
      pending.delete(type);
      reject(new AppError("Failed to send command to Python worker", 500));
    }

    // Timeout for control commands (should be instant)
    if (type === "control") {
      setTimeout(() => {
        if (pending.has(type)) {
          pending.delete(type);
          reject(new AppError("Control command timeout", 500));
        }
      }, 5000);
    }
  });
}

// --- Close Worker ---
async function closeWorker() {
  if (!pyWorker) return;
  try {
    await sendCommand({ action: "close" });
  } catch (e) {
    console.error("[closeWorker] error:", e);
  } finally {
    try {
      pyWorker.kill("SIGTERM");
    } catch (e) {
      console.error("[closeWorker] kill error:", e);
    }
    pyWorker = null;
  }
}

// --- Controllers ---

const loginOrOtp = async (req, res, next) => {
  const { email, password, otp } = req.body;
  try {
    let payload;
    if (otp) payload = { action: "otp", otp };
    else if (email && password) payload = { action: "login", email, password };
    else return res.status(400).json({ success: false, message: "Email/password or OTP required" });

    const response = await sendCommand(payload);
    res.json(response);
  } catch (err) {
    console.error("[loginOrOtp] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const fillReportForm2 = async (req, res, next) => {
  const { id } = req.body;
  let tabsNum = parseInt(req.body.tabsNum, 10);
  if (isNaN(tabsNum) || tabsNum < 1) tabsNum = 3;

  try {
    const response = await sendCommand({ action: "formFill2", reportId: id, tabsNum, socketMode: true });
    res.json(response);
  } catch (err) {
    console.error("[fillReportForm2] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const pause = async (req, res, next) => {
  try {
    const { id } = req.body;  // Get reportId from body
    const taskId = activeTasks.get(id);
    
    console.log(`[PAUSE] reportId=${id}, taskId=${taskId}, activeTasks=`, Array.from(activeTasks.entries()));
    
    const response = await sendCommand({ 
      action: "pause", 
      reportId: id,
      taskId 
    }, "control");
    
    // Emit pause event to socket
    if (io) {
      io.to(`report_${id}`).emit('form_fill_paused', {
        reportId: id,
        status: 'PAUSED',
        message: 'Form filling paused',
        timestamp: new Date().toISOString()
      });
    }
    
    res.json(response);
  } catch (err) {
    console.error("[pause] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const resume = async (req, res, next) => {
  try {
    const { id } = req.body;  // Get reportId from body
    const taskId = activeTasks.get(id);
    
    console.log(`[RESUME] reportId=${id}, taskId=${taskId}`);
    
    const response = await sendCommand({ 
      action: "resume", 
      reportId: id,
      taskId 
    }, "control");
    
    // Emit resume event to socket
    if (io) {
      io.to(`report_${id}`).emit('form_fill_resumed', {
        reportId: id,
        status: 'RESUMED',
        message: 'Form filling resumed',
        timestamp: new Date().toISOString()
      });
    }
    
    res.json(response);
  } catch (err) {
    console.error("[resume] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const stop = async (req, res, next) => {
  try {
    const { id } = req.body;  // Get reportId from body
    const taskId = activeTasks.get(id);
    
    console.log(`[STOP] reportId=${id}, taskId=${taskId}`);
    
    const response = await sendCommand({ 
      action: "stop", 
      reportId: id,
      taskId 
    }, "control");
    
    res.json(response);
  } catch (err) {
    console.error("[stop] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const checkMacros = async (req, res, next) => {
  const { id } = req.body;
  let tabsNum = parseInt(req.body.tabsNum, 10);
  if (isNaN(tabsNum) || tabsNum < 1) tabsNum = 3;

  try {
    const response = await sendCommand({ action: "checkMacros", reportId: id, tabsNum });
    res.json(response);
  } catch (err) {
    console.error("[checkMacros] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const retryMacros = async (req, res, next) => {
  const { id } = req.body;
  let tabsNum = parseInt(req.body.tabsNum, 10);
  if (isNaN(tabsNum) || tabsNum < 1) tabsNum = 3;

  try {
    const response = await sendCommand({ action: "retryMacros", recordId: id, tabsNum, socketMode: true });
    res.json(response);
  } catch (err) {
    console.error("[retryMacros] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const reportDataExtraction = async (req, res, next) => {
  const excelFilePath = req.files?.excel?.[0]?.path;
  const pdfFilePaths = req.files?.pdfs?.[0]?.path;
  const userId = req.user.userId;
  
  try {
    const result = await reportDataExtract(excelFilePath, pdfFilePaths, userId);
    if (result.status !== "SUCCESS") {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.json({ success: true, status: "SAVED", data: result.data, message: "Report saved." });
  } catch (err) {
    console.error("[reportDataExtract] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const getAssetsByUserId = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const assets = await getAssetsByUserIdUC(userId);
    res.status(200).json(assets);
  } catch (err) {
    console.error("[getAssetsByUserId] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const getHalfReportsByUserId = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const reports = await getHalfReportsByUserIdUC(userId);
    res.status(200).json(reports);
  } catch (err) {
    console.error("[getHalfReportsByUserId] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const fillHalfReportForm = async (req, res, next) => {
  const { baseData } = req.body;
  const excelFilePath = req.files?.excel?.[0]?.path;
  const pdfFilePaths = req.files?.pdfs?.map(f => f.path) || [];

  try {
    if (!excelFilePath) {
      return res.status(400).json({ success: false, message: "Excel file is required" });
    }

    const result = await extractAssetData(excelFilePath, pdfFilePaths[0], baseData);
    if (result.status !== "SUCCESS") {
      return res.status(400).json({ success: false, message: result.error });
    }

    const response = await sendCommand({ action: "formFill", reportId: result.data._id });
    res.json({
      success: true,
      status: "SAVED",
      data: result.data,
      automation: response,
      message: "Report saved and automation executed.",
    });
  } catch (err) {
    console.error("[fillHalfReportForm] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const extractExistingReportData = async (req, res, next) => {
  const { reportId } = req.body;
  const userId = req.user.userId;
  const excelFilePath = req.files?.excel?.[0]?.path;

  try {
    if (!excelFilePath) {
      return res.status(400).json({ success: false, message: "Excel file is required" });
    }

    const result = await noBaseDataExtraction(excelFilePath, reportId, userId)
    
    if (result.status !== "SUCCESS") {
      return res.status(400).json({
        success: false,
        message: result.error,
        summary: result.summary,
        highlights: result.highlights
      });
    }

    res.json({
      success: true,
      status: "SAVED",
      data: result.data,
      message: "Assets added to report.",
    });
  } catch (err) {
    console.error("[extractExistingReportData] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const withFormDataExtraction = async (req, res, next) => {
  const { formData } = req.body;
  const excelFilePath = req.files?.excel?.[0]?.path;
  const pdfFilePaths = req.files?.pdfs?.[0]?.path;
  const userId = req.user.userId;

  try {
    const result = await formDataExtraction(excelFilePath, pdfFilePaths, userId, formData);
    if (result.status !== "SUCCESS") {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.json({ success: true, status: "SAVED", data: result.data, message: "Report saved." });
  } catch (err) {
    console.error("[formDataExtraction] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const addAssetsToReport = async (req, res, next) => {
  const { reportId } = req.body;

  try {
    const response = await sendCommand({ action: "addAssets", reportId });
    res.json(response);
  } catch (err) {
    console.error("[addAssetsToReport] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const getHalfReportById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId; // From authentication middleware
    
    // Query parameters for customization
    const {
      includeAssets = 'true',
      assetFields = '',
      checkOwnership = 'false',
      summary = 'false'
    } = req.query;

    // Parse boolean parameters
    const includeAssetsBool = includeAssets.toLowerCase() === 'true';
    const checkOwnershipBool = checkOwnership.toLowerCase() === 'true';
    const summaryBool = summary.toLowerCase() === 'true';

    // Parse asset fields array
    const assetFieldsArray = assetFields ? assetFields.split(',').map(field => field.trim()) : [];

    const options = {
      includeAssets: includeAssetsBool,
      assetFields: assetFieldsArray,
      checkOwnership: checkOwnershipBool,
      userId: checkOwnershipBool ? userId : null
    };

    let result;
    
    if (summaryBool) {
      result = await getHalfReportByIdUC.getReportSummary(id);
    } else {
      result = await getHalfReportByIdUC.execute(id, options);
    }

    res.status(200).json({
      success: true,
      status: 'SUCCESS',
      data: result.data,
      message: result.message,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`[getHalfReportById] Controller error for ID ${req.params.id}:`, error);
    
    // Determine appropriate status code
    let statusCode = 500;
    let message = 'Internal server error';

    if (error.statusCode) {
      statusCode = error.statusCode;
      message = error.message;
    } else if (error.message.includes('not found')) {
      statusCode = 404;
      message = 'Report not found';
    } else if (error.message.includes('access denied')) {
      statusCode = 403;
      message = 'Access denied to this report';
    } else if (error.message.includes('Invalid report ID')) {
      statusCode = 400;
      message = error.message;
    }

    res.status(statusCode).json({
      success: false,
      status: 'ERROR',
      message: message,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
};

const checkAssets = async (req, res, next) => {
  const { reportId } = req.body;
  
  try {
    const response = await sendCommand({ action: "check", reportId });
    res.json(response);
  } catch (err) {
    console.error("[checkAssets] error:", err);
    next(err instanceof AppError ? err : new AppError(String(err), 500));
  }
};

const setCheck = async (req, res, next) => {
  try {
    const { id } = req.body;
    
    const updatedReport = await checkHalfReport(id);
    
    res.json({ 
      success: true, 
      data: updatedReport
    });
  } catch (err) {
    console.error("[setCheck] error:", err);
    
    const statusCode = err.message === 'Report not found' ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: err.message
    });
  }
};

module.exports = {
  loginOrOtp,
  fillHalfReportForm,
  fillReportForm2,
  addAssetsToReport,
  extractExistingReportData,
  retryMacros,
  withFormDataExtraction,
  reportDataExtraction,
  getHalfReportsByUserId,
  checkMacros,
  getHalfReportById,
  checkAssets,
  getAssetsByUserId,
  setCheck,
  pause,
  resume,
  stop,
  sendCommand,
  closeWorker,
  setSocketIO,  // Export to allow server.js to inject io instance
  activeTasks   // Export for debugging/monitoring
};