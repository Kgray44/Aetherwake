import type { GitHubCommitEvidence, TimelineSourceCoverage } from "../../timeline-product/contracts.ts";
import { ensure } from "./contracts.mts";

const PAGE_SIZE = 30;
const MAX_BYTES = 1024 * 1024;
const PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

async function publicJson(url: URL, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    redirect: "error",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "Aerynth Development Timeline",
    },
  }).catch(() => null);
  ensure(response?.ok && response.body, "github_source_unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "", bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      ensure(bytes <= MAX_BYTES, "github_source_too_large");
      body += decoder.decode(value, { stream: true });
    }
    return { value: JSON.parse(body + decoder.decode()) as unknown, hasMore: /rel="next"/.test(response.headers.get("link") ?? "") };
  } catch {
    throw new Error("github_response_unusable");
  } finally {
    await reader.cancel().catch(() => {});
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export async function readPublicGitHubCommits(repository: string, signal: AbortSignal) {
  ensure(/^[a-z\d-]{1,39}\/[a-z\d_.-]{1,100}$/.test(repository) && !repository.endsWith("/.") && !repository.endsWith("/.."), "invalid_github_repository");
  const until = new Date(), requestedTo = until.toISOString();
  const requestedFrom = new Date(until.getTime() - PERIOD_MS).toISOString();
  const endpoint = `https://api.github.com/repos/${repository}`;
  const { value: metadata } = await publicJson(new URL(endpoint), signal);
  ensure(object(metadata) && metadata.private === false && typeof metadata.full_name === "string" &&
    metadata.full_name.toLowerCase() === repository && typeof metadata.default_branch === "string" &&
    metadata.default_branch.length > 0 && metadata.default_branch.length <= 240, "github_public_repository_required");
  const sourceLabel = metadata.full_name;
  const url = new URL(endpoint + "/commits");
  url.search = new URLSearchParams({ sha: metadata.default_branch, per_page: String(PAGE_SIZE), since: requestedFrom, until: requestedTo }).toString();
  const { value, hasMore } = await publicJson(url, signal);
  ensure(Array.isArray(value) && value.length <= PAGE_SIZE, "github_response_unusable");
  const commits: { sha: string; evidence: Omit<GitHubCommitEvidence, "source"> }[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!object(entry) || typeof entry.sha !== "string" || !/^[a-f\d]{40}$/.test(entry.sha) ||
        seen.has(entry.sha) || !object(entry.commit) || typeof entry.commit.message !== "string" ||
        !object(entry.commit.committer) || typeof entry.commit.committer.date !== "string") continue;
    const time = Date.parse(entry.commit.committer.date);
    if (!Number.isFinite(time) || time < Date.parse(requestedFrom) || time > until.getTime()) continue;
    const title = entry.commit.message.split(/\r?\n/, 1)[0]!.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 200).trim();
    if (!title) continue;
    seen.add(entry.sha);
    commits.push({ sha: entry.sha, evidence: { kind: "github-commit", title, reportedAt: new Date(time).toISOString(), timeSource: "github-committer" } });
  }
  const partial = hasMore || commits.length < value.length;
  const coverage: TimelineSourceCoverage = {
    kind: "github-commits", sourceLabel, requestedFrom, requestedTo, fetchedAt: new Date().toISOString(),
    status: partial ? "partial" : "bounded",
    ...(partial ? { omissionReason: "Only the first page of usable default-branch commits was imported." } : {}),
  };
  return { coverage, commits };
}
