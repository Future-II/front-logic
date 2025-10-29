import asyncio, time, traceback
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

MONGO_URI = "mongodb+srv://test:JUL3OvyCSLVjSixj@assetval.pu3bqyr.mongodb.net/projectForever"
client = AsyncIOMotorClient(MONGO_URI)
db = client["projectForever"]

from formFiller import wait_for_element
from utils import wait_for_table_rows

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
                        table_ready = await wait_for_table_rows(page, timeout=100)
                        if not table_ready:
                            print(f"[TAB-{tab_id}] Timeout waiting for table rows on page {page_num}")
                            break
                        
                        await asyncio.sleep(3)
                        macro_cells = await safe_query_selector_all(page, "#m-table tbody tr td:nth-child(1) a")
                        status_cells = await safe_query_selector_all(page, "#m-table tbody tr td:nth-child(6)")
                        
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

