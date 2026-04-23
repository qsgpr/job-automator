from datetime import datetime
from time import perf_counter
from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.exceptions import OutputParserException


ANALYSIS_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are a technical recruiter and career coach.
Analyze the job description and resume provided. Return ONLY valid JSON with this exact structure — no extra text:

{{
  "title": "the exact job title from the job description",
  "requirements": ["list of must-have skills and experience from the JD"],
  "nice_to_have": ["preferred but not required qualifications"],
  "match_score": <integer 0 to 100>,
  "strengths": ["specific resume points that match the job well"],
  "gaps": ["requirements in the JD not clearly demonstrated in the resume"],
  "summary": "2-3 sentence summary of the role and how well the candidate fits"
}}"""),
    ("human", "JOB DESCRIPTION:\n{job_description}\n\nRESUME:\n{resume}"),
])


def _extract_token_usage(response) -> dict:
    """Best-effort token extraction from Ollama/LangChain metadata."""
    md = getattr(response, "response_metadata", {}) or {}
    usage = md.get("token_usage", {}) if isinstance(md.get("token_usage"), dict) else {}

    prompt_tokens = usage.get("prompt_tokens") or md.get("prompt_eval_count") or md.get("input_tokens")
    completion_tokens = usage.get("completion_tokens") or md.get("eval_count") or md.get("output_tokens")
    total_tokens = usage.get("total_tokens")
    if total_tokens is None and isinstance(prompt_tokens, int) and isinstance(completion_tokens, int):
        total_tokens = prompt_tokens + completion_tokens

    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }


def analyze_with_metrics(job_description: str, resume: str) -> tuple[dict, list[dict]]:
    """
    Analyze a JD against a resume and return (analysis, llm_attempts_metrics).

    Each attempt metric includes:
      attempt, tool_call, temperature, latency_ms, token_usage, error, retry_of
    """
    parser = JsonOutputParser()
    messages = ANALYSIS_PROMPT.format_messages(job_description=job_description, resume=resume)
    attempts = []

    for attempt in range(2):
        temperature = 0 if attempt == 0 else 0.1
        llm = ChatOllama(model="gemma4:26b", temperature=temperature)
        t0 = perf_counter()

        try:
            response = llm.invoke(messages)
            latency_ms = (perf_counter() - t0) * 1000
            token_usage = _extract_token_usage(response)
            parsed = parser.parse(response.content)

            attempts.append({
                "attempt": attempt + 1,
                "tool_call": "ollama:gemma4:26b",
                "temperature": temperature,
                "latency_ms": latency_ms,
                "token_usage": token_usage,
                "error": None,
                "retry_of": attempt if attempt > 0 else None,
            })
            return parsed, attempts

        except (OutputParserException, ValueError) as e:
            latency_ms = (perf_counter() - t0) * 1000
            usage = locals().get("token_usage", {})
            attempts.append({
                "attempt": attempt + 1,
                "tool_call": "ollama:gemma4:26b",
                "temperature": temperature,
                "latency_ms": latency_ms,
                "token_usage": usage,
                "error": str(e),
                "retry_of": attempt if attempt > 0 else None,
            })
            if attempt == 0:
                print("  (model returned invalid JSON — retrying with higher temperature...)")
                continue
            raise RuntimeError(
                "Gemma returned malformed JSON after 2 attempts.\n"
                "The model may be overloaded or the job description too long.\n"
                f"Detail: {e}"
            )
        except Exception as e:
            latency_ms = (perf_counter() - t0) * 1000
            attempts.append({
                "attempt": attempt + 1,
                "tool_call": "ollama:gemma4:26b",
                "temperature": temperature,
                "latency_ms": latency_ms,
                "token_usage": {},
                "error": str(e),
                "retry_of": attempt if attempt > 0 else None,
            })
            raise RuntimeError(
                f"Analysis failed: {e}\n"
                "Is Ollama running? Try: ollama serve"
            )

    raise RuntimeError("Analysis failed unexpectedly")


def analyze(job_description: str, resume: str) -> dict:
    """Backwards-compatible analysis API used by existing callers."""
    result, _ = analyze_with_metrics(job_description, resume)
    return result


def load_resume(path: str = "resume.txt") -> str:
    with open(path) as f:
        content = f.read().strip()
    if not content:
        raise ValueError("resume.txt is empty — paste your resume text into it first")
    return content


def format_report(analysis: dict) -> str:
    """
    Build the analysis report as a string.
    Returning a string (instead of printing directly) lets us both
    display it on screen and save it to a file with the same function.
    """
    line = "=" * 60
    parts = [f"\n{line}", "JOB ANALYSIS REPORT", line]

    title = analysis.get("title", "")
    if title:
        parts.append(f"\nPosition: {title}")

    score = analysis.get("match_score", "?")
    if isinstance(score, int):
        filled = score // 5
        bar = "#" * filled + "-" * (20 - filled)
    else:
        bar = "?"
    parts.append(f"\nMatch Score: {score}/100  [{bar}]")
    parts.append(f"\nSummary:\n  {analysis.get('summary', '')}")

    def section(heading, items, icon="•"):
        if not items:
            return []
        return [f"\n--- {heading} ---"] + [f"  {icon} {item}" for item in items]

    parts += section("Key Requirements", analysis.get("requirements", []))
    parts += section("Nice to Have", analysis.get("nice_to_have", []))
    parts += section("Your Strengths", analysis.get("strengths", []), icon="✓")
    parts += section("Gaps to Address", analysis.get("gaps", []), icon="✗")
    parts.append(f"\n{line}")

    return "\n".join(parts)


def print_report(analysis: dict) -> None:
    print(format_report(analysis))


RESUME_PARSE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """Extract contact information from the resume below.
Return ONLY valid JSON with exactly these fields (use empty string if not found):
{{
  "name":     "the person's full name",
  "email":    "email address",
  "phone":    "phone number as written in the resume",
  "linkedin": "LinkedIn URL or username",
  "location": "city and state or country"
}}"""),
    ("human", "{resume}"),
])


def parse_resume(resume_text: str) -> dict:
    """
    Use Gemma to pull structured contact info out of a resume.

    Only the first 2000 characters are sent — contact info is always
    at the top of a resume so we don't need the full document.

    Returns a dict with keys: name, email, phone, linkedin, location.
    Missing fields are empty strings.
    """
    llm    = ChatOllama(model="gemma4:26b", temperature=0)
    parser = JsonOutputParser()
    chain  = RESUME_PARSE_PROMPT | llm | parser
    try:
        raw = chain.invoke({"resume": resume_text[:2000]})
        return {k: str(v).strip() for k, v in raw.items() if v}
    except Exception:
        return {}


COVER_LETTER_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """You are an expert career coach. Write a professional cover letter.
Return ONLY the cover letter body text — no date, no address header, no subject line.
3-4 tight paragraphs, under 380 words.

Structure:
1. Opening: one sentence connecting to the company's mission and why this role excites you
2. Body: 2-3 specific experiences from the resume that directly match the role requirements
3. Skills paragraph: weave in the highlighted skills naturally, not as a list
4. Closing: confident call to action"""),
    ("human", """Company: {company}
Role: {role}
Skills to highlight: {skills}

Resume:
{resume}"""),
])


def generate_cover_letter(company: str, role: str, resume: str, skills: str = "") -> str:
    """
    Generate a tailored cover letter using Gemma.
    skills is a comma-separated string of things to emphasize.
    Returns the cover letter as plain text.
    """
    llm = ChatOllama(model="gemma4:26b", temperature=0.3)
    chain = COVER_LETTER_PROMPT | llm

    result = chain.invoke({
        "company": company,
        "role": role,
        "resume": resume,
        "skills": skills or "relevant technical experience",
    })
    return result.content.strip()


if __name__ == "__main__":
    sample_jd = """
    Python Backend Engineer

    Requirements:
    - 3+ years Python experience
    - FastAPI or Django for REST APIs
    - PostgreSQL and SQL proficiency
    - Experience with Docker
    - Git and CI/CD workflows

    Nice to have:
    - Kubernetes, AWS or GCP, Redis, LangChain
    """

    try:
        resume = load_resume()
    except ValueError as e:
        print(f"Note: {e}\nUsing placeholder resume for demo.\n")
        resume = "Engineer with Python, REST APIs, and PostgreSQL experience."

    print("Running sample analysis with Gemma...")
    result = analyze(sample_jd, resume)
    print_report(result)
