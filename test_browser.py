import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)  # headless=False so you can see it
        page = await browser.new_page()
        await page.goto("https://www.indeed.com/jobs?q=software+engineer&l=Puerto+Rico")
        await page.wait_for_timeout(3000)  # wait 3 seconds so you can see it
        
        title = await page.title()
        print(f"Page title: {title}")
        
        content = await page.content()
        print(f"Page content length: {len(content)} characters")
        
        await browser.close()

asyncio.run(main())