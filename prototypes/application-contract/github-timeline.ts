/** GitHub scope is an explicit public repository URL. Credentials and arbitrary
 * URLs are never passed into the development Timeline capability. */
export function githubRepository(value: string): string | null {
  const match = /^https:\/\/github\.com\/([a-z\d](?:[a-z\d-]{0,38}))\/([a-z\d_.-]{1,100})\/?$/i.exec(value.trim());
  const repo = match?.[2]?.replace(/\.git$/i, "");
  return match && repo && repo !== "." && repo !== ".." ? `${match[1]}/${repo}`.toLowerCase() : null;
}
export function namedGitHubRepositories(intent: string): string[] {
  return [...new Set([...intent.matchAll(/https:\/\/github\.com\/[a-z\d-]+\/[a-z\d_.-]+\/?/gi)]
    .filter(match => !/[\w/@?&#%]/.test(intent[(match.index ?? 0) + match[0].length] ?? ""))
    .flatMap(match => {
      const repository = githubRepository(match[0].replace(/\.+$/, ""));
      return repository ? [repository] : [];
    }))];
}

export interface GitHubTimelineOpen {
  name: "openCommit";
  input: { timelineId: string; eventId: string; cursor: number };
}

export type GitHubTimelineCommand = GitHubTimelineOpen | { name: "sources"; input: Record<string, never> };
