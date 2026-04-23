"""
scraper.py — Playwright-based job scraper

Two modes:
  python3 scraper.py --list-jobs <listing_url>
      → Loads a careers/listing page and prints matching jobs with URLs.

  python3 scraper.py <url>
      → Scrapes a single job page. Pages with collapsed sections are expanded
        before text is extracted.
"""

import sys
import time
import random
import requests
from playwright.sync_api import sync_playwright, Page, TimeoutError as PlaywrightTimeout
from observability import record_selector_result

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Multi-word phrases that almost exclusively appear on block/CAPTCHA pages.
# Single words like "captcha" are intentionally excluded — they appear in
# legitimate job descriptions (e.g. "experience with Captcha bypass").
BLOCK_PHRASES = {
    "please solve this captcha",
    "prove you are not a robot",
    "you have been blocked",
    "access has been denied",
    "please complete the security check",
    "verifying you are not a bot",
    "checking if the site connection is secure",
    "ray id",  # Cloudflare block pages always include this
}

# Single words that are suspicious ONLY when the page content is also very short
# (a real job description mentioning "captcha" as a skill won't be 200 chars long)
SUSPICIOUS_IF_SHORT = {
    "captcha", "cloudflare", "unusual traffic", "just a moment",
}


class ScraperError(Exception):
    """Raised when the scraper can't get usable content from a page."""


# ─── helpers ──────────────────────────────────────────────────────────────────

def _wait(min_s=1.0, max_s=2.5):
    """Random delay — mimics human reading time, reduces bot detection."""
    time.sleep(random.uniform(min_s, max_s))


def _check_block(text: str, url: str) -> None:
    """
    Raise ScraperError if the extracted text looks like a bot-block page.

    Two tiers:
    - BLOCK_PHRASES: multi-word phrases that appear almost exclusively on
      block pages — flag these regardless of content length.
    - SUSPICIOUS_IF_SHORT: single words that are only suspicious when the
      page is also very short. "captcha" alone is not a block signal on a
      4,000-char page — it's probably a skill in the job description.
    """
    lower = text.lower()

    for phrase in BLOCK_PHRASES:
        if phrase in lower:
            raise ScraperError(
                f"Bot detection triggered on {url}\n"
                f"  Detected: '{phrase}'\n"
                f"  The page returned a block/CAPTCHA page instead of job content.\n"
                f"  Greenhouse and Lever URLs work reliably; Indeed/LinkedIn often block headless browsers."
            )

    if len(text) < 1000:
        for word in SUSPICIOUS_IF_SHORT:
            if word in lower:
                raise ScraperError(
                    f"Likely blocked on {url}\n"
                    f"  Extracted only {len(text)} chars and found '{word}' in the content.\n"
                    f"  The page may be a bot-detection wall. Try the URL in your browser first."
                )

    if len(text) < 300:
        raise ScraperError(
            f"Only {len(text)} characters extracted from {url}\n"
            f"  The page may require login, use heavy JavaScript, or have blocked the scraper."
        )


def _make_browser(playwright, headless=True):
    """Launch Chrome with a realistic profile."""
    browser = playwright.chromium.launch(headless=headless)
    context = browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 900},
        locale="en-US",
    )
    context.set_extra_http_headers({"Accept-Language": "en-US,en;q=0.9"})
    return browser, context.new_page()


# ─── structured board listing ────────────────────────────────────────────────

def list_structured_jobs(
    url: str,
    location: str = None,
    department: str = None,
    headless: bool = True,
) -> list[dict]:
    """
    Scrape a listing board that exposes job cards as:
      a.job-result[data-location][data-department]

    Optional location / department args filter the results after scraping.

    Each returned dict: {title, url, location, department}
    """
    with sync_playwright() as p:
        browser, page = _make_browser(p, headless=headless)
        try:
            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
            except PlaywrightTimeout:
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
            _wait(2, 3)
            jobs = _extract_structured_job_links(page, url)
        except Exception as e:
            print(f"  Structured board scrape failed ({type(e).__name__}: {e})")
            jobs = []
        finally:
            browser.close()

    if location:
        jobs = [j for j in jobs if j.get("location") == location]
    if department:
        jobs = [j for j in jobs if j.get("department") == department]

    return jobs


def _extract_structured_job_links(page: Page, listing_url: str) -> list[dict]:
    """
    Return every job card from a structured listing page.

    Each card carries data-location and data-department attributes used by
    the listing page filters. We read them directly for richer UI filtering.
    """
    selector = "a.job-result[data-location]"
    t0 = time.perf_counter()
    cards = page.query_selector_all(selector)
    record_selector_result(
        selector=selector,
        context="scraper.listings",
        success=bool(cards),
        latency_ms=(time.perf_counter() - t0) * 1000,
        error=None if cards else "No matching job cards found",
    )
    base = "/".join(listing_url.split("/")[:3])

    jobs = []
    for card in cards:
        href  = card.get_attribute("href") or ""
        loc   = card.get_attribute("data-location") or ""
        dept  = card.get_attribute("data-department") or ""
        h3    = card.query_selector("h3")
        title = h3.inner_text().strip() if h3 else card.inner_text().strip()
        full_url = href if href.startswith("http") else f"{base}{href}"
        jobs.append({"title": title, "url": full_url, "location": loc, "department": dept})

    return jobs


# ─── careers page discovery ───────────────────────────────────────────────────

# Words in link text that strongly suggest a careers/jobs page
_CAREERS_TEXT = {
    "careers", "career", "jobs", "job openings", "work here",
    "work with us", "join us", "join our team", "we're hiring",
    "open positions", "open roles", "opportunities", "come work",
}

# URL path fragments that strongly suggest a careers/jobs page
_CAREERS_HREF = {
    "/careers", "/jobs", "/work-here", "/join", "/opportunities",
    "/openings", "/positions", "/apply",
}


def find_careers_url(url: str):
    """
    Given any company URL, find and return the URL of their careers/jobs page.

    Loads the page, scores every <a> tag by how much it looks like a careers
    link (text match + href pattern match), and returns the highest-scoring one.
    Returns None if nothing looks like a careers page.

    How to use it from the GUI:
      careers = find_careers_url("https://company.com/")
      # → "https://company.com/careers"
    """
    with sync_playwright() as p:
        browser, page = _make_browser(p, headless=True)

        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
        except PlaywrightTimeout:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)

        _wait(1.0, 2.0)

        base = "/".join(url.split("/")[:3])

        best_url   = None
        best_score = 0

        for link in page.query_selector_all("a[href]"):
            href = (link.get_attribute("href") or "").strip()
            text = link.inner_text().strip().lower()

            if not href or href.startswith("mailto:") or href.startswith("tel:"):
                continue

            score = 0

            # Text scoring: exact match beats substring
            for kw in _CAREERS_TEXT:
                if text == kw:
                    score += 4
                    break
                if kw in text:
                    score += 2
                    break

            # href scoring
            href_lower = href.lower()
            for pattern in _CAREERS_HREF:
                if pattern in href_lower:
                    score += 3
                    break

            if score > best_score:
                best_score = score
                best_url = href if href.startswith("http") else f"{base}{href}"

        browser.close()

    # Only return if we're reasonably confident it's a careers page
    return best_url if best_score >= 3 else None


# ─── generic job listing scraper ─────────────────────────────────────────────

# Known ATS domains — any sufficiently deep URL from these is likely a job posting
_ATS_DOMAINS = {
    "greenhouse.io", "lever.co", "ashbyhq.com",
    "bamboohr.com", "rippling.com", "workable.com",
    "myworkdayjobs.com", "icims.com", "smartrecruiters.com",
    "jobvite.com", "breezy.hr", "recruitee.com",
}

# Generic path segments that precede a job ID or slug
# Note: no "/apply" — that matches credit-card forms, loan pages, etc.
_JOB_PATH_SEGMENTS = {
    "/job/", "/jobs/", "/job-description/", "/job-opening/",
    "/careers/", "/career/",
    "/posting/", "/position/", "/openings/",
    "/requisition/", "/role/",
}

# Link texts that are definitely NOT job titles — skip these
_NAV_TEXTS = {
    "apply", "apply now", "apply here", "submit application",
    "back", "next", "previous", "continue", "go",
    "login", "log in", "sign in", "sign up", "register",
    "contact", "contact us", "about", "about us", "home",
    "blog", "news", "press", "privacy", "terms", "cookies",
    "learn more", "read more", "see all", "view all", "show more",
    "load more", "search", "filter", "reset", "clear", "close",
    "share", "tweet", "facebook", "linkedin", "instagram",
    "create alert", "job alert", "set alert", "get notified",
    "refer a friend", "referral",
}

# URL path fragments that disqualify any URL, even on ATS domains
_EXCLUDE_URL_FRAGMENTS = {
    "/users/", "/sign_in", "/sign-in", "/login",
    "/auth/", "/account/", "/register", "/password",
    "/sessions", "/oauth",
}


def _is_job_posting_url(href: str, listing_url: str) -> bool:
    """
    Two-tier check:

    Tier 1 — ATS domains: any URL from a known ATS with 4+ path segments
    is almost certainly a job posting (not the board root).
      ✓ boards.greenhouse.io/anthropic/jobs/4016185007   (5 parts)
      ✗ boards.greenhouse.io/anthropic                   (3 parts)

    Tier 2 — Generic segments: the URL must have a job segment AND non-empty
    content after it, so /jobs/ is a listing page but /jobs/12345 is a posting.
      ✓ /jobs/senior-engineer                            (content after)
      ✗ /jobs  or  /jobs/                               (nothing after)
    """
    if href.rstrip("/") == listing_url.rstrip("/"):
        return False

    lower = href.lower()

    # Always exclude auth / account URLs regardless of domain
    for fragment in _EXCLUDE_URL_FRAGMENTS:
        if fragment in lower:
            return False

    # Tier 1: known ATS domain with enough path depth
    for domain in _ATS_DOMAINS:
        if domain in lower:
            parts = [p for p in href.split("/") if p and p not in ("https:", "http:")]
            if len(parts) >= 3:   # domain + company + job_id minimum
                return True

    # Tier 2: generic path segment with content after it
    for seg in _JOB_PATH_SEGMENTS:
        idx = lower.find(seg)
        if idx >= 0:
            after = lower[idx + len(seg):].lstrip("/").split("?")[0]
            if len(after) >= 3:   # must have at least 3 chars after the segment
                return True

    return False


# ─── ATS public APIs ──────────────────────────────────────────────────────────
#
# Many ATS platforms expose unauthenticated JSON APIs for public job boards.
# Using the API is always better than scraping the rendered page:
#   - No browser needed → 10x faster
#   - No bot detection
#   - Structured data with location / department already separated
#
# Supported:
#   Greenhouse  boards.greenhouse.io/{company}  or  job-boards.greenhouse.io/{company}
#   Lever       jobs.lever.co/{company}
#
# If the API call fails (private board, wrong company slug, rate limit),
# we fall through to the Playwright + LLM scraper.


def _company_slug(url: str, after: str) -> str:
    """Pull the company identifier out of an ATS URL.

    _company_slug("https://boards.greenhouse.io/anthropic/jobs/123", "greenhouse.io/")
    → "anthropic"
    """
    try:
        tail = url.split(after)[-1].strip("/")
        return tail.split("/")[0]
    except Exception:
        return ""


def _list_greenhouse_api(company: str) -> list[dict]:
    """
    Greenhouse public board API.
    Returns up to ~500 jobs instantly with no browser.

    API shape:
      GET https://boards-api.greenhouse.io/v1/boards/{company}/jobs
      → {"jobs": [{"title", "location": {"name"}, "absolute_url", "departments": [...]}, ...]}
    """
    url = f"https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=false"
    try:
        r = requests.get(url, timeout=10,
                         headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        jobs = r.json().get("jobs", [])
        return [
            {
                "title":      j.get("title", "").strip(),
                "url":        j.get("absolute_url", ""),
                "location":   j.get("location", {}).get("name", ""),
                "department": j.get("departments", [{}])[0].get("name", "")
                              if j.get("departments") else "",
            }
            for j in jobs
            if j.get("title") and j.get("absolute_url")
        ]
    except Exception as e:
        print(f"  Greenhouse API failed ({e}) — falling back to browser scrape")
        return []


def _list_lever_api(company: str) -> list[dict]:
    """
    Lever public postings API.

    API shape:
      GET https://api.lever.co/v0/postings/{company}?mode=json
      → [{"text", "hostedUrl", "categories": {"team", "location", "department"}}, ...]
    """
    url = f"https://api.lever.co/v0/postings/{company}?mode=json"
    try:
        r = requests.get(url, timeout=10,
                         headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        jobs = r.json()
        if not isinstance(jobs, list):
            return []
        return [
            {
                "title":      j.get("text", "").strip(),
                "url":        j.get("hostedUrl", ""),
                "location":   j.get("categories", {}).get("location", ""),
                "department": j.get("categories", {}).get("team", ""),
            }
            for j in jobs
            if j.get("text") and j.get("hostedUrl")
        ]
    except Exception as e:
        print(f"  Lever API failed ({e}) — falling back to browser scrape")
        return []


def list_jobs(url: str, headless: bool = True) -> list[dict]:
    """
    Dispatch hierarchy — fastest/most-reliable path first:

    1. Greenhouse     → public JSON API (instant, structured)
    2. Lever          → public JSON API (instant, structured)
    3. Structured board cards (a.job-result with metadata)
    4. Everything else → Playwright loads page + Gemma identifies job links
                          (30-60 s, works on any page)
    """
    lower = url.lower()

    if "greenhouse.io" in lower:
        company = _company_slug(url, "greenhouse.io/")
        if company:
            jobs = _list_greenhouse_api(company)
            if jobs:
                return jobs

    if "lever.co" in lower:
        company = _company_slug(url, "lever.co/")
        if company:
            jobs = _list_lever_api(company)
            if jobs:
                return jobs

    jobs = list_structured_jobs(url, headless=headless)
    if jobs:
        return jobs

    # Generic fallback: browser + LLM
    return _list_jobs_generic(url, headless=headless)


# ── Step 1: extract every link from the loaded page ───────────────────────────

def _extract_page_links(page: Page, base_url: str) -> list[dict]:
    """
    Pull every <a> tag from the page and return a pre-filtered list of
    {text, url, context} dicts.

    We remove obvious noise (mailto, nav words, auth URLs) before handing
    the data to the LLM.  Fewer tokens = faster + cheaper inference.
    """
    base = "/".join(base_url.split("/")[:3])
    links = []
    seen = set()

    for link in page.query_selector_all("a[href]"):
        href = (link.get_attribute("href") or "").strip()
        text = link.inner_text().strip()

        if not href or not text:
            continue
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        if len(text) < 5 or len(text) > 150:
            continue
        if text.lower() in _NAV_TEXTS:
            continue

        full_url = href if href.startswith("http") else f"{base}{href}"

        if any(f in full_url.lower() for f in _EXCLUDE_URL_FRAGMENTS):
            continue
        if full_url in seen:
            continue
        seen.add(full_url)

        # Grab text from the nearest semantic container (li, card, article)
        # so the LLM sees location/department tags that live next to the title
        context = ""
        try:
            parent_text = link.evaluate(
                "el => el.closest('li, tr, [class*=job], [class*=card], article')?.innerText || ''"
            )
            ctx = parent_text.replace(text, "").strip()
            if ctx and len(ctx) < 120:
                context = ctx
        except Exception:
            pass

        links.append({"text": text, "url": full_url, "context": context})

    return links


# ── Step 2: send the link list to Gemma ───────────────────────────────────────

def _llm_extract_jobs(links_data: list[dict], source_url: str) -> list[dict]:
    """
    Format the pre-filtered link list and ask Gemma to identify job postings.

    Why use the LLM here instead of URL patterns?
    URL patterns break the moment a site uses an unusual path structure.
    Gemma understands the *meaning* of the link text and can tell the difference
    between "Senior Software Engineer → /req/12345" (a job) and
    "Our Engineering Blog → /blog/engineering" (not a job) without hardcoded rules.

    Input format sent to Gemma:
      1. "Senior Engineer" → https://company.com/jobs/123
         context: Remote · Engineering
      2. "Privacy Policy" → https://company.com/privacy
      ...

    Returns a list of {title, url, location, department} dicts.
    """
    from langchain_ollama import ChatOllama
    from langchain_core.output_parsers import JsonOutputParser
    from langchain_core.prompts import ChatPromptTemplate

    if not links_data:
        return []

    # Format compactly — each link is one or two lines
    lines = []
    for i, item in enumerate(links_data[:200], 1):   # cap at 200 to control token usage
        line = f'{i}. "{item["text"]}" → {item["url"]}'
        if item.get("context"):
            line += f'\n   nearby text: {item["context"]}'
        lines.append(line)

    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are analyzing links extracted from a job listings webpage.
Your task: identify which links lead to INDIVIDUAL job postings (one specific open position).

NOT job postings: navigation links, "See all jobs", category pages, blog posts,
sign-in pages, alert subscriptions, social media links.

For each job posting, return:
  title      — the job title (clean up whitespace/newlines)
  url        — the full URL exactly as given
  location   — from nearby text if available, else empty string
  department — from nearby text if available, else empty string

Return ONLY a valid JSON array. Empty array [] if none found.
Example: [{"title": "Senior Engineer", "url": "https://...", "location": "Remote", "department": "Engineering"}]"""),
        ("human", "Source page: {source_url}\n\nLinks:\n\n{links}"),
    ])

    llm    = ChatOllama(model="gemma4:26b", temperature=0)
    parser = JsonOutputParser()
    chain  = prompt | llm | parser

    try:
        raw = chain.invoke({"source_url": source_url, "links": "\n".join(lines)})
        jobs = []
        for item in raw:
            if isinstance(item, dict) and item.get("title") and item.get("url"):
                jobs.append({
                    "title":      item.get("title", "").strip(),
                    "url":        item.get("url", ""),
                    "location":   (item.get("location")   or "").strip(),
                    "department": (item.get("department") or "").strip(),
                })
        return jobs
    except Exception as e:
        print(f"  LLM extraction failed ({type(e).__name__}) — will try heuristic fallback")
        return []


# ── Step 3: heuristic fallback ────────────────────────────────────────────────

def _heuristic_filter(links_data: list[dict], listing_url: str) -> list[dict]:
    """
    URL-pattern fallback used when Gemma is unavailable or returns nothing.
    Less accurate than the LLM but works offline.
    """
    jobs = []
    for item in links_data:
        if _is_job_posting_url(item["url"], listing_url):
            jobs.append({
                "title":      item["text"],
                "url":        item["url"],
                "location":   item.get("context", ""),
                "department": "",
            })
    return jobs


# ── Orchestrator ──────────────────────────────────────────────────────────────

def _list_jobs_generic(url: str, headless: bool = True) -> list[dict]:
    """
    Three-step pipeline for any careers page:

    1. Playwright loads the page and collects every link + surrounding text
    2. Gemma reads the link list and returns only the job postings as JSON
    3. If Gemma fails, fall back to URL-pattern heuristics

    This works on any site because the LLM understands link context —
    it doesn't need to know the site's URL structure in advance.
    """
    with sync_playwright() as p:
        browser, page = _make_browser(p, headless=headless)

        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
        except PlaywrightTimeout:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)

        _wait(1.5, 2.5)
        links_data = _extract_page_links(page, url)
        browser.close()

    print(f"  Found {len(links_data)} candidate links — asking Gemma to identify job postings...")

    jobs = _llm_extract_jobs(links_data, url)

    if jobs:
        print(f"  Gemma identified {len(jobs)} job postings")
        return jobs

    print("  Gemma returned nothing — using URL-pattern heuristics as fallback")
    return _heuristic_filter(links_data, url)


# ─── single job page scraper ──────────────────────────────────────────────────

def scrape_job(url: str) -> str:
    """
    Scrape a single job posting URL and return its text.

    First attempts accordion-aware extraction for pages with collapsed content.
    If that doesn't yield enough text, falls back to common ATS selectors.

    Raises ScraperError on timeout, bot detection, or too-short content.
    """
    try:
        with sync_playwright() as p:
            browser, page = _make_browser(p, headless=True)

            try:
                page.goto(url, wait_until="networkidle", timeout=30000)
            except PlaywrightTimeout:
                # networkidle can hang on pages with constant background requests;
                # fall back to domcontentloaded which fires as soon as HTML is parsed.
                page.goto(url, wait_until="domcontentloaded", timeout=30000)

            _wait(1.5, 3.0)

            text = _scrape_accordion_job_page(page)
            if len(text.strip()) < 300:
                text = _scrape_generic_job_page(page)

            browser.close()

    except PlaywrightTimeout:
        raise ScraperError(
            f"Timed out loading {url}\n"
            f"  The site may be very slow, down, or actively blocking headless browsers."
        )
    except ScraperError:
        raise
    except Exception as e:
        raise ScraperError(f"Unexpected scraper error on {url}: {type(e).__name__}: {e}")

    _check_block(text.strip(), url)
    return text.strip()


def _scrape_accordion_job_page(page: Page) -> str:
    """
    Expand common accordion sections before extracting text.
    Many job pages hide key details in collapsed tabs.
    """
    accordion_tabs = [
        "Job Description",
        "Responsibilities",
        "Qualifications",
        "Benefits",
        "About",
        "About Us",
        "About the Team",
    ]

    expanded_count = 0
    for tab_name in accordion_tabs:
        t0 = time.perf_counter()
        try:
            # get_by_text finds any visible element containing this text.
            # .first prevents errors if the text appears in multiple places.
            tab_trigger = page.get_by_text(tab_name, exact=False).first
            tab_trigger.scroll_into_view_if_needed()
            tab_trigger.click()
            _wait(0.5, 1.0)
            print(f"  Expanded: {tab_name}")
            expanded_count += 1
            record_selector_result(
                selector=f"text:{tab_name}",
                context="scraper.accordion",
                success=True,
                latency_ms=(time.perf_counter() - t0) * 1000,
            )
        except Exception as e:
            print(f"  ! Could not expand '{tab_name}': {e}")
            record_selector_result(
                selector=f"text:{tab_name}",
                context="scraper.accordion",
                success=False,
                latency_ms=(time.perf_counter() - t0) * 1000,
                error=str(e),
            )

    record_selector_result(
        selector="accordion_any",
        context="scraper.accordion",
        success=expanded_count > 0,
        error=None if expanded_count > 0 else "No accordion sections were expandable",
    )

    _wait(0.5, 1.0)

    # Grab text from the most specific container we can find, then fallback
    for selector in [".job-content", ".job-detail", ".entry-content",
                     "[class*='job']", "article", "main"]:
        try:
            el = page.query_selector(selector)
            if el:
                text = el.inner_text()
                if len(text) > 300:
                    return text
        except Exception:
            continue

    return page.inner_text("body")


def _scrape_generic_job_page(page: Page) -> str:
    """Try common ATS selectors for generic job pages."""
    selectors = [
        "#content", ".job-post",                          # Greenhouse
        ".posting-description", ".posting-requirements",  # Lever
        ".description__text", ".jobs-description__content",  # LinkedIn
        "[data-automation-id='job-description']",         # Workday
        "[data-testid='job-description']",
        "#job-description", ".job-description",
        "article", "main",
    ]
    for sel in selectors:
        t0 = time.perf_counter()
        try:
            el = page.query_selector(sel)
            if el:
                text = el.inner_text()
                if len(text) > 300:
                    record_selector_result(
                        selector=sel,
                        context="scraper.job_content",
                        success=True,
                        latency_ms=(time.perf_counter() - t0) * 1000,
                    )
                    return text
        except Exception:
            continue
    record_selector_result(
        selector="job_content_any",
        context="scraper.job_content",
        success=False,
        error="No content selector returned enough text",
    )
    return page.inner_text("body")


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 scraper.py --list-jobs <url>    # list jobs from a listings page")
        print("  python3 scraper.py <url>                # scrape a single job page")
        sys.exit(1)

    if sys.argv[1] == "--list-jobs":
        if len(sys.argv) < 3:
            print("Error: provide a listings URL, e.g. python3 scraper.py --list-jobs https://company.com/careers")
            sys.exit(1)
        listing_url = sys.argv[2]
        print(f"\nLoading jobs from:\n  {listing_url}\n")
        jobs = list_jobs(listing_url)

        if not jobs:
            print("No jobs found.")
        else:
            print(f"\nFound {len(jobs)} job(s):\n")
            for i, job in enumerate(jobs, 1):
                print(f"  {i}. {job['title']}")
                extra = " · ".join(filter(None, [job.get("location"), job.get("department")]))
                if extra:
                    print(f"     {extra}")
                print(f"     {job['url']}\n")

    else:
        url = sys.argv[1]
        print(f"Scraping: {url}\n")
        result = scrape_job(url)
        print(f"Extracted {len(result)} characters\n")
        print("─" * 60)
        print(result[:4000])
