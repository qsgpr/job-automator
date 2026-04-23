"""
main.py — Job Automator CLI

Usage:
  python3 main.py <url>                   analyze a job URL (positional)
  python3 main.py --url <url>             same, explicit flag
  python3 main.py --url <url> --save      analyze and save report to reports/
  python3 main.py --list-jobs <url>       list jobs from a careers/listing page
  python3 main.py --history               show job analysis history
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

from scraper import scrape_job, list_jobs, ScraperError
from analyzer import analyze, load_resume, format_report


HISTORY_FILE = Path("history.json")
REPORTS_DIR = Path("reports")


# ─── history ──────────────────────────────────────────────────────────────────

def load_history() -> list:
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text())
        except json.JSONDecodeError:
            return []
    return []


def append_history(entry: dict) -> None:
    history = load_history()
    history.append(entry)
    HISTORY_FILE.write_text(json.dumps(history, indent=2))


def show_history() -> None:
    history = load_history()
    if not history:
        print("\nNo jobs analyzed yet. Run: python3 main.py <url>")
        return

    line = "=" * 60
    print(f"\n{line}")
    print(f"JOB HISTORY  ({len(history)} analyzed)")
    print(line)

    for entry in reversed(history):
        score = entry.get("score", "?")
        bar = ("#" * (score // 10) if isinstance(score, int) else "?")
        print(f"\n  {entry.get('title', 'Unknown')}")
        print(f"  Score : {score}/100  [{bar:<10}]")
        print(f"  Date  : {entry.get('date', '?')}")
        print(f"  URL   : {entry.get('url', '?')}")
        if entry.get("saved_to"):
            print(f"  File  : {entry['saved_to']}")

    print(f"\n{line}\n")


# ─── report saving ────────────────────────────────────────────────────────────

def save_report(report_text: str, url: str, title: str) -> str:
    """
    Save the report to reports/<timestamp>_<slug>.txt.
    Returns the path as a string so we can log it in history.
    """
    REPORTS_DIR.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    slug = title.lower()[:40]
    slug = "".join(c if c.isalnum() else "-" for c in slug).strip("-")
    filename = REPORTS_DIR / f"{timestamp}_{slug}.txt"

    # Prepend metadata header that isn't in format_report
    header = f"URL: {url}\nDate: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n"
    filename.write_text(header + report_text + "\n")
    return str(filename)


# ─── main ─────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="Job Automator — scrape and analyze job postings with Gemma",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  python3 main.py https://company.com/jobs/senior-browser-automation-engineer\n"
            "  python3 main.py --url <url> --save\n"
            "  python3 main.py --list-jobs https://company.com/careers\n"
            "  python3 main.py --history\n"
        ),
    )
    parser.add_argument(
        "url", nargs="?", metavar="URL",
        help="job URL to analyze (positional form)",
    )
    parser.add_argument(
        "--url", dest="url_flag", metavar="URL",
        help="job URL to analyze (explicit flag form)",
    )
    parser.add_argument(
        "--save", action="store_true",
        help="save the report to a timestamped file in reports/",
    )
    parser.add_argument(
        "--list-jobs", metavar="LISTING_URL",
        help="list jobs from a careers or job board page",
    )
    parser.add_argument(
        "--history", action="store_true",
        help="show the job analysis history log",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # ── subcommands that don't need a URL ─────────────────────────────────────

    if args.history:
        show_history()
        return

    if args.list_jobs:
        print(f"\nLoading job listings from:\n  {args.list_jobs}\n")
        jobs = list_jobs(args.list_jobs, headless=True)
        if not jobs:
            print("No jobs found.")
        else:
            print(f"Found {len(jobs)} job(s):\n")
            for i, job in enumerate(jobs, 1):
                print(f"  {i}. {job['title']}")
                extra = " · ".join(filter(None, [job.get("location"), job.get("department")]))
                if extra:
                    print(f"     {extra}")
                print(f"     {job['url']}\n")
        return

    # ── analyze a URL ─────────────────────────────────────────────────────────

    url = args.url or args.url_flag
    if not url:
        parser.print_help()
        sys.exit(1)

    # Step 1: scrape
    print(f"\n[1/3] Scraping job description...")
    print(f"      {url}")
    try:
        job_description = scrape_job(url)
        print(f"      Extracted {len(job_description)} characters")
    except ScraperError as e:
        print(f"\nScraper error: {e}")
        print("\nTips:")
        print("  • Greenhouse and Lever job pages work reliably")
        print("  • Indeed and LinkedIn often block headless browsers")
        print("  • Try the URL in your browser first to confirm it loads")
        sys.exit(1)

    # Step 2: load resume
    print("\n[2/3] Loading resume...")
    try:
        resume = load_resume()
        print(f"      Loaded {len(resume)} characters")
    except FileNotFoundError:
        print("\nError: resume.txt not found.")
        print("Create it: touch resume.txt  then paste your resume text inside.")
        sys.exit(1)
    except ValueError as e:
        print(f"\nError: {e}")
        sys.exit(1)

    # Step 3: analyze
    print("\n[3/3] Analyzing with Gemma (30-60 seconds)...")
    try:
        analysis = analyze(job_description, resume)
    except RuntimeError as e:
        print(f"\nAnalysis error: {e}")
        sys.exit(1)

    # Display
    report_text = format_report(analysis)
    print(report_text)

    # Save if requested
    saved_to = None
    if args.save:
        title = analysis.get("title") or url.rstrip("/").split("/")[-1].replace("-", " ").title()
        saved_to = save_report(report_text, url, title)
        print(f"Report saved: {saved_to}")

    # Log to history
    title = analysis.get("title") or url.rstrip("/").split("/")[-1].replace("-", " ").title()
    append_history({
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "title": title,
        "url": url,
        "score": analysis.get("match_score"),
        "saved_to": saved_to,
    })


if __name__ == "__main__":
    main()
