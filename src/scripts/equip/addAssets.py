import asyncio, time, traceback
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

MONGO_URI = "mongodb+srv://test:JUL3OvyCSLVjSixj@assetval.pu3bqyr.mongodb.net/projectForever"
client = AsyncIOMotorClient(MONGO_URI)
db = client["projectForever"]

from formFiller import fill_assets_via_macro_urls, wait_for_element
from macrosFetcher import get_macros

async def safe_query_selector(element, selector, max_retries=2):
    """Safe wrapper for query_selector that prevents recursion depth issues"""
    for attempt in range(max_retries):
        try:
            result = await element.query_selector(selector)
            return result
        except RecursionError:
            print(f"[WARNING] RecursionError in query_selector for {selector}, attempt {attempt + 1}")
            if attempt == max_retries - 1:
                return None
            await asyncio.sleep(0.1 * (attempt + 1))
        except Exception as e:
            print(f"[WARNING] Error in query_selector for {selector}: {e}")
            return None
    return None


async def safe_query_selector_all(element, selector, max_retries=2):
    """Safe wrapper for query_selector_all that prevents recursion depth issues"""
    for attempt in range(max_retries):
        try:
            result = await element.query_selector_all(selector)
            return result
        except RecursionError:
            print(f"[WARNING] RecursionError in query_selector_all for {selector}, attempt {attempt + 1}")
            if attempt == max_retries - 1:
                return []
            await asyncio.sleep(0.1 * (attempt + 1))
        except Exception as e:
            print(f"[WARNING] Error in query_selector_all for {selector}: {e}")
            return []
    return []

async def check_incomplete_macros(browser, record_id, browsers_num=3):
    try:
        print(f"[CHECK] Starting incomplete macro check for report {record_id}")

        # First, fetch halfreport to map macro IDs
        report = await db.halfreports.find_one({"_id": ObjectId(record_id)})
        if not report:
            return {"status": "FAILED", "error": f"Report {record_id} not found in halfreports"}

        report_id = report.get("report_id")
        if not report_id:
            return {"status": "FAILED", "error": f"No report_id found for {record_id}"}

        base_url = f"https://qima.taqeem.sa/report/{report_id}"
        main_page = await browser.get(base_url)
        await asyncio.sleep(1)

        # Check for delete button first
        delete_btn = await wait_for_element(main_page, "#delete_report", timeout=5)
        if delete_btn:
            print("[INFO] Delete button exists, assuming all macros complete.")
            # Mark all assets as complete
            await db.halfreports.update_one(
                {"_id": ObjectId(record_id)},
                {"$set": {f"asset_data.{i}.submitState": 1 for i in range(len(report.get("asset_data", [])))}}
            )
            return {"status": "SUCCESS", "incomplete_ids": [], "macro_count": 0, "message": "All macros complete"}

        # Get total number of pages from pagination
        pagination_links = await main_page.query_selector_all('ul.pagination li a')
        page_numbers = []

        for link in pagination_links:
            text = link.text
            if text and text.strip().isdigit():
                page_numbers.append(int(text.strip()))

        total_pages = max(page_numbers) if page_numbers else 1
        print(f"[CHECK] Found {total_pages} pages to process with {browsers_num} tabs")

        # Create pages for parallel processing
        pages = [main_page] + [await browser.get("about:blank", new_tab=True) for _ in range(min(browsers_num - 1, total_pages - 1))]

        # Balanced page distribution
        def get_balanced_page_distribution(total_pages, num_tabs):
            if total_pages <= 0 or num_tabs <= 0:
                return [[] for _ in range(num_tabs)]
            
            base_pages_per_tab = total_pages // num_tabs
            remainder = total_pages % num_tabs
            
            distribution = []
            current_page = 1
            
            for tab_index in range(num_tabs):
                pages_this_tab = base_pages_per_tab + (1 if tab_index < remainder else 0)
                
                if pages_this_tab > 0:
                    tab_pages = list(range(current_page, current_page + pages_this_tab))
                    distribution.append(tab_pages)
                    current_page += pages_this_tab
                else:
                    distribution.append([])
            
            return distribution

        page_chunks = get_balanced_page_distribution(total_pages, len(pages))

        print(f"[CHECK] Page distribution: {[len(chunk) for chunk in page_chunks]} pages per tab")
        
        incomplete_ids = []
        incomplete_ids_lock = asyncio.Lock()

        async def process_pages_chunk(page, page_numbers_chunk, tab_id):
            local_incomplete = []
            
            print(f"[TAB-{tab_id}] Processing pages: {page_numbers_chunk}")
            
            for page_num in page_numbers_chunk:
                print(f"[TAB-{tab_id}] Processing page {page_num}")
                
                try:
                    # Navigate to the specific page
                    page_url = f"{base_url}?page={page_num}" if page_num > 1 else base_url
                    await page.get(page_url)
                    await asyncio.sleep(2)
                    
                    # Inner loop for table sub-pages (internal pagination)
                    while True:
                        # Wait for table to load
                        table = await wait_for_element(page, "#m-table", timeout=20)
                        if not table:
                            print(f"[TAB-{tab_id}] Table not found on page {page_num}, breaking")
                            break
                        
                        # METHOD 1: Get ALL data using page-level CSS selectors (RECOMMENDED)
                        # This avoids the stale element problem completely
                        macro_cells = await safe_query_selector_all(page, "#m-table tbody tr td:nth-child(1) a")
                        status_cells = await safe_query_selector_all(page, "#m-table tbody tr td:nth-child(6)")
                        
                        # Skip header row if needed
                        start_index = 0
                        
                        processed_count = 0
                        incomplete_count = 0
                        
                        for i in range(start_index, len(macro_cells)):
                            try:
                                if i >= len(status_cells):
                                    break
                                    
                                macro_cell = macro_cells[i]
                                status_cell = status_cells[i]
                                
                                macro_id_text = macro_cell.text if macro_cell else None
                                status_text = status_cell.text if status_cell else ""
                                
                                if not macro_id_text or not macro_id_text.strip():
                                    continue
                                    
                                macro_id = int(macro_id_text.strip())
                                submit_state = 0 if "غير مكتملة" in status_text else 1

                                # Update database
                                result = await db.halfreports.update_one(
                                    {"_id": ObjectId(record_id), "asset_data.id": macro_id},
                                    {"$set": {"asset_data.$.submitState": submit_state}}
                                )

                                print(f"[TAB-{tab_id}] Processed Macro {macro_id} on page {page_num}, submitState={submit_state}, matched={result.matched_count}, modified={result.modified_count}")

                                processed_count += 1
                                
                                if submit_state == 0:
                                    print(f"[TAB-{tab_id}] INCOMPLETE Macro {macro_id} on page {page_num}")
                                    local_incomplete.append(macro_id)
                                    incomplete_count += 1
                                    
                            except (ValueError, TypeError) as e:
                                print(f"[TAB-{tab_id}] WARNING Invalid macro ID on row {i}: {e}")
                                continue
                            except Exception as e:
                                print(f"[TAB-{tab_id}] ERROR processing row {i}: {e}")
                                continue
                        
                        print(f"[TAB-{tab_id}] Page {page_num}: Processed {processed_count} macros, {incomplete_count} incomplete")
                    
                        
                        
                        # Check for next button
                        next_btn = await wait_for_element(page, "#m-table_next", timeout=5)
                        if next_btn:
                            attributes = next_btn.attrs
                            classes = attributes.get("class_")
                            if "disabled" not in classes:
                                print(f"[TAB-{tab_id}] Clicking next sub-page button on page {page_num}")
                                await next_btn.click()
                                await asyncio.sleep(2)
                                continue
                        
                        # No more sub-pages, break inner loop
                        print(f"[TAB-{tab_id}] No more sub-pages on page {page_num}")
                        break
                        
                except Exception as e:
                    print(f"[TAB-{tab_id}] ERROR processing page {page_num}: {str(e)}")
                    continue
            
            async with incomplete_ids_lock:
                incomplete_ids.extend(local_incomplete)
                
            print(f"[TAB-{tab_id}] Completed processing, found {len(local_incomplete)} incomplete macros")

        # Process pages in parallel

        tasks = []
        for i, (page, chunk) in enumerate(zip(pages, page_chunks)):
            if chunk:  # Only create tasks for tabs that have pages to process
                tasks.append(process_pages_chunk(page, chunk, i))

        # Process pages in parallel
        await asyncio.gather(*tasks)

        # Close extra tabs
        for p in pages[1:]:
            await p.close()

        return {
            "status": "SUCCESS",
            "incomplete_ids": incomplete_ids,
            "macro_count": len(incomplete_ids),
            "total_pages_processed": total_pages,
            "tabs_used": len(pages)
        }

    except Exception as e:
        tb = traceback.format_exc()
        print("[CHECK] Error:", tb)
        return {"status": "FAILED", "error": str(e), "traceback": tb}
    

async def check_incomplete_macros_after_creation(browser, record_id, browsers_num=3):
    try:
        print("Fetching assets for DB ID:", record_id)
        report = await db.halfreports.find_one({"_id": ObjectId(record_id)})
        assets = report.get("asset_data", [])
        if not assets:
            return {"status": "FAILED", "error": "No assets found in DB"}
        
        report_id = report.get("report_id")
        report_url = f"https://qima.taqeem.sa/report/{report_id}"

        # Open the main report page
        main_page = await browser.get(report_url)
        await asyncio.sleep(1)

        # Check for delete button
        delete_btn = await wait_for_element(main_page, "#delete_report", timeout=10)
        if delete_btn:
            print("[INFO] Delete button exists, assuming all macros complete.")
            # Mark all assets as complete
            await db.halfreports.update_one(
                {"_id": ObjectId(record_id)},
                {"$set": {f"asset_data.{i}.submitState": 1 for i in range(len(assets))}}
            )
            return {"status": "SUCCESS", "macro_count": 0, "message": "All macros complete"}

        macro_ids = [str(asset["id"]) for asset in assets if "id" in asset]
        if not macro_ids:
            return {"status": "SUCCESS", "macro_count": 0, "message": "No macros found in DB assets"}

        macros_urls = [f"https://qima.taqeem.sa/report/macro/{macro_id}/show" for macro_id in macro_ids]

        pages = [await browser.get("about:blank", new_tab=True) for _ in range(min(browsers_num, len(macros_urls)))]
        chunks = [macros_urls[i::len(pages)] for i in range(len(pages))]

        incomplete_count = 0

        async def process_chunk(page, urls):
            nonlocal incomplete_count
            for url in urls:
                macro_id = url.rstrip("/").split("/")[-2].strip()
                await page.get(url)
                await asyncio.sleep(0.5)
                html_content = await page.get_content()

                submit_state = 0 if (html_content and "غير مكتملة" in html_content) else 1

                await db.halfreports.update_one(
                    {"_id": ObjectId(record_id), "asset_data.id": int(macro_id)},
                    {"$set": {"asset_data.$.submitState": submit_state}}
                )

                if submit_state == 0:
                    incomplete_count += 1

        await asyncio.gather(*[process_chunk(p, chunk) for p, chunk in zip(pages, chunks)])

        for p in pages:
            await p.close()

        return {"status": "SUCCESS", "macro_count": incomplete_count}

    except Exception as e:
        tb = traceback.format_exc()
        print("traceback:", tb)
        return {"status": "FAILED", "error": str(e), "traceback": tb}

async def add_assets_to_report(browser, report_id, browsers_num=5):
    try:
        assets = await db.assetdatas.find({"report_id": report_id}).to_list(None)
        if not assets:
            return {"status": "FAILED", "error": f"No assets found for reportId={report_id}"}

        record = {"_id": report_id, "asset_data": assets}
        record["number_of_macros"] = str(len(assets))
        print(f"➡️ Linking {len(assets)} assets to report {report_id}")

        macro_urls = await get_macros(browser, report_id, assets, browsers_num)
        if not macro_urls:
            return {"status": "FAILED", "error": "No macro edit URLs found"}

        print(f"✅ Found {len(macro_urls)} macro edit links: {macro_urls}")

        page = await browser.get(f"https://qima.taqeem.sa/report/{report_id}")
        translate = await wait_for_element(page, "a[href='https://qima.taqeem.sa/setlocale/ar']", timeout=30)
        if translate:
            await translate.click()
            await asyncio.sleep(1)
        else:
            print("⚠️ No translate link found")

        macro_result = await fill_assets_via_macro_urls(browser, record, macro_urls, tabs_num=3)
        if isinstance(macro_result, dict) and macro_result.get("status") == "FAILED":
            return macro_result

        check_result = await check_incomplete_macros(browser, report_id, browsers_num=3)
        if check_result.get("status") == "FAILED":
            print("⚠️ Warning: Failed to check incomplete macros:", check_result.get("error"))

        return {
            "status": "SUCCESS",
            "message": f"Assets linked & macros filled successfully for report {report_id}",
            "recordId": str(record["_id"]),
            "macro_urls": macro_urls,
            "incomplete_macros": check_result.get("macro_count", 0)
        }


    except Exception as e:
        tb = traceback.format_exc()
        return {"status": "FAILED", "error": str(e), "traceback": tb}