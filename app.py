import hashlib
import time
import streamlit as st
import pandas as pd
from pathlib import Path
from datetime import datetime

from scraper import scrape_job, list_jobs, find_careers_url, ScraperError
from analyzer import analyze_with_metrics, load_resume, format_report, generate_cover_letter, parse_resume
from autofill import autofill_form
from main import load_history, append_history, save_report
from observability import (
    start_run,
    add_run_event,
    finish_run,
    get_timeline_events,
    get_selector_reliability,
    get_selector_alerts,
)

st.set_page_config(
    page_title="Job Automator",
    page_icon="🎯",
    layout="centered",
)


# ── shared rendering helpers ───────────────────────────────────────────────────
# Defined before the tabs so they're available when tab code runs top-to-bottom.

def _score_color(score: int) -> str:
    if score >= 70:
        return "green"
    if score >= 50:
        return "orange"
    return "red"


def _render_full_report(analysis: dict, url: str, save_flag: bool) -> None:
    """Full report layout used in the Analyze tab."""
    title = analysis.get("title", "")
    score = analysis.get("match_score", 0)

    st.divider()
    if title:
        st.subheader(title)

    color = _score_color(score)
    label = ("Strong" if score >= 70 else "Partial" if score >= 50 else "Weak") + f" match — {score}/100"
    st.markdown(
        f"<div style='font-size:2rem;font-weight:700;color:{color}'>{score}/100</div>",
        unsafe_allow_html=True,
    )
    st.progress(score / 100, text=label)

    if analysis.get("summary"):
        st.markdown(f"**Summary:** {analysis['summary']}")

    st.divider()
    col_l, col_r = st.columns(2)
    with col_l:
        st.markdown("**Your Strengths**")
        for s in analysis.get("strengths", []):
            st.success(s)
    with col_r:
        st.markdown("**Gaps to Address**")
        for g in analysis.get("gaps", []):
            st.warning(g)

    with st.expander("Key Requirements"):
        for r in analysis.get("requirements", []):
            st.write(f"• {r}")
    with st.expander("Nice to Have"):
        for r in analysis.get("nice_to_have", []):
            st.write(f"• {r}")

    report_text = format_report(analysis)
    saved_to = None
    if save_flag:
        slug = title or url.rstrip("/").split("/")[-1]
        saved_to = save_report(report_text, url, slug)
        st.info(f"Report saved: `{saved_to}`")

    st.download_button(
        label="Download report as .txt",
        data=f"URL: {url}\nDate: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n{report_text}",
        file_name=f"{title or 'report'}.txt",
        mime="text/plain",
    )

    append_history({
        "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "title": title or url.rstrip("/").split("/")[-1],
        "url": url,
        "score": score,
        "saved_to": saved_to,
    })


def _render_inline_result(analysis: dict) -> None:
    """Compact result layout used inside each job card in Browse Jobs."""
    score = analysis.get("match_score", 0)
    color = _score_color(score)

    st.markdown(
        f"<span style='font-size:1.3rem;font-weight:700;color:{color}'>{score}/100</span>",
        unsafe_allow_html=True,
    )
    st.progress(score / 100)

    if analysis.get("summary"):
        st.caption(analysis["summary"])

    col_s, col_g = st.columns(2)
    with col_s:
        st.markdown("**Strengths**")
        for s in analysis.get("strengths", []):
            st.success(s)
    with col_g:
        st.markdown("**Gaps**")
        for g in analysis.get("gaps", []):
            st.warning(g)


def _record_timed_event(run_id: str, step: str, tool_call: str, start_time: float, error=None, token_usage=None, retry_of=None, details=None) -> None:
    add_run_event(
        run_id=run_id,
        step=step,
        tool_call=tool_call,
        latency_ms=(time.perf_counter() - start_time) * 1000,
        token_usage=token_usage or {},
        error=error,
        retry_of=retry_of,
        details=details or {},
    )


# ── page ───────────────────────────────────────────────────────────────────────

st.title("Job Automator")
st.caption("Paste a job URL · score it against your resume · powered by Gemma running locally")

tab_analyze, tab_browse, tab_cover, tab_demo, tab_history, tab_observability = st.tabs(
    ["Analyze Job", "Browse Jobs", "Cover Letter", "Auto-Fill Demo", "History", "Observability"]
)


# ── Analyze tab ────────────────────────────────────────────────────────────────

with tab_analyze:
    url = st.text_input(
        "Job URL",
        placeholder="https://company.com/jobs/senior-browser-automation-engineer",
    )
    save_flag = st.checkbox("Save report to reports/")

    if st.button("Analyze", type="primary", use_container_width=True):
        if not url.strip():
            st.warning("Paste a job URL above.")
            st.stop()

        run_id = start_run("analyze_job", {"url": url.strip()})

        t0 = time.perf_counter()
        try:
            resume = load_resume()
        except FileNotFoundError:
            _record_timed_event(run_id, "load_resume", "file:resume.txt", t0, error="resume.txt not found")
            finish_run(run_id, status="failed", summary={"reason": "resume_missing"})
            st.error("resume.txt not found. Create it in the project folder and paste your resume text.")
            st.stop()
        except ValueError as e:
            _record_timed_event(run_id, "load_resume", "file:resume.txt", t0, error=str(e))
            finish_run(run_id, status="failed", summary={"reason": "resume_invalid"})
            st.error(str(e))
            st.stop()
        _record_timed_event(run_id, "load_resume", "file:resume.txt", t0)

        with st.spinner("Scraping job page..."):
            t0 = time.perf_counter()
            try:
                jd = scrape_job(url.strip())
            except ScraperError as e:
                _record_timed_event(run_id, "scrape_job", "playwright:scraper", t0, error=str(e))
                finish_run(run_id, status="failed", summary={"reason": "scrape_error"})
                st.error(str(e))
                st.stop()
            _record_timed_event(run_id, "scrape_job", "playwright:scraper", t0)
        st.success(f"Scraped {len(jd):,} characters.")

        with st.spinner("Analyzing with Gemma — 30-60 seconds..."):
            try:
                analysis, attempts = analyze_with_metrics(jd, resume)
                for attempt in attempts:
                    add_run_event(
                        run_id=run_id,
                        step=f"analyze_llm_attempt_{attempt['attempt']}",
                        tool_call=attempt["tool_call"],
                        latency_ms=attempt["latency_ms"],
                        token_usage=attempt["token_usage"],
                        error=attempt["error"],
                        retry_of=attempt["retry_of"],
                        details={"temperature": attempt["temperature"]},
                    )
            except RuntimeError as e:
                finish_run(run_id, status="failed", summary={"reason": "analysis_error"})
                st.error(str(e))
                st.stop()

        finish_run(
            run_id,
            status="success",
            summary={
                "score": analysis.get("match_score"),
                "title": analysis.get("title", ""),
            },
        )
        _render_full_report(analysis, url.strip(), save_flag)


# ── Browse Jobs tab ────────────────────────────────────────────────────────────

with tab_browse:
    listing_url = st.text_input(
        "Jobs listing page URL",
        placeholder="https://company.com/careers",
        help="Paste any careers or job board page. Greenhouse, Lever, Workday, and custom pages all work.",
    )

    if st.button("Load Jobs", use_container_width=True):
        target = listing_url.strip()
        run_id = start_run("browse_jobs", {"url": target})
        with st.spinner("Loading job listings..."):
            t0 = time.perf_counter()
            try:
                loaded = list_jobs(target, headless=True)
                _record_timed_event(run_id, "list_jobs", "playwright+apis:list_jobs", t0)

                # No jobs found — maybe this is a company homepage.
                # Try to discover the careers/jobs page automatically.
                if not loaded:
                    t0 = time.perf_counter()
                    careers = find_careers_url(target)
                    _record_timed_event(run_id, "find_careers_url", "playwright:find_careers_url", t0)
                    if careers and careers.rstrip("/") != target.rstrip("/"):
                        t0 = time.perf_counter()
                        loaded = list_jobs(careers, headless=True)
                        _record_timed_event(
                            run_id,
                            "list_jobs_retry",
                            "playwright+apis:list_jobs",
                            t0,
                            retry_of=1,
                            details={"resolved_url": careers},
                        )
                        if loaded:
                            target = careers   # update so we show the resolved URL

                st.session_state.browse_jobs   = loaded
                st.session_state.browse_source = target
                finish_run(run_id, status="success", summary={"jobs_found": len(loaded), "source": target})
            except Exception as e:
                _record_timed_event(run_id, "list_jobs", "playwright+apis:list_jobs", t0, error=str(e))
                finish_run(run_id, status="failed", summary={"reason": "listings_error"})
                st.error(f"Could not load listings: {e}")

    all_jobs = st.session_state.get("browse_jobs", [])
    browse_source = st.session_state.get("browse_source", "")

    # If we followed a redirect to a careers page, tell the user
    if browse_source and browse_source.rstrip("/") != listing_url.strip().rstrip("/"):
        st.info(f"Careers page found: {browse_source}")

    if not all_jobs:
        st.info("Enter a jobs listing URL and click Load Jobs.")
    else:
        # ── dynamic filters ──────────────────────────────────────────────────
        # Build filter options from whatever fields came back.
        # Some boards return structured location + department;
        # others return whatever metadata could be extracted.

        has_location   = any(j.get("location")   for j in all_jobs)
        has_department = any(j.get("department")  for j in all_jobs)

        keyword = st.text_input(
            "Search",
            placeholder="Filter by keyword — title, location, department...",
        )

        filter_cols = st.columns(2) if (has_location and has_department) else (
                      st.columns([1, 3]) if (has_location or has_department) else [None]
        )

        selected_loc  = "All"
        selected_dept = "All"

        col_idx = 0
        if has_location:
            locations = ["All"] + sorted(set(j["location"] for j in all_jobs if j.get("location")))
            selected_loc = filter_cols[col_idx].selectbox("Location", locations)
            col_idx += 1

        if has_department:
            departments = ["All"] + sorted(set(j["department"] for j in all_jobs if j.get("department")))
            selected_dept = filter_cols[col_idx].selectbox("Department", departments)

        # Client-side filter — no re-scraping needed
        def _matches(job: dict) -> bool:
            searchable = " ".join([
                job.get("title", ""),
                job.get("location", ""),
                job.get("department", ""),
            ]).lower()
            if keyword and keyword.lower() not in searchable:
                return False
            if selected_loc  != "All" and job.get("location")   != selected_loc:
                return False
            if selected_dept != "All" and job.get("department")  != selected_dept:
                return False
            return True

        jobs = [j for j in all_jobs if _matches(j)]

        count_label = f"**{len(jobs)} job(s)**"
        if len(jobs) < len(all_jobs):
            count_label += f" of {len(all_jobs)} total"
        st.markdown(count_label)
        st.divider()

        for job in jobs:
            # Hash the full URL for a short, unique, collision-free key.
            # Truncating the URL slug fails when two jobs share a long title prefix.
            uid        = hashlib.md5(job["url"].encode()).hexdigest()[:10]
            result_key = f"jr_{uid}"
            error_key  = f"je_{uid}"
            logged_key = f"jl_{uid}"

            with st.container(border=True):
                st.markdown(f"**{job['title']}**")

                # Location / department tags (when available)
                tags = " · ".join(filter(None, [job.get("location"), job.get("department")]))
                if tags:
                    st.caption(tags)

                col_analyze, col_copy, col_open = st.columns(3)

                if col_analyze.button("Analyze", key=f"btn_{uid}", use_container_width=True):
                    run_id = start_run("browse_job_analyze", {"url": job["url"], "title": job["title"]})
                    t0 = time.perf_counter()
                    try:
                        resume = load_resume()
                    except (FileNotFoundError, ValueError) as e:
                        _record_timed_event(run_id, "load_resume", "file:resume.txt", t0, error=str(e))
                        finish_run(run_id, status="failed", summary={"reason": "resume_error"})
                        st.session_state[error_key] = f"Resume issue: {e}"
                    else:
                        _record_timed_event(run_id, "load_resume", "file:resume.txt", t0)
                        with st.spinner("Analyzing — 30-60 seconds..."):
                            t0 = time.perf_counter()
                            try:
                                jd = scrape_job(job["url"])
                                _record_timed_event(run_id, "scrape_job", "playwright:scraper", t0)

                                result, attempts = analyze_with_metrics(jd, resume)
                                for attempt in attempts:
                                    add_run_event(
                                        run_id=run_id,
                                        step=f"analyze_llm_attempt_{attempt['attempt']}",
                                        tool_call=attempt["tool_call"],
                                        latency_ms=attempt["latency_ms"],
                                        token_usage=attempt["token_usage"],
                                        error=attempt["error"],
                                        retry_of=attempt["retry_of"],
                                        details={"temperature": attempt["temperature"]},
                                    )
                                st.session_state[result_key] = result
                                st.session_state.pop(error_key, None)
                                finish_run(
                                    run_id,
                                    status="success",
                                    summary={"score": result.get("match_score"), "title": result.get("title", "")},
                                )
                            except (ScraperError, RuntimeError) as e:
                                _record_timed_event(run_id, "scrape_or_analyze", "playwright:scraper+ollama", t0, error=str(e))
                                finish_run(run_id, status="failed", summary={"reason": "analyze_error"})
                                st.session_state[error_key] = str(e)

                    # Guard: only log to history once per URL per session
                    if result_key in st.session_state and not st.session_state.get(logged_key):
                        r = st.session_state[result_key]
                        append_history({
                            "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                            "title": r.get("title") or job["title"],
                            "url": job["url"],
                            "score": r.get("match_score"),
                            "saved_to": None,
                        })
                        st.session_state[logged_key] = True

                with col_copy.popover("Copy URL", use_container_width=True):
                    st.code(job["url"], language=None)

                col_open.link_button("Open →", job["url"], use_container_width=True)

                if error_key in st.session_state:
                    st.error(st.session_state[error_key])

                if result_key in st.session_state:
                    _render_inline_result(st.session_state[result_key])


# ── Cover Letter tab ──────────────────────────────────────────────────────────

with tab_cover:
    st.markdown("Generate a tailored cover letter using Gemma based on the company, role, and your resume.")

    col_co, col_ro = st.columns(2)
    company = col_co.text_input("Company", placeholder="Acme Corp")
    role    = col_ro.text_input("Role", placeholder="Senior Browser Automation Engineer")

    skills = st.text_input(
        "Skills to highlight",
        placeholder="Playwright, JavaScript, LLM agents, CI/CD — comma separated",
        help="Pull these from the Gaps or Requirements section of your analysis report.",
    )

    if st.button("Generate Cover Letter", type="primary", use_container_width=True):
        if not company or not role:
            st.warning("Enter a company name and role first.")
            st.stop()

        run_id = start_run("cover_letter", {"company": company, "role": role})
        t0 = time.perf_counter()
        try:
            resume = load_resume()
        except (FileNotFoundError, ValueError) as e:
            _record_timed_event(run_id, "load_resume", "file:resume.txt", t0, error=str(e))
            finish_run(run_id, status="failed", summary={"reason": "resume_error"})
            st.error(str(e))
            st.stop()
        _record_timed_event(run_id, "load_resume", "file:resume.txt", t0)

        with st.spinner("Writing cover letter with Gemma — 20-40 seconds..."):
            t0 = time.perf_counter()
            try:
                letter = generate_cover_letter(company, role, resume, skills)
                _record_timed_event(run_id, "generate_cover_letter", "ollama:gemma4:26b", t0)
                st.session_state.cover_letter = letter
                st.session_state.cover_letter_meta = {"company": company, "role": role}
                finish_run(run_id, status="success", summary={"letters_generated": 1})
            except Exception as e:
                _record_timed_event(run_id, "generate_cover_letter", "ollama:gemma4:26b", t0, error=str(e))
                finish_run(run_id, status="failed", summary={"reason": "generation_error"})
                st.error(f"Cover letter generation failed: {e}")
                st.stop()

    if "cover_letter" in st.session_state:
        meta = st.session_state.get("cover_letter_meta", {})
        st.divider()
        st.subheader(f"{meta.get('role', 'Cover Letter')} — {meta.get('company', '')}")
        letter_text = st.session_state.cover_letter
        st.write(letter_text)

        col_dl, col_sv = st.columns(2)
        col_dl.download_button(
            "Download as .txt",
            data=letter_text,
            file_name=f"cover_letter_{meta.get('company', 'company').lower().replace(' ', '_')}.txt",
            mime="text/plain",
            use_container_width=True,
        )
        if col_sv.button("Save to cover_letter.txt", use_container_width=True):
            from pathlib import Path
            Path("cover_letter.txt").write_text(letter_text)
            st.success("Saved to cover_letter.txt — ready for the Demo tab.")


# ── Auto-Fill Demo tab ─────────────────────────────────────────────────────────

with tab_demo:
    st.markdown(
        "**Full pipeline demo**: Playwright opens a real browser window on your screen "
        "and fills your application — field by field — in real time."
    )
    st.caption("This demonstrates the AI + browser automation workflow end-to-end.")

    # ── Contact info ─────────────────────────────────────────────────────────
    st.divider()

    # Initialize session_state defaults so the keys exist before widgets render
    _demo_defaults = {
        "demo_name":     "Carlos Martinez",
        "demo_email":    "carlos199730@gmail.com",
        "demo_phone":    "",
        "demo_linkedin": "",
    }
    for k, v in _demo_defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

    col_prefill, _ = st.columns([2, 3])
    if col_prefill.button("Pre-fill contact info from resume", use_container_width=True):
        run_id = start_run("prefill_contact", {})
        t0 = time.perf_counter()
        try:
            resume_raw = load_resume()
        except (FileNotFoundError, ValueError) as e:
            _record_timed_event(run_id, "load_resume", "file:resume.txt", t0, error=str(e))
            finish_run(run_id, status="failed", summary={"reason": "resume_error"})
            st.error(str(e))
        else:
            _record_timed_event(run_id, "load_resume", "file:resume.txt", t0)
            with st.spinner("Parsing resume with Gemma — 10-20 seconds..."):
                t0 = time.perf_counter()
                parsed = parse_resume(resume_raw)
                _record_timed_event(run_id, "parse_resume", "ollama:gemma4:26b", t0)
            # Only overwrite a field if the LLM found something
            if parsed.get("name"):     st.session_state.demo_name     = parsed["name"]
            if parsed.get("email"):    st.session_state.demo_email    = parsed["email"]
            if parsed.get("phone"):    st.session_state.demo_phone    = parsed["phone"]
            if parsed.get("linkedin"): st.session_state.demo_linkedin = parsed["linkedin"]
            st.success("Contact info extracted — review and edit below.")
            finish_run(run_id, status="success", summary={"fields_found": len(parsed)})

    st.subheader("Applicant Info")
    col_n, col_e = st.columns(2)
    # key= binds the widget to session_state so pre-fill updates it
    demo_name  = col_n.text_input("Your Name",  key="demo_name")
    demo_email = col_e.text_input("Your Email", key="demo_email")

    col_p, col_li = st.columns(2)
    demo_phone    = col_p.text_input("Phone",    key="demo_phone")
    demo_linkedin = col_li.text_input("LinkedIn", key="demo_linkedin")

    # ── Content ───────────────────────────────────────────────────────────────
    st.subheader("Content")

    try:
        default_resume = load_resume()
        resume_source  = "Loaded from resume.txt"
    except Exception:
        default_resume = ""
        resume_source  = "resume.txt is empty — paste your resume below"

    demo_resume = st.text_area("Resume", value=default_resume, height=180, help=resume_source)

    default_cover = st.session_state.get("cover_letter", "")
    demo_cover = st.text_area(
        "Cover Letter",
        value=default_cover,
        height=180,
        help="Generate one in the Cover Letter tab, or paste your own.",
    )

    # ── Speed selector ────────────────────────────────────────────────────────
    st.subheader("Fill Mode")

    speed = st.select_slider(
        "How the form is filled",
        options=["Instant", "Instant per field", "Fast typing", "Normal typing", "Slow typing"],
        value="Normal typing",
    )

    # Map to (mode, typing_delay_ms, field_pause_s)
    speed_config = {
        "Instant":          ("instant",           0,  0.0),
        "Instant per field": ("instant_per_field", 0,  0.9),
        "Fast typing":      ("type",               8,  0.0),
        "Normal typing":    ("type",               35, 0.0),
        "Slow typing":      ("type",               70, 0.0),
    }

    fill_mode, fill_delay, fill_pause = speed_config[speed]

    speed_descriptions = {
        "Instant":           "Sets every field value in one shot — no keystrokes, no pauses.",
        "Instant per field": "Fills each field instantly but pauses between them so you can watch.",
        "Fast typing":       "Real keystrokes at ~125 WPM — fast but human-looking.",
        "Normal typing":     "Real keystrokes at ~57 WPM — comfortable to watch.",
        "Slow typing":       "Real keystrokes at ~28 WPM — every character visible.",
    }
    st.caption(speed_descriptions[speed])

    # ── Run ───────────────────────────────────────────────────────────────────
    st.divider()
    if st.button("Run Demo →", type="primary", use_container_width=True):
        if not demo_name or not demo_email:
            st.warning("Name and email are required.")
            st.stop()

        run_id = start_run("autofill_demo", {"mode": fill_mode})
        st.info("Opening Chrome — watch your screen.")
        t0 = time.perf_counter()
        try:
            autofill_form(
                name         = demo_name,
                email        = demo_email,
                phone        = demo_phone,
                linkedin     = demo_linkedin,
                resume_text  = demo_resume,
                cover_letter = demo_cover,
                mode         = fill_mode,
                typing_delay = fill_delay,
                field_pause  = fill_pause,
            )
            _record_timed_event(run_id, "autofill_form", "playwright:autofill", t0)
            finish_run(run_id, status="success", summary={"mode": fill_mode})
            st.success("Demo complete — application submitted!")
        except Exception as e:
            _record_timed_event(run_id, "autofill_form", "playwright:autofill", t0, error=str(e))
            finish_run(run_id, status="failed", summary={"reason": "autofill_error"})
            st.error(f"Demo failed: {e}")


# ── History tab ────────────────────────────────────────────────────────────────

with tab_history:
    history = load_history()

    if not history:
        st.info("No jobs analyzed yet. Use the Analyze tab to get started.")
    else:
        rows = list(reversed(history))
        df = pd.DataFrame(rows)

        display_cols = ["date", "title", "score"]
        if "saved_to" in df.columns:
            display_cols.append("saved_to")

        st.dataframe(
            df[display_cols].rename(columns={
                "date": "Date", "title": "Job Title",
                "score": "Score", "saved_to": "Saved File",
            }),
            use_container_width=True,
            hide_index=True,
        )

        st.markdown("**URLs**")
        for entry in rows:
            st.markdown(f"- [{entry.get('title', 'Unknown')}]({entry.get('url', '#')})")

        st.divider()
        if st.button("Clear History", type="secondary"):
            Path("history.json").write_text("[]")
            st.rerun()


# ── Observability tab ───────────────────────────────────────────────────────────

with tab_observability:
    st.subheader("Agent Observability Timeline")
    st.caption("Per-run traces across scraping, LLM calls, and browser automation.")

    timeline = get_timeline_events(limit_runs=30, limit_events=400)
    if not timeline:
        st.info("No run traces yet. Execute Analyze, Browse, Cover Letter, or Demo actions first.")
    else:
        timeline_df = pd.DataFrame(timeline)
        show_cols = [
            "time", "run_id", "run_type", "run_status", "step", "tool_call",
            "latency_ms", "prompt_tokens", "completion_tokens", "total_tokens", "retry_of", "error",
        ]
        st.dataframe(
            timeline_df[show_cols],
            use_container_width=True,
            hide_index=True,
        )

    st.divider()
    st.subheader("Automation Drift Monitor")
    st.caption("Alerts fire when recent selector reliability drops versus baseline.")

    alerts = get_selector_alerts()
    if alerts:
        alert_df = pd.DataFrame(alerts)
        st.warning(f"{len(alert_df)} selector drift alert(s) detected.")
        st.dataframe(
            alert_df[["severity", "context", "selector", "recent_rate", "overall_rate", "drop", "attempts", "last_error"]],
            use_container_width=True,
            hide_index=True,
        )
    else:
        st.success("No selector drift alerts right now.")

    reliability = get_selector_reliability(min_attempts=1)
    if reliability:
        rel_df = pd.DataFrame(reliability)
        st.dataframe(
            rel_df[["context", "selector", "attempts", "successes", "recent_rate", "overall_rate", "avg_latency_ms", "last_error"]],
            use_container_width=True,
            hide_index=True,
        )
