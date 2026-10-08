(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./ai-guide'));
  } else {
    root.NightSky.ModelClient = factory(root.NightSky.AIGuide);
  }
})(globalThis, function (AI) {
  async function request(config, route, payload, fetcher = fetch) {
    const url = AI.modelUrl(config.url);
    const headers = {};
    if (payload) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetcher(url + route, {
        method: payload ? 'POST' : 'GET',
        headers,
        credentials: 'omit',
        redirect: 'error',
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(payload ? 120000 : 10000),
      });
    } catch {
      throw Error(
        'Cannot reach the model server. Check the URL and whether it allows this page’s origin.',
      );
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw Error('The Ollama endpoint denied access.');
      throw Error(
        `The model server returned HTTP ${response.status}. Check the endpoint and model ID.`,
      );
    }
    try {
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let bytes = 0,
        text = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1048576) {
            await reader.cancel();
            throw Error('Response too large.');
          }
          text += decoder.decode(value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
      } finally {
        reader.releaseLock();
      }
    } catch {
      throw Error('The model server returned an unreadable response.');
    }
  }

  async function models(config, fetcher) {
    const result = await request(config, '/api/tags', null, fetcher);
    const rows = result.models;
    if (!Array.isArray(rows))
      throw Error('This endpoint did not return a model list. Check the API base URL.');
    return rows
      .map((row) => row?.name || row?.model)
      .filter((name) => typeof name === 'string' && name && name.length <= 200)
      .slice(0, 100);
  }

  async function generate(plan, config, equipment, fetcher) {
    const model = String(config.model || '').trim();
    if (model.length > 200) throw Error('The model tag is too long.');
    if (!model) throw Error('Enter a model ID in Settings first.');
    const messages = [{ role: 'user', content: AI.prompt(plan, equipment) }];
    const result = await request(
      config,
      '/api/chat',
      { model, stream: false, format: AI.schema(plan), messages },
      fetcher,
    );
    return AI.parse(result.message?.content, plan, `Ollama · ${model}`);
  }

  return { models, generate };
});
