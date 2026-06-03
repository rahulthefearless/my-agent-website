const GITHUB_API = "https://api.github.com";

export class GitHubMemory {
  constructor(token, owner, repo) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.base = `${GITHUB_API}/repos/${owner}/${repo}/contents`;
    this.headers = {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github.v3+json",
    };
  }

  async getFile(path) {
    try {
      const r = await fetch(`${this.base}/${path}`, { headers: this.headers });
      if (r.status === 404) return null;
      const d = await r.json();
      return { content: atob(d.content.replace(/\n/g, "")), sha: d.sha };
    } catch {
      return null;
    }
  }

  async putFile(path, content, message, sha) {
    const body = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
    };
    if (sha) body.sha = sha;
    const r = await fetch(`${this.base}/${path}`, {
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return r.ok;
  }

  async loadMemory() {
    const file = await this.getFile("agent-memory/memory.json");
    if (!file)
      return {
        scenarios: [],
        convTraining: [],
        conversations: [],
        profile: { name: "", style: "", traits: [] },
      };
    try {
      return JSON.parse(file.content);
    } catch {
      return {
        scenarios: [],
        convTraining: [],
        conversations: [],
        profile: { name: "", style: "", traits: [] },
      };
    }
  }

  async saveMemory(data) {
    const existing = await this.getFile("agent-memory/memory.json");
    return this.putFile(
      "agent-memory/memory.json",
      JSON.stringify(data, null, 2),
      `🧠 Memory update — ${new Date().toISOString()}`,
      existing?.sha
    );
  }
}
