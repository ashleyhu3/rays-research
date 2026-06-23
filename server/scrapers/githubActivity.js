const https = require('https');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'signal-dashboard/1.0',
        'Accept': 'application/vnd.github+json',
        ...headers,
      },
    };
    https.get(url, options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`JSON parse error for ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

const REPOS = [
  'huggingface/transformers',
  'langchain-ai/langchain',
  'ggerganov/llama.cpp',
  'vllm-project/vllm',
  'openai/whisper',
  'ollama/ollama',
  'microsoft/DeepSpeed',
  'AUTOMATIC1111/stable-diffusion-webui',
  // Agent/framework ecosystem
  'langchain-ai/langgraph',
  'crewAIInc/crewAI',
  'microsoft/autogen',
  'All-Hands-AI/OpenHands',
  'pydantic/pydantic-ai',
  'modelcontextprotocol/servers',
];

async function fetchCommitActivity(repo, headers) {
  const url = `https://api.github.com/repos/${repo}/stats/commit_activity`;
  let result = await fetchJson(url, headers);
  if (result.status === 202) {
    await sleep(5000);
    result = await fetchJson(url, headers);
  }
  if (result.status !== 200 || !Array.isArray(result.data)) return [];
  return result.data.map(w => w.total);
}

async function fetchNewRepoCount(query, headers) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=1`;
  const result = await fetchJson(url, headers);
  if (result.status !== 200) return 0;
  return result.data.total_count ?? 0;
}

async function getGitHubActivity() {
  const headers = {};
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  const commitResults = await Promise.allSettled(
    REPOS.map(repo => fetchCommitActivity(repo, headers))
  );
  const commits = {};
  REPOS.forEach((repo, i) => {
    commits[repo] = commitResults[i].status === 'fulfilled' ? commitResults[i].value : [];
  });

  const now = new Date();
  function daysAgo(n) {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  const [r30, r60, r90] = await Promise.allSettled([
    fetchNewRepoCount(`topic:llm created:>${daysAgo(30)}`, headers),
    fetchNewRepoCount(`topic:llm created:>${daysAgo(60)}`, headers),
    fetchNewRepoCount(`topic:llm created:>${daysAgo(90)}`, headers),
  ]);

  return {
    commits,
    newRepos: {
      last30d: r30.status === 'fulfilled' ? r30.value : 0,
      last60d: r60.status === 'fulfilled' ? r60.value : 0,
      last90d: r90.status === 'fulfilled' ? r90.value : 0,
    },
  };
}

module.exports = { getGitHubActivity };
