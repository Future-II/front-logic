import asyncio
import time
import traceback
import json
import sys
from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from formSteps2 import form_steps, macro_form_config
from addAssets import check_incomplete_macros_after_creation, check_incomplete_macros

MONGO_URI="mongodb+srv://test:JUL3OvyCSLVjSixj@assetval.pu3bqyr.mongodb.net/projectForever"
client = AsyncIOMotorClient(MONGO_URI)
db = client["projectForever"]

def emit_progress(status, message, reportId, **kwargs):
    """Emit progress updates that Node.js will forward to Socket.IO clients"""
    progress_data = {
        "type": "PROGRESS",
        "status": status,
        "message": message,
        "reportId": reportId,
        **kwargs
    }
    print(json.dumps(progress_data), flush=True)

def detect_report_type(record):
    """
    Detect if the report has base data or is asset-only
    Checks for presence of base data fields in the record
    """
    # Check for base data fields that indicate this is a with-base report
    base_data_fields = ['report_name', 'client_name', 'valuation_date', 'purpose_id', 'value_premise_id']
    
    # Check if any base data field exists and has a value in the record
    has_base_data = any(field in record and record[field] for field in base_data_fields)
    
    if has_base_data:
        return "with_base"
    else:
        return "without_base"

async def navigate_to_existing_report_assets(browser, report_id, control_state=None):
    """Navigate directly to asset creation page for existing report"""
    from worker_equip import check_control
    
    if control_state:
        await check_control(control_state)
    
    asset_creation_url = f"https://qima.taqeem.sa/report/asset/create/{report_id}"
    emit_progress("NAVIGATING_ASSET_PAGE", f"Navigating to asset creation for report {report_id}", report_id)
    
    main_page = await browser.get(asset_creation_url)
    await asyncio.sleep(2)
    
    current_url = await main_page.evaluate("window.location.href")
    if str(report_id) not in current_url:
        emit_progress("NAVIGATION_FAILED", f"Failed to navigate to asset creation page for report {report_id}", report_id)
        return None
    
    emit_progress("ON_ASSET_PAGE", f"Successfully reached asset creation page: {current_url}", report_id)
    return main_page

async def handle_without_base_report(browser, record, tabs_num=3, control_state=None, record_id=None):
    """Handle asset-only reports (without base data)"""
    from worker_equip import check_control
    
    results = []
    
    # Get report_id from the record
    report_id = record.get("report_id")
    if not report_id:
        emit_progress("MISSING_REPORT_ID", "Report ID not found in record data", record_id)
        return {"status": "FAILED", "error": "Report ID not found in record data"}
    
    main_page = await navigate_to_existing_report_assets(browser, report_id, control_state)
    if not main_page:
        return {"status": "FAILED", "error": f"Could not navigate to asset creation page for report {report_id}"}
    
    total_macros = len(record.get("asset_data", []))
    record["number_of_macros"] = str(total_macros)
    
    emit_progress("MACRO_CREATION_START", f"Starting macro creation for {total_macros} assets in existing report", record_id)
    
    if total_macros > 10:
        macro_result = await handle_macros_multi(browser, record, tab_nums=tabs_num, batch_size=10, 
                                                control_state=control_state, report_id=record_id)
    else:
        macro_result = await fill_form(
            main_page, 
            record, 
            form_steps[1]["field_map"], 
            form_steps[1]["field_types"], 
            is_last_step=True,
            skip_special_fields=True,
            control_state=control_state,
            report_id=record_id
        )
    
    if isinstance(macro_result, dict) and macro_result.get("status") == "FAILED":
        emit_progress("MACRO_CREATION_FAILED", "Macro creation failed", record_id, error=macro_result.get("error"))
        return {"status": "FAILED", "error": macro_result.get("error")}
    
    emit_progress("MACRO_CREATION_SUCCESS", "Macro creation completed successfully", record_id)
    
    emit_progress("MACRO_EDIT_START", "Starting macro editing process", record_id)
    edit_result = await handle_macro_edits(browser, record, tabs_num=tabs_num, 
                                          control_state=control_state, report_id=record_id)
    
    if isinstance(edit_result, dict) and edit_result.get("status") == "FAILED":
        emit_progress("MACRO_EDIT_FAILED", "Macro editing failed", record_id, error=edit_result.get("error"))
        return {"status": "FAILED", "error": edit_result.get("error")}
    
    emit_progress("MACRO_EDIT_SUCCESS", "Macro editing completed successfully", record_id)
    
    pages = browser.tabs
    for p in pages[1:]:
        await p.close()
    
    emit_progress("CHECKING_INCOMPLETE", "Checking for incomplete macros", record_id)
    checker_result = await check_incomplete_macros_after_creation(browser, record_id, browsers_num=tabs_num)
    results.append({"status": "CHECKER_RESULT", "recordId": str(record["_id"]), "result": checker_result})
    
    if checker_result.get("macro_count", 0) > 0:
        emit_progress("RETRYING_MACROS", f"Retrying {checker_result['macro_count']} incomplete macros", record_id)
        await retryMacros(browser, record_id, tabs_num=tabs_num, control_state=control_state)
    
    return {"status": "SUCCESS", "results": results, "report_id": report_id, "record_id": record_id}

async def wait_for_element(page, selector, timeout=30, check_interval=0.5):
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            element = await page.query_selector(selector)
            if element:
                return element
        except Exception:
            pass
        await asyncio.sleep(check_interval)
    return None

_location_cache = {}

_location_cache = {}

async def set_location(page, country_name, region_name, city_name):
    try:
        import re, unicodedata

        cache_key = f"{country_name}|{region_name}|{city_name}"

        def normalize_text(text: str) -> str:
            if not text:
                return ""
            text = unicodedata.normalize("NFKC", text)
            text = re.sub(r"\s+", " ", text)
            return text.strip()

        async def wait_for_options(selector, min_options=2, timeout=10):
            for _ in range(timeout * 2):
                el = await wait_for_element(page, selector, timeout=1)
                if el and getattr(el, "children", None) and len(el.children) >= min_options:
                    return el
                await asyncio.sleep(0.5)
            return None

        async def get_location_code(name, selector):
            if not name:
                return None
            el = await wait_for_options(selector)
            if not el:
                return None
            for opt in el.children:
                text = normalize_text(opt.text)
                if normalize_text(name).lower() in text.lower():
                    return opt.attrs.get("value")
            return None

        async def set_field(selector, value):
            if not value:
                return
            args = json.dumps({"selector": selector, "value": value})
            await page.evaluate(f"""
                (function() {{
                    const args = {args};
                    if (window.$) {{
                        window.$(args.selector).val(args.value).trigger("change");
                    }} else {{
                        const el = document.querySelector(args.selector);
                        if (!el) return;
                        if (el.value !== args.value) {{
                            el.value = args.value;
                            el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                            el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        }}
                    }}
                }})();
            """)

        region_code, city_code = _location_cache.get(cache_key, (None, None))

        if not region_code:
            region_code = await get_location_code(region_name, "#region")
        if not city_code:
            city_code = await get_location_code(city_name, "#city")

        if region_code or city_code:
            _location_cache[cache_key] = (region_code, city_code)

        await set_field("#country_id", "1")
        await asyncio.sleep(0.5)
        await set_field("#region", region_code)
        await asyncio.sleep(0.5)
        await set_field("#city", city_code)
        await asyncio.sleep(0.5)

        return True

    except Exception as e:
        print(f"Location injection failed: {e}", file=sys.stderr)
        return False
    
async def bulk_inject_inputs(page, record, field_map, field_types):
    jsdata = {}

    for key, selector in field_map.items():
        if key not in record:
            continue

        field_type = field_types.get(key, "text")
        value = str(record[key] or "").strip()

        if field_type == "date" and value:
            try:
                value = datetime.strptime(value, "%d-%m-%Y").strftime("%Y-%m-%d")
            except ValueError:
                try:
                    datetime.strptime(value, "%Y-%m-%d")
                except ValueError:
                    print(f"[WARNING] Invalid date format for {key}: {value}", file=sys.stderr)
                    continue

        jsdata[selector] = {"type": field_type, "value": value}

    js = f"""
    (function() {{
        const data = {json.dumps(jsdata)};
        for (const [selector, meta] of Object.entries(data)) {{
            const el = document.querySelector(selector);
            if (!el) continue;

            switch(meta.type) {{
                case "checkbox":
                    el.checked = Boolean(meta.value);
                    el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    break;

                case "select":
                    let found = false;
                    for (const opt of el.options) {{
                        if (opt.value == meta.value || opt.text == meta.value) {{
                            el.value = opt.value;
                            found = true;
                            break;
                        }}
                    }}
                    if (!found && el.options.length) {{
                        el.selectedIndex = 0;
                    }}
                    el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    break;

                case "radio":
                    const labels = document.querySelectorAll('label.form-check-label');
                    for (const lbl of labels) {{
                        if ((lbl.innerText || '').trim() === meta.value) {{
                            const radio = document.getElementById(lbl.getAttribute('for'));
                            if (radio) {{
                                radio.checked = true;
                                radio.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            }}
                            break;
                        }}
                    }}
                    break;

                case "date":
                case "text":
                default:
                    el.value = meta.value ?? "";
                    el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                    el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    break;
            }}
        }}
    }})();
    """

    await page.evaluate(js)

async def fill_form(page, record, field_map, field_types, is_last_step=False, retries=0, max_retries=2, skip_special_fields=False, control_state=None, report_id=None):
    try:
        from worker_equip import check_control
        if control_state:
            await check_control(control_state)
        
        start_time = time.time()
        await bulk_inject_inputs(page, record, field_map, field_types)

        for key, selector in field_map.items():
            if key not in record: continue
            value = str(record[key] or "")
            ftype = field_types.get(key,"text")
            try:
                if ftype == "location":
                    country_name = record.get("country","")
                    region_name = record.get("region","")
                    city_name = record.get("city","")
                    await set_location(page, country_name, region_name, city_name)

                elif ftype == "file":
                    file_input = await wait_for_element(page, selector, timeout=10)
                    if file_input: await file_input.send_file(value)
                    
                elif ftype == "dynamic_select":
                    select_element = await wait_for_element(page, selector, timeout=10)
                    if select_element:
                        for opt in select_element.children:
                            if value.lower() in (opt.text or "").lower():
                                await opt.select_option()
                                break

            except Exception:
                continue
        
        end_time = time.time()
        elapsed_time = end_time - start_time

        if not is_last_step:
            continue_btn = await wait_for_element(page, "input[name='continue']", timeout=10)
            if continue_btn:
                await continue_btn.click()
                await asyncio.sleep(2)
                error_div = await wait_for_element(page, "div.alert.alert-danger", timeout=5)
                if error_div and retries < max_retries:
                    await asyncio.sleep(1)
                    return await fill_form(page, record, field_map, field_types, is_last_step, retries+1, max_retries, skip_special_fields, control_state, report_id)
        else:
            save_btn = await wait_for_element(page, "input[type='submit']", timeout=10)
            if save_btn:
                await asyncio.sleep(0.5)
                await save_btn.click()
                await asyncio.sleep(2)
                return {"status":"SAVED"}
            else:
                return {"status":"FAILED","error":"Save button not found"}
        return True
    except Exception as e:
        return {"status":"FAILED","error": str(e)}

def chunk_macros(macros, chunk_size=10):
    for i in range(0, len(macros), chunk_size):
        yield macros[i:i+chunk_size]

def calculate_tab_batches(total_assets: int, max_tabs: int, batch_size: int = 10):
    if total_assets <= batch_size:
        return [total_assets] 
    
    required_tabs = (total_assets + batch_size - 1) // batch_size
    tabs_to_use = min(required_tabs, max_tabs)

    base, extra = divmod(total_assets, tabs_to_use)
    result = []
    for i in range(tabs_to_use):
        size = base + (1 if i < extra else 0)
        result.append(size)
    return result

async def handle_macros_multi(browser, record, tab_nums=3, batch_size=10, control_state=None, report_id=None):
    from worker_equip import check_control
    
    macros = record.get("asset_data", [])
    total_assets = len(macros)
    if not total_assets:
        return True

    if control_state:
        await check_control(control_state)

    emit_progress("MACRO_PROCESSING", f"Processing {total_assets} assets across {tab_nums} tabs", report_id, 
                  total=total_assets, current=0)

    distribution = calculate_tab_batches(total_assets, tab_nums, batch_size)

    main_page = browser.tabs[0]  
    current_url = await main_page.evaluate("window.location.href")

    pages = [main_page]
    for _ in range(len(distribution) - 1):
        new_tab = await browser.get(current_url, new_tab=True)
        pages.append(new_tab)

    for page in pages:
        for _ in range(20):  
            ready_state = await page.evaluate("document.readyState")
            key_el = await wait_for_element(page, "#macros", timeout=0.5)
            if ready_state == "complete" and key_el:
                break
            await asyncio.sleep(0.5)

    completed = 0

    async def process_assets(page, start_index, count):
        nonlocal completed
        end_index = start_index + count
        subset = macros[start_index:end_index]
        for i in range(0, len(subset), batch_size):
            if control_state:
                await check_control(control_state)
            
            chunk = subset[i:i+batch_size]
            temp_record = record.copy()
            temp_record["asset_data"] = chunk
            temp_record["number_of_macros"] = str(len(chunk))
            
            result = await fill_form(
                page,
                temp_record,
                form_steps[1]["field_map"],
                form_steps[1]["field_types"],
                is_last_step=True,
                skip_special_fields=True,
                control_state=control_state,
                report_id=report_id
            )

            completed += len(chunk)
            emit_progress("MACRO_PROCESSING", f"Processed batch {start_index+i}–{start_index+i+len(chunk)}", 
                         report_id, total=total_assets, current=completed, 
                         percentage=round((completed/total_assets)*100, 2))

            if isinstance(result, dict):
                if result.get("status") == "FAILED":
                    emit_progress("MACRO_ERROR", f"Failed batch {start_index+i}–{start_index+i+len(chunk)}", 
                                report_id, error=result.get("error"))
                    return result
                elif result.get("status") == "SAVED":
                    pass

            if i + batch_size < len(subset):
                await page.get(current_url)
                await asyncio.sleep(1)

        return True

    tasks = []
    idx = 0
    for page, count in zip(pages, distribution):
        tasks.append(process_assets(page, idx, count))
        idx += count

    await asyncio.gather(*tasks)

    await asyncio.sleep(2)
    for p in pages[1:]:
        await p.close()

    emit_progress("MACRO_COMPLETE", f"Completed processing {total_assets} assets", report_id, 
                  total=total_assets, current=completed)

    return True

async def get_first_macro_id(page):
    tbody = await wait_for_element(page, "#m-table", timeout=100)
    if not tbody:
        return {"status": "FAILED", "error": "Could not find macro table"}
    
    trs = await tbody.query_selector_all("tr") if tbody else []
    if not trs:
        return {"status": "FAILED", "error": "Could not find macro table rows"}
    
    first_tr = trs[1] if trs else None
    if not first_tr:
        return {"status": "FAILED", "error": "Could not find macro table row"}
    tds = first_tr.children if first_tr else []
    if not tds:
        return {"status": "FAILED", "error": "Could not find macro table row cells"}
    first_td = tds[0]
    print(f"first_td: {first_td}")
    id = first_td.text
    print(f"id: {id}")
    if not id:
        return {"status": "FAILED", "error": "Could not find macro table row link"}
    return int(id) if id else None

async def fill_macro_form(page, macro_id, macro_data, field_map, field_types, control_state=None, report_id=None):
    await page.get(f"https://qima.taqeem.sa/report/macro/{macro_id}/edit")
    await asyncio.sleep(0.5)
    try:
        result = await fill_form(page, macro_data, field_map, field_types, is_last_step=True, 
                                skip_special_fields=True, control_state=control_state, report_id=report_id)
        return result
    except Exception as e:
        print(f"Filling macro {macro_id} failed: {e}", file=sys.stderr)
        return {"status": "FAILED", "error": str(e)}

async def handle_macro_edits(browser, record, tabs_num=3, control_state=None, report_id=None):
    from worker_equip import check_control
    
    asset_data = record.get("asset_data", [])
    if not asset_data: return True

    if control_state:
        await check_control(control_state)

    emit_progress("MACRO_EDIT", f"Editing {len(asset_data)} macros", report_id, 
                  total=len(asset_data), current=0)

    main_page = browser.tabs[0]
    first_macro_id = await get_first_macro_id(main_page)
    if first_macro_id is None:
        return {"status":"FAILED","error":"Could not determine first macro id"}
    print(f"First macro id: {first_macro_id} with type {type(first_macro_id)}")
    

    chunks = balanced_chunks(asset_data, tabs_num)
    pages = [main_page] + [await browser.get("", new_tab=True) for _ in range(tabs_num - 1)]

    completed = 0

    async def process_chunk(chunk, page, offset):
        nonlocal completed
        for idx, macro in enumerate(chunk):
            if control_state:
                await check_control(control_state)
            
            macro_id = first_macro_id + idx + offset
            element_index = offset + idx

            try:
                res = await db.halfreports.update_one(
                    {"_id": record["_id"]},
                    {"$set": {f"asset_data.{element_index}.id": int(macro_id)}}
                )
            except Exception as e:
                print(f"[DB PATCH ERROR] {e}", file=sys.stderr)
            
            try:
                await fill_macro_form(
                    page,
                    macro_id,
                    macro,
                    macro_form_config["field_map"],
                    macro_form_config["field_types"],
                    control_state,
                    report_id
                )
                
                completed += 1
                emit_progress("MACRO_EDIT", f"Edited macro {macro_id}", report_id, 
                            total=len(asset_data), current=completed, 
                            percentage=round((completed/len(asset_data))*100, 2))
            except Exception as e:
                emit_progress("MACRO_EDIT_ERROR", f"Failed to edit macro {macro_id}", report_id, 
                            error=str(e), macro_id=macro_id)

    tasks = [process_chunk(chunk, page, sum(len(c) for c in chunks[:i])) for i, (page, chunk) in enumerate(zip(pages, chunks))]
    await asyncio.gather(*tasks)
    
    emit_progress("MACRO_EDIT_COMPLETE", f"Completed editing {len(asset_data)} macros", report_id, 
                  total=len(asset_data), current=completed)
    
    return True

def balanced_chunks(lst, n):
    k, m = divmod(len(lst), n)
    chunks = []
    start = 0
    for i in range(n):
        size = k + (1 if i < m else 0)
        chunks.append(lst[start:start+size])
        start += size
    return chunks

async def runFormFill2(browser, record_id, tabs_num=3, control_state=None):
    from worker_equip import check_control
    
    try:
        if not ObjectId.is_valid(record_id):
            return {"status":"FAILED","error":"Invalid record_id"}
        
        emit_progress("FETCHING_RECORD", "Fetching report data from database", record_id)
        
        record = await db.halfreports.find_one({"_id": ObjectId(record_id)})
        if not record: 
            return {"status":"FAILED","error":"Record not found"}
        
        # Detect report type
        report_type = detect_report_type(record)
        emit_progress("REPORT_TYPE_DETECTED", f"Detected report type: {report_type}", record_id, report_type=report_type)
        
        await db.halfreports.update_one(
            {"_id": record["_id"]},
            {"$set": {"startSubmitTime": datetime.now(timezone.utc)}}
        )

        results=[]
        record["number_of_macros"] = str(len(record.get("asset_data",[])))

        # Handle without-base reports
        if report_type == "without_base":
            emit_progress("PROCESSING_WITHOUT_BASE", "Processing asset-only report (without base data)", record_id)
            result = await handle_without_base_report(browser, record, tabs_num, control_state, record_id)
            
            await db.halfreports.update_one(
                {"_id": record["_id"]},
                {"$set": {"endSubmitTime": datetime.now(timezone.utc)}}
            )

            if result.get("status") == "SUCCESS":
                emit_progress("COMPLETE", "Asset-only form filling completed successfully", record_id)
            else:
                emit_progress("FAILED", "Asset-only form filling failed", record_id, error=result.get("error"))
            
            return result

        # Handle with-base reports (original logic)
        emit_progress("PROCESSING_WITH_BASE", "Processing report with base data", record_id)
        emit_progress("NAVIGATING", "Navigating to form creation page", record_id)
        main_page = await browser.get("https://qima.taqeem.sa/report/create/4/487")
        await asyncio.sleep(1)

        for step_num, step_config in enumerate(form_steps, 1):
            if control_state:
                await check_control(control_state)
            
            is_last = step_num == len(form_steps)
            
            emit_progress("STEP_STARTED", f"Starting step {step_num}/{len(form_steps)}", record_id, 
                         step=step_num, total_steps=len(form_steps))
            
            results.append({"status":"STEP_STARTED","step":step_num,"recordId":str(record["_id"])})

            if step_num == 2 and len(record.get("asset_data", [])) > 10:
                result = await handle_macros_multi(browser, record, tab_nums=tabs_num, batch_size=10, 
                                                   control_state=control_state, report_id=record_id)
            else:
                result = await fill_form(
                    main_page, 
                    record, 
                    step_config["field_map"], 
                    step_config["field_types"], 
                    is_last, 
                    skip_special_fields=True,
                    control_state=control_state,
                    report_id=record_id
                )

            if isinstance(result, dict) and result.get("status")=="FAILED":
                emit_progress("STEP_FAILED", f"Step {step_num} failed", record_id, 
                            step=step_num, error=result.get("error"))
                results.append({
                    "status":"FAILED",
                    "step":step_num,
                    "recordId":str(record["_id"]),
                    "error":result.get("error")
                })
                return {"status":"FAILED","results":results}

            emit_progress("STEP_COMPLETE", f"Completed step {step_num}/{len(form_steps)}", record_id, 
                         step=step_num, total_steps=len(form_steps))

            if is_last:
                main_url = await main_page.evaluate("window.location.href")
                form_id = main_url.split("/")[-1]
                if not form_id:
                    results.append({"status":"FAILED","step":"report_id","recordId":str(record["_id"]),"error":"Could not determine report_id"})
                    return {"status":"FAILED","results":results}

                res = await db.halfreports.update_one(
                    {"_id": record["_id"]}, 
                    {"$set": {"report_id": form_id}}
                )
                
                emit_progress("REPORT_SAVED", f"Report created with ID: {form_id}", record_id, form_id=form_id)

                macro_result = await handle_macro_edits(browser, record, tabs_num=tabs_num, 
                                                       control_state=control_state, report_id=record_id)
                if isinstance(macro_result, dict) and macro_result.get("status")=="FAILED":
                    results.append({"status":"FAILED","step":"macro_edit","recordId":str(record["_id"]),"error":macro_result.get("error")})
                    return {"status":"FAILED","results":results}

                results.append({"status":"MACRO_EDIT_SUCCESS","message":"All macros filled","recordId":str(record["_id"])})

                pages = browser.tabs
                for p in pages[1:]:
                    await p.close()

                emit_progress("CHECKING", "Checking for incomplete macros", record_id)
                checker_result = await check_incomplete_macros_after_creation(browser, record_id, browsers_num=tabs_num)
                results.append({"status":"CHECKER_RESULT", "recordId":str(record["_id"]), "result":checker_result})

                if checker_result["macro_count"] > 0:
                    emit_progress("RETRYING", f"Retrying {checker_result['macro_count']} incomplete macros", record_id)
                    await retryMacros(browser, record_id, tabs_num=tabs_num, control_state=control_state)

        await db.halfreports.update_one(
            {"_id": record["_id"]},
            {"$set": {"endSubmitTime": datetime.now(timezone.utc)}}
        )

        emit_progress("COMPLETE", "Form filling completed successfully", record_id)
        return {"status":"SUCCESS","results":results}

    except Exception as e:
        tb = traceback.format_exc() 
        emit_progress("FAILED", f"Form filling failed: {str(e)}", record_id, error=str(e))
        await db.halfreports.update_one(
            {"_id": record["_id"]},
            {"$set": {"endSubmitTime": datetime.now(timezone.utc)}}
        )
        return {"status":"FAILED","error":str(e),"traceback":tb}

async def retryMacros(browser, record_id, tabs_num=3, control_state=None):
    from worker_equip import check_control
    
    try:
        if control_state:
            await check_control(control_state)
        
        report = await db.halfreports.find_one({"_id": ObjectId(record_id)})
        if not report:
            return {"status": "FAILED", "error": "Report not found"}

        assets = report.get("asset_data", [])
        retry_assets = [(idx, a) for idx, a in enumerate(assets) if a.get("submitState") == 0]
        if not retry_assets:
            emit_progress("RETRY_COMPLETE", "All macros already complete", record_id)
            return {"status": "SUCCESS", "message": "All macros complete"}

        emit_progress("RETRY_STARTED", f"Retrying {len(retry_assets)} incomplete macros", record_id, 
                     total=len(retry_assets), current=0)

        num_tabs = min(tabs_num, len(retry_assets))
        pages = [browser.tabs[0]]
        
        if num_tabs > 1:
            pages.extend([await browser.get("about:blank", new_tab=True) for _ in range(num_tabs - 1)])
        
        chunks = [retry_assets[i::len(pages)] for i in range(len(pages))]
        
        completed = 0

        async def process_chunk(page, assets_chunk):
            nonlocal completed
            for idx, asset in assets_chunk:
                if control_state:
                    await check_control(control_state)
                
                macro_id = asset.get("id")
                if not macro_id:
                    continue

                try:
                    await fill_macro_form(
                        page, 
                        macro_id, 
                        asset, 
                        macro_form_config["field_map"], 
                        macro_form_config["field_types"], 
                        control_state,
                        record_id
                    )

                    show_url = f"https://qima.taqeem.sa/report/macro/{macro_id}/show"
                    await page.get(show_url)
                    await asyncio.sleep(0.5)
                    html_content = await page.get_content()

                    submit_state = 0 if (html_content and "غير مكتملة" in html_content) else 1
                    await db.halfreports.update_one(
                        {"_id": report["_id"]}, 
                        {"$set": {f"asset_data.{idx}.submitState": submit_state}}
                    )

                    completed += 1
                    status = "SUCCESS" if submit_state == 1 else "INCOMPLETE"
                    emit_progress("RETRY_PROGRESS", f"Retried macro {macro_id}: {status}", record_id, 
                                total=len(retry_assets), current=completed, 
                                percentage=round((completed/len(retry_assets))*100, 2),
                                macro_id=macro_id, status=status)

                except Exception as e:
                    emit_progress("RETRY_ERROR", f"Failed to retry macro {macro_id}", record_id, 
                                error=str(e), macro_id=macro_id)

        await asyncio.gather(*[process_chunk(p, chunk) for p, chunk in zip(pages, chunks)])

        for p in pages[1:]:
            await p.close()

        emit_progress("RETRY_COMPLETE", f"Completed retrying {len(retry_assets)} macros", record_id, 
                     total=len(retry_assets), current=completed)

        return {"status": "SUCCESS", "message": f"Retried {len(retry_assets)} macros"}

    except Exception as e:
        tb = traceback.format_exc()
        emit_progress("RETRY_FAILED", f"Retry failed: {str(e)}", record_id, error=str(e))
        return {"status": "FAILED", "error": str(e), "traceback": tb}

async def runCheckMacros(browser, record_id, tabs_num=3):
    try:
        if not ObjectId.is_valid(record_id): 
            return {"status": "FAILED", "error": "Invalid record_id"}
    
        emit_progress("CHECK_STARTED", "Checking incomplete macros", record_id)
        check_result = await check_incomplete_macros(browser, record_id)
        emit_progress("CHECK_COMPLETE", f"Found {check_result.get('macro_count', 0)} incomplete macros", 
                     record_id, result=check_result)
        
        return {
            "status": "SUCCESS",
            "recordId": str(record_id),
            "result": check_result
        }

    except Exception as e:
        tb = traceback.format_exc()
        emit_progress("CHECK_FAILED", f"Check failed: {str(e)}", record_id, error=str(e))
        return {
            "status": "FAILED",
            "error": str(e),
            "traceback": tb
        }