import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

const nativeFetch = window.fetch.bind(window);
const app = new App({ name: 'Humander', version: '0.1.0' }, {});
const ready = app.connect(new PostMessageTransport(window.parent, window.parent));
const nonce = window.HUMANDER_APP_NONCE;
const methods = { state: 'humander_app_state', models: 'humander_app_models', action: 'humander_app_action', document: 'humander_app_document' };

window.fetch = async (input, init = {}) => {
  const url = new URL(String(input), 'https://humander.local/');
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  try {
    await ready;
    const method = url.pathname.split('/').at(-1), name = methods[method];
    if (!name) throw new Error('Unknown panel request');
    const args = { nonce };
    if (method === 'models' && url.searchParams.has('provider')) args.provider = url.searchParams.get('provider');
    if (method === 'document') args.path = url.searchParams.get('path');
    if (method === 'action') args.input = JSON.parse(init.body);
    const result = await app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error(result.content?.[0]?.text || 'Panel request failed');
    const value = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? '{}');
    if (method === 'document') {
      const bytes = Uint8Array.from(atob(value.data), c => c.charCodeAt(0));
      return new Response(bytes, { status: 200, headers: { 'content-type': value.mimeType ?? 'application/octet-stream' } });
    }
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { 'content-type': 'application/json' } });
  }
};

window.addEventListener('DOMContentLoaded', () => {
  const button = document.createElement('button');
  button.textContent = 'Refresh / 刷新';
  button.className = 'secondary';
  button.onclick = () => { document.getElementById('connect')?.click(); };
  document.querySelector('header')?.append(button);
  const section = document.createElement('section');
  section.innerHTML = `<h2>Model providers / 模型供应商</h2>
    <p>OpenAI-compatible chat-completions endpoints. Keys stay in the local Humander state directory.</p>
    <div class="grid"><label>Provider ID<input id="wbProviderId" placeholder="deepseek"></label>
    <label>Name / 名称<input id="wbProviderName" placeholder="DeepSeek"></label>
    <label>Base URL<input id="wbProviderUrl" placeholder="https://api.example.com/v1"></label>
    <label>API key<input id="wbProviderKey" type="password" autocomplete="off"></label></div>
    <label>Model IDs, one per line / 模型 ID，每行一个<textarea id="wbProviderModels"></textarea></label>
    <label><input id="wbNoKey" type="checkbox"> Local loopback provider without API key / 本地模型无需密钥</label>
    <button id="wbSaveProvider">Save provider / 保存供应商</button><p id="wbProviderResult" role="status"></p>`;
  document.getElementById('teamSection')?.before(section);
  section.querySelector('#wbSaveProvider').onclick = async () => {
    const val = id => section.querySelector('#' + id).value.trim();
    const result = section.querySelector('#wbProviderResult');
    try {
      await ready;
      const response = await app.callServerTool({ name: 'humander_app_provider_save', arguments: { nonce, provider: {
        id: val('wbProviderId'), name: val('wbProviderName'), baseUrl: val('wbProviderUrl'), apiKey: val('wbProviderKey'),
        models: val('wbProviderModels').split(/\r?\n/).map(x => x.trim()).filter(Boolean), allowNoKey: section.querySelector('#wbNoKey').checked,
      } } });
      if (response.isError) throw new Error(response.content?.[0]?.text || 'Save failed');
      section.querySelector('#wbProviderKey').value = '';
      result.textContent = 'Saved. Refresh available models below. / 已保存，请在下方刷新模型。';
      document.getElementById('reloadModels')?.click();
    } catch (error) { result.textContent = error.message; }
  };
  const publication = document.createElement('section');
  publication.innerHTML = `<h2>Public evidence / 公开证据</h2>
    <p>Every submitted paper publishes its code and experiments to a public GitHub branch. Use a public repository and a token with Contents write access. The token stays on this computer.</p>
    <div class="grid"><label>GitHub owner<input id="wbOwner" placeholder="your-account"></label>
    <label>Repository / 仓库<input id="wbRepo" placeholder="humander-research"></label>
    <label>Branch / 分支<input id="wbBranch" value="humander-public"></label>
    <label>Fine-grained token<input id="wbGithubToken" type="password" autocomplete="off"></label></div>
    <button id="wbSavePublication">Save publication target / 保存发表目标</button><p id="wbPublicationResult" role="status"></p>`;
  section.after(publication);
  ready.then(async () => {
    const response = await app.callServerTool({ name: 'humander_app_state', arguments: { nonce } });
    const settings = response.structuredContent?.publication;
    if (settings) {
      publication.querySelector('#wbOwner').value = settings.owner ?? '';
      publication.querySelector('#wbRepo').value = settings.repo ?? '';
      publication.querySelector('#wbBranch').value = settings.branch ?? 'humander-public';
    }
  }).catch(() => {});
  publication.querySelector('#wbSavePublication').onclick = async () => {
    const val = id => publication.querySelector('#' + id).value.trim();
    const result = publication.querySelector('#wbPublicationResult');
    try {
      await ready;
      const response = await app.callServerTool({ name: 'humander_app_publication_save', arguments: { nonce, publication: {
        owner: val('wbOwner'), repo: val('wbRepo'), branch: val('wbBranch'), token: val('wbGithubToken'),
      } } });
      if (response.isError) throw new Error(response.content?.[0]?.text || 'Save failed');
      publication.querySelector('#wbGithubToken').value = '';
      result.textContent = 'Saved. Papers will be released during submission. / 已保存，论文投稿时公开。';
    } catch (error) { result.textContent = error.message; }
  };
});
