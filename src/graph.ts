import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { ChatOllama } from '@langchain/ollama';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { JsonOutputParser, StringOutputParser } from '@langchain/core/output_parsers';
import type { Analysis } from './types.js';

// ── State shared across graph nodes ──────────────────────────────────────────

const AnalysisState = Annotation.Root({
  jd:           Annotation<string>,
  resume:       Annotation<string>,
  requirements: Annotation<string[]>,
  nice_to_have: Annotation<string[]>,
  analysis:     Annotation<Analysis | null>,
});

type State = typeof AnalysisState.State;

// ── Node 1: extract structured requirements from the JD ───────────────────────
// Focused single task → lower hallucination than a combined prompt.

const EXTRACT_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `Extract requirements from this job description. Return ONLY valid JSON:
{{
  "requirements": ["must-have skills and experience, be specific"],
  "nice_to_have": ["preferred but not required qualifications"]
}}`],
  ['human', '{jd}'],
]);

async function extractRequirements(state: State): Promise<Partial<State>> {
  const llm = new ChatOllama({ model: 'gemma4:26b', temperature: 0, numCtx: 8192, think: false });
  const parser = new JsonOutputParser<{ requirements: string[]; nice_to_have: string[] }>();
  const chain = EXTRACT_PROMPT.pipe(llm).pipe(parser);
  const result = await chain.invoke({ jd: state.jd.slice(0, 5000) });
  return {
    requirements: result.requirements ?? [],
    nice_to_have: result.nice_to_have ?? [],
  };
}

// ── Node 2: score resume against the already-extracted requirements ───────────
// Gets structured requirements from node 1 as context — no re-parsing needed.

const SCORE_PROMPT = ChatPromptTemplate.fromMessages([
  ['system', `You are a technical recruiter. Score this resume against the job requirements.
Return ONLY valid JSON:
{{
  "title": "exact job title",
  "match_score": <integer 0-100>,
  "strengths": ["specific resume points that match"],
  "gaps": ["requirements not clearly demonstrated in the resume"],
  "summary": "2-3 sentence fit assessment"
}}`],
  ['human', `MUST-HAVE REQUIREMENTS:
{requirements}

NICE-TO-HAVE:
{nice_to_have}

RESUME:
{resume}`],
]);

async function scoreResume(state: State): Promise<Partial<State>> {
  const llm = new ChatOllama({ model: 'gemma4:26b', temperature: 0, numCtx: 16384, think: false });
  const parser = new JsonOutputParser<Omit<Analysis, 'requirements' | 'nice_to_have'>>();
  const chain = SCORE_PROMPT.pipe(llm).pipe(parser);

  const result = await chain.invoke({
    requirements: state.requirements.map(r => `• ${r}`).join('\n'),
    nice_to_have: state.nice_to_have.map(r => `• ${r}`).join('\n'),
    resume: state.resume.slice(0, 3000),
  });

  const analysis: Analysis = {
    title:        result.title       ?? '',
    requirements: state.requirements,
    nice_to_have: state.nice_to_have,
    match_score:  result.match_score ?? 0,
    strengths:    result.strengths   ?? [],
    gaps:         result.gaps        ?? [],
    summary:      result.summary     ?? '',
  };

  return { analysis };
}

// ── Compiled graph ─────────────────────────────────────────────────────────────

const workflow = new StateGraph(AnalysisState)
  .addNode('extract', extractRequirements)
  .addNode('score',   scoreResume)
  .addEdge(START,     'extract')
  .addEdge('extract', 'score')
  .addEdge('score',   END);

export const analysisGraph = workflow.compile();

export async function analyzeWithGraph(jd: string, resume: string): Promise<Analysis> {
  const result = await analysisGraph.invoke({
    jd,
    resume,
    requirements: [],
    nice_to_have: [],
    analysis:     null,
  });

  if (!result.analysis) throw new Error('Graph returned no analysis');
  return result.analysis;
}
