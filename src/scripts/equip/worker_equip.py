import asyncio
import sys
import json
import traceback
import platform

from login import startLogin, submitOtp
from browser import closeBrowser, get_browser
from formFiller import runFormFill
from formFiller2 import runFormFill2, runCheckMacros, retryMacros
from addAssets import check_incomplete_macros

if platform.system().lower() == "windows":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

_task_controls = {} 

class TaskStoppedException(Exception):
    """Raised when task is stopped"""
    pass

def create_control_state(task_id, report_id=None):
    """Create a new control state for a task"""
    _task_controls[task_id] = {
        "paused": False,
        "stopped": False,
        "report_id": report_id
    }
    return _task_controls[task_id]

def get_control_state(task_id):
    """Get control state for a task"""
    return _task_controls.get(task_id)

def cleanup_control_state(task_id):
    """Remove control state when task completes"""
    if task_id in _task_controls:
        del _task_controls[task_id]

async def check_control(state):
    """Check if we should pause or stop"""
    if state["stopped"]:
        raise TaskStoppedException("Task was stopped by user")
    
    while state["paused"]:
        await asyncio.sleep(0.5)

async def _readline(loop):
    return await loop.run_in_executor(None, sys.stdin.readline)

async def command_handler():
    """Handles incoming commands concurrently"""
    loop = asyncio.get_running_loop()
    
    while True:
        line = await _readline(loop)
        if not line:
            break
        
        try:
            cmd = json.loads(line.strip())
        except json.JSONDecodeError:
            print(json.dumps({"status": "FAILED", "error": "Invalid JSON"}), flush=True)
            continue
        
        action = cmd.get("action")
        
        # Handle control commands (require taskId or reportId)
        if action == "pause":
            task_id = cmd.get("taskId")
            report_id = cmd.get("reportId")
            
            # Find task by taskId or reportId
            target_state = None
            if task_id and task_id in _task_controls:
                target_state = _task_controls[task_id]
            elif report_id:
                for tid, state in _task_controls.items():
                    if state.get("report_id") == report_id:
                        target_state = state
                        task_id = tid
                        break
            
            if target_state:
                target_state["paused"] = True
                print(json.dumps({
                    "status": "PAUSED", 
                    "message": "Task paused",
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)
            else:
                print(json.dumps({
                    "status": "FAILED", 
                    "error": "Task not found",
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)
        
        elif action == "resume":
            task_id = cmd.get("taskId")
            report_id = cmd.get("reportId")
            
            target_state = None
            if task_id and task_id in _task_controls:
                target_state = _task_controls[task_id]
            elif report_id:
                for tid, state in _task_controls.items():
                    if state.get("report_id") == report_id:
                        target_state = state
                        task_id = tid
                        break
            
            if target_state:
                target_state["paused"] = False
                print(json.dumps({
                    "status": "RESUMED", 
                    "message": "Task resumed",
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)
            else:
                print(json.dumps({
                    "status": "FAILED", 
                    "error": "Task not found",
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)

        elif action == "stop":
            task_id = cmd.get("taskId")
            report_id = cmd.get("reportId")
            
            target_state = None
            if task_id and task_id in _task_controls:
                target_state = _task_controls[task_id]
            elif report_id:
                for tid, state in _task_controls.items():
                    if state.get("report_id") == report_id:
                        target_state = state
                        task_id = tid
                        break
            
            if target_state:
                target_state["stopped"] = True
                target_state["paused"] = False  # Unpause if paused
                
                # Close all tabs except the main page
                try:
                    browser = await get_browser()
                    pages = browser.tabs
                    if len(pages) > 1:
                        # Close all tabs except the first one (main page)
                        for page in pages[1:]:
                            try:
                                await page.close()
                            except Exception as e:
                                print(f"Warning: Failed to close tab: {e}", file=sys.stderr)
                        print(f"Closed {len(pages) - 1} additional tabs", file=sys.stderr)
                except Exception as e:
                    print(f"Warning: Error closing tabs: {e}", file=sys.stderr)
                
                print(json.dumps({
                    "status": "STOPPED", 
                    "message": "Task stopped",
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)
            else:
                print(json.dumps({
                    "status": "FAILED", 
                    "error": "Task not found",
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)
        
        elif action == "close":
            browser = await get_browser()
            if browser is not None:
                await closeBrowser()
                await asyncio.sleep(1)
                print(json.dumps({"status": "CLOSED"}), flush=True)

            break
        
        else:
            # Queue other commands
            asyncio.create_task(handle_action(cmd))

async def handle_action(cmd):
    record_id = cmd.get("recordId")
    task_id = record_id
    
    try:
        action = cmd.get("action")
        
        if action == "login":
            browser = await get_browser(force_new=True)
            page = await browser.get(
                "https://sso.taqeem.gov.sa/realms/REL_TAQEEM/protocol/openid-connect/auth"
                "?client_id=cli-qima-valuers&redirect_uri=https%3A%2F%2Fqima.taqeem.sa%2Fkeycloak%2Flogin%2Fcallback"
                "&scope=openid&response_type=code"
            )
            result = await startLogin(page, cmd.get("email", ""), cmd.get("password", ""))
            print(json.dumps(result), flush=True)
        
        elif action == "otp":
            browser = await get_browser()
            page = browser.main_tab
            result = await submitOtp(page, cmd.get("otp", ""))
            print(json.dumps(result), flush=True)
        
        elif action == "formFill2":
            browser = await get_browser()
            tabs_num = int(cmd.get("tabsNum", 3))
            report_id = cmd.get("reportId", "")
            
            # Create control state for this specific task
            control_state = create_control_state(task_id, report_id)
            
            try:
                result = await runFormFill2(browser, report_id, tabs_num, control_state=control_state)
                result["taskId"] = task_id
                print(json.dumps(result), flush=True)
            except TaskStoppedException as e:
                print(json.dumps({
                    "status": "STOPPED", 
                    "message": str(e),
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)
            finally:
                cleanup_control_state(task_id)
        
        elif action == "checkMacros":
            browser = await get_browser()
            tabs_num = int(cmd.get("tabsNum", 3))
            result = await runCheckMacros(browser, cmd.get("reportId", ""), tabs_num=tabs_num)
            result["taskId"] = task_id
            print(json.dumps(result), flush=True)
        
        elif action == "retryMacros":
            browser = await get_browser()
            tabs_num = int(cmd.get("tabsNum", 3))
            report_id = cmd.get("recordId", "")
            
            # Create control state for retry task
            control_state = create_control_state(task_id, report_id)
            
            try:
                result = await retryMacros(browser, report_id, tabs_num=tabs_num, control_state=control_state)
                result["taskId"] = task_id
                print(json.dumps(result), flush=True)
            except TaskStoppedException as e:
                print(json.dumps({
                    "status": "STOPPED", 
                    "message": str(e),
                    "taskId": task_id,
                    "reportId": report_id
                }), flush=True)
            finally:
                cleanup_control_state(task_id)
        
        elif action == "check":
            browser = await get_browser()
            result = await check_incomplete_macros(browser, cmd.get("reportId", ""))
            result["taskId"] = task_id
            print(json.dumps(result), flush=True)
        
        elif action == "formFill":
            browser = await get_browser()
            result = await runFormFill(browser, cmd.get("reportId", ""))
            result["taskId"] = task_id
            print(json.dumps(result), flush=True)
        
        else:
            result = {"status": "FAILED", "error": f"Unknown action: {action}", "taskId": task_id}
            print(json.dumps(result), flush=True)
    
    except Exception as e:
        tb = traceback.format_exc()
        print(json.dumps({
            "status": "FAILED", 
            "error": str(e), 
            "traceback": tb,
            "taskId": task_id
        }), flush=True)
        cleanup_control_state(task_id)

async def worker():
    try:
        await command_handler()
    except Exception as e:
        print(json.dumps({"status": "FATAL", "error": str(e)}), flush=True)
    finally:
        await closeBrowser()

if __name__ == "__main__":
    asyncio.run(worker())