import asyncio
import time
import traceback
import json
import time
from datetime import datetime

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

from formSteps import form_steps, macro_form_config
from locationMapper import get_country_code, get_region_code, get_city_code

MONGO_URI="mongodb+srv://test:JUL3OvyCSLVjSixj@assetval.pu3bqyr.mongodb.net/projectForever"
client = AsyncIOMotorClient(MONGO_URI)
db = client["projectForever"]

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

async def set_location(page, country_code, region_code, city_code):
    try:
        async def set_field(selector, value):
            args = json.dumps({"selector": selector, "value": value})
            await page.evaluate(f"""
                (function() {{
                    const args = {args};
                    const el = document.querySelector(args.selector);
                    if (!el) return;
                    if (el.value !== args.value) {{
                        el.value = args.value;
                        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    }}
                }})();
            """)

        await set_field("#country_id", country_code)
        await asyncio.sleep(1)

        await set_field("#region", region_code)
        await asyncio.sleep(1) 

        await set_field("#city", city_code)
        await asyncio.sleep(1) 

        print(f"Location set → {country_code} / {region_code} / {city_code}")
        return True

    except Exception as e:
        print(f"Location injection failed: {e}")
        return False


    except Exception as e:
        print(f"Location injection failed: {e}")
        return False


async def bulk_inject_inputs(page, record, field_map, field_types):
    selects = {}
    others = {}

    for key, selector in field_map.items():
        if key not in record:
            continue
        field_type = field_types.get(key, "text")
        value = str(record[key] or "")

        # Convert date strings to YYYY-MM-DD
        if field_type == "date" and value:
            try:
                value = datetime.strptime(value, "%d-%m-%Y").strftime("%Y-%m-%d")
            except ValueError:
                print(f"[WARNING] Invalid date format for {key}: {value}")
                continue

        if field_type == "select":
            selects[selector] = {"type": "select", "value": value}
        elif field_type in ["text", "checkbox", "date"]:
            others[selector] = {"type": field_type, "value": value}

    async def inject(jsdata):
        if not jsdata:
            return
        data_json = json.dumps(jsdata)
        js = f"""
        (function() {{
            const data = {data_json};
            for (const [selector, meta] of Object.entries(data)) {{
                const el = document.querySelector(selector);
                if (!el) continue;
                switch(meta.type) {{
                    case "checkbox":
                        el.checked = meta.value;
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;
                    case "select":
                        let matched = false;
                        for (const option of el.options) {{
                            if (option.value == meta.value || option.text == meta.value) {{
                                el.value = option.value;
                                matched = true;
                                break;
                            }}
                        }}
                        if (!matched && el.options.length) el.selectedIndex = 0;
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;
                    case "date":
                    case "text":
                    default:
                        el.value = meta.value;
                        el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                        el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                        break;
                }}
            }}
            return true;
        }})();
        """
        await page.evaluate(js)

    await inject(selects)
    await inject(others)


# --------------------- Special Fields ---------------------
async def fill_clients(page, clients):
    if not clients:
        return
    client = clients[0]
    selectors = {
        "[name='client[0][name]']": client.get("client_name", ""),
        "[name='client[0][telephone]']": client.get("telephone_number", ""),
        "[name='client[0][email]']": client.get("email_address", ""),
    }
    for sel, val in selectors.items():
        el = await wait_for_element(page, sel, timeout=5)
        if el:
            await el.clear_input()
            await asyncio.sleep(0.05)
            await el.send_keys(val)

async def fill_valuers(page, valuers):
    if len(valuers) > 1:
        for _ in range(len(valuers)-1):
            add_btn = await wait_for_element(page, "#duplicateValuer", timeout=5)
            if add_btn:
                await add_btn.click()
                await asyncio.sleep(0.5)
    for idx, valuer in enumerate(valuers):
        name_sel = f"[name='valuer[{idx}][id]']"
        contrib_sel = f"[name='valuer[{idx}][contribution]']"
        for sel, val in [(name_sel, valuer.get("valuer_name","")), (contrib_sel, str(valuer.get("contribution_percentage","")))]:
            select_element = await wait_for_element(page, sel, timeout=10)
            if not select_element:
                continue
            options = select_element.children
            for opt in options:
                text = (opt.text or "").strip()
                if val.lower() in text.lower():
                    await opt.select_option()
                    break

async def fill_report_users(page, users):
    if not users:
        return
    if len(users) > 1:
        for _ in range(len(users)-1):
            add_btn = await wait_for_element(page, "#duplicateUser", timeout=5)
            if add_btn:
                await add_btn.click()
                await asyncio.sleep(0.5)
    for idx, name in enumerate(users):
        sel = f"[name='user[{idx}][name]']"
        el = await wait_for_element(page, sel, timeout=5)
        if el:
            await el.clear_input()
            await asyncio.sleep(0.05)
            await el.send_keys(name)

async def fill_form(page, record, field_map, field_types, is_last_step=False, retries=0, max_retries=2, skip_special_fields=False):
    try:
        start_time = time.time()

        if not skip_special_fields:
            if "clients" in record: await fill_clients(page, record["clients"])
            if "valuers" in record: await fill_valuers(page, record["valuers"])
            if "report_users" in record: await fill_report_users(page, record["report_users"])
        await bulk_inject_inputs(page, record, field_map, field_types)

        for key, selector in field_map.items():
            if key not in record: continue
            value = str(record[key] or "")
            ftype = field_types.get(key,"text")
            try:
                if ftype == "location":
                    country_code = get_country_code(record.get("country",""))
                    region_code = get_region_code(record.get("region",""))
                    city_code = get_city_code(record.get("city",""))
                    await set_location(page, country_code, region_code, city_code)

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
        print(f"[FORM] filled in {elapsed_time:.2f} seconds")

        if not is_last_step:
            continue_btn = await wait_for_element(page, "input[name='continue']", timeout=10)
            if continue_btn:
                await continue_btn.click()
                await asyncio.sleep(2)
                error_div = await wait_for_element(page, "div.alert.alert-danger", timeout=5)
                if error_div and retries < max_retries:
                    await asyncio.sleep(1)
                    return await fill_form(page, record, field_map, field_types, is_last_step, retries+1, max_retries)
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

async def handle_macros(page, record):
    macros = record.get("asset_data", [])
    if not macros: return True
    batches = list(chunk_macros(macros, 10))
    for idx, batch in enumerate(batches, start=1):
        temp_record = record.copy()
        temp_record["asset_data"] = batch
        temp_record["number_of_macros"] = str(len(batch))
        result = await fill_form(
            page,
            temp_record,
            form_steps[1]["field_map"],
            form_steps[1]["field_types"],
            is_last_step=True,
            skip_special_fields=True
        )
        if isinstance(result, dict) and result.get("status")=="FAILED":
            return result
        # Navigate to add next batch if any
        if idx < len(batches):
            formId = (await page.evaluate("window.location.href")).rstrip("/").split("/")[-1]
            next_url = f"https://qima.taqeem.sa/report/asset/create/{formId}"
            await page.get(next_url)
            await asyncio.sleep(1)
    return True

# --------------------- Macro Editing ---------------------
async def get_first_macro_id(page):
    tbody = await wait_for_element(page, "tbody", timeout=10)
    trs = await tbody.query_selector_all("tr") if tbody else []
    first_tr = trs[0] if trs else None
    tds = await first_tr.query_selector_all("td") if first_tr else []
    link = await tds[0].query_selector("a") if tds else None
    return int(link.text.strip()) if link else None

async def fill_macro_form(page, macro_id, macro_data, field_map, field_types):
    await page.get(f"https://qima.taqeem.sa/report/macro/{macro_id}/edit")
    await asyncio.sleep(0.5)
    try:
        result = await fill_form(page, macro_data, field_map, field_types, is_last_step=True, skip_special_fields=True)
        return result
    except Exception as e:
        print(f"Filling macro {macro_id} failed: {e}")
        return {"status": "FAILED", "error": str(e)}
    
async def fill_assets_via_macro_urls(browser, record, macro_urls, tabs_num=3):
    asset_data = record.get("asset_data", [])
    if not asset_data or not macro_urls:
        return {"status": "FAILED", "error": "No assets or macro URLs provided"}

    # Use first tab as main
    main_page = await browser.get(macro_urls[0])
    
    # Prepare tabs
    pages = [main_page] + [await browser.get("about:blank", new_tab=True) for _ in range(min(tabs_num-1, len(macro_urls)-1))]

    # Split macro_urls into chunks per tab
    def chunk_list(lst, n):
        for i in range(0, len(lst), n):
            yield lst[i:i+n]
    
    chunks = list(chunk_list(macro_urls, len(macro_urls)//len(pages) + 1))

    async def process_chunk(chunk, page, offset):
        for idx, url in enumerate(chunk):
            if asset_data[offset + idx].get("submitState") == 1:
                continue
            
            element_index = offset + idx
            try:
                await page.get(url)
                await asyncio.sleep(0.5)  

                macro_id = int(url.rstrip("/").split("/")[-2])
                print("macro_id", macro_id)

                asset_id = asset_data[element_index]["_id"]
                
                await db.assetdatas.update_one(
                    {"_id": asset_id},
                    {"$set": {"id": macro_id}},
                )

                await fill_macro_form(
                    page,
                    macro_id,
                    asset_data[element_index],
                    macro_form_config["field_map"],
                    macro_form_config["field_types"]
                )
                print(f"[FILLED] asset index {element_index} -> macro_id {macro_id}")

            except Exception as e:
                print(f"[ERROR] Filling macro {url} failed: {e}")

    tasks = [process_chunk(chunk, page, sum(len(c) for c in chunks[:i])) for i, (page, chunk) in enumerate(zip(pages, chunks))]
    await asyncio.gather(*tasks)

    for p in pages[1:]:
        await p.close()

    return {"status": "SUCCESS", "message": f"Filled {len(asset_data)} macros using provided URLs"}

async def handle_macro_edits(browser, record, tabs_num=3):
    asset_data = record.get("asset_data", [])
    if not asset_data: return True


    main_page = browser.tabs[0]
    first_macro_id = await get_first_macro_id(main_page)
    if first_macro_id is None:
        return {"status":"FAILED","error":"Could not determine first macro id"}

    chunks = list(chunk_macros(asset_data, len(asset_data)//tabs_num + 1))
    pages = [main_page] + [await browser.get("", new_tab=True) for _ in range(tabs_num - 1)]

    async def process_chunk(chunk, page, offset):
        for idx, macro in enumerate(chunk):
            macro_id = first_macro_id + idx + offset
            element_index = offset + idx

            try:
                res = await db.halfreports.update_one(
                    {"_id": record["_id"]},
                    {"$set": {f"asset_data.{element_index}.id": int(macro_id)}}
                )
                print(f"[DB PATCH] index {element_index} -> macro_id {macro_id} (matched={res.matched_count}, modified={res.modified_count})")
                if res.modified_count == 0:
                    doc = await db.halfreports.find_one({"_id": record["_id"]})
                    ad = doc.get("asset_data", [])
                    print(f"[DB PATCH WARNING] no modification. asset_data length={len(ad)}. element at index:",
                        ad[element_index] if element_index < len(ad) else "INDEX OUT OF RANGE")
            except Exception as e:
                print(f"[DB PATCH ERROR] {e}")
            try:
                await fill_macro_form(
                    page,
                    macro_id,
                    macro,
                    macro_form_config["field_map"],
                    macro_form_config["field_types"]
                )
            except Exception as e:
                print(f"Filling macro {macro_id} failed: {e}")


    tasks = [process_chunk(chunk, page, sum(len(c) for c in chunks[:i])) for i, (page, chunk) in enumerate(zip(pages, chunks))]
    await asyncio.gather(*tasks)
    return True

async def runFormFill(browser, record_id):
    try:
        if not ObjectId.is_valid(record_id):
            return {"status":"FAILED","error":"Invalid record_id"}
        record = await db.halfreports.find_one({"_id": ObjectId(record_id)})
        if not record: return {"status":"FAILED","error":"Record not found"}

        results=[]
        record["number_of_macros"] = str(len(record.get("asset_data",[])))

        main_page = await browser.get("https://qima.taqeem.sa/report/create/4/487")

        if "clients" in record: await fill_clients(main_page, record["clients"])
        if "valuers" in record: await fill_valuers(main_page, record["valuers"])

        for step_num, step_config in enumerate(form_steps, 1):
            is_last = step_num == len(form_steps)
            results.append({"status":"STEP_STARTED","step":step_num,"recordId":str(record["_id"])})

            if step_num==2 and len(record.get("asset_data",[]))>10:
                result = await handle_macros(main_page, record)
            else:
                result = await fill_form(main_page, record, step_config["field_map"], step_config["field_types"], is_last, skip_special_fields=True)

            if isinstance(result, dict) and result.get("status")=="FAILED":
                results.append({"status":"FAILED","step":step_num,"recordId":str(record["_id"]),"error":result.get("error")})
                return {"status":"FAILED","results":results}

            if is_last:
                translate = await wait_for_element(main_page, "a[href='https://qima.taqeem.sa/setlocale/ar']", timeout=30)
                if not translate:
                    results.append({"status":"FAILED","step":"translate","recordId":str(record["_id"]),"error":"Translate link not found"})
                    return {"status":"FAILED","results":results}
                await translate.click()
                await asyncio.sleep(1)

                main_url = await main_page.evaluate("window.location.href")
                form_id = main_url.split("/")[-1]
                if not form_id:
                    results.append({"status":"FAILED","step":"report_id","recordId":str(record["_id"]),"error":"Could not determine report_id"})

                res = await db.halfreports.update_one({"_id": record["_id"]}, {"$set": {"report_id": form_id}})
                if res.modified_count == 0:
                    results.append({"status":"FAILED","step":"report_id","recordId":str(record["_id"]),"error":"Could not set report_id"})
                    return {"status":"FAILED","results":results}
                print(f"[DB PATCH] report_id set: {form_id}")

                macro_result = await handle_macro_edits(browser, record, tabs_num=3)
                if isinstance(macro_result, dict) and macro_result.get("status")=="FAILED":
                    results.append({"status":"FAILED","step":"macro_edit","recordId":str(record["_id"]),"error":macro_result.get("error")})
                    return {"status":"FAILED","results":results}

                results.append({"status":"MACRO_EDIT_SUCCESS","message":"All macros filled","recordId":str(record["_id"])})

        return {"status":"SUCCESS","results":results}

    except Exception as e:
        tb = traceback.format_exc()
        return {"status":"FAILED","error":str(e),"traceback":tb}
