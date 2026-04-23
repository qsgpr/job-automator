"""
autofill.py — Playwright demo: auto-fill a job application form

Fill modes
----------
type              Sends one real keystroke per character (visible typing).
                  typing_delay controls ms between keystrokes.

instant_per_field Sets each field's value all at once, but pauses between
                  fields so you can watch it move through the form.
                  field_pause controls the gap between fields (seconds).

instant           Fills everything in one shot with no pauses at all.
                  Useful for testing without waiting.

Usage (CLI)
----------
  python3 autofill.py                        # sample data, "type" mode
  python3 autofill.py --mode instant         # fills instantly
  python3 autofill.py --mode instant_per_field
  python3 autofill.py --from-files           # reads resume.txt + cover_letter.txt
"""

import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright
from observability import record_selector_result

FORM_PATH = Path(__file__).parent / "form.html"


def autofill_form(
    name:          str,
    email:         str,
    phone:         str  = "",
    linkedin:      str  = "",
    resume_text:   str  = "",
    cover_letter:  str  = "",
    mode:          str  = "type",   # "type" | "instant_per_field" | "instant"
    typing_delay:  int  = 35,       # ms per keystroke (type mode only)
    field_pause:   float = 0.8,     # seconds between fields (instant_per_field only)
) -> None:
    """
    Open form.html in a visible Chrome window and fill every field.

    How fill modes work
    -------------------
    "type"
        page.type(text, delay=N) — fires one real KeyDown/KeyPress/KeyUp
        event per character.  This is what a human keyboard produces.
        Bot-detection systems that check for keyboard events will see
        legitimate input.  Slowest but most realistic.

    "instant_per_field"
        page.fill(text) — sets the input's .value directly (like
        JavaScript: input.value = text).  The field fills in one frame.
        Between fields we sleep for field_pause seconds so the viewer
        can see the cursor move from field to field.

    "instant"
        Same as instant_per_field but no pause between fields at all.
        The entire form is filled in under a second.
    """
    form_url = f"file://{FORM_PATH.resolve()}"

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--start-maximized"],
        )
        context = browser.new_context(no_viewport=True)
        page    = context.new_page()

        page.goto(form_url, wait_until="domcontentloaded")
        time.sleep(1.0)   # let the user see the blank form

        def fill(selector: str, text: str) -> None:
            """Click a field then fill it according to the chosen mode."""
            if not text:
                return
            t0 = time.perf_counter()
            try:
                el = page.locator(selector)
                el.click()
                time.sleep(0.15)   # brief focus pause

                if mode == "type":
                    el.type(text, delay=typing_delay)
                    time.sleep(0.15)

                elif mode == "instant_per_field":
                    el.fill(text)
                    time.sleep(field_pause)   # pause so viewer sees each field fill

                else:   # "instant"
                    el.fill(text)

                record_selector_result(
                    selector=selector,
                    context="autofill.form",
                    success=True,
                    latency_ms=(time.perf_counter() - t0) * 1000,
                )
            except Exception as e:
                record_selector_result(
                    selector=selector,
                    context="autofill.form",
                    success=False,
                    latency_ms=(time.perf_counter() - t0) * 1000,
                    error=str(e),
                )
                raise

        fill("#name",     name)
        fill("#email",    email)
        fill("#phone",    phone)
        fill("#linkedin", linkedin)
        fill("#resume",   resume_text)
        fill("#cover",    cover_letter)

        # Brief pause so the completed form is visible before submit
        if mode == "type":
            time.sleep(1.5)
        elif mode == "instant_per_field":
            time.sleep(1.0)
        else:
            time.sleep(0.5)

        page.locator("#submitBtn").click()
        time.sleep(2.5)   # show success screen

        browser.close()


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mode = "type"
    for arg in sys.argv[1:]:
        if arg.startswith("--mode="):
            mode = arg.split("=", 1)[1]
        elif arg == "--mode" and sys.argv.index(arg) + 1 < len(sys.argv):
            mode = sys.argv[sys.argv.index(arg) + 1]

    from_files = "--from-files" in sys.argv

    if from_files:
        resume_text  = Path("resume.txt").read_text().strip()  if Path("resume.txt").exists()  else ""
        cover_letter = Path("cover_letter.txt").read_text().strip() if Path("cover_letter.txt").exists() else ""
    else:
        resume_text = (
            "5+ years of browser automation engineering using Playwright, Puppeteer, and Selenium.\n"
            "Built large-scale scraping infrastructure processing 500k pages/day.\n"
            "Strong JavaScript/TypeScript, REST API design, and cloud deployment (AWS).\n"
            "Experience debugging shadow DOM, iframe injection, and CAPTCHA mitigation."
        )
        cover_letter = (
            "I am excited to apply for the Senior Browser Automation Engineer role on your team. "
            "Your work on LLM-powered automation workflows aligns exactly "
            "with the systems I have designed and shipped over the past five years.\n\n"
            "I look forward to discussing how my background fits the challenges your team is solving."
        )

    print(f"Running demo in '{mode}' mode...")
    autofill_form(
        name         = "Carlos Martinez",
        email        = "carlos199730@gmail.com",
        phone        = "(787) 555-0100",
        linkedin     = "linkedin.com/in/carlosmartinez",
        resume_text  = resume_text,
        cover_letter = cover_letter,
        mode         = mode,
    )
    print("Done.")
