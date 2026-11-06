# CIE Semantic Interpretation and Evidence Retrieval
**Specification CIE-SER-01 · 2026-11-05 · Owner-directed design clarification · Implementation not yet accepted**

> **Authority:** Subordinate to Constitution 00; Charters 04, 05, 06, 07, 08, 12, 14, 15 and 16; and [UMCR-01](../architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md). This document specifies *how* the established Context Intelligence Engine can understand information needs; it does not establish a new memory owner, a planner, or a privileged AI identity. Source owners and the existing native policy gateway remain authoritative.
>
> **Program boundary:** Architecture Recovery may reconcile contracts, measure current lexical baselines, and build an isolated evaluation spike. Production model-assisted retrieval, automatic memory learning and full cross-provider continuity belong to Full Aerynth Realization unless a minimal integration defect must first be repaired.

## 1. Problem and intended behavior

Today the Personal Context preview ranks approved fact keywords, Vela history retrieval uses token overlap, mission context uses lexical scoring, and governance-context selects sections by terms with protected normative expansion. Those are bounded, source-aware baselines; they do **not** reliably understand paraphrase, implied intent, temporal updates, original reasoning versus current decisions, or which evidence would answer a complex question.

CIE must turn the user's task into an **evidence requirement**, discover adequate authorized sources, and produce a provenance-bound, provider-neutral context package. A related search hit is not proof that the question has been answered. A smaller prompt is not a successful outcome unless the required evidence remains intact.

### Outcomes
1. Interpret implicit references and semantic meaning without depending on keyword trigger lists.
2. Identify separately the original decision, later correction, current ratification, causal reasoning and other distinct evidence requirements.
3. Preserve directly selected resource IDs, hard constraints, source authority and known task checkpoints without model reinterpretation.
4. Distinguish **candidate found**, **source expanded**, **evidence verified**, **context attached**, **provider disclosed**, and **task completed**.
5. Recover from misunderstood or incomplete retrieval through a bounded evidence gap loop.
6. Support cheap, fast models when measured sufficient, never sacrificing critical recall or privacy for token savings.

## 2. Division of responsibility

| Component | Owns | Must not do |
|---|---|---|
| Native context-request host | Trusted user/task/selected-resource IDs, active scope, permissions, provider eligibility, policy and freshness | Derive authority from model-suggested IDs |
| **Semantic interpreter** (candidate: GPT-6 Luna) | Meaning, evidence requirements, temporal/reference hypotheses, optional query paraphrases | Authorize sources, select database credentials, mutate memory or execute user tasks |
| Canonical source adapters | Typed discovery and current versioned reads for conversations, projects, notes, missions, events, personal context and governance | Create a competing source of truth |
| Hybrid retrieval | Exact IDs, relationship traversal, FTS, scoped semantic candidates and current event/checkpoint discovery | Treat vector similarity as permission, truth or completeness |
| Evidence evaluator | Assess whether each requirement has supporting, opposing or missing evidence | Declare model confidence to be factual proof |
| Manifest compiler | Versioned, bounded context capsule with protected anchors, provenance, omissions, authorization and trace IDs | Quietly drop required constraints to satisfy a token budget |
| Provider/agent execution | Act or answer with permitted source-backed context and verified receipts | Rewrite CIE memory or infer permission from contextual relevance |

The interpreter is a **semantic request compiler**, not a second Vela, a generic task planner, a separate agent scheduler, or an alternative identity. AIR owns provider capability selection; CIE owns information need resolution. Both use one native policy gateway.

## 3. Two cooperating request representations

A trusted native `ContextRequestEnvelope` is assembled *before* the semantic call from actual selected resources, task IDs, scope, policy snapshot, freshness and provider destination. A model may receive a **policy-authorized minimal projection** of that envelope, not arbitrary private data.

The model returns a typed **`SemanticContextRequest` proposal**. The host validates it and attaches only host-resolved, eligible identifiers:

```ts
type SemanticContextRequestV1 = {
  schemaVersion: "aerynth.cie.semantic-request@1";
  taskKind: "answer" | "recall" | "compare" | "reconstruct-decision" |
            "continue-task" | "prepare-action" | "discover" | "unknown";
  objective: string;
  evidenceNeeds: Array<{
    key: string; question: string;
    evidenceKind: "current-state" | "original-source" | "historical-reasoning" |
                  "approved-decision" | "constraint" | "correction" |
                  "task-checkpoint" | "verification" | "relationship" | "other";
    required: boolean; sourceTypeHints: string[];
  }>;
  entityHints: string[];
  temporalIntent: "current" | "historical" | "historical-and-current" |
                  "ordered-changes" | "unspecified";
  semanticQueries: string[];
  contradictionCheck: boolean;
  freshnessNeed: "live" | "latest-known" | "historical" | "unspecified";
  ambiguity: string[];
  noRelevantMemoryExpected: boolean;
};
```

**Contract constraints:**
- Schema has a strict size bound, maximum candidate/evidence counts, enumerable fields, versioning and a defined `unknown` state. Implemented JSON Schema must respect the supported Structured Outputs subset (required fields, closed objects).
- All model strings are **untrusted hints**, not SQL fragments, filesystem paths to open, effective scopes, ACLs, trusted instructions or source citations.
- The effective principal, actual project/workspace/conversation/branch/task IDs, selected resources, permission and provider destination are supplied **only by the host**.
- A model-generated source ID is ignored unless independently resolved by the native source-owner interface and authorized; safer default is no such ID field in the model schema.
- If interpretation fails, refuses, times out or returns semantically incoherent output, use the existing permitted exact/FTS path and surface uncertainty. Never make up an interpretation or silently widen scope.

## 4. Retrieval execution

1. **Host anchors** user selection, explicit content, binding project constraints, current source version and live task checkpoints before any generative suggestion.
2. **Admit semantic understanding** only when ambiguity, historical reasoning, cross-source synthesis or evidence decomposition warrants its latency and data disclosure. Direct ID lookup and trusted local telemetry require no model.
3. **Interpret** eligible task text and approved contextual metadata with strict structured output; validate schema and limits locally.
4. **Discover** candidates from exact IDs, relationships, FTS, permitted semantic index and current revision metadata, with independent per-source coverage flags.
5. **Expand** actual current authorized source ranges; semantic chunks and embeddings are retrieval hints, never the evidence of record.
6. **Evaluate** evidence coverage: each required need is `supported | contradicted | missing | stale | inaccessible | uncertain`; attach source refs/revisions and locate contradictions. The evaluator proposes further searches, not conclusions or privileges.
7. **Recover** only where new evidence is plausibly accessible. Bound additional rounds, source fan-out, tokens, spend and time. If missing, return truthful partial coverage rather than a forced answer.
8. **Compile** typed inclusion/omission manifest; reauthorize each source for its actual destination immediately before egress; record digest and version.
9. **Learn** from source-verified user corrections or task evidence through existing memory policy. Semantic interpretation itself must never auto-promote facts.

Search modality can vary per evidence need. Current-state questions should refresh their authoritative owner. Historical reasoning should search contemporaneous discussions and later decisions. Contradictions require preserving multiple time-stamped sources. The semantics of user intent do **not** become an executable user operation.

## 5. Fast model strategy and OpenAI integration

Initial research candidate: `gpt-6-luna` via **Responses API Structured Outputs** for rich request compilation and bounded evidence review. As of 2026-11-05, the public model catalog describes Luna as an efficient focused model supporting structured outputs; provider/account availability must be confirmed at execution. Official references: [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

The [Decisions API](https://developers.openai.com/api/docs/guides/decisions) can optionally perform calibrated predicates/choices/scores when that is genuinely cheaper and more reliable; it is **not** the replacement for arbitrary structured requests. Do not require both calls on every turn. Do not treat an API model name, current rate, subscription credits, budget or eligibility as permanently guaranteed.

Model selection is a named, replaceable **semantic-interpreter role** qualified by AIR, with measured latency, validity, evidence recall, error rate, applicable cost and privacy. No hidden rule that every request must invoke a model, and no automatic escalation solely because a confidence number is low. Use an expensive model only if evaluated complex cases justify it.

**Privacy boundary:** Sending task text, conversation excerpts, embeddings, behavioral observations or memory passages to the interpreter is itself a provider disclosure. Subject it to original source-owner authority, user memory policy, provider consent, retention/residency settings, sensitivity and scope checks *before* the first call. Query-only interpretation can minimize disclosure but may not be possible for all ambiguous requests; an unavailable authorized model must not force private-data transfer.

## 6. Evidence coverage and failure modes

A `CoverageReport` accompanies every assembled package:
- Required evidence keys and matched source refs with current revision/time and reason for inclusion.
- Separate `verified-by-source`, `user-reported`, `inferred`, `historical`, `superseded` and `disputed` status.
- Missing, stale, unavailable or unauthorized source categories, including partial index coverage.
- Model proposal identifier, prompt/schema version, retrieval methods, rejected proposed hints, search rounds and approximate/actual cost.
- Exact provider dispatch manifest digest and policy version, including any redactions.
- No claim of hidden model reasoning, private thoughts or unseen provider history.

Fail closed on revoked ACLs, unknown task effects and illegal disclosure; fail gracefully to exact retrieval when vector or semantic services are down. A stale vector hit must be revalidated. Prompt injection in a retrieved note remains *source content*, never a new instruction.

## 7. Evaluation design: no more keyword 'intelligence'

Create a held-out, synthetic and privacy-safe corpus with independently labeled gold-source IDs, required claims and negative cases. Compare:
- Baseline current lexical retrieval.
- Exact/FTS/relationship retrieval.
- Hybrid lexical + embeddings.
- Hybrid + Luna-style semantic request compiler.
- Hybrid + evidence sufficiency/expansion pass.

**Mandatory cases:** paraphrases with no important shared terms; implicit referents; original-versus-latest governing decision; corrections and supersession; two contradictory sources; cross-branch permission denial; old but binding constraint; current telemetry versus expired reading; selected exact ID; partial indexing; missing source; source revocation during retrieval; malicious instruction inside retrieved text; provider outage; concurrent agent checkpoints; a question requiring *no* memory.

Track critical-source recall@k, evidence-need coverage, unsupported-answer rate, answer correctness after source verification, privacy leaks (required zero), retrieval p50/p95, model-call count, cost per *correct* task, cache/index staleness, rework and user-visible friction. Shorter prompts and a model reporting high confidence are **not** acceptance evidence.

Require an independent evaluator and source-labeled mistakes. Promote model assistance to the active path only when held-out metrics and native tests demonstrate material, reliable advantage without privacy regression. Shadow mode precedes active integration; regression baselines survive model changes.

## 8. Implementation stages and boundaries

**Architecture Recovery (now):** inventory current `previewContext`, history retriever, mission context, governance context and source adapters; define the native envelope and semantic proposal contract; benchmark lexical behavior; document missing authority/latency paths; implement isolated synthetic shadow experiments only. Do not build a new canonical database, another planner, or auto-learning in this workstream.

**Full Realization (later):** qualified model role; actual strict-output semantic interpreter; tested hybrid indexes; bounded evidence evaluation and expansion; approved automatic memory candidates; cross-provider context capsules; native Context Inspector; privacy deletion and measured adaptive behavior.

Migrate through adapters and existing canonical identities; no big-bang rewrite. The initial deliverable must demonstrate one genuine history-retrieval improvement on unseen paraphrases with sources and no scope expansion. Implement specialized mechanisms only when they earn their complexity.

## 9. Related authoritative documents

- [Charter 08: Context Intelligence and Memory](../../governance/08-CONTEXT-INTELLIGENCE-AND-MEMORY.md)
- [Charter 06: Vela Intelligence and Adaptation](../../governance/06-VELA-INTELLIGENCE-AND-ADAPTATION.md)
- [UMCR-01](../architecture/VELA-UNIFIED-MEMORY-AND-CONTEXT-RUNTIME.md)
- [Local-first storage and continuity](../architecture/AERYNTH-LOCAL-FIRST-STORAGE-AND-CONTINUITY.md)
- [ADR-002: Two programs and cohesive runtime](../decisions/ADR-002-ARCHITECTURE-RECOVERY-AND-COHESIVE-RUNTIME.md)
- [AIR](VELA-ADAPTIVE-INTELLIGENCE-ROUTING.md)
