class CCClient {
  constructor({ url, team }) {
    if (!url) {
      throw new Error('CCClient requires a URL.');
    }
    if (!team) {
      throw new Error('CCClient requires a team.');
    }
    this.baseUrl = url;
    this.team = team;
  }

  async _request(method, path, body = null) {
    const headers = {
      'Content-Type': 'application/json',
      // X-Team header is not explicitly mentioned for every request in P2.2,
      // but it's a good practice and was in my previous implementation.
      // However, the instructions say 'sendMessage... with body {team: this.team, ...}'
      // and 'createTask... with body {team: this.team, ...}'.
      // This implies the team is sent in the body, not necessarily in a header.
      // Let's remove X-Team header for now, as it's not explicitly requested for _all_ calls
      // and team is now in the body for specific calls.
    };

    const options = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${path}`, options);
    const text = await response.text();

    if (!response.ok) {
      // Changed error message format as per P2.2 instructions
      throw new Error(`CC ${response.status}: ${text}`);
    }

    return text ? JSON.parse(text) : {};
  }

  async sendMessage({ from, to, text }) {
    // Added team to body as per P2.2 instructions
    return this._request('POST', '/api/messages', { team: this.team, from, to, text });
  }

  async createTask({ assignTo, type, payload, priority }) {
    // Added team to body as per P2.2 instructions
    return this._request('POST', '/api/tasks', { team: this.team, assignTo, type, payload, priority });
  }

  async listAgents() {
    return this._request('GET', '/api/agents/health');
  }

  async updateTaskStatus(id, { status, result }) {
    return this._request('PATCH', `/api/tasks/${id}`, { status, result });
  }
}

export { CCClient };
